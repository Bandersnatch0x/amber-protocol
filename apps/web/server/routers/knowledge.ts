import { createRequire } from 'module';
import { router, publicProcedure } from '../trpc';
import { listRecentChanges } from '../lib/knowledge-recent';
import { resolveRepoRoot } from '../lib/repo-root';
import { getStatus } from '../lib/knowledge-llm';
import { inferSemanticEdges, inferNodeSummaries } from '../lib/knowledge-llm-prompts';
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

export function selectSemanticInputs(nodes: KnowledgeNode[]): {
  edgeNodes: KnowledgeNode[];
  summaryNodes: KnowledgeNode[];
} {
  return {
    edgeNodes: nodes,
    summaryNodes: nodes.filter((node) => node.body),
  };
}

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
    } catch {
      console.warn('[knowledge.semantic] graph read failed');
      return {
        available: true,
        inferredEdges: [],
        nodeSummaries: [],
        error: 'graph-unavailable',
      };
    }

    const nodes = raw.nodes.map(adaptNode);
    const semanticInputs = selectSemanticInputs(nodes);
    const existingEdges = raw.edges
      .filter((edge) => EDGE_VERBS.has(edge.verb as KnowledgeEdgeDTO['verb']))
      .map((edge) => ({ src: edge.src, dst: edge.dst, verb: edge.verb }));

    const [edgeOutcome, summaryOutcome] = await Promise.allSettled([
      inferSemanticEdges(semanticInputs.edgeNodes, existingEdges),
      inferNodeSummaries(semanticInputs.summaryNodes),
    ]);
    const errors: string[] = [];

    let inferredEdges: KnowledgeEdgeDTO[] = [];
    if (edgeOutcome.status === 'fulfilled') {
      inferredEdges = edgeOutcome.value.items.map((edge) => ({
        ...edge,
        origin: 'inferred' as const,
        provenance: edgeOutcome.value.provenance,
      }));
    } else {
      console.warn('[knowledge.semantic] semantic-edges facade failed');
      errors.push('semantic-edges-unavailable');
    }

    let nodeSummaries: NodeSummaryDTO[] = [];
    if (summaryOutcome.status === 'fulfilled') {
      nodeSummaries = summaryOutcome.value.items.map((summary) => ({
        ...summary,
        provenance: summaryOutcome.value.provenance,
        origin: 'inferred' as const,
      }));
    } else {
      console.warn('[knowledge.semantic] node-summaries facade failed');
      errors.push('node-summaries-unavailable');
    }

    return {
      available: true,
      inferredEdges,
      nodeSummaries,
      providerModel: status.model,
      ...(errors.length > 0 ? { error: errors.join(',') } : {}),
    };
  }),
});
