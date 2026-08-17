"use strict";

// F028 durable owner taxonomy. This is the single source of truth for the
// owner recorded on a learning write-back booking. An owner describes the
// Amber surface that carries the behavior after review; it does not describe
// the recurrence cause or grant execution authority.

const LEARNING_OWNER_ROUTES = Object.freeze([
	Object.freeze({
		id: "skill",
		decisionQuestion:
			"Will the durable behavior primarily teach an agent how to perform a specific task?",
		responsibility:
			"Owns instruction documents that guide an agent through a specific task; it does not execute the task.",
	}),
	Object.freeze({
		id: "hook",
		decisionQuestion:
			"Must this behavior be checked at a lifecycle boundary every time that boundary is reached?",
		responsibility:
			"Owns deterministic lifecycle reminders, blockers, records, or policy checks at a host boundary.",
	}),
	Object.freeze({
		id: "command",
		decisionQuestion:
			"Is the durable behavior best exposed as a short, fixed operator entry point?",
		responsibility:
			"Owns a concise, explicit CLI or manual entry point that invokes a stable operation.",
	}),
	Object.freeze({
		id: "standard",
		decisionQuestion: "Is the behavior a reusable set of review checks applied across changes?",
		responsibility:
			"Owns reusable review criteria and check collections; it does not itself run a scheduler.",
	}),
	Object.freeze({
		id: "script",
		decisionQuestion:
			"Is the behavior a deterministic extraction, validation, transformation, or formatting helper?",
		responsibility:
			"Owns deterministic support logic for extracting, validating, transforming, or formatting data.",
	}),
	Object.freeze({
		id: "workflow-pack",
		decisionQuestion:
			"Should the behavior be carried as a declarative bundle of reusable governance pieces?",
		responsibility:
			"Owns declarative bundles that compose skills, standards, scripts, and approval gates without autonomous execution.",
	}),
	Object.freeze({
		id: "loop-contract",
		decisionQuestion:
			"Does the behavior define recurring-work trigger, cadence, state, stop, and review semantics?",
		responsibility:
			"Owns declarative repeated-work contracts for trigger, cadence, state spine, hard stops, and review gates; it is not a scheduler.",
	}),
	Object.freeze({
		id: "ci",
		decisionQuestion: "Must the check run on a protected repository event or pull-request gate?",
		responsibility:
			"Owns continuous checks that actually run on protected repository or PR events; it does not imply general target-project execution.",
	}),
]);

const LEARNING_OWNER_IDS = Object.freeze(LEARNING_OWNER_ROUTES.map((route) => route.id));

function getLearningOwner(id) {
	return LEARNING_OWNER_ROUTES.find((route) => route.id === id) || null;
}

function renderLearningOwnerLines(indent = "") {
	return LEARNING_OWNER_ROUTES.map(
		(route) => `${indent}- ${route.id}: ${route.decisionQuestion} ${route.responsibility}`,
	);
}

function learningOwnerIdsText() {
	return LEARNING_OWNER_IDS.join(", ");
}

module.exports = {
	LEARNING_OWNER_ROUTES,
	LEARNING_OWNER_IDS,
	getLearningOwner,
	renderLearningOwnerLines,
	learningOwnerIdsText,
};
