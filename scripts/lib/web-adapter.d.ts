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
};
