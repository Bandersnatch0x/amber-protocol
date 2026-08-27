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
  body?: string;
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
  recentChanges: RecentChangeItem[];
}

export interface RecentChangeItem {
  id: string;
  source: 'git' | 'feature' | 'adr' | 'drift';
  title: string;
  time: string;
  linkTo?: 'sessions' | 'gates' | 'transcripts' | 'routes' | 'governance';
  linkId?: string;
  linkLabel?: string;
}

const ADR_NODES: Array<[string, string, string]> = [
  [
    'adr:0001',
    'Scaffold versions and drift classes',
    'Scaffold installs are idempotent and versioned; drift between scaffold versions is classified so upgrades never overwrite user files.',
  ],
  [
    'adr:0002',
    'Wiki as governance surface',
    'The wiki is a governed surface: Amber creates and validates the skeleton, humans curate the content.',
  ],
  [
    'adr:0003',
    'Governance-gated execution',
    'Execution is governance-gated: policy rules, explicit one-shot approval, worktree isolation, evidence, and audit must hold before anything runs.',
  ],
  [
    'adr:0004',
    'Evidence-first acceptance',
    'Acceptance is evidence-first: features complete against recorded verification evidence, not claims.',
  ],
  [
    'adr:0005',
    'Session manifests and timeline',
    'Sessions carry a manifest and an append-only timeline; state transitions are replayable from the hash-chain ledger.',
  ],
  [
    'adr:0006',
    'Viewer is .amber-only',
    'The web viewer reads `.amber` only; legacy state dirs resolve through the state-dir resolver.',
  ],
  [
    'adr:0007',
    'Web console role — supervised action viewer',
    'The web console is a **supervised action viewer**: five audited mutations (start / pause / resume / abort / runVerification); approval, completion, and handoff remain CLI-only.',
  ],
  [
    'adr:0008',
    'Rule packs and team distribution',
    'Rule packs distribute team policy as versioned JSON; deny-wins evaluation.',
  ],
  [
    'adr:0009',
    'Contract-driven context distillation',
    'Context distillation is contract-driven: `request → ingest → verify → refresh` closes the loop with deterministic `AMBER_E_*` verification codes.',
  ],
  [
    'adr:0010',
    'Context Loadouts and budgets',
    'Context Loadouts bundle knowledge pages under token budgets; superseded knowledge is excluded.',
  ],
  [
    'adr:0011',
    'Timeline events schema',
    'Timeline events follow one schema: every event is typed and hash-chained.',
  ],
  [
    'adr:0012',
    'Action Types as governed verbs',
    'Action Types are governed verbs on managed objects; mutating operations return approval-required and are never spawned by the adapter.',
  ],
  [
    'adr:0013',
    'Source adapters for context',
    'Source adapters feed context from heterogeneous sources behind one seam.',
  ],
  [
    'adr:0014',
    'Memory write-back pipeline',
    'MEMORY.md write-back is a governed pipeline: nominate → ingest → approve → book.',
  ],
  [
    'adr:0015',
    'Context verification codes',
    'Context verification codes are deterministic `AMBER_E_*` checklists, not human judgment.',
  ],
  [
    'adr:0016',
    'Loop contracts',
    'Loop contracts describe loop-engineering self-constraints; loops never execute anything.',
  ],
  [
    'adr:0017',
    'Structural identity',
    'Structural identity is path-and-type based, stable across renames via supersedes lineage.',
  ],
  [
    'adr:0018',
    'Governed MEMORY.md write-back',
    'Humans curate MEMORY.md; Amber admits, approves, and registers write-backs. `amber memory request/ingest/approve/book/abandon/status` governs the pipeline.',
  ],
  [
    'adr:0019',
    'Sync envelopes',
    'Sync envelopes are the unit of transport; admission is schema-gated and fail-closed.',
  ],
  [
    'adr:0020',
    'Governed local commit (Stage A)',
    'Stage A performs the governed local commit behind identity, policy, single-use approval, and path-and-state confinement. **`git push` is never executed.**',
  ],
  [
    'adr:0021',
    'Governance Graph projection',
    'The Governance Graph is the only graph projection: deterministic rebuild from context pages plus every committed artifact revision.',
  ],
  [
    'adr:0022',
    'Program authority documents',
    'Specs and ADRs carry authority for the feature program; F049–F057 hang off this decision.',
  ],
  [
    'adr:0023',
    'Canonical Planning Artifacts',
    'Each revision binds a human-readable Body to a machine-actionable Envelope in one atomic, journal-settled admission; only committed revisions are visible.',
  ],
  [
    'adr:0024',
    'Principal registry',
    'The Principal registry governs who can act: humans and service identities, each binding identity, kind, capability, scope, and validity in a tamper-evident append-only ledger.',
  ],
];

const WIKI_NODES: Array<[string, string, string]> = [
  [
    'knowledge:amber-ontology-mcp',
    'Amber Ontology MCP',
    'The P1 stdio MCP server and P2 OAG query layer expose Amber objects through the governance seam.',
  ],
  [
    'knowledge:knowledge-base-lifecycle',
    'Knowledge Base lifecycle',
    'How knowledge pages are created, classified, superseded, and retired.',
  ],
  [
    'knowledge:context-distillation',
    'Context distillation playbook',
    'Operating manual for contract-driven distillation: request, ingest, verify, refresh.',
  ],
  [
    'knowledge:memory-writeback',
    'Memory write-back rules',
    'When MEMORY.md nominations are owed, and how they are booked.',
  ],
  [
    'knowledge:loop-engineering',
    'Loop engineering',
    'Self-description of the loop contracts and no-execution invariants.',
  ],
  [
    'knowledge:artifact-admission',
    'Artifact admission',
    'How Canonical Planning Artifacts are admitted, journaled, and made visible.',
  ],
  [
    'knowledge:principal-governance',
    'Principal governance',
    'Principal registry semantics: identity, capability, scope, revocation.',
  ],
  [
    'knowledge:projection-rebuild',
    'Projection rebuild',
    'Deterministic rebuild rules for the Governance Graph projection.',
  ],
  [
    'knowledge:eval-suite',
    'Instruction-surface Evals',
    'The deterministic F050 Eval suite: MCP tool descriptions, Context quote boundary, breadcrumb authenticity.',
  ],
  [
    'knowledge:sync-transport',
    'Sync transport',
    'Envelope admission, transport ledger, and Stage A commit rules.',
  ],
];

const ARCH_NODES: Array<[string, string, string]> = [
  [
    'architecture:web-viewer',
    'Web viewer',
    'apps/web: Vite + React 19 + tRPC 11 dashboard over .amber state.',
  ],
  [
    'architecture:cli-entry',
    'CLI entry',
    'scripts/amber.js — the single command surface; intent router projects the journey entry.',
  ],
  [
    'architecture:core-engine',
    'Core engine',
    'scripts/lib/core: lifecycle, completion, evidence, checkpoints.',
  ],
  [
    'architecture:governance-graph',
    'Governance graph store',
    'The projection store under .amber/projections; read-only, fails closed.',
  ],
  [
    'architecture:context-store',
    'Context store',
    'Context pages, requests, and loadouts under .amber/context.',
  ],
  [
    'architecture:memory-store',
    'Memory store',
    'Governed MEMORY.md write-back state under .amber/memory.',
  ],
  [
    'architecture:loop-runtime',
    'Loop runtime',
    'Loop recommendation and dry-run surfaces; report-only.',
  ],
  [
    'architecture:schema-seam',
    'Schema contract seam',
    'One cached, format-registered Ajv adapter for every JSON-schema validation.',
  ],
  [
    'architecture:eval-harness',
    'Eval harness',
    'Deterministic replay of the instruction-surface Eval suite.',
  ],
];

const MEMORY_NODES: Array<[string, string, string]> = [
  [
    'memory:bug-hunting-leads',
    'Bug-hunting leads',
    'Recurring defect classes worth a break-loop post-mortem: ledger ritual duplication, state-dir drift.',
  ],
  [
    'memory:web-session-status',
    'Web session-status convergence',
    'Session status shown by the web viewer must converge with CLI `session status`; divergence is a bug, not a cache problem.',
  ],
  [
    'memory:exec-capture-tail',
    'Exec capture tail slicing',
    'Long command output is tail-sliced for evidence; keep the first line for exit context.',
  ],
];

interface FeatureFixture {
  id: string;
  title: string;
  status: string;
  behavior: string;
  paths?: string[];
}

const FEATURE_NODES: FeatureFixture[] = [
  {
    id: 'F001',
    title: 'Amber scaffold install (init)',
    status: 'passing',
    behavior:
      'A project gains AGENTS.md/CLAUDE.md, feature_list.json, and a wiki skeleton, with existing files preserved (idempotent).',
    paths: ['scripts/lib/core/scaffolding.js'],
  },
  {
    id: 'F002',
    title: 'Doctor validation',
    status: 'passing',
    behavior:
      "amber doctor reports whether a repo's Amber setup is usable and internally consistent.",
  },
  {
    id: 'F003',
    title: 'Route engine',
    status: 'passing',
    behavior:
      'Routes (feature-standard, bugfix-quick, refactor-safe) can be listed, inspected, validated, and dry-run tested.',
  },
  {
    id: 'F004',
    title: 'Session lifecycle',
    status: 'passing',
    behavior:
      'Sessions can be started, listed, status-checked, aborted, and continued from checkpoints.',
  },
  {
    id: 'F005',
    title: 'Governance report & approval gates',
    status: 'passing',
    behavior:
      'amber governance report scores the delivery loop and emits structured next actions; gates enforce human approval.',
  },
  {
    id: 'F006',
    title: 'Handoff reports',
    status: 'passing',
    behavior: 'amber handoff produces a portable handoff bundle for clean session continuity.',
  },
  {
    id: 'F007',
    title: 'Governed loop execution (ADR-0003)',
    status: 'passing',
    behavior:
      'Loop contracts run only behind four gates: policy rules, explicit one-shot approval, isolated worktree, and audit.',
    paths: ['scripts/lib/core/loops/'],
  },
  {
    id: 'F008',
    title: 'Web viewer (Phase C)',
    status: 'passing',
    behavior:
      'A Vite + React + tRPC viewer renders sessions, timelines, ledgers, and governance state.',
  },
  {
    id: 'F009',
    title: 'State-dir resolver (legacy .harness)',
    status: 'passing',
    behavior:
      'Governance evidence reads resolve the state dir, so legacy .harness repositories read correct state.',
  },
  {
    id: 'F010',
    title: 'Ship 1.3.8 after interrupted 1.3.7 release',
    status: 'passing',
    behavior:
      'Package and CHANGELOG present as 1.3.8 so a new tag can publish after the interrupted v1.3.7 ship.',
  },
  {
    id: 'F011',
    title: 'CLI_REFERENCE covers all 33 commands',
    status: 'passing',
    behavior: 'docs/CLI_REFERENCE.md documents every command in the CLI COMMANDS array (33/33).',
  },
  {
    id: 'F012',
    title: 'Pre-push hook rejects pi-rewind checkpoint refs',
    status: 'passing',
    behavior:
      'git push --mirror or a direct push of refs/pi-checkpoints/* is blocked by .githooks/pre-push.',
  },
  {
    id: 'F015',
    title: 'Loop no-progress reporting',
    status: 'passing',
    behavior:
      'Loop status reports bounded no-progress signals from recorded ledger history without executing anything.',
  },
  {
    id: 'F016',
    title: 'Review blocker remediation',
    status: 'passing',
    behavior:
      'Context, Loadout, governed execution, routing, migration, and handoff surfaces remediated from review blockers.',
  },
  {
    id: 'F017',
    title: 'Governed Context knowledge lifecycle',
    status: 'passing',
    behavior:
      'Context Pages carry governed knowledge classification and supersession lineage; Loadouts exclude superseded knowledge.',
  },
  {
    id: 'F018',
    title: 'MCP governance & repo isolation invariants',
    status: 'passing',
    behavior:
      'MCP Action 和 Function 只能通过受治理且仓库本地的 seam 执行或读取，并以准确错误语义失败关闭。',
  },
  {
    id: 'F019',
    title: 'Intent router + deep journey skills',
    status: 'passing',
    behavior:
      'The ~35-command surface converges behind an intent router with deep journey skills and a default-help projection.',
  },
  {
    id: 'F020',
    title: 'Remediate v1.5.1 review findings',
    status: 'passing',
    behavior:
      'MCP submissions, repository reads, route queries, releases, and version metadata preserve documented safety invariants.',
  },
  {
    id: 'F021',
    title: 'Prerelease publish policy lockstep',
    status: 'passing',
    behavior: 'Pre-release tags skip GitHub Packages publish the same way they skip npmjs.',
  },
  {
    id: 'F022',
    title: 'Per-turn workflow-state breadcrumb hook',
    status: 'passing',
    behavior:
      'An opt-in amber hooks breadcrumb surface injects the active Amber focus into agent context.',
  },
  {
    id: 'F023',
    title: 'Post-accept learning write-back checkpoint',
    status: 'passing',
    behavior:
      'After a feature is accepted, Amber deterministically detects whether knowledge write-back review is owed.',
  },
  {
    id: 'F024',
    title: 'Dogfood friction batch #118/#119/#121',
    status: 'passing',
    behavior:
      'Evidence reflux stamps the local calendar day; resolvePendingGate no longer reports a phantom next gate.',
  },
  {
    id: 'F025',
    title: 'Break-loop post-mortem scaffold',
    status: 'passing',
    behavior:
      'When a friction class recurs after a fix, amber break-loop scaffolds a post-mortem with a fixed structure.',
  },
  {
    id: 'F026',
    title: 'Finish-time dirty-path classification',
    status: 'passing',
    behavior:
      "amber handoff classifies dirty worktree paths into Amber-managed churn vs the focus feature's uncommitted work.",
  },
  {
    id: 'F027',
    title: 'Role-scoped context manifests + memory creed',
    status: 'passing',
    behavior:
      'Plan scaffolds gain a Context manifests section (implement/ and review/ roles listing knowledge-surface paths).',
  },
  {
    id: 'F028',
    title: 'Durable owner routing for recurring friction',
    status: 'passing',
    behavior:
      'amber learnings requires one explicit durable Amber owner when booking a new review.',
  },
  {
    id: 'F029',
    title: 'CI commit identity gate for merge commits',
    status: 'passing',
    behavior:
      'GitHub-generated merge commits pass CI while ordinary unsigned commits still fail the identity gate.',
  },
  {
    id: 'F030',
    title: 'Learnings output when no review is owed',
    status: 'passing',
    behavior:
      'When no mandatory write-back triggers match, amber learnings states that no review is owed.',
  },
  {
    id: 'F031',
    title: 'Skill frontmatter lockstep with Governance Console',
    status: 'passing',
    behavior:
      'Every shipped Amber skill names a real Governance Console command; validation fails on drift.',
  },
  {
    id: 'F032',
    title: 'Approval gates distinct from Session completion',
    status: 'passing',
    behavior:
      'Passing every approval gate records approval but does not mark a Session completed until strict completion evidence passes.',
  },
  {
    id: 'F033',
    title: 'Governed Memory Layer batch A',
    status: 'passing',
    behavior:
      'amber memory request/ingest/approve/book/abandon/status govern the MEMORY.md write-back pipeline.',
  },
  {
    id: 'F034',
    title: 'T1/T2 memory write-back trigger mounting',
    status: 'passing',
    behavior:
      'Completing a session strictly with handoff evidence nominates a T1 memory write-back contract.',
  },
  {
    id: 'F035',
    title: 'Harden distributed sync admission',
    status: 'passing',
    behavior:
      'Sync Runtime envelopes pass one admission pipeline (schema, canonical path/type, protocol, tenant).',
  },
  {
    id: 'F036',
    title: 'State-dir path seam + legacy .harness fix',
    status: 'passing',
    behavior:
      'Resolves .amber state paths through state-dir-resolver so legacy .harness repositories read correct state.',
  },
  {
    id: 'F037',
    title: 'Unify the git adapter seam',
    status: 'passing',
    behavior:
      'git-exec.js becomes the single git invocation seam; sync-session, identity, and worktree-manager migrate onto it.',
  },
  {
    id: 'F038',
    title: 'Dedupe the fail-closed ledger ritual',
    status: 'passing',
    behavior:
      'jsonl.js owns the typed fail-closed ledger read; all error-code literals are guarded.',
  },
  {
    id: 'F039',
    title: 'Unify the command envelope',
    status: 'passing',
    behavior:
      'defineCommand owns routing, aliasing, envelopes, and exit codes behind one dispatcher composition.',
  },
  {
    id: 'F040',
    title: 'Sync transport report as structured contract (ADR-0020 D5)',
    status: 'passing',
    behavior:
      'sync session push emits a schemaVersioned report whose proposedOps are structured operations (verb + confined paths).',
  },
  {
    id: 'F041',
    title: 'ADR-0020 Stage A: governed local commit',
    status: 'passing',
    behavior:
      'amber sync session push --execute --yes runs git add + git commit behind the full gate stack; never push.',
  },
  {
    id: 'F042',
    title: 'Generalize the Ajv adapter (survey Finding 3)',
    status: 'passing',
    behavior:
      'All JSON-schema validation routes through one cached, format-registered schema-contract adapter.',
  },
  {
    id: 'F043',
    title: 'apps/web eslint 10 flat config (#207 batch 1)',
    status: 'passing',
    behavior: 'apps/web lints its TS/React toolchain with eslint 10 via a flat config.',
  },
  {
    id: 'F044',
    title: 'apps/web tRPC 11 + TanStack Query 5 (#207 batch 2)',
    status: 'passing',
    behavior:
      'apps/web runs tRPC 11 with @tanstack/react-query 5; client/provider/hooks refactored for the v5 API.',
  },
  {
    id: 'F045',
    title: 'apps/web React 19 (#207 batch 3)',
    status: 'passing',
    behavior:
      'apps/web runs react/react-dom 19.2.x with @types/react 19; UI, tests, and build behave identically.',
  },
  {
    id: 'F046',
    title: 'apps/web build chain (#207 batch 4)',
    status: 'passing',
    behavior:
      'apps/web runs vite 8 + vitest 4 + typescript 7 + tailwind 4 + zod 4 + react-markdown 10.',
  },
  {
    id: 'F047',
    title: 'Clear react-hooks production warnings',
    status: 'passing',
    behavior: 'apps/web runs with zero react-hooks set-state-in-effect/refs warnings.',
  },
  {
    id: 'F048',
    title: 'Pre-commit prettier coverage in lint-staged',
    status: 'passing',
    behavior:
      'Commits in this repo automatically prettier-format staged files before the commit is created.',
  },
  {
    id: 'F049',
    title: 'Canonical Planning Artifacts',
    status: 'accepted',
    behavior:
      'Intent, Spec, and Plan are admitted as immutable Body/Envelope revisions with deterministic lineage and projection.',
  },
  {
    id: 'F050',
    title: 'Decisions, Gates & Evidence Assurance',
    status: 'accepted',
    behavior:
      'Human Decisions, deterministic Gates, scoped Approval, and four-level Evidence Assurance remain distinct and fail-closed.',
  },
  {
    id: 'F051',
    title: 'Read-only Adapters & Explicit Cutover',
    status: 'accepted',
    behavior:
      'Legacy and external records enter through read-only Adapters until an explicit scoped Cutover changes Canonical state.',
  },
  {
    id: 'F052',
    title: 'Controlled Runner & Environment Boundaries',
    status: 'accepted',
    behavior:
      'Only registered Runner capabilities execute within explicit Development, Staging, and Production boundaries.',
  },
  {
    id: 'F053',
    title: 'Release Prepare, Deploy & Rollback',
    status: 'accepted',
    behavior:
      'A verified release is prepared, independently authorized, deployed, and rolled back through environment Gates.',
  },
  {
    id: 'F054',
    title: 'Deterministic Maintain & Intent Re-entry',
    status: 'accepted',
    behavior:
      'Deterministic Control Bands create Findings for human triage; only a fix Decision creates a candidate Intent.',
  },
  {
    id: 'F055',
    title: 'Retention, Coordinated Deletion & Proof',
    status: 'accepted',
    behavior:
      'Approved deletion coordinates registered Holders, respects Legal Hold, and proves only declared settled coverage.',
  },
  {
    id: 'F056',
    title: 'Registered External Side Effects',
    status: 'accepted',
    behavior:
      'External writes execute only through registered scoped Adapters with human authorization, receipts, and compensation.',
  },
  {
    id: 'F057',
    title: 'Break-glass Authorization',
    status: 'accepted',
    behavior:
      'Emergency capability is human-authorized, exact-scope, time-limited, single-use, auditable, and post-reviewed.',
  },
  {
    id: 'F058',
    title: 'Instruction-Surface Adversarial Evals',
    status: 'passing',
    behavior:
      'A deterministic F050 Eval suite reports whether MCP tool descriptions, the Context quote boundary, and breadcrumbs hold.',
    paths: [
      'scripts/lib/core/instruction-surface-evals.js',
      'tests/unit/instruction-surface-evals.test.js',
    ],
  },
];

function adrFile(id: string, title: string): string {
  const num = id.slice(4);
  return `docs/adr/${num.padStart(4, '0')}-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')}.md`;
}

const nodes: KnowledgeNode[] = [
  ...ADR_NODES.map(([id, title, body]): KnowledgeNode => ({
    id,
    kind: 'adr',
    layer: 'decision',
    title,
    status: 'Accepted',
    sourcePath: adrFile(id, title),
    updated: '2026-07-08',
    body,
  })),
  ...WIKI_NODES.map(([id, title, body]): KnowledgeNode => ({
    id,
    kind: 'knowledge',
    layer: 'knowledge',
    title,
    sourcePath: `docs/wiki/knowledge/${id.split(':')[1]}/${id.split(':')[1]}.md`,
    updated: '2026-08-20',
    body,
  })),
  ...ARCH_NODES.map(([id, title, body]): KnowledgeNode => ({
    id,
    kind: 'architecture',
    layer: 'knowledge',
    title,
    sourcePath: `docs/architecture/${id.split(':')[1]}.md`,
    updated: '2026-08-01',
    body,
  })),
  ...MEMORY_NODES.map(([id, title, body]): KnowledgeNode => ({
    id,
    kind: 'memory',
    layer: 'knowledge',
    title,
    sourcePath: 'MEMORY.md',
    updated: '2026-08-25',
    body,
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
    body: 'The admitted plan artifact for F049: three committed revisions, each binding a Body to an Envelope.',
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
    body: 'The admitted decision artifact for F050, binding the acting Principal and its decision kind.',
  },
  ...FEATURE_NODES.map((f): KnowledgeNode => ({
    id: `feature:${f.id}`,
    kind: 'feature',
    layer: 'implementation',
    title: f.title,
    status: f.status,
    sourcePath: 'feature_list.json',
    body: f.behavior,
    ...(f.paths ? { paths: f.paths } : {}),
  })),
];

function det(
  src: string,
  dst: string,
  verb: KnowledgeEdgeDTO['verb'],
  path: string,
  line: number,
): KnowledgeEdgeDTO {
  return { src, dst, verb, origin: 'deterministic', evidence: [{ path, line }] };
}

const edges: KnowledgeEdgeDTO[] = [
  // supersedes — new ADR replaces old
  det('adr:0007', 'adr:0006', 'supersedes', 'docs/adr/0007-web-viewer-role.md', 5),
  det('adr:0020', 'adr:0019', 'supersedes', 'docs/adr/0020-governed-local-commit.md', 6),
  det('adr:0023', 'adr:0022', 'supersedes', 'docs/adr/0023-canonical-planning-artifacts.md', 5),

  // builds-on — dependent → depended
  det('adr:0009', 'adr:0003', 'builds-on', 'docs/adr/0009-context-distillation.md', 8),
  det('adr:0010', 'adr:0009', 'builds-on', 'docs/adr/0010-context-loadouts.md', 7),
  det('adr:0013', 'adr:0009', 'builds-on', 'docs/adr/0013-source-adapters.md', 7),
  det('adr:0015', 'adr:0009', 'builds-on', 'docs/adr/0015-context-verification.md', 7),
  det('adr:0018', 'adr:0014', 'builds-on', 'docs/adr/0018-memory-writeback.md', 7),
  det('adr:0021', 'adr:0009', 'builds-on', 'docs/adr/0021-governance-graph.md', 6),
  det('adr:0024', 'adr:0023', 'builds-on', 'docs/adr/0024-principal-registry.md', 6),
  det('adr:0007', 'adr:0003', 'builds-on', 'docs/adr/0007-web-viewer-role.md', 7),
  det('adr:0023', 'adr:0018', 'builds-on', 'docs/adr/0023-canonical-planning-artifacts.md', 7),
  det('adr:0020', 'adr:0003', 'builds-on', 'docs/adr/0020-governed-local-commit.md', 8),

  // references — mentioner → mentioned (knowledge layer → decision layer)
  det(
    'knowledge:amber-ontology-mcp',
    'adr:0012',
    'references',
    'docs/wiki/knowledge/amber-ontology-mcp/amber-ontology-mcp.md',
    12,
  ),
  det(
    'knowledge:context-distillation',
    'adr:0009',
    'references',
    'docs/wiki/knowledge/context-distillation/context-distillation.md',
    9,
  ),
  det(
    'knowledge:memory-writeback',
    'adr:0018',
    'references',
    'docs/wiki/knowledge/memory-writeback/memory-writeback.md',
    7,
  ),
  det(
    'knowledge:loop-engineering',
    'adr:0016',
    'references',
    'docs/wiki/knowledge/loop-engineering/loop-engineering.md',
    6,
  ),
  det(
    'knowledge:projection-rebuild',
    'adr:0021',
    'references',
    'docs/wiki/knowledge/projection-rebuild/projection-rebuild.md',
    8,
  ),
  det(
    'knowledge:eval-suite',
    'adr:0022',
    'references',
    'docs/wiki/knowledge/eval-suite/eval-suite.md',
    10,
  ),
  det(
    'knowledge:sync-transport',
    'adr:0019',
    'references',
    'docs/wiki/knowledge/sync-transport/sync-transport.md',
    9,
  ),
  det(
    'knowledge:artifact-admission',
    'adr:0023',
    'references',
    'docs/wiki/knowledge/artifact-admission/artifact-admission.md',
    8,
  ),
  det(
    'knowledge:principal-governance',
    'adr:0024',
    'references',
    'docs/wiki/knowledge/principal-governance/principal-governance.md',
    7,
  ),
  det(
    'knowledge:knowledge-base-lifecycle',
    'adr:0002',
    'references',
    'docs/wiki/knowledge/knowledge-base-lifecycle/knowledge-base-lifecycle.md',
    6,
  ),
  det('architecture:web-viewer', 'adr:0007', 'references', 'docs/architecture/web-viewer.md', 11),
  det('architecture:core-engine', 'adr:0003', 'references', 'docs/architecture/core-engine.md', 9),
  det(
    'architecture:context-store',
    'adr:0009',
    'references',
    'docs/architecture/context-store.md',
    8,
  ),
  det(
    'architecture:memory-store',
    'adr:0018',
    'references',
    'docs/architecture/memory-store.md',
    7,
  ),
  det(
    'architecture:governance-graph',
    'adr:0021',
    'references',
    'docs/architecture/governance-graph.md',
    6,
  ),
  det(
    'architecture:eval-harness',
    'adr:0022',
    'references',
    'docs/architecture/eval-harness.md',
    9,
  ),
  det('architecture:cli-entry', 'adr:0012', 'references', 'docs/architecture/cli-entry.md', 10),
  det(
    'architecture:loop-runtime',
    'adr:0016',
    'references',
    'docs/architecture/loop-runtime.md',
    7,
  ),
  det('architecture:schema-seam', 'adr:0008', 'references', 'docs/architecture/schema-seam.md', 9),
  det('memory:bug-hunting-leads', 'knowledge:loop-engineering', 'references', 'MEMORY.md', 3),
  det('memory:web-session-status', 'architecture:web-viewer', 'references', 'MEMORY.md', 5),
  det('memory:exec-capture-tail', 'architecture:core-engine', 'references', 'MEMORY.md', 7),

  // describes — decision/architecture → feature
  det('adr:0001', 'feature:F001', 'describes', 'feature_list.json', 4),
  det('adr:0002', 'feature:F001', 'describes', 'feature_list.json', 5),
  det('adr:0003', 'feature:F007', 'describes', 'docs/adr/0003-governance-gated-execution.md', 40),
  det('adr:0003', 'feature:F016', 'describes', 'feature_list.json', 60),
  det('adr:0003', 'feature:F020', 'describes', 'feature_list.json', 76),
  det('adr:0003', 'feature:F024', 'describes', 'feature_list.json', 92),
  det('adr:0004', 'feature:F005', 'describes', 'feature_list.json', 26),
  det('adr:0004', 'feature:F032', 'describes', 'feature_list.json', 121),
  det('adr:0005', 'feature:F004', 'describes', 'feature_list.json', 18),
  det('adr:0006', 'feature:F008', 'describes', 'feature_list.json', 34),
  det('adr:0006', 'feature:F009', 'describes', 'feature_list.json', 38),
  det('adr:0007', 'feature:F008', 'describes', 'docs/adr/0007-web-viewer-role.md', 44),
  det('adr:0009', 'feature:F017', 'describes', 'feature_list.json', 66),
  det('adr:0010', 'feature:F027', 'describes', 'feature_list.json', 104),
  det('adr:0012', 'feature:F018', 'describes', 'docs/adr/0012-action-types.md', 38),
  det('adr:0012', 'feature:F019', 'describes', 'feature_list.json', 72),
  det('adr:0014', 'feature:F034', 'describes', 'feature_list.json', 129),
  det('adr:0016', 'feature:F015', 'describes', 'feature_list.json', 52),
  det('adr:0016', 'feature:F025', 'describes', 'feature_list.json', 94),
  det('adr:0018', 'feature:F033', 'describes', 'docs/adr/0018-memory-writeback.md', 45),
  det('adr:0018', 'feature:F023', 'describes', 'feature_list.json', 86),
  det('adr:0019', 'feature:F035', 'describes', 'feature_list.json', 133),
  det('adr:0020', 'feature:F040', 'describes', 'docs/adr/0020-governed-local-commit.md', 38),
  det('adr:0020', 'feature:F041', 'describes', 'docs/adr/0020-governed-local-commit.md', 39),
  det('adr:0021', 'feature:F049', 'describes', 'docs/adr/0021-governance-graph.md', 33),
  det('adr:0022', 'feature:F049', 'describes', 'docs/adr/0022-program-authority.md', 50),
  det('adr:0022', 'feature:F050', 'describes', 'docs/adr/0022-program-authority.md', 51),
  det('adr:0022', 'feature:F051', 'describes', 'docs/adr/0022-program-authority.md', 52),
  det('adr:0022', 'feature:F052', 'describes', 'docs/adr/0022-program-authority.md', 53),
  det('adr:0022', 'feature:F053', 'describes', 'docs/adr/0022-program-authority.md', 54),
  det('adr:0022', 'feature:F054', 'describes', 'docs/adr/0022-program-authority.md', 55),
  det('adr:0022', 'feature:F055', 'describes', 'docs/adr/0022-program-authority.md', 56),
  det('adr:0022', 'feature:F056', 'describes', 'docs/adr/0022-program-authority.md', 57),
  det('adr:0022', 'feature:F057', 'describes', 'docs/adr/0022-program-authority.md', 58),
  det('adr:0022', 'feature:F058', 'describes', 'docs/adr/0022-program-authority.md', 55),
  det('adr:0023', 'feature:F049', 'describes', 'docs/adr/0023-canonical-planning-artifacts.md', 52),
  det('adr:0024', 'feature:F050', 'describes', 'docs/adr/0024-principal-registry.md', 48),
  det('architecture:web-viewer', 'feature:F043', 'describes', 'feature_list.json', 166),
  det('architecture:web-viewer', 'feature:F044', 'describes', 'feature_list.json', 169),
  det('architecture:web-viewer', 'feature:F045', 'describes', 'feature_list.json', 172),
  det('architecture:web-viewer', 'feature:F046', 'describes', 'feature_list.json', 175),
  det('architecture:web-viewer', 'feature:F047', 'describes', 'feature_list.json', 178),
  det('architecture:web-viewer', 'feature:F048', 'describes', 'feature_list.json', 181),
  det('architecture:cli-entry', 'feature:F002', 'describes', 'feature_list.json', 12),
  det('architecture:cli-entry', 'feature:F010', 'describes', 'feature_list.json', 44),
  det('architecture:cli-entry', 'feature:F011', 'describes', 'feature_list.json', 47),
  det('architecture:cli-entry', 'feature:F012', 'describes', 'feature_list.json', 50),
  det('architecture:cli-entry', 'feature:F029', 'describes', 'feature_list.json', 112),
  det('architecture:cli-entry', 'feature:F039', 'describes', 'feature_list.json', 147),
  det('architecture:core-engine', 'feature:F003', 'describes', 'feature_list.json', 15),
  det('architecture:core-engine', 'feature:F006', 'describes', 'feature_list.json', 30),
  det('architecture:core-engine', 'feature:F036', 'describes', 'feature_list.json', 137),
  det('architecture:core-engine', 'feature:F037', 'describes', 'feature_list.json', 140),
  det('architecture:core-engine', 'feature:F038', 'describes', 'feature_list.json', 143),
  det('architecture:schema-seam', 'feature:F042', 'describes', 'feature_list.json', 160),
  det('architecture:loop-runtime', 'feature:F022', 'describes', 'feature_list.json', 82),
  det('architecture:eval-harness', 'feature:F058', 'describes', 'feature_list.json', 205),
  det('architecture:context-store', 'feature:F021', 'describes', 'feature_list.json', 79),
  det('architecture:memory-store', 'feature:F028', 'describes', 'feature_list.json', 108),
  det('architecture:memory-store', 'feature:F030', 'describes', 'feature_list.json', 115),
  det('knowledge:amber-ontology-mcp', 'feature:F031', 'describes', 'feature_list.json', 118),
  det('knowledge:loop-engineering', 'feature:F026', 'describes', 'feature_list.json', 100),

  // feature → references (implementation reaching back into knowledge/decision)
  det('feature:F002', 'knowledge:knowledge-base-lifecycle', 'references', 'feature_list.json', 13),
  det('feature:F049', 'artifact:F049-plan', 'references', 'feature_list.json', 184),
  det('feature:F050', 'artifact:F050-decision', 'references', 'feature_list.json', 187),

  // inferred — semantic layer output (provenance labels mandatory)
  {
    src: 'knowledge:context-distillation',
    dst: 'knowledge:amber-ontology-mcp',
    verb: 'references',
    origin: 'inferred',
    provenance: { model: 'stub-model', timestamp: '2026-08-27T09:30:00Z', promptHash: 'b3f1c9e2' },
  },
  {
    src: 'architecture:web-viewer',
    dst: 'architecture:core-engine',
    verb: 'builds-on',
    origin: 'inferred',
    provenance: { model: 'stub-model', timestamp: '2026-08-27T09:30:00Z', promptHash: 'b3f1c9e2' },
  },
  {
    src: 'feature:F058',
    dst: 'knowledge:eval-suite',
    verb: 'references',
    origin: 'inferred',
    provenance: { model: 'stub-model', timestamp: '2026-08-27T09:30:00Z', promptHash: 'b3f1c9e2' },
  },
  {
    src: 'knowledge:principal-governance',
    dst: 'artifact:F050-decision',
    verb: 'references',
    origin: 'inferred',
    provenance: { model: 'stub-model', timestamp: '2026-08-27T09:30:00Z', promptHash: 'b3f1c9e2' },
  },
];

export const knowledgeGraphFixture: KnowledgeGraphDTO = {
  schemaVersion: '1',
  nodes,
  edges,
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
  recentChanges: [
    {
      id: 'rc-1',
      source: 'git',
      title: 'feat(governance): add Principal registry and Decision artifacts (F050)',
      time: '2026-08-27',
      linkTo: 'sessions',
      linkId: 's-422cd8e',
      linkLabel: 'feat(governance): F050',
    },
    {
      id: 'rc-2',
      source: 'feature',
      title: 'F058 eval grill findings closed — scan counts, model-independence regex',
      time: '2026-08-26',
      linkTo: 'gates',
      linkId: 'F058',
      linkLabel: 'F058 acceptance',
    },
    {
      id: 'rc-3',
      source: 'adr',
      title: 'ADR-0024 Principal registry accepted; ADR-0021..0024 admitted',
      time: '2026-08-25',
      linkTo: 'governance',
      linkLabel: 'governance report',
    },
    {
      id: 'rc-4',
      source: 'drift',
      title: 'Drift detected: F001 anchors scaffolding.js (renamed scaffold.js)',
      time: '2026-08-24',
      linkTo: 'transcripts',
      linkId: 'drift-scan-0824',
      linkLabel: 'drift scan transcript',
    },
    {
      id: 'rc-5',
      source: 'feature',
      title: 'Route advice updated for knowledge-map objective',
      time: '2026-08-23',
      linkTo: 'routes',
      linkId: 'knowledge-map',
      linkLabel: 'route: knowledge-map',
    },
  ],
};
