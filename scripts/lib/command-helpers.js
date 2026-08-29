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

/**
 * Typed read-failure envelope for corrupt or unreadable ledgers (F035-S5,
 * decision D4): explicit code, empty payload, non-empty diagnostics, exit
 * code 1 — never an empty success.
 * @param {object} args - Parsed CLI arguments.
 * @param {Error} err - Typed error thrown by the read surface.
 * @param {string} fallbackCode - Code to report when err carries no .amberCode.
 * @returns {{result: object, exitCode: number, bypassPrint: boolean}}
 */
function readFailure(args, err, fallbackCode) {
	return {
		result: {
			target: args.target,
			text: "",
			errors: [err.message || String(err)],
			warnings: [],
			code: err.amberCode || fallbackCode,
		},
		exitCode: 1,
		bypassPrint: !args.json,
	};
}

// ── Shared per-flag seam helpers (acceptance review S2) ─────────────────
// The governed-registry command seams (maintain/retention/external/
// breakglass) compose one flag-parsing vocabulary: the invalid-arg
// envelope, target resolution, required strings, positive integers, the
// injected --now clock, the ok/record result envelope, and the
// truncated-flag probe. Each seam keeps only its own flag table and any
// registry-specific envelope variant.

function invalidArg(message) {
	return { text: "", errors: [message], warnings: [], exitCode: 1, code: "AMBER_E_INVALID_ARG" };
}

function targetValue(args) {
	if (args.target === undefined || args.target === null) return { value: resolveTarget(args) };
	const target = String(args.target);
	if (target.trim().length === 0)
		return { error: `--target must be non-empty; got ${JSON.stringify(args.target)}` };
	return { value: target };
}

function requiredString(args, key, flag, example) {
	const value = args[key] === undefined ? null : String(args[key]);
	if (value === null || value.trim().length === 0) {
		return {
			error: `${flag} is required and must be non-empty (e.g. ${flag} ${example}); got ${JSON.stringify(args[key])}`,
		};
	}
	return { value };
}

function positiveInt(args, key, flag) {
	const value = Number(args[key]);
	if (!Number.isInteger(value) || value < 1)
		return { error: `${flag} must be a positive integer; got ${JSON.stringify(args[key])}` };
	return { value };
}

function clockValue(args) {
	if (args.now === undefined) return { value: null };
	const now = new Date(String(args.now));
	if (Number.isNaN(now.getTime()))
		return { error: `--now must be an ISO-8601 timestamp; got ${JSON.stringify(args.now)}` };
	return { value: now };
}

function resultEnvelope(result) {
	return {
		text: result.ok ? JSON.stringify(result.record, null, 2) : "",
		errors: result.errors,
		warnings: [],
		exitCode: result.ok ? 0 : 1,
		...(result.code ? { code: result.code } : {}),
	};
}

// A value-bearing flag that was the last token on the command line parses
// as undefined; naming it beats a generic failure. Each seam passes its
// own [argsKey, flag] table.
function missingValueFlag(args, valueFlags) {
	for (const [key, flag] of valueFlags) {
		if (key in args && args[key] === undefined) return flag;
	}
	return null;
}

module.exports = {
	resolveTarget,
	unknownAction,
	shapeResult,
	requireSessionId,
	readFailure,
	invalidArg,
	targetValue,
	requiredString,
	positiveInt,
	clockValue,
	resultEnvelope,
	missingValueFlag,
};
