import { createHash } from 'crypto';
import { z } from 'zod';
import { complete, getStatus } from './knowledge-llm';
import { llmCache } from './knowledge-llm-cache';

// ── Prompt version 1: semantic-edges ──────────────────────────────────────────
const SEMANTIC_EDGES_PROMPT =
  `You are a knowledge-graph analyst. Given a list of nodes from a software repository's
knowledge graph, identify unlisted semantic relationships between them.

Each node has: id, kind (adr|artifact|wiki|memory|architecture|feature), title, and optional body.
Return ONLY a JSON object with an "edges" array. Each edge must have:
  src   – id of the source node (the declarer)
  dst   – id of the target node (the declared)
  verb  – one of: supersedes, builds-on, references, describes

Rules:
- Only emit edges whose src AND dst appear in the provided node list.
- Omit edges that are already present in the existing edge list.
- Return at most 30 edges. If uncertain, omit.
- Do not explain; return only the JSON.

Respond with valid JSON only, no markdown fences.`.trim();

// ── Prompt version 1: node-summary ────────────────────────────────────────────
const NODE_SUMMARY_PROMPT =
  `You are a concise technical writer. Given a node from a knowledge graph, write a 1–2 sentence
summary of what it is and why it matters in the context of this software repository.

Respond with valid JSON only, no markdown fences. Return:
{ "summaries": [ { "nodeId": "<id>", "summary": "<text>" } ] }

Summarise ONLY the nodes provided. Be precise and factual; do not hallucinate details.`.trim();

// ── Stable version hashes ──────────────────────────────────────────────────────
export const SEMANTIC_EDGES_PROMPT_HASH = createHash('sha256')
  .update(SEMANTIC_EDGES_PROMPT)
  .digest('hex')
  .slice(0, 16);

export const NODE_SUMMARY_PROMPT_HASH = createHash('sha256')
  .update(NODE_SUMMARY_PROMPT)
  .digest('hex')
  .slice(0, 16);

// ── Zod schemas for bounded JSON output ───────────────────────────────────────
const VALID_VERBS = ['supersedes', 'builds-on', 'references', 'describes'] as const;

const SemanticEdgesSchema = z.object({
  edges: z.array(
    z.object({
      src: z.string().min(1),
      dst: z.string().min(1),
      verb: z.enum(VALID_VERBS),
    }),
  ),
});

const NodeSummarySchema = z.object({
  summaries: z.array(
    z.object({
      nodeId: z.string().min(1),
      summary: z.string().min(1).max(512),
    }),
  ),
});

// ── Types ─────────────────────────────────────────────────────────────────────
export interface InferredEdge {
  src: string;
  dst: string;
  verb: 'supersedes' | 'builds-on' | 'references' | 'describes';
}

export interface InferredSummary {
  nodeId: string;
  summary: string;
}

export interface NodeInput {
  id: string;
  kind: string;
  title: string;
  body?: string;
}

export interface EdgeInput {
  src: string;
  dst: string;
  verb: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function hashContent(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function currentModel(): string {
  return process.env.LLM_MODEL ?? 'gpt-4o-mini';
}

// ── Facade 1: semantic edges ──────────────────────────────────────────────────
/**
 * All-or-nothing: throws on provider failure, JSON parse error, or schema
 * validation error. No partial results are returned.
 */
export async function inferSemanticEdges(
  nodes: NodeInput[],
  existingEdges: EdgeInput[],
): Promise<InferredEdge[]> {
  const status = getStatus();
  if (!status.available) throw new Error('LLM unavailable');

  const compact = nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    ...(n.body ? { body: n.body.slice(0, 300) } : {}),
  }));

  const existingSet = new Set(existingEdges.map((e) => `${e.src}|${e.dst}|${e.verb}`));

  const contentHash = hashContent(
    JSON.stringify(compact) + '|' + JSON.stringify([...existingSet].sort()),
  );
  const cacheKey = `${contentHash}:${SEMANTIC_EDGES_PROMPT_HASH}:${currentModel()}`;

  const raw = await llmCache.getOrFetch(cacheKey, () => {
    const userMessage =
      `Nodes:\n${JSON.stringify(compact, null, 0)}\n\n` +
      `Existing edges (do not repeat):\n${JSON.stringify(existingEdges, null, 0)}`;
    return complete(SEMANTIC_EDGES_PROMPT, userMessage);
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('LLM semantic-edges response is not valid JSON');
  }

  const validated = SemanticEdgesSchema.parse(parsed);

  const nodeIds = new Set(nodes.map((n) => n.id));
  return validated.edges.filter(
    (e) =>
      nodeIds.has(e.src) &&
      nodeIds.has(e.dst) &&
      !existingSet.has(`${e.src}|${e.dst}|${e.verb}`),
  );
}

// ── Facade 2: node summaries ──────────────────────────────────────────────────
/**
 * All-or-nothing: throws on provider failure, JSON parse error, or schema
 * validation error.
 */
export async function inferNodeSummaries(nodes: NodeInput[]): Promise<InferredSummary[]> {
  const status = getStatus();
  if (!status.available) throw new Error('LLM unavailable');

  const compact = nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    ...(n.body ? { body: n.body.slice(0, 600) } : {}),
  }));

  const contentHash = hashContent(JSON.stringify(compact));
  const cacheKey = `${contentHash}:${NODE_SUMMARY_PROMPT_HASH}:${currentModel()}`;

  const raw = await llmCache.getOrFetch(cacheKey, () => {
    const userMessage = `Nodes:\n${JSON.stringify(compact, null, 0)}`;
    return complete(NODE_SUMMARY_PROMPT, userMessage);
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('LLM node-summary response is not valid JSON');
  }

  const validated = NodeSummarySchema.parse(parsed);

  const nodeIds = new Set(nodes.map((n) => n.id));
  return validated.summaries.filter((s) => nodeIds.has(s.nodeId));
}
