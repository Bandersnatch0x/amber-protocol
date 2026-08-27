"use strict";

// F050 ticket 2 (#227) — Evidence receipts & Assurance CLI surface
// (record/verify/show/list). Envelope, routing, and exit codes are owned by
// defineCommand (F039); this adapter only parses flags and forwards to the
// evidence core (core/evidence-receipts.js), which owns every semantic
// verdict (the four-level Assurance contract, producer/verifier registry
// binding, replayOf provenance, ceiling, corruption) as a stable AMBER_E_*
// code.

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");

// The readFailure FALLBACK for untyped crashes at the show/list seams, not a
// corruption verdict (same naming discipline as the principal command).
const READ_FAILURE_CODE = "AMBER_E_EVIDENCE_NOT_FOUND";

function invalidArg(message) {
	return { text: "", errors: [message], warnings: [], exitCode: 1, code: "AMBER_E_INVALID_ARG" };
}

/**
 * The evidence writers (record/verify) propagate typed throws for
 * environment-level misconfiguration — a garbage AMBER_EVIDENCE_MAX_REGISTRY_BYTES
 * override is resolvePositiveIntCeiling's typed AMBER_E_INVALID_ARG, never a
 * silent default. The CLI seam converts a typed throw into the standard
 * result envelope so the public surface keeps its stable code and exit code.
 */
function writeFailure(err) {
	return {
		text: "",
		errors: [err.message || String(err)],
		warnings: [],
		exitCode: 1,
		...(err.amberCode ? { code: err.amberCode } : {}),
	};
}

/**
 * A value flag as the LAST argv token parses to `undefined`, which is
 * indistinguishable from "not declared" further down — a trailing `--id` or
 * `--producer` would silently drop the declared input. parseArgs only sets a
 * value flag's key when the flag appears, so present-but-undefined names
 * exactly the truncated invocation, and it fails closed as
 * AMBER_E_INVALID_ARG here at the evidence command seam (same discipline as
 * the principal command, ticket-03 review finding F-4).
 */
function missingValueFlag(args) {
	const valueFlags = [
		["id", "--id"],
		["producer", "--producer"],
		["assurance", "--assurance"],
		["scope", "--scope"],
		["subject", "--subject"],
		["status", "--status"],
		["replayOf", "--replay-of"],
		["verifier", "--verifier"],
		["inputVal", "--input"],
		["toolVal", "--tool"],
		["envVal", "--env"],
		["outputVal", "--outputs"],
		["target", "--target"],
	];
	for (const [key, flag] of valueFlags) {
		if (key in args && args[key] === undefined) return flag;
	}
	return null;
}

/**
 * An explicitly passed-but-empty --target ("", or whitespace) is a malformed
 * invocation, never a silent fallback to the process CWD (same helper
 * discipline as the principal/artifact commands).
 */
function targetFlagValue(args) {
	if (args.target === undefined || args.target === null) return { value: resolveTarget(args) };
	const target = String(args.target);
	if (target.trim().length === 0) {
		return {
			error: `--target must be a non-empty repository path when provided; got ${JSON.stringify(args.target)}`,
		};
	}
	return { value: target };
}

/** Absent flag → null (the core's "not declared"); never undefined. */
function optionalString(value) {
	return value === undefined ? null : String(value);
}

function requiredFlag(args, key, flag, example) {
	const value = optionalString(args[key]);
	if (value === null || value.trim().length === 0) {
		return {
			error: `${flag} is required and must be a non-empty value (e.g. ${flag} ${example}); got ${JSON.stringify(args[key])}`,
		};
	}
	return { value };
}

/**
 * Parse the accumulated `--env key=value` entries into the environment
 * object. Each entry must carry one "=" separator with a non-empty key; a
 * malformed entry fails closed as AMBER_E_INVALID_ARG naming the entry (the
 * receipt contract stores plain string values, so no quoting games).
 */
function environmentFromEntries(entries) {
	if (!entries || entries.length === 0) return {};
	const environment = {};
	for (const entry of entries) {
		if (typeof entry !== "string") {
			return { error: `--env requires a "key=value" entry; got ${JSON.stringify(entry)}` };
		}
		const separator = entry.indexOf("=");
		if (separator <= 0 || separator === entry.length - 1) {
			return {
				error: `--env requires a "key=value" entry with a non-empty key and value; got ${JSON.stringify(entry)}`,
			};
		}
		const key = entry.slice(0, separator);
		if (key in environment) {
			return {
				error: `--env declares "${key}" more than once; an environment key is stated once (later declarations would silently shadow earlier ones)`,
			};
		}
		environment[key] = entry.slice(separator + 1);
	}
	return { value: environment };
}

const dispatch = defineCommand({
	command: "evidence",
	actions: ["record", "verify", "show", "list"],
	handlers: {
		record: (args) => {
			const { recordEvidence } = require("./core/evidence-receipts");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line, so the declared input would otherwise be dropped silently`,
				);
			}
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredFlag(args, "id", "--id", "evidence/run-42");
			if (id.error) return invalidArg(id.error);
			const producer = requiredFlag(args, "producer", "--producer", "ci-runner");
			if (producer.error) return invalidArg(producer.error);
			const assurance = requiredFlag(args, "assurance", "--assurance", "replayable");
			if (assurance.error) return invalidArg(assurance.error);
			const subject = requiredFlag(args, "subject", "--subject", "spec/login@2");
			if (subject.error) return invalidArg(subject.error);
			const status = requiredFlag(args, "status", "--status", "pass");
			if (status.error) return invalidArg(status.error);
			const environment = environmentFromEntries(args.envEntries);
			if (environment.error) return invalidArg(environment.error);
			let result;
			try {
				result = recordEvidence(target.value, {
					id: id.value,
					producer: producer.value,
					assurance: assurance.value,
					scope: optionalString(args.scope),
					subject: subject.value,
					inputs: args.inputs || [],
					tools: args.tools || [],
					environment: environment.value,
					outputs: args.outputs || [],
					status: status.value,
					replayOf: optionalString(args.replayOf),
				});
			} catch (err) {
				return writeFailure(err);
			}
			return {
				text: result.ok ? JSON.stringify(result.receipt, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		verify: (args) => {
			const { verifyEvidence } = require("./core/evidence-receipts");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			}
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredFlag(args, "id", "--id", "evidence/run-42");
			if (id.error) return invalidArg(id.error);
			const verifier = requiredFlag(args, "verifier", "--verifier", "reviewer-alice");
			if (verifier.error) return invalidArg(verifier.error);
			let result;
			try {
				result = verifyEvidence(target.value, {
					id: id.value,
					verifier: verifier.value,
				});
			} catch (err) {
				return writeFailure(err);
			}
			return {
				text: result.ok ? JSON.stringify(result.receipt, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		show: (args) => {
			const { showEvidence } = require("./core/evidence-receipts");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			}
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredFlag(args, "id", "--id", "evidence/run-42");
			if (id.error) return invalidArg(id.error);
			let record;
			try {
				record = showEvidence(target.value, id.value);
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
			if (!record) {
				return {
					text: "",
					errors: [`evidence "${id.value}" is not recorded`],
					warnings: [],
					exitCode: 1,
					code: "AMBER_E_EVIDENCE_NOT_FOUND",
				};
			}
			return { text: JSON.stringify(record, null, 2) };
		},
		list: (args) => {
			const { listEvidence } = require("./core/evidence-receipts");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			}
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			let records;
			try {
				records = listEvidence(target.value);
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
			return { text: JSON.stringify(records, null, 2) };
		},
	},
});

function evidenceDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { evidenceDispatch };
