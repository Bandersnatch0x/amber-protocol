"use strict";

// F049 tickets 01–03 — Canonical Artifact CLI surface (admit/show/list).
// Envelope, routing, and exit codes are owned by defineCommand (F039).

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");
const { ARTIFACT_TYPES } = require("./core/canonical-artifact-contracts");

const CORRUPT_CODE = "AMBER_E_ARTIFACT_NOT_FOUND";

/**
 * Strict positive-integer parse for revision flags: absent → { value: null },
 * garbage (including an explicitly empty value) → { error } with a visible
 * message. A garbage value never reaches the admission contract as NaN, and
 * never silently drops a declared CAS precondition.
 */
function parseRevisionFlag(raw, flag) {
	if (raw === undefined || raw === null) return { value: null };
	const text = String(raw).trim();
	if (!/^[0-9]+$/.test(text) || !Number.isSafeInteger(Number.parseInt(text, 10))) {
		return {
			error: `${flag} must be a positive integer revision number; got ${JSON.stringify(text)}`,
		};
	}
	const parsed = Number.parseInt(text, 10);
	if (parsed < 1) {
		return {
			error: `${flag} must be a positive integer revision number (revisions start at 1); got ${JSON.stringify(text)}`,
		};
	}
	return { value: parsed };
}

/**
 * Ticket-02 review finding F4: a value flag as the LAST argv token parses to
 * `undefined`, which is indistinguishable from "not declared" further down —
 * a trailing `--expected-head` would silently drop the CAS precondition.
 * parseArgs only sets a value flag's key when the flag appears, so
 * present-but-undefined names exactly the truncated invocation, and it fails
 * closed as AMBER_E_INVALID_ARG here at the artifact command seam.
 */
function missingValueFlag(args) {
	const valueFlags = [
		["type", "--type"],
		["id", "--id"],
		["body", "--body"],
		["provenance", "--provenance"],
		["expectedHead", "--expected-head"],
		["supersedesRevision", "--supersedes-revision"],
		["idempotencyKey", "--idempotency-key"],
		["transition", "--transition"],
		["scope", "--scope"],
		["traceVal", "--trace"],
		["revision", "--revision"],
	];
	for (const [key, flag] of valueFlags) {
		if (key in args && args[key] === undefined) return flag;
	}
	return null;
}

/**
 * Parse repeatable --trace flags (ticket 03, #220):
 * `--trace <traceType>:<identity>[@<revision>]` — e.g.
 * `--trace refines:login-bug` or `--trace refines:login-bug@2`. The target
 * type is deliberately NOT declared here: the registered Trace contract
 * derives it from the trace type and the admitting artifact's type, so the
 * CLI cannot name a target type the registry contradicts. The revision is
 * strict (positive integer, never NaN) and defaults to the target's current
 * committed head inside the store.
 */
function parseTraceFlags(rawList) {
	const traces = [];
	const list = Array.isArray(rawList) ? rawList : [];
	for (const raw of list) {
		if (typeof raw !== "string" || raw.length === 0) {
			return {
				error: `--trace must be of the form <traceType>:<identity>[@<revision>]; got ${JSON.stringify(raw)}`,
			};
		}
		const colon = raw.indexOf(":");
		if (colon <= 0 || colon === raw.length - 1) {
			return {
				error: `--trace must be of the form <traceType>:<identity>[@<revision>]; got ${JSON.stringify(raw)}`,
			};
		}
		const type = raw.slice(0, colon);
		let identity = raw.slice(colon + 1);
		let revision = null;
		const at = identity.lastIndexOf("@");
		if (at !== -1) {
			const revisionText = identity.slice(at + 1);
			if (!/^[0-9]+$/.test(revisionText) || Number.parseInt(revisionText, 10) < 1) {
				return {
					error: `--trace revision must be a positive integer revision number; got ${JSON.stringify(revisionText)}`,
				};
			}
			revision = Number.parseInt(revisionText, 10);
			identity = identity.slice(0, at);
		}
		if (identity.length === 0) {
			return {
				error: `--trace must be of the form <traceType>:<identity>[@<revision>]; got ${JSON.stringify(raw)}`,
			};
		}
		traces.push({ type, to: { identity, ...(revision !== null ? { revision } : {}) } });
	}
	return { value: traces };
}

function invalidArg(message) {
	return { text: "", errors: [message], warnings: [], exitCode: 1, code: "AMBER_E_INVALID_ARG" };
}

function unknownType(type) {
	return {
		text: "",
		errors: [
			`artifact type "${type}" is not registered; registered types: ${ARTIFACT_TYPES.join(", ")}`,
		],
		warnings: [],
		exitCode: 1,
		code: "AMBER_E_ARTIFACT_UNKNOWN_TYPE",
	};
}

const dispatch = defineCommand({
	command: "artifact",
	actions: ["admit", "show", "list"],
	handlers: {
		admit: (args) => {
			const { admitArtifact } = require("./core/canonical-artifacts");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line, so the declared precondition would otherwise be dropped silently`,
				);
			}
			const body = args.body ? String(args.body) : null;
			const expectedHead = parseRevisionFlag(args.expectedHead, "--expected-head");
			if (expectedHead.error) return invalidArg(expectedHead.error);
			const supersedes = parseRevisionFlag(args.supersedesRevision, "--supersedes-revision");
			if (supersedes.error) return invalidArg(supersedes.error);
			// Ticket-02 review finding F5: an explicitly passed-but-empty
			// idempotency key is a malformed invocation, never a silent "no key" —
			// it must fail closed exactly like an empty --expected-head does.
			const idempotencyKey = args.idempotencyKey === undefined ? null : String(args.idempotencyKey);
			if (idempotencyKey !== null && idempotencyKey.trim().length === 0) {
				return invalidArg(
					`--idempotency-key must be a non-empty string when provided; got ${JSON.stringify(args.idempotencyKey)}`,
				);
			}
			const traces = parseTraceFlags(args.traceArgs);
			if (traces.error) return invalidArg(traces.error);
			const result = admitArtifact(resolveTarget(args), {
				type: args.type || "intent",
				identity: args.id,
				body,
				provenance: args.provenance ? { source: args.provenance } : null,
				supersedes: supersedes.value,
				expectedHead: expectedHead.value,
				idempotencyKey,
				transition: args.transition === undefined ? null : String(args.transition),
				scope: args.scope === undefined ? null : String(args.scope),
				traces: traces.value,
			});
			return {
				text: result.ok ? JSON.stringify(result.receipt, null, 2) : "",
				errors: result.errors,
				warnings: result.duplicate ? ["duplicate retry; original committed revision returned"] : [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		show: (args) => {
			const { showArtifact } = require("./core/canonical-artifacts");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const revision = parseRevisionFlag(args.revision, "--revision");
			if (revision.error) return invalidArg(revision.error);
			const type = args.type || "intent";
			if (!ARTIFACT_TYPES.includes(type)) return unknownType(type);
			let shown;
			try {
				shown = showArtifact(resolveTarget(args), args.id, { type, revision: revision.value });
			} catch (err) {
				const failure = readFailure(args, err, CORRUPT_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
			if (!shown) {
				return {
					text: "",
					errors: [
						`no committed revision found for "${args.id}"${revision.value ? ` at revision ${revision.value}` : ""}`,
					],
					warnings: [],
					exitCode: 1,
					code: "AMBER_E_ARTIFACT_NOT_FOUND",
				};
			}
			return { text: JSON.stringify(shown, null, 2) };
		},
		list: (args) => {
			const { listArtifacts } = require("./core/canonical-artifacts");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			if (args.type !== undefined && !ARTIFACT_TYPES.includes(args.type)) {
				return unknownType(args.type);
			}
			let artifacts;
			try {
				artifacts = listArtifacts(resolveTarget(args));
			} catch (err) {
				const failure = readFailure(args, err, CORRUPT_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
			return { text: JSON.stringify(artifacts, null, 2) };
		},
	},
});

function artifactDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { artifactDispatch };
