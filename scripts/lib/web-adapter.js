"use strict";

// Deep adapter surface for the web console (ADR-0007 / architecture deepening T5).
// Folds lifecycle + completion composition so the web does not recompose
// buildContext → inferNextStep → evaluateLifecycle across the createRequire seam.
// Does NOT re-export LifecycleContext or the primitive builders.

const {
	buildContext,
	inferNextStep,
	evaluateLifecycle,
} = require("./core/lifecycle");
const {
	evaluateCompletion,
	formatCompletion,
} = require("./completion-check");
const { runEvidenceCommand } = require("./core/evidence-runner");

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

module.exports = {
	evaluateLifecycleNext,
	getCompletionStatus,
	runEvidenceCommand,
};
