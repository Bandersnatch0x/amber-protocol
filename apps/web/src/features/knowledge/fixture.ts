import type { Edge, Node } from '@xyflow/react';

export type GraphLayer = 'decision' | 'knowledge' | 'implementation';

export interface KnowledgeNode {
  id: string;
  kind: 'adr' | 'artifact' | 'knowledge' | 'memory' | 'architecture' | 'feature';
  layer: GraphLayer;
  title: string;
  status?: string;
  sourcePath: string;
  updated?: string;
  paths?: string[];
  contextPage?: string;
  revisions?: number;
}

export interface KnowledgeEdgeDTO {
  src: string;
  dst: string;
  verb: 'supersedes' | 'builds-on' | 'references' | 'describes';
  origin: 'deterministic' | 'inferred';
  evidence?: Array<{ path: string; line: number }>;
  provenance?: { model: string; timestamp: string; promptHash: string };
}

export interface DriftFinding {
  nodeId: string;
  kind: 'dead-anchor';
  path: string;
  detail: string;
}

export interface KnowledgeGraphDTO {
  schemaVersion: '1';
  nodes: KnowledgeNode[];
  edges: KnowledgeEdgeDTO[];
  drift: DriftFinding[];
}

const ADR_TITLES: Array<[string, string, string]> = [
  ['adr:0001', 'Scaffold versions and drift classes', 'Accepted'],
  ['adr:0002', 'Wiki as governance surface', 'Accepted'],
  ['adr:0003', 'Governance-gated execution', 'Accepted'],
  ['adr:0004', 'Evidence-first acceptance', 'Accepted'],
  ['adr:0005', 'Session manifests and timeline', 'Accepted'],
  ['adr:0006', 'Viewer is .amber-only', 'Accepted'],
  ['adr:0007', 'Web console role — supervised action viewer', 'Accepted'],
  ['adr:0008', 'Rule packs and team distribution', 'Accepted'],
  ['adr:0009', 'Contract-driven context distillation', 'Accepted'],
  ['adr:0010', 'Context Loadouts and budgets', 'Accepted'],
  ['adr:0011', 'Timeline events schema', 'Accepted'],
  ['adr:0012', 'Action Types as governed verbs', 'Accepted'],
  ['adr:0013', 'Source adapters for context', 'Accepted'],
  ['adr:0014', 'Memory write-back pipeline', 'Accepted'],
  ['adr:0015', 'Context verification codes', 'Accepted'],
  ['adr:0016', 'Loop contracts', 'Accepted'],
  ['adr:0017', 'Structural identity', 'Accepted'],
  ['adr:0018', 'Governed MEMORY.md write-back', 'Accepted'],
  ['adr:0019', 'Sync envelopes', 'Accepted'],
  ['adr:0020', 'Governed local commit (Stage A)', 'Accepted'],
  ['adr:0021', 'Governance Graph projection', 'Accepted'],
  ['adr:0022', 'Program authority documents', 'Accepted'],
  ['adr:0023', 'Canonical Planning Artifacts', 'Accepted'],
  ['adr:0024', 'Principal registry', 'Accepted'],
];

const WIKI_PAGES: Array<[string, string]> = [
  ['knowledge:amber-ontology-mcp', 'Amber Ontology MCP'],
  ['knowledge:knowledge-base-lifecycle', 'Knowledge Base lifecycle'],
  ['knowledge:context-distillation', 'Context distillation playbook'],
  ['knowledge:memory-writeback', 'Memory write-back rules'],
  ['knowledge:loop-engineering', 'Loop engineering'],
  ['knowledge:artifact-admission', 'Artifact admission'],
  ['knowledge:principal-governance', 'Principal governance'],
  ['knowledge:projection-rebuild', 'Projection rebuild'],
  ['knowledge:eval-suite', 'Instruction-surface Evals'],
  ['knowledge:sync-transport', 'Sync transport'],
];

const ARCH_PAGES: Array<[string, string]> = [
  ['architecture:web-viewer', 'Web viewer'],
  ['architecture:cli-entry', 'CLI entry'],
  ['architecture:core-engine', 'Core engine'],
  ['architecture:governance-graph', 'Governance graph store'],
  ['architecture:context-store', 'Context store'],
  ['architecture:memory-store', 'Memory store'],
  ['architecture:loop-runtime', 'Loop runtime'],
  ['architecture:schema-seam', 'Schema contract seam'],
  ['architecture:eval-harness', 'Eval harness'],
];

const MEMORY_PAGES: Array<[string, string]> = [
  ['memory:bug-hunting-leads', 'Bug-hunting leads'],
  ['memory:web-session-status', 'Web session-status convergence'],
  ['memory:exec-capture-tail', 'Exec capture tail slicing'],
];

const FEATURE_IDS = [
  'F001',
  'F002',
  'F003',
  'F004',
  'F005',
  'F006',
  'F007',
  'F008',
  'F009',
  'F010',
  'F011',
  'F012',
  'F013',
  'F014',
  'F015',
  'F016',
  'F017',
  'F018',
  'F019',
  'F020',
  'F021',
  'F022',
  'F023',
  'F024',
  'F025',
  'F026',
  'F027',
  'F028',
  'F029',
  'F030',
];

const FEATURE_TITLES: Record<string, string> = {
  F001: 'V1 scaffold',
  F007: 'Governance-gated execution',
  F018: 'MCP governance seam',
  F040: 'Sync transport report',
  F041: 'ADR-0020 Stage A commit',
  F044: 'tRPC 11 upgrade',
  F045: 'React 19 upgrade',
  F046: 'Web build chain upgrade',
  F047: 'React-hooks warnings cleared',
  F048: 'Prettier pre-commit coverage',
  F049: 'Canonical Planning Artifacts',
  F050: 'Decisions, gates, evidence',
  F057: 'Eval grill/review fixes',
  F058: 'Instruction-surface Eval suite',
};

const FEATURE_STATUS: Record<string, string> = {
  F058: 'passing',
  F049: 'accepted',
  F050: 'accepted',
};

const FEATURE_PATHS: Record<string, string[]> = {
  F001: ['scripts/lib/core/scaffolding.js'],
  F007: ['scripts/lib/core/loops/'],
  F058: [
    'tests/unit/instruction-surface-evals.test.js',
    'scripts/lib/core/instruction-surface-evals.js',
  ],
};

function featureTitle(id: string): string {
  return FEATURE_TITLES[id] ?? `Feature ${id}`;
}

function adrNumber(id: string): string {
  return id.slice(4);
}

export const knowledgeGraphFixture: KnowledgeGraphDTO = {
  schemaVersion: '1',
  nodes: [
    ...ADR_TITLES.map(([id, title, status]): KnowledgeNode => ({
      id,
      kind: 'adr',
      layer: 'decision',
      title,
      status,
      sourcePath: `docs/adr/${adrNumber(id).padStart(4, '0')}-${title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')}.md`,
      updated: '2026-07-08',
    })),
    ...WIKI_PAGES.map(([id, title]): KnowledgeNode => ({
      id,
      kind: 'knowledge',
      layer: 'knowledge',
      title,
      sourcePath: `docs/wiki/knowledge/${id.split(':')[1]}/${id.split(':')[1]}.md`,
      updated: '2026-08-20',
    })),
    ...ARCH_PAGES.map(([id, title]): KnowledgeNode => ({
      id,
      kind: 'architecture',
      layer: 'knowledge',
      title,
      sourcePath: `docs/architecture/${id.split(':')[1]}.md`,
      updated: '2026-08-01',
    })),
    ...MEMORY_PAGES.map(([id, title]): KnowledgeNode => ({
      id,
      kind: 'memory',
      layer: 'knowledge',
      title,
      sourcePath: 'MEMORY.md',
      updated: '2026-08-25',
    })),
    {
      id: 'artifact:F049-plan',
      kind: 'artifact',
      layer: 'decision',
      title: 'F049 Canonical Planning Artifacts plan',
      status: 'committed',
      sourcePath: '.amber/artifacts/F049-plan/',
      updated: '2026-08-27',
      revisions: 3,
    },
    {
      id: 'artifact:F050-decision',
      kind: 'artifact',
      layer: 'decision',
      title: 'F050 Decision artifact',
      status: 'committed',
      sourcePath: '.amber/artifacts/F050-decision/',
      updated: '2026-08-27',
      revisions: 2,
    },
    ...FEATURE_IDS.map((fid): KnowledgeNode => {
      const entry: KnowledgeNode = {
        id: `feature:${fid}`,
        kind: 'feature',
        layer: 'implementation',
        title: featureTitle(fid),
        status: FEATURE_STATUS[fid] ?? 'accepted',
        sourcePath: 'feature_list.json',
      };
      if (FEATURE_PATHS[fid]) entry.paths = FEATURE_PATHS[fid];
      return entry;
    }),
  ],
  edges: [
    // supersedes — new ADR replaces old (from ADR "Supersedes" lines)
    {
      src: 'adr:0007',
      dst: 'adr:0006',
      verb: 'supersedes',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0007-web-viewer-role.md', line: 5 }],
    },
    {
      src: 'adr:0020',
      dst: 'adr:0019',
      verb: 'supersedes',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0020-governed-local-commit.md', line: 6 }],
    },
    {
      src: 'adr:0023',
      dst: 'adr:0022',
      verb: 'supersedes',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0023-canonical-planning-artifacts.md', line: 5 }],
    },

    // builds-on — dependency direction: dependent → depended
    {
      src: 'adr:0009',
      dst: 'adr:0003',
      verb: 'builds-on',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0009-context-distillation.md', line: 8 }],
    },
    {
      src: 'adr:0010',
      dst: 'adr:0009',
      verb: 'builds-on',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0010-context-loadouts.md', line: 7 }],
    },
    {
      src: 'adr:0013',
      dst: 'adr:0009',
      verb: 'builds-on',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0013-source-adapters.md', line: 7 }],
    },
    {
      src: 'adr:0015',
      dst: 'adr:0009',
      verb: 'builds-on',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0015-context-verification.md', line: 7 }],
    },
    {
      src: 'adr:0018',
      dst: 'adr:0014',
      verb: 'builds-on',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0018-memory-writeback.md', line: 7 }],
    },
    {
      src: 'adr:0021',
      dst: 'adr:0009',
      verb: 'builds-on',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0021-governance-graph.md', line: 6 }],
    },
    {
      src: 'adr:0024',
      dst: 'adr:0023',
      verb: 'builds-on',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0024-principal-registry.md', line: 6 }],
    },
    {
      src: 'adr:0007',
      dst: 'adr:0003',
      verb: 'builds-on',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0007-web-viewer-role.md', line: 7 }],
    },
    {
      src: 'adr:0023',
      dst: 'adr:0018',
      verb: 'builds-on',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0023-canonical-planning-artifacts.md', line: 7 }],
    },

    // references — mentioner → mentioned
    {
      src: 'knowledge:amber-ontology-mcp',
      dst: 'adr:0012',
      verb: 'references',
      origin: 'deterministic',
      evidence: [
        { path: 'docs/wiki/knowledge/amber-ontology-mcp/amber-ontology-mcp.md', line: 12 },
      ],
    },
    {
      src: 'knowledge:context-distillation',
      dst: 'adr:0009',
      verb: 'references',
      origin: 'deterministic',
      evidence: [
        { path: 'docs/wiki/knowledge/context-distillation/context-distillation.md', line: 9 },
      ],
    },
    {
      src: 'knowledge:memory-writeback',
      dst: 'adr:0018',
      verb: 'references',
      origin: 'deterministic',
      evidence: [{ path: 'docs/wiki/knowledge/memory-writeback/memory-writeback.md', line: 7 }],
    },
    {
      src: 'knowledge:loop-engineering',
      dst: 'adr:0016',
      verb: 'references',
      origin: 'deterministic',
      evidence: [{ path: 'docs/wiki/knowledge/loop-engineering/loop-engineering.md', line: 6 }],
    },
    {
      src: 'knowledge:projection-rebuild',
      dst: 'adr:0021',
      verb: 'references',
      origin: 'deterministic',
      evidence: [{ path: 'docs/wiki/knowledge/projection-rebuild/projection-rebuild.md', line: 8 }],
    },
    {
      src: 'knowledge:eval-suite',
      dst: 'adr:0022',
      verb: 'references',
      origin: 'deterministic',
      evidence: [{ path: 'docs/wiki/knowledge/eval-suite/eval-suite.md', line: 10 }],
    },
    {
      src: 'knowledge:sync-transport',
      dst: 'adr:0019',
      verb: 'references',
      origin: 'deterministic',
      evidence: [{ path: 'docs/wiki/knowledge/sync-transport/sync-transport.md', line: 9 }],
    },
    {
      src: 'knowledge:artifact-admission',
      dst: 'adr:0023',
      verb: 'references',
      origin: 'deterministic',
      evidence: [{ path: 'docs/wiki/knowledge/artifact-admission/artifact-admission.md', line: 8 }],
    },
    {
      src: 'knowledge:principal-governance',
      dst: 'adr:0024',
      verb: 'references',
      origin: 'deterministic',
      evidence: [
        { path: 'docs/wiki/knowledge/principal-governance/principal-governance.md', line: 7 },
      ],
    },
    {
      src: 'architecture:web-viewer',
      dst: 'adr:0007',
      verb: 'references',
      origin: 'deterministic',
      evidence: [{ path: 'docs/architecture/web-viewer.md', line: 11 }],
    },
    {
      src: 'architecture:core-engine',
      dst: 'adr:0003',
      verb: 'references',
      origin: 'deterministic',
      evidence: [{ path: 'docs/architecture/core-engine.md', line: 9 }],
    },
    {
      src: 'architecture:context-store',
      dst: 'adr:0009',
      verb: 'references',
      origin: 'deterministic',
      evidence: [{ path: 'docs/architecture/context-store.md', line: 8 }],
    },
    {
      src: 'architecture:memory-store',
      dst: 'adr:0018',
      verb: 'references',
      origin: 'deterministic',
      evidence: [{ path: 'docs/architecture/memory-store.md', line: 7 }],
    },
    {
      src: 'architecture:governance-graph',
      dst: 'adr:0021',
      verb: 'references',
      origin: 'deterministic',
      evidence: [{ path: 'docs/architecture/governance-graph.md', line: 6 }],
    },
    {
      src: 'architecture:eval-harness',
      dst: 'adr:0022',
      verb: 'references',
      origin: 'deterministic',
      evidence: [{ path: 'docs/architecture/eval-harness.md', line: 9 }],
    },
    {
      src: 'memory:bug-hunting-leads',
      dst: 'knowledge:loop-engineering',
      verb: 'references',
      origin: 'deterministic',
      evidence: [{ path: 'MEMORY.md', line: 3 }],
    },
    {
      src: 'memory:web-session-status',
      dst: 'architecture:web-viewer',
      verb: 'references',
      origin: 'deterministic',
      evidence: [{ path: 'MEMORY.md', line: 5 }],
    },
    {
      src: 'memory:exec-capture-tail',
      dst: 'architecture:core-engine',
      verb: 'references',
      origin: 'deterministic',
      evidence: [{ path: 'MEMORY.md', line: 7 }],
    },

    // describes — ADR → feature
    {
      src: 'adr:0003',
      dst: 'feature:F007',
      verb: 'describes',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0003-governance-gated-execution.md', line: 40 }],
    },
    {
      src: 'adr:0018',
      dst: 'feature:F033',
      verb: 'describes',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0018-memory-writeback.md', line: 45 }],
    },
    {
      src: 'adr:0020',
      dst: 'feature:F040',
      verb: 'describes',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0020-governed-local-commit.md', line: 38 }],
    },
    {
      src: 'adr:0020',
      dst: 'feature:F041',
      verb: 'describes',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0020-governed-local-commit.md', line: 39 }],
    },
    {
      src: 'adr:0023',
      dst: 'feature:F049',
      verb: 'describes',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0023-canonical-planning-artifacts.md', line: 52 }],
    },
    {
      src: 'adr:0024',
      dst: 'feature:F050',
      verb: 'describes',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0024-principal-registry.md', line: 48 }],
    },
    {
      src: 'adr:0022',
      dst: 'feature:F058',
      verb: 'describes',
      origin: 'deterministic',
      evidence: [{ path: 'docs/adr/0022-program-authority.md', line: 55 }],
    },

    // inferred — semantic layer output (provenance labels mandatory)
    {
      src: 'knowledge:context-distillation',
      dst: 'knowledge:amber-ontology-mcp',
      verb: 'references',
      origin: 'inferred',
      provenance: {
        model: 'stub-model',
        timestamp: '2026-08-27T09:30:00Z',
        promptHash: 'b3f1c9e2',
      },
    },
    {
      src: 'architecture:web-viewer',
      dst: 'architecture:core-engine',
      verb: 'builds-on',
      origin: 'inferred',
      provenance: {
        model: 'stub-model',
        timestamp: '2026-08-27T09:30:00Z',
        promptHash: 'b3f1c9e2',
      },
    },
    {
      src: 'feature:F058',
      dst: 'knowledge:eval-suite',
      verb: 'references',
      origin: 'inferred',
      provenance: {
        model: 'stub-model',
        timestamp: '2026-08-27T09:30:00Z',
        promptHash: 'b3f1c9e2',
      },
    },
    {
      src: 'knowledge:principal-governance',
      dst: 'artifact:F050-decision',
      verb: 'references',
      origin: 'inferred',
      provenance: {
        model: 'stub-model',
        timestamp: '2026-08-27T09:30:00Z',
        promptHash: 'b3f1c9e2',
      },
    },
  ],
  drift: [
    {
      nodeId: 'feature:F001',
      kind: 'dead-anchor',
      path: 'scripts/lib/core/scaffolding.js',
      detail:
        'Anchored file does not exist — actual file is scripts/lib/core/scaffold.js (rename drift).',
    },
    {
      nodeId: 'feature:F007',
      kind: 'dead-anchor',
      detail:
        'Anchored directory does not exist — actual is scripts/lib/core/loops.js (directory collapsed to file).',
      path: 'scripts/lib/core/loops/',
    },
  ],
};

export type { Node, Edge };
