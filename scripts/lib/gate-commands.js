"use strict";

// F050 ticket 3 (#228) — Gate Contract CLI surface
// (evaluate/show/list). Envelope, routing, and exit codes are owned by
// defineCommand (F039); this adapter only parses flags and forwards to the
// gate core (core/gate-evaluation.js), which owns every semantic verdict
// (the contract shape, the allOf/bounded-anyOf evaluation, assurance
// ordering, staleness, thresholds, expiry, deny-only failure behavior, and
// the immutable outcome ledger) as a stable AMBER_E_* code.
//
// Gates are ADMITTED through the existing artifact surface —
// `amber artifact admit --type gate --extension gate.require='[...]'` —
// because a Gate Contract is ordinary canonical-artifact content riding
// the Envelope's extensions carrier; this command only evaluates and reads.

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");

// The readFailure FALLBACK for untyped crashes at the show/list seams, not
// a corruption verdict (same naming discipline as the approval command).
const READ_FAILURE_CODE = "AMBER_E_GATE_NOT_FOUND";

function invalidArg(message) {
	return { text: "", errors: [message], warnings: [], exitCode: 1, code: "AMBER_E_INVALID_ARG" };
}

/**
 * The evaluate writer propagates typed throws for environment-level
 * misconfiguration — a garbage AMBER_GATE_MAX_OUTCOME_BYTES override is
 * resolvePositiveIntCeiling's typed AMBER_E_INVALID_ARG, never a silent
 * default. The CLI seam converts a typed throw into the standard result
 * envelope so the public surface keeps its stable code and exit code.
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
 * indistinguishable from "not declared" further down — a trailing `--gate`
 * or `--subject` would silently drop the declared input. parseArgs only
 * sets a value flag's key when the flag appears, so present-but-undefined
 * names exactly the truncated invocation, and it fails closed as
 * AMBER_E_INVALID_ARG here at the gate command seam (same discipline as
 * the approval and evidence commands).
 */
function missingValueFlag(args) {
	const valueFlags = [
		["gate", "--gate"],
		["subject", "--subject"],
		["revision", "--revision"],
		["now", "--now"],
		["index", "--index"],
		["verdict", "--verdict"],
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
 * discipline as the principal/evidence/approval commands).
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

/** Parse --revision: a positive integer naming one committed gate revision. */
function revisionFlagValue(args) {
	if (args.revision === undefined) return { value: null };
	const revision = Number(args.revision);
	if (!Number.isInteger(revision) || revision < 1) {
		return {
			error: `--revision must be a positive integer naming the committed gate revision to evaluate (it defaults to the current committed head); got ${JSON.stringify(args.revision)}`,
		};
	}
	return { value: revision };
}

/**
 * Parse --now: the injected evaluation clock, an ISO-8601 date or zoned
 * date-time. The evaluator records clockSource "injected" whenever it is
 * provided; garbage is an argument error, never a silently ignored flag.
 */
function nowFlagValue(args) {
	if (args.now === undefined) return { value: undefined };
	const parsed = new Date(String(args.now));
	if (Number.isNaN(parsed.getTime())) {
		return {
			error: `--now must be an ISO-8601 date, or a date-time carrying an explicit zone (Z or ±hh:mm) — e.g. 2027-01-31 or 2027-01-31T09:00:00Z; got ${JSON.stringify(args.now)}`,
		};
	}
	return { value: parsed };
}

/** Parse --index: a non-negative 0-based outcome ledger line. */
function indexFlagValue(args) {
	if (args.index === undefined) return { value: null };
	const index = Number(args.index);
	if (!Number.isInteger(index) || index < 0) {
		return {
			error: `--index must be a non-negative integer naming the 0-based gate outcome ledger line to show; got ${JSON.stringify(args.index)}`,
		};
	}
	return { value: index };
}

function verdictFilterValue(args) {
	if (args.verdict === undefined) return { value: null };
	const verdict = String(args.verdict);
	if (verdict !== "pass" && verdict !== "fail") {
		return {
			error: `--verdict must be one of the closed set (pass, fail); got ${JSON.stringify(args.verdict)}`,
		};
	}
	return { value: verdict };
}

const dispatch = defineCommand({
	command: "gate",
	actions: ["evaluate", "show", "list"],
	handlers: {
		evaluate: (args) => {
			const { evaluateGate } = require("./core/gate-evaluation");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line, so the declared input would otherwise be dropped silently`,
				);
			}
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			const gate = requiredFlag(args, "gate", "--gate", "gate/login-gate");
			if (gate.error) return invalidArg(gate.error);
			const subject = requiredFlag(args, "subject", "--subject", "spec/login@2");
			if (subject.error) return invalidArg(subject.error);
			const revision = revisionFlagValue(args);
			if (revision.error) return invalidArg(revision.error);
			const now = nowFlagValue(args);
			if (now.error) return invalidArg(now.error);
			let result;
			try {
				result = evaluateGate(
					target.value,
					{
						gate: gate.value,
						subject: subject.value,
						revision: revision.value,
						...(now.value !== undefined ? { now: now.value } : {}),
					},
					{},
				);
			} catch (err) {
				return writeFailure(err);
			}
			// A FAIL verdict is a completed evaluation, not a command error:
			// the outcome record is appended (verdict "fail") and returned
			// with exit code 0 — the record is the audit trail, and only
			// contract/expiry/resolution failures refuse to run.
			return {
				text: result.ok ? JSON.stringify(result.outcome, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		show: (args) => {
			const { showGateOutcome } = require("./core/gate-evaluation");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			}
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			const index = indexFlagValue(args);
			if (index.error) return invalidArg(index.error);
			const gate = optionalString(args.gate);
			const subject = optionalString(args.subject);
			if (index.value === null && gate === null) {
				return invalidArg(
					"--index <n> (the 0-based outcome ledger line) or --gate <id> (latest matching outcome, optionally narrowed by --subject) is required: show names one outcome record to display",
				);
			}
			let record;
			try {
				record = showGateOutcome(target.value, {
					index: index.value,
					gate,
					subject,
				});
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
			if (!record) {
				return {
					text: "",
					errors: [
						`no gate outcome recorded${gate !== null ? ` for gate "${gate}"${subject !== null ? ` and subject "${subject}"` : ""}` : ""}${index.value !== null ? ` at index ${index.value}` : ""}`,
					],
					warnings: [],
					exitCode: 1,
					code: "AMBER_E_GATE_NOT_FOUND",
				};
			}
			return { text: JSON.stringify(record, null, 2) };
		},
		list: (args) => {
			const { listGateOutcomes } = require("./core/gate-evaluation");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			}
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			const verdict = verdictFilterValue(args);
			if (verdict.error) return invalidArg(verdict.error);
			let records;
			try {
				records = listGateOutcomes(target.value, {
					gate: optionalString(args.gate),
					subject: optionalString(args.subject),
					verdict: verdict.value,
				});
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
			return { text: JSON.stringify(records, null, 2) };
		},
	},
});

function gateDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { gateDispatch };
