"use strict";

// F049 tickets 01–02 — Canonical Artifact CLI surface (admit/show/list).
// Envelope, routing, and exit codes are owned by defineCommand (F039).

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");

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

function invalidArg(message) {
	return { text: "", errors: [message], warnings: [], exitCode: 1, code: "AMBER_E_INVALID_ARG" };
}

const dispatch = defineCommand({
	command: "artifact",
	actions: ["admit", "show", "list"],
	handlers: {
		admit: (args) => {
			const { admitArtifact } = require("./core/canonical-artifacts");
			const body = args.body ? String(args.body) : null;
			const expectedHead = parseRevisionFlag(args.expectedHead, "--expected-head");
			if (expectedHead.error) return invalidArg(expectedHead.error);
			const supersedes = parseRevisionFlag(args.supersedesRevision, "--supersedes-revision");
			if (supersedes.error) return invalidArg(supersedes.error);
			const result = admitArtifact(resolveTarget(args), {
				type: args.type || "intent",
				identity: args.id,
				body,
				provenance: args.provenance ? { source: args.provenance } : null,
				supersedes: supersedes.value,
				expectedHead: expectedHead.value,
				idempotencyKey: args.idempotencyKey || null,
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
			const revision = parseRevisionFlag(args.revision, "--revision");
			if (revision.error) return invalidArg(revision.error);
			let shown;
			try {
				shown = showArtifact(resolveTarget(args), args.id, { revision: revision.value });
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
