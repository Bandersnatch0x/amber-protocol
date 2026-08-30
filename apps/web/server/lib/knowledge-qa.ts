import { createRequire } from 'module';
import { z } from 'zod';
import type {
  KnowledgeAnswerSegmentDTO,
  KnowledgeAskResultDTO,
  KnowledgeGraphDTO,
} from '../../src/lib/knowledge-dto';
import { MAX_CONTEXT_NODES, isDocumentNode } from '../../src/lib/knowledge-dto';
import { completeWithMetadata } from './knowledge-llm';

const requireCli = createRequire(import.meta.url);
const { sha256Hex, canonicalJson } = requireCli('../../../../scripts/lib/web-adapter.js') as {
  sha256Hex: (value: string) => string;
  canonicalJson: (value: string) => string;
};

export const CITED_QA_PROMPT_VERSION = 'cited-qa-v1';
export const CITED_QA_PROMPT =
  `You answer questions only from the supplied deterministic knowledge graph context.
Return valid JSON only, with this shape:
{ "segments": [ { "text": "one factual claim", "citations": ["node:id"] } ] }

Rules:
- Every segment must contain one concise factual claim and at least one cited node id from the supplied context.
- Never cite an id that is absent from the supplied context.
- Do not use outside knowledge, inferred edges, inferred summaries, or unstated assumptions.
- Prefer current nodes for current-state questions. Superseded nodes may be cited for historical claims.
- Return at most 24 segments, each with at most 12 citations.
- If the context cannot support an answer, return { "segments": [] }.
- Do not include markdown fences or fields other than segments, text, and citations.`.trim();
export const CITED_QA_PROMPT_HASH = sha256Hex(`${CITED_QA_PROMPT_VERSION}\0${CITED_QA_PROMPT}`);

const MAX_CONTEXT_EDGES = 512;
const MAX_CONTEXT_DRIFT = 256;
const MAX_CONTEXT_BYTES = 512 * 1024;
const MAX_SEGMENTS = 24;
const MAX_SEGMENT_TEXT_BYTES = 4 * 1024;
const MAX_CITATIONS_PER_SEGMENT = 12;
const MAX_ID_BYTES = 1024;

const ProviderAnswerSchema = z
  .object({
    segments: z
      .array(
        z
          .object({
            text: z
              .string()
              .trim()
              .min(1)
              .max(MAX_SEGMENT_TEXT_BYTES)
              .refine(
                (value) => Buffer.byteLength(value, 'utf8') <= MAX_SEGMENT_TEXT_BYTES,
                'segment-text-too-large',
              ),
            citations: z
              .array(
                z
                  .string()
                  .min(1)
                  .max(MAX_ID_BYTES)
                  .refine(
                    (value) => Buffer.byteLength(value, 'utf8') <= MAX_ID_BYTES,
                    'citation-id-too-large',
                  ),
              )
              .max(MAX_CITATIONS_PER_SEGMENT),
          })
          .strict(),
      )
      .max(MAX_SEGMENTS),
  })
  .strict();

export class KnowledgeAskError extends Error {
  constructor(readonly code: 'invalid-focus-node' | 'context-overflow' | 'uncitable-answer') {
    super(code);
    this.name = 'KnowledgeAskError';
  }
}

interface ContextAssembly {
  context: string;
  contextDigest: string;
  nodeIds: Set<string>;
}

/**
 * The read-time LLM layer is a document surface (F060): Code Nodes and the
 * code-only verbs never enter context, citations, or the ceiling math. The
 * imports/anchors edges vanish with their code endpoints, so prompts and
 * their hashes stay byte-identical to F059.
 */
function documentScope(snapshot: KnowledgeGraphDTO): KnowledgeGraphDTO {
  const nodes = snapshot.nodes.filter(isDocumentNode);
  const documentIds = new Set(nodes.map((node) => node.id));
  return {
    ...snapshot,
    nodes,
    edges: snapshot.edges.filter((edge) => documentIds.has(edge.src) && documentIds.has(edge.dst)),
    drift: snapshot.drift.filter((finding) => documentIds.has(finding.nodeId)),
  };
}

// Byte order, matching the deterministic graph builder: localeCompare is
// ICU/locale sensitive, so the same snapshot could otherwise digest
// differently on differently configured servers.
function stable<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((left, right) => {
    const a = key(left);
    const b = key(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function focusedNodeIds(snapshot: KnowledgeGraphDTO, focusNodeId?: string): Set<string> {
  const allIds = new Set(snapshot.nodes.map((node) => node.id));
  if (!focusNodeId) return allIds;
  if (!allIds.has(focusNodeId)) throw new KnowledgeAskError('invalid-focus-node');

  const deterministicEdges = snapshot.edges.filter((edge) => edge.origin === 'deterministic');
  let frontier = new Set([focusNodeId]);
  const included = new Set(frontier);
  for (let depth = 0; depth < 2; depth += 1) {
    const next = new Set<string>();
    for (const edge of deterministicEdges) {
      if (frontier.has(edge.src) && !included.has(edge.dst)) next.add(edge.dst);
      if (frontier.has(edge.dst) && !included.has(edge.src)) next.add(edge.src);
    }
    for (const id of next) included.add(id);
    frontier = next;
  }
  return included;
}

function assertContextBounds(
  nodeCount: number,
  edgeCount: number,
  driftCount: number,
  context: string,
) {
  if (
    nodeCount > MAX_CONTEXT_NODES ||
    edgeCount > MAX_CONTEXT_EDGES ||
    driftCount > MAX_CONTEXT_DRIFT ||
    Buffer.byteLength(context, 'utf8') > MAX_CONTEXT_BYTES
  ) {
    throw new KnowledgeAskError('context-overflow');
  }
}

export function assembleKnowledgeContext(
  snapshot: KnowledgeGraphDTO,
  focusNodeId: string | undefined,
  promptVersion = CITED_QA_PROMPT_VERSION,
): ContextAssembly {
  const scoped = documentScope(snapshot);
  const includedIds = focusedNodeIds(scoped, focusNodeId);
  const nodes = stable(
    scoped.nodes.filter((node) => includedIds.has(node.id)),
    (node) => node.id,
  );
  const edges = stable(
    scoped.edges.filter(
      (edge) =>
        edge.origin === 'deterministic' && includedIds.has(edge.src) && includedIds.has(edge.dst),
    ),
    (edge) => `${edge.src}\0${edge.dst}\0${edge.verb}`,
  ).map(({ src, dst, verb, evidence }) => ({
    src,
    dst,
    verb,
    ...(evidence ? { evidence } : {}),
  }));
  const drift = stable(
    scoped.drift.filter((finding) => includedIds.has(finding.nodeId)),
    (finding) => `${finding.nodeId}\0${finding.path}\0${finding.detail}`,
  );
  const context = canonicalJson(
    JSON.stringify({
      promptVersion,
      focusNodeId: focusNodeId ?? null,
      nodes,
      edges,
      drift,
    }),
  );
  assertContextBounds(nodes.length, edges.length, drift.length, context);
  return { context, contextDigest: sha256Hex(context), nodeIds: includedIds };
}

export function validateCitedAnswer(
  raw: string,
  snapshot: KnowledgeGraphDTO,
): {
  segments: KnowledgeAnswerSegmentDTO[];
  omittedCount: number;
  supersededBy: Record<string, string[]>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('invalid-json');
  }
  const answer = ProviderAnswerSchema.parse(parsed);
  const validNodeIds = new Set(documentScope(snapshot).nodes.map((node) => node.id));
  const segments: KnowledgeAnswerSegmentDTO[] = [];
  let omittedCount = 0;

  for (const segment of answer.segments) {
    if (Buffer.byteLength(segment.text, 'utf8') > MAX_SEGMENT_TEXT_BYTES) {
      throw new Error('segment-text-too-large');
    }
    const citations = [...new Set(segment.citations)].filter((id) => validNodeIds.has(id));
    if (citations.length === 0) {
      omittedCount += 1;
      continue;
    }
    segments.push({ text: segment.text, citations });
  }

  if (segments.length === 0) throw new KnowledgeAskError('uncitable-answer');
  const citedIds = new Set(segments.flatMap((segment) => segment.citations));
  const supersededBy: Record<string, string[]> = {};
  for (const edge of stable(
    snapshot.edges.filter(
      (candidate) =>
        candidate.origin === 'deterministic' &&
        candidate.verb === 'supersedes' &&
        citedIds.has(candidate.dst),
    ),
    (candidate) => `${candidate.dst}\0${candidate.src}`,
  )) {
    const superseders = (supersededBy[edge.dst] ??= []);
    if (!superseders.includes(edge.src)) superseders.push(edge.src);
  }
  return { segments, omittedCount, supersededBy };
}

export async function answerKnowledgeQuestion(
  snapshot: KnowledgeGraphDTO,
  question: string,
  focusNodeId?: string,
): Promise<KnowledgeAskResultDTO> {
  const assembly = assembleKnowledgeContext(snapshot, focusNodeId);
  const userMessage = JSON.stringify({ question, context: assembly.context });
  const exchange = await completeWithMetadata('cited-qa', CITED_QA_PROMPT, userMessage);
  const answer = validateCitedAnswer(exchange.output, snapshot);
  return {
    status: 'ok',
    answer: { segments: answer.segments },
    omittedCount: answer.omittedCount,
    supersededBy: answer.supersededBy,
    request: {
      question,
      ...(focusNodeId ? { focusNodeId } : {}),
    },
    contextDigest: assembly.contextDigest,
    questionDigest: sha256Hex(question),
    exchangeDigest: sha256Hex(userMessage),
    provenance: {
      provider: exchange.identity.provider,
      model: exchange.identity.model,
      timestamp: exchange.timestamp,
      promptHash: CITED_QA_PROMPT_HASH,
    },
  };
}
