/**
 * Typed SSOT for the web console ↔ CLI core adapter (ADR-0007).
 *
 * Depth pin: LifecycleContext, buildContext, inferNextStep, and evaluateLifecycle
 * must NOT appear on this exported surface. The web calls only the three ops below.
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

/** Runtime module shape for createRequire cast — single SSOT with the functions above. */
export type WebAdapter = {
	evaluateLifecycleNext: typeof evaluateLifecycleNext;
	getCompletionStatus: typeof getCompletionStatus;
	runEvidenceCommand: typeof runEvidenceCommand;
};
