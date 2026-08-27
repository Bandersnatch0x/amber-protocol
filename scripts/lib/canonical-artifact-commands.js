"use strict";

// F049 tickets 01–03 — Canonical Artifact CLI surface (admit/show/list).
// Envelope, routing, and exit codes are owned by defineCommand (F039).

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");
const {
	ARTIFACT_TYPES,
	DECISION_KINDS,
	traceRequiresDeclaredTarget,
} = require("./core/canonical-artifact-contracts");

// Full-review follow-up finding 7 (ticket-01 review F7): this constant is the
// readFailure FALLBACK for untyped crashes/misses at the show/list seams, not
// a corruption verdict — it is named for what it actually holds so a crash can
// never be misread as "settlement corrupt" (or vice versa).
const READ_FAILURE_CODE = "AMBER_E_ARTIFACT_NOT_FOUND";

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
 * Ticket-03 review finding F-4 adds `--target`: parseArgs seeds args.target
 * with process.cwd() rather than leaving it absent, so a trailing `--target`
 * would otherwise parse as undefined and silently fall back to the CWD at
 * resolveTarget — the same present-but-undefined check catches it.
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
		["extensionVal", "--extension"],
		["revision", "--revision"],
		["target", "--target"],
		["decisionKind", "--decision-kind"],
		["principal", "--principal"],
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
 *
 * F050 ticket 1 (#226): a Trace type whose contract direction cannot derive
 * the target type ("any", e.g. `decides`) MUST declare it — its grammar is
 * `--trace <traceType>:<targetType>:<identity>[@<revision>]`, e.g.
 * `--trace decides:spec:spec/login-spec`. The requirement is registry-driven
 * (traceRequiresDeclaredTarget), not a CLI-side special case, so a future
 * "any"-direction trace type inherits the same grammar. Whether the declared
 * target type is REGISTERED stays the admission contract's verdict (the
 * structural check lists the registered types), exactly like trace semantics
 * are the registry's, not the CLI's.
 *
 * Full-review follow-up finding 8 (ticket-03 review F-6): identities may
 * contain `@`. The revision is parsed from the LAST `@` and only when what
 * follows is all digits — `refines:user@tenant` names the identity
 * `user@tenant` (head), `refines:user@tenant@3` pins revision 3 of it, and
 * `refines:login-bug@2` still pins revision 2 of `login-bug`. A trailing
 * all-digits-but-invalid value (`@0`) stays a fail-closed argument error —
 * the caller meant a revision. The one spelling this grammar cannot express
 * is an identity that itself ends in `@<digits>` referenced unpinned; pin a
 * revision explicitly instead (documented in CLI_REFERENCE).
 */
function parseTraceFlags(rawList) {
	const traces = [];
	const list = Array.isArray(rawList) ? rawList : [];
	for (const raw of list) {
		if (typeof raw !== "string" || raw.length === 0) {
			return {
				error: `--trace must be of the form <traceType>:<identity>[@<revision>] (or <traceType>:<targetType>:<identity>[@<revision>] for a Trace type that declares its target type); got ${JSON.stringify(raw)}`,
			};
		}
		const colon = raw.indexOf(":");
		if (colon <= 0 || colon === raw.length - 1) {
			return {
				error: `--trace must be of the form <traceType>:<identity>[@<revision>] (or <traceType>:<targetType>:<identity>[@<revision>] for a Trace type that declares its target type); got ${JSON.stringify(raw)}`,
			};
		}
		const type = raw.slice(0, colon);
		let rest = raw.slice(colon + 1);
		let declaredType = null;
		if (traceRequiresDeclaredTarget(type)) {
			const second = rest.indexOf(":");
			if (second <= 0 || second === rest.length - 1) {
				return {
					error: `--trace ${type} must be of the form ${type}:<targetType>:<identity>[@<revision>] — the ${type} contract allows any registered target type, so the Trace declares it (registered types: ${ARTIFACT_TYPES.join(", ")}); got ${JSON.stringify(raw)}`,
				};
			}
			declaredType = rest.slice(0, second);
			rest = rest.slice(second + 1);
		}
		let identity = rest;
		let revision = null;
		const at = identity.lastIndexOf("@");
		if (at !== -1) {
			const revisionText = identity.slice(at + 1);
			if (/^[0-9]+$/.test(revisionText)) {
				if (Number.parseInt(revisionText, 10) < 1) {
					return {
						error: `--trace revision must be a positive integer revision number; got ${JSON.stringify(revisionText)}`,
					};
				}
				revision = Number.parseInt(revisionText, 10);
				identity = identity.slice(0, at);
			}
			// A non-digit suffix after the last '@' belongs to the identity
			// itself (finding 8): the token names the target's head.
		}
		if (identity.length === 0) {
			return {
				error: `--trace must be of the form <traceType>:<identity>[@<revision>] (or <traceType>:<targetType>:<identity>[@<revision>] for a Trace type that declares its target type); got ${JSON.stringify(raw)}`,
			};
		}
		traces.push({
			type,
			to: {
				...(declaredType !== null ? { type: declaredType } : {}),
				identity,
				...(revision !== null ? { revision } : {}),
			},
		});
	}
	return { value: traces };
}

function invalidArg(message) {
	return { text: "", errors: [message], warnings: [], exitCode: 1, code: "AMBER_E_INVALID_ARG" };
}

/**
 * Parse repeatable --extension flags (ticket 06, #223 — AC2):
 * `--extension <namespace>.<key>=<value>` — e.g. `--extension acme.weight=3`
 * or `--extension acme.meta={"a":1}`. The value is parsed as JSON when it is
 * valid JSON (numbers, booleans, null, objects, arrays) and carried verbatim
 * as a string otherwise — extension data is opaque to amber, so both
 * `--extension acme.tag=hello` and `--extension acme.count=42` are
 * legitimate (the first carries the string "hello", the second the number
 * 42). The namespace/key split is on the FIRST dot of the name half, so
 * extension keys may themselves contain dots. Collisions with core Envelope
 * fields are NOT this parser's verdict — the admission contract owns that
 * stable error (AMBER_E_ARTIFACT_EXTENSION_COLLISION), exactly like trace
 * semantics are the registry's, not the CLI's. A duplicate namespace.key
 * declaration is an argument error: one key carries one value.
 */
function parseExtensionFlags(rawList) {
	const extensions = {};
	const list = Array.isArray(rawList) ? rawList : [];
	for (const raw of list) {
		if (typeof raw !== "string" || raw.length === 0) {
			return {
				error: `--extension must be of the form <namespace>.<key>=<value>; got ${JSON.stringify(raw)}`,
			};
		}
		const eq = raw.indexOf("=");
		if (eq <= 0) {
			return {
				error: `--extension must be of the form <namespace>.<key>=<value>; got ${JSON.stringify(raw)}`,
			};
		}
		const name = raw.slice(0, eq);
		const value = raw.slice(eq + 1);
		const dot = name.indexOf(".");
		if (dot <= 0 || dot === name.length - 1) {
			return {
				error: `--extension must be of the form <namespace>.<key>=<value>; got ${JSON.stringify(raw)}`,
			};
		}
		const namespace = name.slice(0, dot);
		const key = name.slice(dot + 1);
		let parsed;
		if (value.length > 0) {
			try {
				parsed = JSON.parse(value);
			} catch {
				parsed = value; // not JSON: carry the verbatim string
			}
		} else {
			parsed = "";
		}
		if (!Object.prototype.hasOwnProperty.call(extensions, namespace)) extensions[namespace] = {};
		if (Object.prototype.hasOwnProperty.call(extensions[namespace], key)) {
			return {
				error: `--extension ${namespace}.${key} was declared twice; one extension key carries one value`,
			};
		}
		extensions[namespace][key] = parsed;
	}
	return { value: Object.keys(extensions).length > 0 ? extensions : null };
}

/**
 * Ticket-04 routed fix: an explicitly passed-but-empty --target ("", or
 * whitespace) is a malformed invocation, never a silent fallback to the
 * process CWD via `args.target || process.cwd()` — the caller meant to name
 * a repository, so it fails closed as AMBER_E_INVALID_ARG exactly like an
 * explicitly empty --type or --scope. (parseArgs seeds args.target with
 * process.cwd() when the flag is absent; a trailing --target is undefined
 * and already caught by missingValueFlag.)
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

/**
 * Ticket-03 review finding F-3: an explicitly passed-but-empty --type is a
 * malformed invocation, never a silent default to intent — the caller meant
 * to name a type, so it fails closed as AMBER_E_INVALID_ARG exactly like an
 * explicitly empty --scope does. The legitimate default (the flag absent
 * entirely) still resolves to intent.
 */
function typeFlagValue(args) {
	if (args.type === undefined) return { value: "intent" };
	const type = String(args.type);
	if (type.trim().length === 0) {
		return {
			error: `--type must be one of the registered artifact types (${ARTIFACT_TYPES.join(", ")}) when provided; got ${JSON.stringify(args.type)}`,
		};
	}
	return { value: type };
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
			// F050 ticket 1 (#226): Decision admissions bind a kind and an acting
			// Principal. The flags are absent for every non-decision type (null);
			// an explicitly passed-but-empty value is a malformed invocation and
			// fails closed as AMBER_E_INVALID_ARG, mirroring --idempotency-key.
			const decisionKind = args.decisionKind === undefined ? null : String(args.decisionKind);
			if (decisionKind !== null && decisionKind.trim().length === 0) {
				return invalidArg(
					`--decision-kind must be one of the registered Decision kinds (${DECISION_KINDS.join(", ")}) when provided; got ${JSON.stringify(args.decisionKind)}`,
				);
			}
			const principal = args.principal === undefined ? null : String(args.principal);
			if (principal !== null && principal.trim().length === 0) {
				return invalidArg(
					`--principal must be a non-empty principal id when provided; got ${JSON.stringify(args.principal)}`,
				);
			}
			const traces = parseTraceFlags(args.traceArgs);
			if (traces.error) return invalidArg(traces.error);
			const extensions = parseExtensionFlags(args.extensionArgs);
			if (extensions.error) return invalidArg(extensions.error);
			const type = typeFlagValue(args);
			if (type.error) return invalidArg(type.error);
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			const result = admitArtifact(target.value, {
				type: type.value,
				identity: args.id,
				body,
				provenance: args.provenance ? { source: args.provenance } : null,
				supersedes: supersedes.value,
				expectedHead: expectedHead.value,
				idempotencyKey,
				transition: args.transition === undefined ? null : String(args.transition),
				scope: args.scope === undefined ? null : String(args.scope),
				traces: traces.value,
				extensions: extensions.value,
				decisionKind,
				principal,
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
			const type = typeFlagValue(args);
			if (type.error) return invalidArg(type.error);
			if (!ARTIFACT_TYPES.includes(type.value)) return unknownType(type.value);
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			let shown;
			try {
				shown = showArtifact(target.value, args.id, {
					type: type.value,
					revision: revision.value,
				});
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
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
			// Ticket-04 routed fix: `list --type ""` used to fall through to
			// UNKNOWN_TYPE while admit/show rejected the same input as
			// INVALID_ARG — the explicitly-empty check now lives in the shared
			// typeFlagValue helper so all three actions agree. The type is
			// validation-only here (listArtifacts lists every registered type);
			// an unregistered non-empty value still reports UNKNOWN_TYPE.
			const type = typeFlagValue(args);
			if (type.error) return invalidArg(type.error);
			if (!ARTIFACT_TYPES.includes(type.value)) return unknownType(type.value);
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			let artifacts;
			try {
				artifacts = listArtifacts(target.value);
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
			return { text: JSON.stringify(artifacts, null, 2) };
		},
	},
});

function artifactDispatch(args) {
	return dispatch(args._?.[0], args);
}

// parseTraceFlags is shared with the approval command (F050 #229): the
// consume action forwards the same `--trace decides:<type>:<identity>` grammar
// to the Decision admission, so one parser owns the flag contract.
module.exports = { artifactDispatch, parseTraceFlags };
