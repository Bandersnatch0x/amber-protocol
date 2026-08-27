"use strict";

// F050 ticket 4 (#229) — Approval records CLI surface
// (grant/revoke/consume/show/list). Envelope, routing, and exit codes are
// owned by defineCommand (F039); this adapter only parses flags and forwards
// to the approval core (core/approval-registry.js), which owns every
// semantic verdict (the human-only approver/revoker slots, the half-open
// validity window, scope confinement, single-use consumption atomic with
// the authorized Decision's settlement, ceiling, corruption) as a stable
// AMBER_E_* code.

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");
const { parseTraceFlags } = require("./canonical-artifact-commands");

// The readFailure FALLBACK for untyped crashes at the show/list seams, not a
// corruption verdict (same naming discipline as the evidence command).
const READ_FAILURE_CODE = "AMBER_E_APPROVAL_NOT_FOUND";

function invalidArg(message) {
	return { text: "", errors: [message], warnings: [], exitCode: 1, code: "AMBER_E_INVALID_ARG" };
}

/**
 * The approval writers (grant/revoke/consume) propagate typed throws for
 * environment-level misconfiguration — a garbage AMBER_APPROVAL_MAX_REGISTRY_BYTES
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
 * `--approver` would silently drop the declared input. parseArgs only sets a
 * value flag's key when the flag appears, so present-but-undefined names
 * exactly the truncated invocation, and it fails closed as
 * AMBER_E_INVALID_ARG here at the approval command seam (same discipline as
 * the principal and evidence commands).
 */
function missingValueFlag(args) {
	const valueFlags = [
		["id", "--id"],
		["approver", "--approver"],
		["subject", "--subject"],
		["scope", "--scope"],
		["validUntil", "--valid-until"],
		["revoker", "--revoker"],
		["decisionIdentity", "--decision-identity"],
		["body", "--body"],
		["traceVal", "--trace"],
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
 * discipline as the principal/evidence/artifact commands).
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

const dispatch = defineCommand({
	command: "approval",
	actions: ["grant", "revoke", "consume", "show", "list"],
	handlers: {
		grant: (args) => {
			const { grantApproval } = require("./core/approval-registry");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line, so the declared input would otherwise be dropped silently`,
				);
			}
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredFlag(args, "id", "--id", "approval/login-42");
			if (id.error) return invalidArg(id.error);
			const approver = requiredFlag(args, "approver", "--approver", "alice@example.com");
			if (approver.error) return invalidArg(approver.error);
			const subject = requiredFlag(args, "subject", "--subject", "spec/login@2");
			if (subject.error) return invalidArg(subject.error);
			const validUntil = requiredFlag(args, "validUntil", "--valid-until", "2027-01-31");
			if (validUntil.error) return invalidArg(validUntil.error);
			let result;
			try {
				result = grantApproval(target.value, {
					id: id.value,
					approver: approver.value,
					scope: optionalString(args.scope),
					subject: subject.value,
					validUntil: validUntil.value,
				});
			} catch (err) {
				return writeFailure(err);
			}
			return {
				text: result.ok ? JSON.stringify(result.approval, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		revoke: (args) => {
			const { revokeApproval } = require("./core/approval-registry");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			}
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredFlag(args, "id", "--id", "approval/login-42");
			if (id.error) return invalidArg(id.error);
			const revoker = requiredFlag(args, "revoker", "--revoker", "alice@example.com");
			if (revoker.error) return invalidArg(revoker.error);
			let result;
			try {
				result = revokeApproval(target.value, {
					id: id.value,
					revoker: revoker.value,
				});
			} catch (err) {
				return writeFailure(err);
			}
			return {
				text: result.ok ? JSON.stringify(result.approval, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		consume: (args) => {
			const { consumeApproval } = require("./core/approval-registry");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line, so the declared input would otherwise be dropped silently`,
				);
			}
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredFlag(args, "id", "--id", "approval/login-42");
			if (id.error) return invalidArg(id.error);
			const decisionIdentity = requiredFlag(
				args,
				"decisionIdentity",
				"--decision-identity",
				"decision/login-approved",
			);
			if (decisionIdentity.error) return invalidArg(decisionIdentity.error);
			const body = requiredFlag(args, "body", "--body", '"# Approval: ..."');
			if (body.error) return invalidArg(body.error);
			// The decides Trace grammar is the artifact surface's (one parser,
			// shared): `--trace decides:<targetType>:<identity>[@<revision>]`.
			const traces = parseTraceFlags(args.traceArgs);
			if (traces.error) return invalidArg(traces.error);
			let result;
			try {
				result = consumeApproval(target.value, {
					id: id.value,
					decisionIdentity: decisionIdentity.value,
					body: body.value,
					traces: traces.value,
					scope: optionalString(args.scope),
				});
			} catch (err) {
				return writeFailure(err);
			}
			return {
				text: result.ok
					? JSON.stringify({ approval: result.approval, decision: result.receipt }, null, 2)
					: "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		show: (args) => {
			const { showApproval } = require("./core/approval-registry");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			}
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredFlag(args, "id", "--id", "approval/login-42");
			if (id.error) return invalidArg(id.error);
			let record;
			try {
				record = showApproval(target.value, id.value);
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
			if (!record) {
				return {
					text: "",
					errors: [`approval "${id.value}" is not recorded`],
					warnings: [],
					exitCode: 1,
					code: "AMBER_E_APPROVAL_NOT_FOUND",
				};
			}
			return { text: JSON.stringify(record, null, 2) };
		},
		list: (args) => {
			const { listApprovals } = require("./core/approval-registry");
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
				records = listApprovals(target.value);
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
			return { text: JSON.stringify(records, null, 2) };
		},
	},
});

function approvalDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { approvalDispatch };
