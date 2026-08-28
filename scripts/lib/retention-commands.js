"use strict";

// F055 public CLI seam for retention classification and deterministic
// expiry evaluation. This adapter parses flags only; the core owns every
// verdict, evaluation is read-only, and nothing is ever deleted here.

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");

const READ_FAILURE_CODE = "AMBER_E_RETENTION_CORRUPT";

function invalidArg(message) {
	return { text: "", errors: [message], warnings: [], exitCode: 1, code: "AMBER_E_INVALID_ARG" };
}

function missingValueFlag(args) {
	const valueFlags = [
		["record", "--record"],
		["retentionClass", "--retention-class"],
		["policy", "--policy"],
		["sensitivity", "--sensitivity"],
		["now", "--now"],
		["type", "--type"],
		["id", "--id"],
		["target", "--target"],
	];
	for (const [key, flag] of valueFlags) {
		if (key in args && args[key] === undefined) return flag;
	}
	return null;
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

// Grammar: <type>:<identity>@<revision> — one committed record pin.
function parseRecord(raw) {
	const match = /^([a-z][a-z0-9-]*):(.+)@([1-9]\d*)$/.exec(String(raw));
	if (!match) {
		return {
			error: `--record must be <type>:<identity>@<revision> (e.g. --record spec:spec/login@2); got ${JSON.stringify(raw)}`,
		};
	}
	return { value: { type: match[1], identity: match[2], revision: Number(match[3]) } };
}

// Grammar: <identity>@<revision> — one committed policy revision pin.
function parsePolicyPin(raw) {
	const match = /^(.+)@([1-9]\d*)$/.exec(String(raw));
	if (!match) {
		return {
			error: `--policy must be <identity>@<revision> (e.g. --policy policy/tenant-retention@1); got ${JSON.stringify(raw)}`,
		};
	}
	return { value: { identity: match[1], revision: Number(match[2]) } };
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

const dispatch = defineCommand({
	command: "retention",
	actions: ["classify", "evaluate", "classifications"],
	handlers: {
		classify: (args) => {
			const { classify } = require("./core/retention-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["record", "--record", "spec:spec/login@2"],
				["retentionClass", "--retention-class", "operational"],
				["policy", "--policy", "policy/tenant-retention@1"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const record = parseRecord(args.record);
			if (record.error) return invalidArg(record.error);
			const policy = parsePolicyPin(args.policy);
			if (policy.error) return invalidArg(policy.error);
			return resultEnvelope(
				classify(target.value, {
					record: record.value,
					retentionClass: String(args.retentionClass),
					policy: policy.value,
					sensitivity: args.sensitivity === undefined ? "none" : String(args.sensitivity),
					minimized: args.minimized === true,
				}),
			);
		},
		evaluate: (args) => {
			const { evaluateRetention } = require("./core/retention-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			let now;
			if (args.now !== undefined) {
				now = new Date(String(args.now));
				if (Number.isNaN(now.getTime()))
					return invalidArg(`--now must be an ISO-8601 timestamp; got ${JSON.stringify(args.now)}`);
			}
			return resultEnvelope(evaluateRetention(target.value, now ? { now } : {}));
		},
		classifications: (args) => {
			const { listClassifications } = require("./core/retention-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const type = args.type === undefined ? null : String(args.type);
			if (type !== null && type.trim().length === 0)
				return invalidArg(
					`--type must be non-empty when provided; got ${JSON.stringify(args.type)}`,
				);
			const identity = args.id === undefined ? null : String(args.id);
			if (identity !== null && identity.trim().length === 0)
				return invalidArg(`--id must be non-empty when provided; got ${JSON.stringify(args.id)}`);
			try {
				return {
					text: JSON.stringify(listClassifications(target.value, { type, identity }), null, 2),
				};
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
	},
});

function retentionDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { retentionDispatch };
