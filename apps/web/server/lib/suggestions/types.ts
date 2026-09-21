export const HOST_IDS = ['claude', 'codex', 'cursor'] as const;
export type HostId = (typeof HOST_IDS)[number];

export const SUGGESTION_STATUSES = ['open', 'snoozed', 'dismissed', 'applied', 'stale'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const OPERATION_VERBS = ['create', 'update', 'remove'] as const;
export type OperationVerb = (typeof OPERATION_VERBS)[number];

export const ARTIFACT_KINDS = ['wiki', 'agents-md', 'skill'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

// Structured finding attribution (trusted-control evolution contract §3). The
// runtime authority for the closed enums and validation is the core module
// scripts/lib/core/finding-attribution.js, reached through the web-adapter
// seam — these unions are a typing mirror, parity-checked against the runtime
// vocabulary by test (both directions, compiler-enforced), never an
// independent enum authority. Attribution is a claim, never a permission.
export type EntrySurface =
  'instruction-surface' | 'tool-output' | 'policy-rule' | 'capability-request';
export type ImpactSurface = 'target-repo' | 'context' | 'external' | 'governance-state';
export type ResponsibleArtifact =
  | 'instruction-surface'
  | 'rules'
  | 'memory'
  | 'capability-registry'
  | 'wiki'
  | 'route'
  | 'loop-contract';

export interface FindingAttribution {
  entrySurface: EntrySurface;
  impactSurface: ImpactSurface;
  failureMode: string;
  responsibleArtifact: ResponsibleArtifact;
}

// Dual-axis expected-effect statement (trusted-control evolution contract §6
// V3): a planned change names BOTH axes of the dual-axis assessment. The
// runtime authority for the shape (both axes present, neither solely an eval
// reference) is the shared core invariant, consumed at card admission through
// the web-adapter seam — this interface is the typing mirror.
export interface ExpectedEffect {
  readiness: string;
  effectiveness: string;
}

// The §8.3 rejection-history hint: informative, read-side only, never
// blocking. `unknown` means the ledger is missing/unreadable/corrupt — it is
// never a claim of "no prior rejection" (unknown ≠ empty).
export type RejectionHistory =
  | { status: 'none' }
  | { status: 'unknown' }
  | { status: 'rejected'; reason: string; summary: string; at: string };

// Recurrence measurement (trusted-control evolution contract §9, E8): a rate
// over an exposure denominator for ONE declared window. `unknown` is a
// denominator state, not an error and not a zero — a zero denominator means
// the window held nothing, unknown means the window could not be established.
// The runtime authority for the derivation is core/recurrence.js, reached
// through the web-adapter seam; this union is a typing mirror, parity-checked
// by test. Report-only: no before/after improvement claim is computed.
export type RecurrenceDenominatorState = 'measured' | 'unknown';

export interface RecurrenceEvidence {
  occurrences: number;
  transcriptsScanned: number | null;
  recurrenceRate: number | null;
  denominator: RecurrenceDenominatorState;
  window: string;
}

export interface SuggestionHomes {
  claudeHome?: string;
  codexHome?: string;
  cursorHome?: string;
}

export interface FrictionSignal {
  host: HostId;
  transcriptId: string;
  tool: string;
  error: string;
  excerpt: string;
  timestamp?: string;
  fingerprint: string;
  /**
   * Absolute path of the host transcript file the signal was extracted from —
   * the owning source a V1 evidence reference resolves against (evolution
   * contract §6). Never rendered or persisted on the card; admission uses it
   * to build resolvable transcript citations.
   */
  sourceFile: string;
}

export interface SuggestionEvidence {
  host: HostId;
  transcriptId: string;
  excerpt: string;
  timestamp?: string;
}

export interface SuggestionOperation {
  verb: OperationVerb;
  artifactKind: ArtifactKind;
  path: string;
  summary: string;
  contents?: string;
  expectedHash: string | null;
}

export interface ImprovementSuggestion {
  id: string;
  fingerprint: string;
  title: string;
  tool: string;
  evidenceCount: number;
  transcriptCount: number;
  hosts: HostId[];
  evidence: SuggestionEvidence[];
  operations: SuggestionOperation[];
  status: SuggestionStatus;
  // Structured attribution derived deterministically at card creation; absent
  // on legacy records — never fabricated. Present blocks are validated through
  // the core seam before a card is emitted.
  findingAttribution?: FindingAttribution;
  // Dual-axis expected effect (evolution contract §6 V3), derived by the
  // planner beside the attribution block; validated at admission.
  expectedEffect?: ExpectedEffect;
  // The §8.3 rejection-history hint (informative, never blocking): present on
  // exposed cards; `unknown` when the review ledger is missing/unreadable.
  rejectionHistory?: RejectionHistory;
  // Recurrence evidence for the declared scan window (contract §9/E8),
  // derived beside the card from the same scan that produced it. The rate is
  // `null` when the denominator is unknown; no improvement claim is computed.
  recurrence?: RecurrenceEvidence;
  snoozeUntil?: string;
  updatedAt?: string;
}

export interface SuggestionListResult {
  suggestions: ImprovementSuggestion[];
  scanned: { host: HostId; transcripts: number }[];
}

export type SuggestionMutationResult =
  { ok: true; suggestion: ImprovementSuggestion } | { ok: false; code: string; message: string };
