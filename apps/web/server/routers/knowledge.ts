import { createRequire } from 'module';
import { router, publicProcedure } from '../trpc';
import { listRecentChanges } from '../lib/knowledge-recent';
import { resolveRepoRoot } from '../lib/repo-root';
import { getStatus } from '../lib/knowledge-llm';
import {
  inferSemanticEdges,
  inferNodeSummaries,
  SEMANTIC_EDGES_PROMPT_HASH,
  NODE_SUMMARY_PROMPT_HASH,
} from '../lib/knowledge-llm-prompts';
import type {
  GraphLayer,
  KnowledgeNode,
  KnowledgeGraphDTO,
  KnowledgeEdgeDTO,
  DriftFinding,
  LLMStatusDTO,
  SemanticResultDTO,
  NodeSummaryDTO,
} from '../../src/lib/knowledge-dto';

const requireCli = createRequire(import.meta.url);
const { buildKnowledgeGraph } = requireCli('../../../../scripts/lib/core/knowledge-graph.js') as {
  buildKnowledgeGraph: (target: string) => RawGraph;
};

interface RawEdge {
  src: string;
  dst: string;
  verb: string;
  provenance: string;
  evidence?: Array<{ path: string; line?: number }>;
}

interface RawDrift {
  nodeId: string;
  kind: string;
  path: string;
  detail: string;
  actualPath?: string;
}

interface RawNode {
  id: string;
  kind: string;
  layer: string;
  title: string;
  sourcePath: string;
  status?: string;
  updated?: string;
  paths?: string[];
  contextPage?: string;
  revisions?: number;
  body?: string;
}

interface RawGraph {
  schemaVersion: '1';
  nodes: RawNode[];
  edges: RawEdge[];
  drift: RawDrift[];
}

const NODE_KINDS = new Set<KnowledgeNode['kind']>([
  'adr',
  'artifact',
  'wiki',
  'knowledge',
  'memory',
  'architecture',
  'feature',
]);
const NODE_LAYERS = new Set<GraphLayer>(['decision', 'knowledge', 'implementation']);
const EDGE_VERBS = new Set<KnowledgeEdgeDTO['verb']>([
  'supersedes',
  'builds-on',
  'references',
  'describes',
]);
const ORIGINS = new Set<'deterministic' | 'inferred'>(['deterministic', 'inferred']);

function adaptNode(n: RawNode): KnowledgeNode {
  if (!NODE_KINDS.has(n.kind as KnowledgeNode['kind'])) {
    throw new Error(`Unknown node kind from parser: ${n.kind}`);
  }
  if (!NODE_LAYERS.has(n.layer as GraphLayer)) {
    throw new Error(`Unknown node layer from parser: ${n.layer}`);
  }
  const node: KnowledgeNode = {
    id: n.id,
    kind: n.kind as KnowledgeNode['kind'],
    layer: n.layer as GraphLayer,
    title: n.title,
    sourcePath: n.sourcePath,
  };
  if (n.status !== undefined) node.status = n.status;
  if (n.updated !== undefined) node.updated = n.updated;
  if (n.paths !== undefined) node.paths = n.paths;
  if (n.contextPage !== undefined) node.contextPage = n.contextPage;
  if (n.revisions !== undefined) node.revisions = n.revisions;
  if (n.body !== undefined) node.body = n.body;
  return node;
}

function adaptEdge(e: RawEdge): KnowledgeEdgeDTO {
  if (!EDGE_VERBS.has(e.verb as KnowledgeEdgeDTO['verb'])) {
    throw new Error(`Unknown edge verb from parser: ${e.verb}`);
  }
  if (!ORIGINS.has(e.provenance as 'deterministic' | 'inferred')) {
    throw new Error(`Unknown edge provenance from parser: ${e.provenance}`);
  }
  return {
    src: e.src,
    dst: e.dst,
    verb: e.verb as KnowledgeEdgeDTO['verb'],
    origin: e.provenance as 'deterministic' | 'inferred',
    ...(e.evidence ? { evidence: e.evidence } : {}),
  };
}

function adaptDrift(d: RawDrift): DriftFinding {
  if (d.kind !== 'dead-anchor') {
    throw new Error(`Unknown drift kind from parser: ${d.kind}`);
  }
  return {
    nodeId: d.nodeId,
    kind: 'dead-anchor',
    path: d.path,
    detail: d.detail,
    ...(d.actualPath ? { actualPath: d.actualPath } : {}),
  };
}

function adaptGraph(raw: RawGraph): KnowledgeGraphDTO {
  return {
    schemaVersion: raw.schemaVersion,
    nodes: raw.nodes.map(adaptNode),
    edges: raw.edges.map(adaptEdge),
    drift: raw.drift.map(adaptDrift),
    recentChanges: [],
  };
}

const CONTENT_KINDS = new Set(['adr', 'wiki', 'memory', 'architecture']);

export const knowledgeRouter = router({
  graph: publicProcedure.query((): KnowledgeGraphDTO => {
    const repoRoot = resolveRepoRoot();
    const raw = buildKnowledgeGraph(repoRoot);
    return adaptGraph(raw);
  }),
  recentChanges: publicProcedure.query(() => listRecentChanges(resolveRepoRoot())),

  semanticStatus: publicProcedure.query((): LLMStatusDTO => {
    return getStatus();
  }),

  semantic: publicProcedure.query(async (): Promise<SemanticResultDTO> => {
    const status = getStatus();
    if (!status.available) {
      return { available: false, inferredEdges: [], nodeSummaries: [] };
    }

    let raw: RawGraph;
    try {
      raw = buildKnowledgeGraph(resolveRepoRoot());
    } catch (err) {
      return {
        available: true,
        inferredEdges: [],
        nodeSummaries: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const nodes = raw.nodes.map(adaptNode);
    const existingEdges = raw.edges
      .filter((e) => EDGE_VERBS.has(e.verb as KnowledgeEdgeDTO['verb']))
      .map((e) => ({ src: e.src, dst: e.dst, verb: e.verb }));

    const timestamp = new Date().toISOString();
    const model = status.model;

    let inferredEdges: KnowledgeEdgeDTO[] = [];
    let nodeSummaries: NodeSummaryDTO[] = [];
    const errors: string[] = [];

    try {
      const contentNodes = nodes.filter((n) => CONTENT_KINDS.has(n.kind));
      const inferred = await inferSemanticEdges(contentNodes, existingEdges);
      inferredEdges = inferred.map((e) => ({
        src: e.src,
        dst: e.dst,
        verb: e.verb,
        origin: 'inferred' as const,
        provenance: { model, timestamp, promptHash: SEMANTIC_EDGES_PROMPT_HASH },
      }));
    } catch (err) {
      errors.push(`edges: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const summaryNodes = nodes.filter((n) => CONTENT_KINDS.has(n.kind) && n.body);
      const summaries = await inferNodeSummaries(summaryNodes);
      nodeSummaries = summaries.map((s) => ({
        nodeId: s.nodeId,
        summary: s.summary,
        provenance: { model, timestamp, promptHash: NODE_SUMMARY_PROMPT_HASH },
        origin: 'inferred' as const,
      }));
    } catch (err) {
      errors.push(`summaries: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      available: true,
      inferredEdges,
      nodeSummaries,
      providerModel: model,
      timestamp,
      ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
    };
  }),
});
