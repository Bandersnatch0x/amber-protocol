"use strict";

// F049 ticket 01 — Canonical Artifact CLI surface (admit/show/list).
// Envelope, routing, and exit codes are owned by defineCommand (F039).

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");

const CORRUPT_CODE = "AMBER_E_ARTIFACT_NOT_FOUND";

const dispatch = defineCommand({
	command: "artifact",
	actions: ["admit", "show", "list"],
	handlers: {
		admit: (args) => {
			const { admitArtifact } = require("./core/canonical-artifacts");
			const body = args.body ? String(args.body) : null;
			const result = admitArtifact(resolveTarget(args), {
				type: args.type || "intent",
				identity: args.id,
				body,
				provenance: args.provenance ? { source: args.provenance } : null,
				supersedes:
					args.supersedesRevision !== undefined && args.supersedesRevision !== ""
						? Number(args.supersedesRevision)
						: null,
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
			let shown;
			try {
				shown = showArtifact(resolveTarget(args), args.id, {
					revision:
						args.revision !== undefined && args.revision !== "" ? Number(args.revision) : null,
				});
			} catch (err) {
				const failure = readFailure(args, err, CORRUPT_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
			if (!shown) {
				return {
					text: "",
					errors: [
						`no committed revision found for "${args.id}"${args.revision ? ` at revision ${args.revision}` : ""}`,
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
