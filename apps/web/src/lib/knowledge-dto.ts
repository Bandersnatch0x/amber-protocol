export type GraphLayer = 'decision' | 'knowledge' | 'implementation';

/**
 * Node ceiling shared by the QA context assembly and the semantic layer, which
 * both refuse rather than truncate past it. Server enforcement and the UI's
 * pre-emptive hint read the same number. The ceiling is document-scale: Code
 * Nodes never enter the LLM layer (F060 — the read-time LLM surface stays a
 * document surface; deterministic code edges are never LLM-authored).
 */
export const MAX_CONTEXT_NODES = 256;

/** One exported symbol of a Code Node (1-based source position). */
export interface CodeSymbol {
  name: string;
  startLine: number;
  startCol: number;
}

/**
 * The document-scale rule shared by every LLM-adjacent seam (F060): Code
 * Nodes never enter QA context, semantic inference, or the ceiling math.
 */
export function isDocumentNode(node: Pick<KnowledgeNode, 'kind'>): boolean {
  return node.kind !== 'code';
}

/**
 * Nodes in this stream are always deterministic, so `provenance` stops at the
 * CLI output the schema validates; only inferred edges and summaries carry it
 * here. See ADR-0021 and the F059 spec's deterministic-layer section. Code
 * Nodes (ADR-0025) are file-level: their exported-symbol table rides as a
 * property, never as child nodes.
 */
export interface KnowledgeNode {
  id: string;
  kind: 'adr' | 'artifact' | 'wiki' | 'memory' | 'architecture' | 'feature' | 'code';
  layer: GraphLayer;
  title: string;
  status?: string;
  sourcePath: string;
  updated?: string;
  paths?: string[];
  symbols?: CodeSymbol[];
  contextPage?: string;
  revisions?: number;
  body?: string;
}

export interface KnowledgeEdgeDTO {
  src: string;
  dst: string;
  verb: 'supersedes' | 'builds-on' | 'references' | 'describes' | 'imports' | 'anchors';
  origin: 'deterministic' | 'inferred';
  evidence?: Array<{ path: string; line?: number }>;
  provenance?: { provider: string; model: string; timestamp: string; promptHash: string };
}

export interface DriftFinding {
  nodeId: string;
  kind: 'dead-anchor';
  path: string;
  detail: string;
  actualPath?: string;
}

export interface KnowledgeGraphDTO {
  schemaVersion: '2';
  /** Extraction toolchain provenance behind the code layer (F060). */
  toolchain: { typescript: string };
  nodes: KnowledgeNode[];
  edges: KnowledgeEdgeDTO[];
  drift: DriftFinding[];
  /** Always empty here; live aggregation is the separate recentChanges query. */
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
    provider: string;
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

export interface KnowledgeAnswerSegmentDTO {
  text: string;
  citations: string[];
}

export type KnowledgeAskResultDTO =
  | { status: 'unavailable'; reason: 'not-configured' | 'invalid-config' }
  | {
      status: 'ok';
      answer: { segments: KnowledgeAnswerSegmentDTO[] };
      omittedCount: number;
      supersededBy: Record<string, string[]>;
      request: {
        question: string;
        focusNodeId?: string;
      };
      contextDigest: string;
      questionDigest: string;
      exchangeDigest: string;
      provenance: {
        provider: string;
        model: string;
        timestamp: string;
        promptHash: string;
      };
    };

export interface LLMStatusDTO {
  available: boolean;
  reason?: 'not-configured' | 'invalid-config';
  provider?: string;
  model?: string;
}
