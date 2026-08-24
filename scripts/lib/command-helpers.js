"use strict";

// Shared routing/result-shaping helpers for command handlers (architecture
// review #1). Extracted from command-dispatcher.js so domain command modules
// (projection-commands, sync-commands, ...) can shape results without
// importing the router.

/** Resolve the target root from args, defaulting to cwd. */
function resolveTarget(args) {
	return args.target || process.cwd();
}

/** The unknown-action envelope: no guess, explicit required-action list. */
function unknownAction(command, actions) {
	const list =
		actions.length > 1
			? `${actions.slice(0, -1).join(", ")}, or ${actions.at(-1)}`
			: `${actions[0]}`;
	return {
		target: undefined,
		errors: [`${command} requires ${list}.`],
		warnings: [],
	};
}

/** Shape a handler result into the { result, exitCode, bypassPrint } envelope. */
function shapeResult(args, body, { exitCode, bypassPrint } = {}) {
	return {
		result: {
			target: args.target,
			...body,
			errors: body.errors || [],
			warnings: body.warnings || [],
		},
		exitCode,
		bypassPrint: bypassPrint ?? !args.json,
	};
}

/** Require a --session id for an action, or an error result. */
function requireSessionId(args, action) {
	if (!args.session) {
		return { text: `session ${action} requires --session <id>.`, exitCode: 1 };
	}
	return null;
}

module.exports = {
	resolveTarget,
	unknownAction,
	shapeResult,
	requireSessionId,
};
