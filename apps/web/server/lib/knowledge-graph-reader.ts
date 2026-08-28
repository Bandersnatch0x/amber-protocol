import { createRequire } from 'module';
import type {
  DriftFinding,
  GraphLayer,
  KnowledgeEdgeDTO,
  KnowledgeGraphDTO,
  KnowledgeNode,
} from '../../src/lib/knowledge-dto';

const requireCli = createRequire(import.meta.url);
const { buildKnowledgeGraph } = requireCli('../../../../scripts/lib/web-adapter.js') as {
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
const ORIGINS = new Set<KnowledgeEdgeDTO['origin']>(['deterministic', 'inferred']);

function adaptNode(node: RawNode): KnowledgeNode {
  if (!NODE_KINDS.has(node.kind as KnowledgeNode['kind'])) {
    throw new Error(`Unknown node kind from parser: ${node.kind}`);
  }
  if (!NODE_LAYERS.has(node.layer as GraphLayer)) {
    throw new Error(`Unknown node layer from parser: ${node.layer}`);
  }
  return {
    id: node.id,
    kind: node.kind as KnowledgeNode['kind'],
    layer: node.layer as GraphLayer,
    title: node.title,
    sourcePath: node.sourcePath,
    ...(node.status !== undefined ? { status: node.status } : {}),
    ...(node.updated !== undefined ? { updated: node.updated } : {}),
    ...(node.paths !== undefined ? { paths: node.paths } : {}),
    ...(node.contextPage !== undefined ? { contextPage: node.contextPage } : {}),
    ...(node.revisions !== undefined ? { revisions: node.revisions } : {}),
    ...(node.body !== undefined ? { body: node.body } : {}),
  };
}

function adaptEdge(edge: RawEdge): KnowledgeEdgeDTO {
  if (!EDGE_VERBS.has(edge.verb as KnowledgeEdgeDTO['verb'])) {
    throw new Error(`Unknown edge verb from parser: ${edge.verb}`);
  }
  if (!ORIGINS.has(edge.provenance as KnowledgeEdgeDTO['origin'])) {
    throw new Error(`Unknown edge provenance from parser: ${edge.provenance}`);
  }
  return {
    src: edge.src,
    dst: edge.dst,
    verb: edge.verb as KnowledgeEdgeDTO['verb'],
    origin: edge.provenance as KnowledgeEdgeDTO['origin'],
    ...(edge.evidence ? { evidence: edge.evidence } : {}),
  };
}

function adaptDrift(drift: RawDrift): DriftFinding {
  if (drift.kind !== 'dead-anchor') {
    throw new Error(`Unknown drift kind from parser: ${drift.kind}`);
  }
  return {
    nodeId: drift.nodeId,
    kind: 'dead-anchor',
    path: drift.path,
    detail: drift.detail,
    ...(drift.actualPath ? { actualPath: drift.actualPath } : {}),
  };
}

export function readKnowledgeGraphSnapshot(repoRoot: string): KnowledgeGraphDTO {
  const raw = buildKnowledgeGraph(repoRoot);
  return {
    schemaVersion: raw.schemaVersion,
    nodes: raw.nodes.map(adaptNode),
    edges: raw.edges.map(adaptEdge),
    drift: raw.drift.map(adaptDrift),
    recentChanges: [],
  };
}
