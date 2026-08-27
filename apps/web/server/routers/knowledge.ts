import { createRequire } from 'module';
import { router, publicProcedure } from '../trpc';
import { resolveRepoRoot } from '../lib/repo-root';
import type { KnowledgeGraphDTO, KnowledgeEdgeDTO, DriftFinding } from '../../src/features/knowledge/types';

const requireCli = createRequire(import.meta.url);
const { buildKnowledgeGraph } = requireCli(
  '../../../../scripts/lib/core/knowledge-graph.js',
) as { buildKnowledgeGraph: (target: string) => RawGraph };

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
}

interface RawGraph {
  schemaVersion: '1';
  nodes: RawNode[];
  edges: RawEdge[];
  drift: RawDrift[];
}

function adaptGraph(raw: RawGraph): KnowledgeGraphDTO {
  return {
    schemaVersion: raw.schemaVersion,
    nodes: raw.nodes as KnowledgeGraphDTO['nodes'],
    edges: raw.edges.map(
      (e): KnowledgeEdgeDTO => ({
        src: e.src,
        dst: e.dst,
        verb: e.verb as KnowledgeEdgeDTO['verb'],
        origin: e.provenance as 'deterministic' | 'inferred',
        ...(e.evidence ? { evidence: e.evidence } : {}),
      }),
    ),
    drift: raw.drift.map(
      (d): DriftFinding => ({
        nodeId: d.nodeId,
        kind: 'dead-anchor',
        path: d.path,
        detail: d.detail,
        ...(d.actualPath ? { actualPath: d.actualPath } : {}),
      }),
    ),
    recentChanges: [],
  };
}

export const knowledgeRouter = router({
  graph: publicProcedure.query((): KnowledgeGraphDTO => {
    const repoRoot = resolveRepoRoot();
    const raw = buildKnowledgeGraph(repoRoot);
    return adaptGraph(raw);
  }),
});
