import { createRequire } from 'module';
import { z } from 'zod';
import { complete, getCacheIdentity } from './knowledge-llm';
import { llmCache } from './knowledge-llm-cache';

const requireCli = createRequire(import.meta.url);
const { sha256Hex, canonicalJson } = requireCli('../../../../scripts/lib/core/context-hash.js') as {
  sha256Hex: (value: string) => string;
  canonicalJson: (value: string) => string;
};

export const SEMANTIC_EDGES_PROMPT_VERSION = 'semantic-edges-v1';
export const NODE_SUMMARY_PROMPT_VERSION = 'node-summary-v1';

const SEMANTIC_EDGES_PROMPT =
  `You are a knowledge-graph analyst. Given a list of nodes from a software repository's
knowledge graph, identify unlisted semantic relationships between them.

Each node has: id, kind (adr|artifact|wiki|knowledge|memory|architecture|feature), title, and optional body.
Return ONLY a JSON object with an "edges" array. Each edge must have:
  src   – id of the source node (the declarer)
  dst   – id of the target node (the declared)
  verb  – one of: supersedes, builds-on, references, describes

Rules:
- Only emit edges whose src AND dst appear in the provided node list.
- Do not emit self-edges, duplicate edges, or edges already present in the existing edge list.
- Return at most 30 edges. If uncertain, omit.
- Do not explain; return only the JSON.

Respond with valid JSON only, no markdown fences.`.trim();

const NODE_SUMMARY_PROMPT =
  `You are a concise technical writer. Given nodes from a knowledge graph, write a 1–2 sentence
summary of what each node is and why it matters in the context of this software repository.

Respond with valid JSON only, no markdown fences. Return:
{ "summaries": [ { "nodeId": "<id>", "summary": "<text>" } ] }

Summarise ONLY the nodes provided. Return at most one summary per node. Be precise and factual; do not hallucinate details.`.trim();

function hashPrompt(version: string, prompt: string): string {
  return sha256Hex(`${version}\0${prompt}`);
}

export const SEMANTIC_EDGES_PROMPT_HASH = hashPrompt(
  SEMANTIC_EDGES_PROMPT_VERSION,
  SEMANTIC_EDGES_PROMPT,
);
export const NODE_SUMMARY_PROMPT_HASH = hashPrompt(
  NODE_SUMMARY_PROMPT_VERSION,
  NODE_SUMMARY_PROMPT,
);

const MAX_INPUT_NODES = 256;
const MAX_INPUT_EDGES = 512;
const MAX_ID_LENGTH = 256;
const MAX_KIND_LENGTH = 32;
const MAX_TITLE_LENGTH = 512;
const MAX_EDGE_VERB_LENGTH = 32;
const MAX_EDGE_BODY_LENGTH = 300;
const MAX_SUMMARY_BODY_LENGTH = 600;
const MAX_INFERRED_EDGES = 30;
const MAX_SUMMARIES = MAX_INPUT_NODES;
const VALID_VERBS = ['supersedes', 'builds-on', 'references', 'describes'] as const;

const BoundedIdSchema = z.string().min(1).max(MAX_ID_LENGTH);
const NodeInputSchema = z.object({
  id: BoundedIdSchema,
  kind: z.string().min(1).max(MAX_KIND_LENGTH),
  title: z.string().min(1).max(MAX_TITLE_LENGTH),
  body: z.string().max(MAX_SUMMARY_BODY_LENGTH).optional(),
});
const EdgeInputSchema = z.object({
  src: BoundedIdSchema,
  dst: BoundedIdSchema,
  verb: z.string().min(1).max(MAX_EDGE_VERB_LENGTH),
});
const SemanticEdgesSchema = z.object({
  edges: z
    .array(
      z.object({
        src: BoundedIdSchema,
        dst: BoundedIdSchema,
        verb: z.enum(VALID_VERBS),
      }),
    )
    .max(MAX_INFERRED_EDGES),
});
const NodeSummarySchema = z.object({
  summaries: z
    .array(
      z.object({
        nodeId: BoundedIdSchema,
        summary: z.string().min(1).max(512),
      }),
    )
    .max(MAX_SUMMARIES),
});

export interface InferenceProvenance {
  model: string;
  provider: string;
  timestamp: string;
  promptHash: string;
}

export interface InferredEdge {
  src: string;
  dst: string;
  verb: 'supersedes' | 'builds-on' | 'references' | 'describes';
}

export interface InferredSummary {
  nodeId: string;
  summary: string;
}

export interface FacadeResult<T> {
  items: T[];
  provenance: InferenceProvenance;
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

function hashContent(value: unknown): string {
  return sha256Hex(canonicalJson(JSON.stringify(value)));
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('invalid-json');
  }
}

function cacheIdentity(
  promptHash: string,
  contentHash: string,
): {
  key: string;
  provenance: InferenceProvenance;
} {
  const identity = getCacheIdentity();
  return {
    key: JSON.stringify([
      identity.provider,
      identity.endpoint,
      identity.model,
      promptHash,
      contentHash,
    ]),
    provenance: {
      provider: identity.provider,
      model: identity.model,
      timestamp: new Date().toISOString(),
      promptHash,
    },
  };
}

function normalizeNodes(nodes: NodeInput[], bodyLimit: number): NodeInput[] {
  const bounded = nodes.map((node) => ({
    ...node,
    ...(node.body ? { body: node.body.slice(0, bodyLimit) } : {}),
  }));
  const validated = z.array(NodeInputSchema).max(MAX_INPUT_NODES).parse(bounded);
  const seen = new Set<string>();
  return validated.map((node) => {
    if (seen.has(node.id)) throw new Error('duplicate-input-node');
    seen.add(node.id);
    return node;
  });
}

function normalizeEdges(edges: EdgeInput[]): EdgeInput[] {
  return z.array(EdgeInputSchema).max(MAX_INPUT_EDGES).parse(edges);
}

function validateSemanticEdges(
  parsed: unknown,
  nodeIds: Set<string>,
  existingEdges: Set<string>,
): InferredEdge[] {
  const edges = SemanticEdgesSchema.parse(parsed).edges;
  const seen = new Set<string>();

  for (const edge of edges) {
    const key = `${edge.src}|${edge.dst}|${edge.verb}`;
    if (!nodeIds.has(edge.src) || !nodeIds.has(edge.dst)) throw new Error('unknown-node-reference');
    if (edge.src === edge.dst) throw new Error('invalid-self-edge');
    if (existingEdges.has(key)) throw new Error('existing-edge-reference');
    if (seen.has(key)) throw new Error('duplicate-edge-reference');
    seen.add(key);
  }

  return [...edges].sort((a, b) =>
    `${a.src}\0${a.dst}\0${a.verb}`.localeCompare(`${b.src}\0${b.dst}\0${b.verb}`),
  );
}

function validateSummaries(parsed: unknown, nodeIds: Set<string>): InferredSummary[] {
  const summaries = NodeSummarySchema.parse(parsed).summaries;
  const seen = new Set<string>();

  for (const summary of summaries) {
    if (!nodeIds.has(summary.nodeId)) throw new Error('unknown-node-reference');
    if (seen.has(summary.nodeId)) throw new Error('duplicate-summary-reference');
    seen.add(summary.nodeId);
  }

  return [...summaries].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

export async function inferSemanticEdges(
  nodes: NodeInput[],
  existingEdges: EdgeInput[],
): Promise<FacadeResult<InferredEdge>> {
  const compactNodes = normalizeNodes(nodes, MAX_EDGE_BODY_LENGTH);
  const compactEdges = normalizeEdges(existingEdges);
  const nodeIds = new Set(compactNodes.map((node) => node.id));
  const existingSet = new Set(compactEdges.map((edge) => `${edge.src}|${edge.dst}|${edge.verb}`));
  const request = { nodes: compactNodes, existingEdges: compactEdges };
  const contentHash = hashContent(request);
  const { key, provenance } = cacheIdentity(SEMANTIC_EDGES_PROMPT_HASH, contentHash);

  return llmCache.getOrFetch(key, async () => {
    const raw = await complete('semantic-edges', SEMANTIC_EDGES_PROMPT, JSON.stringify(request));
    return {
      items: validateSemanticEdges(parseJson(raw), nodeIds, existingSet),
      provenance,
    };
  }) as Promise<FacadeResult<InferredEdge>>;
}

export async function inferNodeSummaries(
  nodes: NodeInput[],
): Promise<FacadeResult<InferredSummary>> {
  const compactNodes = normalizeNodes(nodes, MAX_SUMMARY_BODY_LENGTH);
  const nodeIds = new Set(compactNodes.map((node) => node.id));
  const request = { nodes: compactNodes };
  const contentHash = hashContent(request);
  const { key, provenance } = cacheIdentity(NODE_SUMMARY_PROMPT_HASH, contentHash);

  return llmCache.getOrFetch(key, async () => {
    const raw = await complete('node-summaries', NODE_SUMMARY_PROMPT, JSON.stringify(request));
    return {
      items: validateSummaries(parseJson(raw), nodeIds),
      provenance,
    };
  }) as Promise<FacadeResult<InferredSummary>>;
}
