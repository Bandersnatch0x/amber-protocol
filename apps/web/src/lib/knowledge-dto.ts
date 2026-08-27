export type GraphLayer = 'decision' | 'knowledge' | 'implementation';

export interface KnowledgeNode {
  id: string;
  kind: 'adr' | 'artifact' | 'wiki' | 'knowledge' | 'memory' | 'architecture' | 'feature';
  layer: GraphLayer;
  title: string;
  status?: string;
  sourcePath: string;
  updated?: string;
  paths?: string[];
  contextPage?: string;
  revisions?: number;
  body?: string;
}

export interface KnowledgeEdgeDTO {
  src: string;
  dst: string;
  verb: 'supersedes' | 'builds-on' | 'references' | 'describes';
  origin: 'deterministic' | 'inferred';
  evidence?: Array<{ path: string; line?: number }>;
  provenance?: { model: string; timestamp: string; promptHash: string };
}

export interface DriftFinding {
  nodeId: string;
  kind: 'dead-anchor';
  path: string;
  detail: string;
  actualPath?: string;
}

export interface KnowledgeGraphDTO {
  schemaVersion: '1';
  nodes: KnowledgeNode[];
  edges: KnowledgeEdgeDTO[];
  drift: DriftFinding[];
  recentChanges: RecentChangeItem[];
}

export interface RecentChangeItem {
  id: string;
  source: 'git' | 'feature' | 'adr' | 'drift' | 'maintenance';
  title: string;
  time: string;
  linkTo?: 'sessions' | 'gates' | 'transcripts' | 'routes' | 'governance';
  linkId?: string;
  linkLabel?: string;
}

export interface NodeSummaryDTO {
  nodeId: string;
  summary: string;
  provenance: {
    model: string;
    timestamp: string;
    promptHash: string;
  };
  origin: 'inferred';
}

export interface SemanticResultDTO {
  available: boolean;
  inferredEdges: KnowledgeEdgeDTO[];
  nodeSummaries: NodeSummaryDTO[];
  providerModel?: string;
  timestamp?: string;
  error?: string;
}

export interface LLMStatusDTO {
  available: boolean;
  provider?: string;
  model?: string;
}
