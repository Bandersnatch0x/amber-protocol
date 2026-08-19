"use strict";

// Deep adapter surface for the web console (ADR-0007 / architecture deepening T5).
// Folds lifecycle + completion composition so the web does not recompose
// buildContext → inferNextStep → evaluateLifecycle across the createRequire seam.
// Does NOT re-export LifecycleContext or the primitive builders.

const fs = require("node:fs");
const path = require("node:path");

const { buildContext, inferNextStep, evaluateLifecycle } = require("./core/lifecycle");
const {
	evaluateCompletion,
	formatCompletion,
	isLiveHandoff,
	hasHandoffEvidence,
} = require("./completion-check");
const { runEvidenceCommand } = require("./core/evidence-runner");
const { validateHandoffBundle, defaultBundleDir } = require("./core/handoff-bundle");
const { validateHandoff } = require("./core/audit");
const { renderHandoff } = require("./handoff-command");
const { findMostRecentSession } = require("./session-commands");
const { buildGovernanceReport } = require("./core/governance-report");
const { inspectLearningWriteBack } = require("./core/learning-writeback");
const { readSessionManifest } = require("./session-manifest");
const { resolveStateDirForRead } = require("./state-dir-resolver");
const loopPolicy = require("./core/loop-policy");
const loopLedger = require("./core/loop-ledger");
const { isLegalTransition, STATES } = require("./session-state-machine");

/**
 * Containment guard for caller-supplied session ids — the CLI-side twin of
 * apps/web/server/lib/safe-path.ts `resolveWithin`. Resolves `sessionId`
 * under `<stateDir>/sessions/` and returns the directory only when it stays
 * inside it. Traversal ids (`../../evil`) and absolute paths return null, so
 * a hostile id is treated exactly like an unknown session (empty state)
 * instead of becoming an out-of-bounds manifest read.
 *
 * @param {string} targetRoot
 * @param {string} sessionId
 * @returns {string | null}
 */
function resolveSessionDirWithin(targetRoot, sessionId) {
	const sessionsDir = path.resolve(resolveStateDirForRead(targetRoot, { quiet: true }), "sessions");
	const resolved = path.resolve(sessionsDir, sessionId);
	const rel = path.relative(sessionsDir, resolved);
	if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
		return null;
	}
	return resolved;
}

/**
 * Fold buildContext + inferNextStep + evaluateLifecycle into one web-shaped DTO.
 * Never returns a raw LifecycleContext handle.
 *
 * @param {string} targetRoot
 * @param {{ feature?: string, session?: string, strict?: boolean, target?: string }} [options]
 * @returns {{
 *   focus: { type: string, id: string | null, autoSelected: boolean, othersPending: number },
 *   nextStep: { id: string, label: string, why?: string, remedy?: string } | null,
 *   lifecycle: Array<{ id: string, label: string, done: boolean }>,
 *   completion?: { status: "pass" | "fail", reasons: string[], missing: string[] },
 * }}
 */
function evaluateLifecycleNext(targetRoot, options = {}) {
	const context = buildContext(targetRoot, options);
	return {
		focus: context.focus,
		nextStep: inferNextStep(context),
		lifecycle: evaluateLifecycle(context),
		...(context.completion ? { completion: context.completion } : {}),
	};
}

/**
 * Fold evaluateCompletion + formatCompletion into a flat completion DTO.
 * Target-first signature preferred by CLI-side / adapter callers.
 *
 * @param {string} projectRoot
 * @param {string} sessionId
 * @param {{ strict?: boolean, target?: string }} [options]
 * @returns {{
 *   status: "pass" | "fail",
 *   reasons: string[],
 *   missing: string[],
 *   text: string,
 *   strict: boolean,
 * }}
 */
function getCompletionStatus(projectRoot, sessionId, options) {
	// No default on `options` so Function.length is 3 (target-first overload).
	// Callers may omit options; treat missing as {}.
	const opts = options || {};
	// strict defaults true to match the web router historical helper.
	const strict = opts.strict !== false;
	const evaluation = evaluateCompletion(projectRoot, sessionId, { strict });
	return {
		...evaluation,
		strict,
		text: formatCompletion(evaluation),
	};
}

/**
 * Read-only fold over the completion-check handoff judgement (live vs scaffold
 * vs missing) plus the handoff-bundle validator. Nothing is written; the bundle
 * preview/validate path only inspects what is already on disk.
 *
 * A missing bundle is a graceful empty state, never a throw.
 *
 * @param {string} targetRoot
 * @param {string} [sessionId]
 * @returns {{
 *   handoffPath: string,
 *   state: "live" | "scaffold" | "missing",
 *   sessionEvidence: boolean,
 *   bundle: {
 *     present: boolean,
 *     valid: boolean,
 *     structureValid: boolean,
 *     deliveryReady: boolean,
 *     readinessScore: number | null,
 *     errors: string[],
 *   },
 * }}
 */
function getHandoffStatus(targetRoot, sessionId) {
	const handoffPath = path.join(targetRoot, "session-handoff.md");
	const live = isLiveHandoff(targetRoot);
	const state = live ? "live" : fs.existsSync(handoffPath) ? "scaffold" : "missing";

	// Session-scoped handoff evidence, mirroring the completion gate's G2 check.
	// The sessionId is traversal-guarded (resolveSessionDirWithin): an escaping
	// id reads as "no session evidence", never as an out-of-bounds manifest read.
	let sessionEvidence = false;
	if (sessionId) {
		const sessionDir = resolveSessionDirWithin(targetRoot, sessionId);
		const loaded = sessionDir ? readSessionManifest(sessionDir) : null;
		if (loaded && !loaded.corrupt && loaded.manifest) {
			sessionEvidence = hasHandoffEvidence(targetRoot, loaded.manifest);
		}
	}

	// Bundle validation is read-only; absent bundle → empty state, not an error.
	const bundleDir = defaultBundleDir(targetRoot);
	let bundle;
	if (!fs.existsSync(bundleDir)) {
		bundle = {
			present: false,
			valid: false,
			structureValid: false,
			deliveryReady: false,
			readinessScore: null,
			errors: [],
		};
	} else {
		const validation = validateHandoffBundle(bundleDir);
		// Same delivery-readiness composition as writeHandoffBundle, minus the write:
		// structure valid AND a coherent live handoff AND a non-blocking decision.
		const structureValid = validation.valid;
		let deliveryReady = false;
		let readinessScore = null;
		if (structureValid) {
			const report = buildGovernanceReport(targetRoot);
			readinessScore = report.scores.overall;
			const handoffValidation = validateHandoff(targetRoot);
			deliveryReady = (handoffValidation.errors || []).length === 0 && report.decision !== "block";
		}
		bundle = {
			present: true,
			valid: structureValid,
			structureValid,
			deliveryReady,
			readinessScore,
			errors: validation.errors,
		};
	}

	return { handoffPath, state, sessionEvidence, bundle };
}

/**
 * Render-only handoff preview: reuses handoff-command's pure renderHandoff so
 * the web can show what `amber handoff` WOULD write without writing anything.
 * Falls back to reading the existing session-handoff.md (marked as such) when
 * live rendering is unavailable.
 *
 * Session id semantics: renderHandoff ALWAYS targets the most recent session
 * and ignores the requested id, so when `source` is "rendered" the returned
 * `sessionId` is the ACTUALLY rendered (most recent) session id — which may
 * differ from the caller's request. The original request is preserved in
 * `requestedSessionId`. For the file fallbacks the actual session is unknown,
 * so `sessionId` echoes the request.
 *
 * @param {string} targetRoot
 * @param {string} [sessionId]
 * @returns {{
 *   sessionId: string | null,
 *   requestedSessionId: string | null,
 *   markdown: string,
 *   source: "rendered" | "session-handoff.md" | "none",
 * }}
 */
function getHandoffPreview(targetRoot, sessionId) {
	const requestedId = sessionId || null;
	try {
		const markdown = renderHandoff(targetRoot);
		// Echo the session the rendered preview actually belongs to (the most
		// recent one), not the request — same lookup renderHandoff performs.
		let renderedId = null;
		try {
			renderedId = findMostRecentSession(targetRoot, {}) || null;
		} catch {
			renderedId = null;
		}
		return {
			sessionId: renderedId,
			requestedSessionId: requestedId,
			markdown,
			source: "rendered",
		};
	} catch {
		const handoffPath = path.join(targetRoot, "session-handoff.md");
		if (fs.existsSync(handoffPath)) {
			try {
				return {
					sessionId: requestedId,
					requestedSessionId: requestedId,
					markdown: fs.readFileSync(handoffPath, "utf8"),
					source: "session-handoff.md",
				};
			} catch {
				// fall through to the empty state
			}
		}
		return {
			sessionId: requestedId,
			requestedSessionId: requestedId,
			markdown: "",
			source: "none",
		};
	}
}

/**
 * Read-only fold over buildGovernanceReport + inspectLearningWriteBack into one
 * web-shaped governance DTO. `options.featureId` is optional: without it the
 * learnings block only reports whether trigger conditions are present for the
 * lifecycle focus. Writes nothing.
 *
 * @param {string} targetRoot
 * @param {{ featureId?: string }} [options]
 * @returns {{
 *   target: string,
 *   generatedAt: string,
 *   decision: "ready" | "warn" | "block",
 *   scores: Record<string, number>,
 *   summary: Record<string, number>,
 *   findings: Array<Record<string, unknown>>,
 *   nextActions: Array<Record<string, unknown>>,
 *   errors: string[],
 *   warnings: string[],
 *   learnings: {
 *     featureId: string | null,
 *     status: string,
 *     hasTriggers: boolean,
 *     matchedCategories: string[],
 *     reviewBooked: boolean,
 *   },
 * }}
 */
function getGovernanceSummary(targetRoot, options = {}) {
	const report = buildGovernanceReport(targetRoot);
	let learnings;
	try {
		const inspection = inspectLearningWriteBack(
			targetRoot,
			options.featureId ? { featureId: options.featureId } : {},
		);
		learnings = {
			featureId: inspection.featureId,
			status: inspection.status,
			hasTriggers: inspection.matchedCategories.length > 0,
			matchedCategories: inspection.matchedCategories,
			reviewBooked: Boolean(
				inspection.learningWriteBack && inspection.learningWriteBack.reviewed === true,
			),
		};
	} catch {
		learnings = {
			featureId: options.featureId || null,
			status: "unavailable",
			hasTriggers: false,
			matchedCategories: [],
			reviewBooked: false,
		};
	}
	return {
		target: report.target,
		generatedAt: report.generatedAt,
		decision: report.decision,
		scores: report.scores,
		summary: report.summary,
		findings: report.readiness.findings,
		nextActions: report.nextActions,
		errors: report.errors,
		warnings: report.warnings,
		learnings,
	};
}

// Completion missing-item → next-action mapping for the web console. In-page
// actions render inside the console; cli-command actions surface the exact
// amber command to run.
const COMPLETION_ACTION_MAP = {
	verification: {
		action: "in-page",
		hint: "Run verification from the console evidence runner.",
	},
	approval: {
		action: "in-page",
		hint: "Approve via the gates view (/gates).",
	},
	handoff: {
		action: "cli-command",
		command: "amber handoff --target .",
		hint: "Regenerate the live session-handoff.md from current repo state.",
	},
};

const COMPLETION_ACTION_FALLBACKS = {
	goal: { hint: 'Start a session with a goal: amber session start --goal "<goal>" --target .' },
	timeline: { hint: "Timeline events are recorded automatically as governed work happens." },
	work: { hint: "Make at least one real change (commit or working-tree edit) during the session." },
	"open blockers": { hint: "Resolve or close the session's open blockers before completing." },
	"manifest not found": {
		hint: "No session manifest yet — start a session: amber session start --target .",
	},
	"manifest is corrupt": {
		hint: "Inspect the session manifest under the state dir; recover or restart the session.",
	},
};

/**
 * Fold getCompletionStatus into actionable web next-steps: each missing item
 * maps to an in-page action or an exact CLI command. When everything passes,
 * the single closing action is `amber session complete --session <id>`.
 *
 * @param {string} targetRoot
 * @param {string} sessionId
 * @returns {{
 *   status: "pass" | "fail",
 *   missing: string[],
 *   actions: Array<{ item: string, action: "in-page" | "cli-command", command?: string, hint: string }>,
 * }}
 */
function getCompletionNextActions(targetRoot, sessionId) {
	const completion = getCompletionStatus(targetRoot, sessionId);
	if (completion.status === "pass") {
		return {
			status: "pass",
			missing: [],
			actions: [
				{
					item: "session-complete",
					action: "cli-command",
					command: `amber session complete --session ${sessionId}`,
					hint: "All completion checks pass — close the session.",
				},
			],
		};
	}
	const actions = completion.missing.map((item) => {
		const mapped = COMPLETION_ACTION_MAP[item];
		if (mapped) return { item, ...mapped };
		const fallback = COMPLETION_ACTION_FALLBACKS[item] || {
			hint: `Resolve the missing completion item: ${item}.`,
		};
		return { item, action: "cli-command", ...fallback };
	});
	return { status: "fail", missing: completion.missing, actions };
}

/**
 * Verify-policy fold: loads verify-rules.json for the target and evaluates the
 * command against the deny-wins policy (built-in destructive + composition
 * denies + custom verify-rules). The exact call evidence-runner makes before
 * spawning — so the web surface can neither relax nor fork the gate.
 *
 * @param {string} targetRoot
 * @param {string} command
 * @returns {{ allowed: boolean, reason?: string, matchedRule?: string | null, confidence?: string }}
 */
function evaluateVerifyPolicy(targetRoot, command) {
	return loopPolicy.evaluateVerifyPolicy(command, loopPolicy.loadVerifyPolicyRules(targetRoot));
}

/**
 * Append one hash-chained ledger record through the CLI SSOT (loop-ledger.js),
 * so web-written records verify against the same chain the CLI writes.
 *
 * @param {string} ledgerPath
 * @param {Record<string, unknown>} record
 * @returns {Record<string, unknown>}
 */
function appendVerificationLedgerRecord(ledgerPath, record) {
	return loopLedger.appendLedgerRecord(ledgerPath, record);
}

/**
 * Session-state fold (Issue #130): the web checks transition legality through
 * this seam instead of requiring scripts/lib/session-state-machine.js
 * directly. Delegates to the CLI SSOT predicate unchanged — the web can
 * neither relax nor fork the transition graph.
 *
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
function isLegalSessionTransition(from, to) {
	return isLegalTransition(from, to);
}

/**
 * Narrow projection of the CLI session-state vocabulary used by the web
 * control surface (idle/running pre-normalization and action legality).
 * Frozen so the web cannot mutate the SSOT values.
 */
const SESSION_STATES = Object.freeze({
	CREATED: STATES.CREATED,
	ROUTED: STATES.ROUTED,
	EXECUTING: STATES.EXECUTING,
	PAUSED: STATES.PAUSED,
});

module.exports = {
	evaluateLifecycleNext,
	getCompletionStatus,
	runEvidenceCommand,
	getHandoffStatus,
	getHandoffPreview,
	getGovernanceSummary,
	getCompletionNextActions,
	evaluateVerifyPolicy,
	appendVerificationLedgerRecord,
	isLegalSessionTransition,
	SESSION_STATES,
};
