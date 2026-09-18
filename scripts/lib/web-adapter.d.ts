/**
 * Typed SSOT for the web console ↔ CLI core adapter (ADR-0007).
 *
 * Depth pin: LifecycleContext, buildContext, inferNextStep, and evaluateLifecycle
 * must NOT appear on this exported surface. The web calls only the seven ops below.
 */

export type LifecycleFocus = {
	type: string;
	id: string | null;
	autoSelected: boolean;
	othersPending: number;
};

export type LifecycleNextStep = {
	id: string;
	label: string;
	why?: string;
	remedy?: string;
};

export type LifecycleStepStatus = {
	id: string;
	label: string;
	done: boolean;
};

export type CompletionEvaluation = {
	status: "pass" | "fail";
	reasons: string[];
	missing: string[];
};

export type LifecycleNextResult = {
	focus: LifecycleFocus;
	nextStep: LifecycleNextStep | null;
	lifecycle: LifecycleStepStatus[];
	completion?: CompletionEvaluation;
};

export type LifecycleNextOptions = {
	feature?: string;
	session?: string;
	strict?: boolean;
	target?: string;
};

/**
 * Fold buildContext + inferNextStep + evaluateLifecycle into one web-shaped DTO.
 * Never returns a raw LifecycleContext handle.
 */
export function evaluateLifecycleNext(
	targetRoot: string,
	options?: LifecycleNextOptions,
): LifecycleNextResult;

export type CompletionStatusOptions = {
	strict?: boolean;
	target?: string;
};

export type CompletionStatusResult = {
	status: "pass" | "fail";
	reasons: string[];
	missing: string[];
	text: string;
	strict: boolean;
};

/**
 * Fold evaluateCompletion + formatCompletion into a flat completion DTO.
 * Target-first form preferred by adapter / CLI-side callers.
 */
export function getCompletionStatus(
	projectRoot: string,
	sessionId: string,
	options?: CompletionStatusOptions,
): CompletionStatusResult;

export type EvidenceCommandInput = {
	target: string;
	command: string;
	ledgerPath: string;
	budgetMinutes?: number;
	subject?: Record<string, unknown>;
};

export type EvidenceCommandResult = {
	target: string;
	executed: boolean;
	denied: boolean;
	reason?: string;
	exitCode?: number;
	stdoutTail?: string;
	stderrTail?: string;
	durationMs?: number;
	ledgerRecord: Record<string, unknown>;
};

/**
 * Re-export of scripts/lib/core/evidence-runner.js (type SSOT only; no extra depth).
 */
export function runEvidenceCommand(input: EvidenceCommandInput): EvidenceCommandResult;

export type HandoffBundleStatus = {
	present: boolean;
	valid: boolean;
	structureValid: boolean;
	deliveryReady: boolean;
	readinessScore: number | null;
	errors: string[];
};

export type HandoffStatusResult = {
	handoffPath: string;
	state: "live" | "scaffold" | "missing";
	sessionEvidence: boolean;
	bundle: HandoffBundleStatus;
};

/**
 * Read-only handoff status fold: live/scaffold/missing judgement from
 * completion-check plus the handoff-bundle validation. A missing bundle is a
 * graceful empty state, never a throw. Writes nothing.
 */
export function getHandoffStatus(targetRoot: string, sessionId?: string): HandoffStatusResult;

export type HandoffPreviewResult = {
	/**
	 * Session the returned markdown belongs to. For `rendered` previews this
	 * is ALWAYS the most recent session (renderHandoff ignores the requested
	 * id) and may differ from `requestedSessionId`; for the file fallbacks
	 * (`session-handoff.md` / `none`) the actual session is unknown, so this
	 * echoes the request.
	 */
	sessionId: string | null;
	/** The session id the caller asked for (null when omitted). */
	requestedSessionId: string | null;
	markdown: string;
	source: "rendered" | "session-handoff.md" | "none";
};

/**
 * Render-only handoff preview (what `amber handoff` would write) — never
 * writes session-handoff.md. Falls back to reading the existing file, marked
 * via `source`. Note: a `rendered` preview always targets the most recent
 * session; `sessionId` echoes that actual session, `requestedSessionId` the
 * caller's request.
 */
export function getHandoffPreview(targetRoot: string, sessionId?: string): HandoffPreviewResult;

export type LearningsSummary = {
	featureId: string | null;
	status: string;
	hasTriggers: boolean;
	matchedCategories: string[];
	reviewBooked: boolean;
};

export type GovernanceSummaryResult = {
	target: string;
	generatedAt: string;
	decision: "ready" | "warn" | "block";
	scores: Record<string, number>;
	summary: Record<string, number>;
	findings: Array<Record<string, unknown>>;
	nextActions: Array<Record<string, unknown>>;
	errors: string[];
	warnings: string[];
	learnings: LearningsSummary;
};

export type GovernanceSummaryOptions = {
	featureId?: string;
};

/**
 * Read-only fold over buildGovernanceReport + inspectLearningWriteBack.
 * Without `featureId` the learnings block only reports whether trigger
 * conditions are present for the lifecycle focus.
 */
export function getGovernanceSummary(
	targetRoot: string,
	options?: GovernanceSummaryOptions,
): GovernanceSummaryResult;

export type CompletionNextAction = {
	item: string;
	action: "in-page" | "cli-command";
	command?: string;
	hint: string;
};

export type CompletionNextActionsResult = {
	status: "pass" | "fail";
	missing: string[];
	actions: CompletionNextAction[];
};

/**
 * Maps getCompletionStatus missing items to web-shaped next actions; all-pass
 * yields the single closing action `amber session complete --session <id>`.
 */
export function getCompletionNextActions(
	targetRoot: string,
	sessionId: string,
): CompletionNextActionsResult;

export type VerifyPolicyVerdict = {
	allowed: boolean;
	reason?: string;
	matchedRule?: string | null;
	confidence?: string;
};

/**
 * Verify-policy fold: loads verify-rules.json for the target and evaluates the
 * command against the deny-wins policy (built-in destructive + composition
 * denies + custom verify-rules). The exact call evidence-runner makes before
 * spawning — so the web surface can neither relax nor fork the gate.
 */
export function evaluateVerifyPolicy(targetRoot: string, command: string): VerifyPolicyVerdict;

/**
 * Append one hash-chained ledger record through the CLI SSOT (loop-ledger.js),
 * so web-written records verify against the same chain the CLI writes.
 */
export function appendVerificationLedgerRecord(
	ledgerPath: string,
	record: Record<string, unknown>,
): Record<string, unknown>;

/**
 * Session-state fold (Issue #130): delegates to the CLI SSOT predicate in
 * session-state-machine.js — the web checks transition legality through this
 * seam and can neither relax nor fork the transition graph.
 */
export function isLegalSessionTransition(from: string, to: string): boolean;

/**
 * Narrow frozen projection of the CLI session-state vocabulary used by the
 * web control surface (idle/running pre-normalization and action legality).
 */
export const SESSION_STATES: Readonly<{
	CREATED: string;
	ROUTED: string;
	EXECUTING: string;
	PAUSED: string;
}>;

export type KnowledgeGraphSnapshot = {
	schemaVersion: string;
	nodes: Array<Record<string, unknown>>;
	edges: Array<Record<string, unknown>>;
	drift: Array<Record<string, unknown>>;
};

/**
 * Read-only re-export of core/knowledge-graph.js buildKnowledgeGraph (F059):
 * the deterministic parser's production (projection) read. No extra depth.
 */
export function buildKnowledgeGraph(
	target: string,
	options?: { source?: "projection" | "tree" },
): KnowledgeGraphSnapshot;

/**
 * Read-only re-export of core/maintenance.js inspectMaintenance (F059
 * recent-changes feed) — the shared core interface governance-report also
 * consumes. Delegates through the module object; no extra depth.
 */
export function inspectMaintenance(target: string, registryPath?: string): Record<string, unknown>;

/** Read-only re-export of core/context-hash.js sha256Hex (raw hex sha256 of a UTF-8 string). */
export function sha256Hex(text: string): string;

/** Read-only re-export of core/context-hash.js canonicalJson (stable canonical JSON string). */
export function canonicalJson(json: string): string;

/**
 * Read-only re-export of core/finding-attribution.js attributionProblem
 * (trusted-control evolution contract §3): repo-style problem string or null
 * for the closed four-field findingAttribution block. The web surface can
 * neither relax nor duplicate the closed-set validation.
 */
export function attributionProblem(value: unknown): string | null;

/**
 * Frozen projection of the finding-attribution vocabulary (the runtime
 * authority is core/finding-attribution.js; the arrays are the closed sets).
 */
export const FINDING_ATTRIBUTION: {
  readonly ENTRY_SURFACES: readonly string[];
  readonly IMPACT_SURFACES: readonly string[];
  readonly RESPONSIBLE_ARTIFACTS: readonly string[];
  readonly FIELDS: readonly string[];
};

// ── Trusted-control evolution contract §6/§8 (F064 Slice 3) ──

export type EvolutionAdmissionInput = {
  targetRoot: string;
  evidenceReferences?: unknown;
  operations?: unknown;
  expectedEffect?: unknown;
};

export type EvolutionAdmissionResult =
  | { ok: true }
  | { ok: false; code: string; detail: string };

/**
 * Shared V1–V3 admission invariant (contract §6), delegated to the core SSOT
 * unchanged: V1 resolvable evidence references, V2 no capability-registry
 * reduction, V3 dual-axis effect statement. Passing proves form, never
 * semantic truth (E5).
 */
export function validateEvolutionAdmission(
  input: EvolutionAdmissionInput,
): EvolutionAdmissionResult;

// ── Trusted-control evolution contract §9/E8 (F064 Slice 4) ──

export type RecurrenceDenominatorState = 'measured' | 'unknown';

export type RecurrenceInput = {
  occurrences?: unknown;
  transcriptsScanned?: unknown;
  window?: unknown;
};

/**
 * One declared window's recurrence evidence. `recurrenceRate` is `null` —
 * reported as `unknown` — when the exposure denominator is zero or
 * unavailable; a number is never fabricated and no before/after improvement
 * claim is computed (report-only, contract E8).
 */
export type RecurrenceEvidence = {
  occurrences: number;
  transcriptsScanned: number | null;
  recurrenceRate: number | null;
  denominator: RecurrenceDenominatorState;
  window: string;
};

/** Derive one window's recurrence evidence (delegated to the core SSOT). */
export function deriveRecurrence(input: RecurrenceInput): RecurrenceEvidence;

/** The declared F064 window label for the collector's file ceiling. */
export function transcriptWindowLabel(ceiling: number): string;

/** Frozen projection of the recurrence denominator vocabulary. */
export const RECURRENCE: {
  readonly DENOMINATOR_STATES: readonly string[];
};

export type SuggestionReviewKind = 'proposed' | 'validated' | 'rejected' | 'applied' | 'undone';

export type SuggestionReviewAppendResult =
  | { ok: true; appended: boolean; record: Record<string, unknown> | null }
  | { ok: false; code: string; record: null; errors: string[] };

export type SuggestionAppliedDigestRecord = {
  path: string;
  beforeHash: string | null;
  afterHash: string | null;
};

export type SuggestionRestoredDigestRecord = {
  path: string;
  hash: string | null;
};

/** Record card promotion (§8.2 `proposed`) — idempotent per fingerprint. */
export function ensureSuggestionProposed(
  targetRoot: string,
  input: {
    fingerprint: string;
    evidence: object[];
    hosts: string[];
    operations: object[];
    attribution: object;
  },
): SuggestionReviewAppendResult;

/** Record an admission pass (§8.2 `validated`) — idempotent per fingerprint. */
export function recordSuggestionValidated(
  targetRoot: string,
  input: { fingerprint: string },
): SuggestionReviewAppendResult;

/** Record an admission-time validity rejection (§8.2 `rejected`) — once per fingerprint. */
export function recordSuggestionValidityRejection(
  targetRoot: string,
  input: { fingerprint: string; reason: string; summary: string },
): SuggestionReviewAppendResult;

/** Record an operator Dismiss (§8.2 `rejected`) — every dismiss appends. */
export function recordSuggestionDismissal(
  targetRoot: string,
  input: { fingerprint: string; reason: string; summary: string },
): SuggestionReviewAppendResult;

/** Record a successful Apply (§8.2 `applied`) with the applied-record digest. */
export function recordSuggestionApplied(
  targetRoot: string,
  input: { fingerprint: string; applied: SuggestionAppliedDigestRecord[] },
): SuggestionReviewAppendResult;

/** Record a successful Undo (§8.2 `undone`) with the restored-hashes digest. */
export function recordSuggestionUndone(
  targetRoot: string,
  input: { fingerprint: string; restored: SuggestionRestoredDigestRecord[] },
): SuggestionReviewAppendResult;

/** One folded review record per fingerprint (current proposal round fields plus cumulative history), first-proposed order. */
export type SuggestionReviewRecord = {
  fingerprint: string;
  proposedAt: string;
  evidenceDigest: string;
  hosts: string[];
  operationsDigest: string;
  attribution: Record<string, unknown>;
  validatedAt: string | null;
  rejections: Array<{ reason: string; summary: string; at: string }>;
  /** §8.2 proposal rounds: how many `proposed` events this fingerprint has. */
  /** §8.2 proposal rounds: how many `proposed` events this fingerprint has. */
  proposalCount: number;
  /** Rejections recorded since the current round's `proposed` event. */
  rejectionsSinceLastProposal: number;
  appliedCount: number;
  undoneCount: number;
  lastAppliedAt: string | null;
  lastAppliedDigest: string | null;
  lastUndoneAt: string | null;
  lastRestoredDigest: string | null;
};

/**
 * Fold the suggestion-review ledger: fail-closed chain walk plus the family
 * domain fold. A missing ledger reads as empty; corruption throws the typed
 * corrupt code (AMBER_E_SUGGESTION_REVIEW_CORRUPT).
 */
export function foldSuggestionReview(targetRoot: string): SuggestionReviewRecord[];

export type SuggestionReviewHistory =
  | { status: 'none' }
  | { status: 'unknown' }
  | { status: 'rejected'; reason: string; summary: string; at: string };

/**
 * The rejection-history hint (§8.3): informative, read-side only, never
 * blocking. Unknown on a missing/unreadable/corrupt ledger — never "no prior
 * rejection".
 */
export function suggestionReviewHistory(
  targetRoot: string,
  fingerprint: string,
): SuggestionReviewHistory;

export type SuggestionReviewPrecheckResult =
  | { ok: true }
  | { ok: false; code: string; errors: string[] };

/**
 * The §8.6 write-side precheck for Apply/Undo/Dismiss: chain walk, writer
 * guard, lock probe, and ceiling probe against the projected event — BEFORE
 * any target mutation, with nothing written on either outcome.
 */
export function precheckSuggestionReviewAppend(
  targetRoot: string,
  input:
    | {
        kind: 'proposed';
        fingerprint: string;
        evidence: object[];
        hosts: string[];
        operations: object[];
        attribution: object;
      }
    | { kind: 'validated'; fingerprint: string }
    | { kind: 'rejected'; fingerprint: string; reason: string; summary: string }
    | { kind: 'applied'; fingerprint: string; applied: SuggestionAppliedDigestRecord[] }
    | { kind: 'undone'; fingerprint: string; restored: SuggestionRestoredDigestRecord[] },
): SuggestionReviewPrecheckResult;

/**
 * Frozen projection of the suggestion-review event vocabulary (the runtime
 * authority is core/ledger-suggestion-review.js).
 */
export const SUGGESTION_REVIEW: {
  readonly KINDS: readonly SuggestionReviewKind[];
  readonly VALIDATED_CHECKS: Readonly<{ v1: 'pass'; v2: 'pass'; v3: 'pass' }>;
  readonly CEILING_ENV_NAME: string;
};

/** Runtime module shape for createRequire cast — single SSOT with the functions above. */
export type WebAdapter = {
	evaluateLifecycleNext: typeof evaluateLifecycleNext;
	getCompletionStatus: typeof getCompletionStatus;
	runEvidenceCommand: typeof runEvidenceCommand;
	getHandoffStatus: typeof getHandoffStatus;
	getHandoffPreview: typeof getHandoffPreview;
	getGovernanceSummary: typeof getGovernanceSummary;
	getCompletionNextActions: typeof getCompletionNextActions;
	evaluateVerifyPolicy: typeof evaluateVerifyPolicy;
	appendVerificationLedgerRecord: typeof appendVerificationLedgerRecord;
	isLegalSessionTransition: typeof isLegalSessionTransition;
	SESSION_STATES: typeof SESSION_STATES;
	buildKnowledgeGraph: typeof buildKnowledgeGraph;
	inspectMaintenance: typeof inspectMaintenance;
	sha256Hex: typeof sha256Hex;
	canonicalJson: typeof canonicalJson;
	attributionProblem: typeof attributionProblem;
	FINDING_ATTRIBUTION: typeof FINDING_ATTRIBUTION;
	validateEvolutionAdmission: typeof validateEvolutionAdmission;
	deriveRecurrence: typeof deriveRecurrence;
	transcriptWindowLabel: typeof transcriptWindowLabel;
	RECURRENCE: typeof RECURRENCE;
	ensureSuggestionProposed: typeof ensureSuggestionProposed;
	recordSuggestionValidated: typeof recordSuggestionValidated;
	recordSuggestionValidityRejection: typeof recordSuggestionValidityRejection;
	recordSuggestionDismissal: typeof recordSuggestionDismissal;
	recordSuggestionApplied: typeof recordSuggestionApplied;
	recordSuggestionUndone: typeof recordSuggestionUndone;
	foldSuggestionReview: typeof foldSuggestionReview;
	suggestionReviewHistory: typeof suggestionReviewHistory;
	precheckSuggestionReviewAppend: typeof precheckSuggestionReviewAppend;
	SUGGESTION_REVIEW: typeof SUGGESTION_REVIEW;
};
