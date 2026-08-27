"use strict";

// F050 ticket 1 (#226) — Principal registry CLI surface
// (register/show/list/revoke). Envelope, routing, and exit codes are owned by
// defineCommand (F039); this adapter only parses flags and forwards to the
// registry core (core/principal-registry.js), which owns every semantic
// verdict (closed kind set, validity windows, terminal revocation, ceiling,
// corruption) as a stable AMBER_E_* code.

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");

// The readFailure FALLBACK for untyped crashes/misses at the show/list seams,
// not a corruption verdict (same naming discipline as the artifact command).
const READ_FAILURE_CODE = "AMBER_E_PRINCIPAL_NOT_FOUND";

function invalidArg(message) {
	return { text: "", errors: [message], warnings: [], exitCode: 1, code: "AMBER_E_INVALID_ARG" };
}

/**
 * The registry writers (register/revoke) propagate typed throws for
 * environment-level misconfiguration — a garbage AMBER_PRINCIPAL_MAX_REGISTRY_BYTES
 * override is resolvePositiveIntCeiling's typed AMBER_E_INVALID_ARG, never a
 * silent default. The CLI seam converts a typed throw into the standard
 * result envelope so the public surface keeps its stable code and exit code
 * (the same discipline the show/list handlers apply to typed read throws).
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
 * `--valid-from` would silently drop the declared input. parseArgs only sets a
 * value flag's key when the flag appears, so present-but-undefined names
 * exactly the truncated invocation, and it fails closed as
 * AMBER_E_INVALID_ARG here at the principal command seam (ticket-03 review
 * finding F-4 / finding F5 discipline, applied to this surface).
 */
function missingValueFlag(args) {
	const valueFlags = [
		["id", "--id"],
		["kind", "--kind"],
		["role", "--role"],
		["membership", "--membership"],
		["capability", "--capability"],
		["validFrom", "--valid-from"],
		["validTo", "--valid-to"],
		["issuer", "--issuer"],
		["reason", "--reason"],
		["target", "--target"],
	];
	for (const [key, flag] of valueFlags) {
		if (key in args && args[key] === undefined) return flag;
	}
	return null;
}

/**
 * An explicitly passed-but-empty --target ("", or whitespace) is a malformed
 * invocation, never a silent fallback to the process CWD — the caller meant to
 * name a repository, so it fails closed as AMBER_E_INVALID_ARG (ticket-04
 * routed fix, same helper as the artifact command).
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

/** Absent flag → null (the registry's "not declared"); never undefined. */
function optionalString(value) {
	return value === undefined ? null : String(value);
}

/**
 * Register/show/revoke name a principal; `--id` absent or explicitly empty is
 * an argument error naming the flag, not a registry lookup for a null id.
 */
function requiredId(args) {
	const id = optionalString(args.id);
	if (id === null || id.trim().length === 0) {
		return {
			error: `--id is required and must be a non-empty principal id (e.g. --id alice@example.com); got ${JSON.stringify(args.id)}`,
		};
	}
	return { value: id };
}

const dispatch = defineCommand({
	command: "principal",
	actions: ["register", "show", "list", "revoke"],
	handlers: {
		register: (args) => {
			const { registerPrincipal } = require("./core/principal-registry");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line, so the declared input would otherwise be dropped silently`,
				);
			}
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			let result;
			try {
				result = registerPrincipal(target.value, {
					id: optionalString(args.id),
					principalKind: optionalString(args.kind),
					role: optionalString(args.role),
					membership: optionalString(args.membership),
					capability: optionalString(args.capability),
					validFrom: optionalString(args.validFrom),
					validTo: optionalString(args.validTo),
					issuer: optionalString(args.issuer),
				});
			} catch (err) {
				return writeFailure(err);
			}
			return {
				text: result.ok ? JSON.stringify(result.record, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		show: (args) => {
			const { showPrincipal } = require("./core/principal-registry");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			}
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredId(args);
			if (id.error) return invalidArg(id.error);
			let record;
			try {
				record = showPrincipal(target.value, id.value);
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
			if (!record) {
				return {
					text: "",
					errors: [`principal "${id.value}" is not registered`],
					warnings: [],
					exitCode: 1,
					code: "AMBER_E_PRINCIPAL_NOT_FOUND",
				};
			}
			return { text: JSON.stringify(record, null, 2) };
		},
		list: (args) => {
			const { listPrincipals } = require("./core/principal-registry");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			}
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			let principals;
			try {
				principals = listPrincipals(target.value);
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
			return { text: JSON.stringify(principals, null, 2) };
		},
		revoke: (args) => {
			const { revokePrincipal } = require("./core/principal-registry");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			}
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredId(args);
			if (id.error) return invalidArg(id.error);
			let result;
			try {
				result = revokePrincipal(target.value, {
					id: id.value,
					reason: optionalString(args.reason),
				});
			} catch (err) {
				return writeFailure(err);
			}
			return {
				text: result.ok ? JSON.stringify(result.record, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
	},
});

function principalDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { principalDispatch };
