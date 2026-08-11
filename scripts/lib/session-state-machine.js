"use strict";

const STATES = {
	CREATED: "created",
	ROUTED: "routed",
	EXECUTING: "executing",
	PAUSED: "paused",
	COMPLETED: "completed",
	FAILED: "failed",
	ABORTED: "aborted",
};

const FINAL_STATES = new Set([STATES.COMPLETED, STATES.FAILED, STATES.ABORTED]);

const TRANSITIONS = {
	[STATES.CREATED]: [STATES.ROUTED, STATES.COMPLETED, STATES.FAILED, STATES.ABORTED],
	[STATES.ROUTED]: [STATES.EXECUTING, STATES.COMPLETED, STATES.FAILED, STATES.ABORTED],
	[STATES.EXECUTING]: [STATES.PAUSED, STATES.COMPLETED, STATES.FAILED, STATES.ABORTED],
	[STATES.PAUSED]: [STATES.EXECUTING, STATES.COMPLETED, STATES.FAILED, STATES.ABORTED],
	[STATES.COMPLETED]: [],
	[STATES.FAILED]: [],
	[STATES.ABORTED]: [],
};

const EVENT_TYPES = {
	[STATES.ROUTED]: "route_selected",
	[STATES.EXECUTING]: "session_resumed",
	[STATES.PAUSED]: "session_paused",
	[STATES.COMPLETED]: "session_completed",
	[STATES.FAILED]: "session_failed",
	[STATES.ABORTED]: "session_aborted",
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

class SessionStateMachine {
	constructor(initialState = STATES.CREATED) {
		this.currentState = initialState;
	}

	transition(toState) {
		const fromState = this.currentState;

		if (!isLegalTransition(fromState, toState)) {
			return {
				success: false,
				error: `Cannot transition from ${fromState} to ${toState}`,
				fromState,
				toState,
			};
		}

		this.currentState = toState;
		const eventType = EVENT_TYPES[toState] || "state_changed";

		return {
			success: true,
			fromState,
			toState,
			event: { type: eventType, data: { fromState, toState } },
		};
	}

	isFinal() {
		return isFinal(this.currentState);
	}
}

module.exports = {
	SessionStateMachine,
	STATES,
	TRANSITIONS,
	FINAL_STATES,
	isLegalTransition,
	legalTargets,
	isFinal,
};
