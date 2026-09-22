"use strict";

// Run state machine (F065 H0; ADR-0101).
//
// The closed nine-state lifecycle of a Harness Run, with the same SSOT
// discipline as the session machine (scripts/lib/session-state-machine.js):
// exported STATES/TRANSITIONS/isLegalTransition/legalTargets/isFinal, illegal
// transitions rejected by callers. This machine is deliberately separate from
// the session machine — a Run is one bounded execution while a Session spans
// framing/approval/review — and the only sanctioned bridge between them is
// the vertical-slice mapping adapter (ADR-0101, decision 4).

const STATES = {
	CREATED: "created",
	ADMITTED: "admitted",
	RUNNING: "running",
	PAUSED: "paused",
	BLOCKED: "blocked",
	FAILED: "failed",
	COMPLETED: "completed",
	CANCELLED: "cancelled",
	EXPIRED: "expired",
};

const FINAL_STATES = new Set([STATES.COMPLETED, STATES.FAILED, STATES.CANCELLED, STATES.EXPIRED]);

const TRANSITIONS = {
	[STATES.CREATED]: [STATES.ADMITTED, STATES.CANCELLED, STATES.EXPIRED],
	[STATES.ADMITTED]: [STATES.RUNNING, STATES.CANCELLED, STATES.EXPIRED],
	[STATES.RUNNING]: [
		STATES.PAUSED,
		STATES.BLOCKED,
		STATES.FAILED,
		STATES.COMPLETED,
		STATES.CANCELLED,
	],
	[STATES.PAUSED]: [STATES.RUNNING, STATES.CANCELLED, STATES.EXPIRED],
	// BLOCKED → RUNNING (human-review recovery) | FAILED | CANCELLED | EXPIRED.
	// BLOCKED → COMPLETED is illegal: unblocking precedes completion (same
	// rule as the session machine).
	[STATES.BLOCKED]: [STATES.RUNNING, STATES.FAILED, STATES.CANCELLED, STATES.EXPIRED],
	[STATES.COMPLETED]: [],
	[STATES.FAILED]: [],
	[STATES.CANCELLED]: [],
	[STATES.EXPIRED]: [],
};

/**
 * Pure SSOT predicate: whether `from` → `to` is an allowed edge.
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
function isLegalTransition(from, to) {
	const allowed = TRANSITIONS[from] || [];
	return allowed.includes(to);
}

/**
 * Pure SSOT: legal target states from `from` (copy, not the live array).
 * @param {string} from
 * @returns {string[]}
 */
function legalTargets(from) {
	return [...(TRANSITIONS[from] || [])];
}

/**
 * Pure SSOT: whether `state` is a terminal/final status.
 * @param {string} state
 * @returns {boolean}
 */
function isFinal(state) {
	return FINAL_STATES.has(state);
}

module.exports = { STATES, TRANSITIONS, FINAL_STATES, isLegalTransition, legalTargets, isFinal };
