"use strict";

// Extracted from command-dispatcher.js (architecture review #1). Envelope,
// routing, and exit codes are owned by defineCommand (F039); the envelope and
// session families compose their own dispatchers under the root one.

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget } = require("./command-helpers");

// Display-only derivation (F040): structured report ops render as the shell
// line a human would type. One-way — the renderer never parses strings back
// into operations (the injection hazard ADR-0020 Option 3 removes).
function proposedOpText(op) {
	if (op.verb === "add") return `git add ${op.paths.join(" ")}`;
	if (op.verb === "commit") return `git commit -m "${op.message}"`;
	return "git push";
}

const envelopeDispatch = defineCommand({
	command: "sync envelope",
	actions: ["pack", "unpack", "compat", "validate"],
	handlers: {
		pack: (args) => {
			const artifactType = args.type;
			const artifactPath = args.artifact;
			if (!artifactType || !artifactPath) {
				return {
					text: "",
					errors: ["sync envelope pack requires --type <artifact-type> --artifact <path>"],
					warnings: [],
					exitCode: 1,
				};
			}
			const { packEnvelope } = require("./core/sync-remote");
			const { envelope, errors } = packEnvelope(resolveTarget(args), artifactType, artifactPath);
			return {
				text: envelope ? JSON.stringify(envelope, null, 2) : "",
				errors,
				warnings: [],
				exitCode: errors.length > 0 ? 1 : 0,
			};
		},
		unpack: (args) => {
			let envelope;
			try {
				envelope = JSON.parse(args.envelope || "");
			} catch {
				return {
					text: "",
					errors: ["sync envelope unpack requires --envelope <json>"],
					warnings: [],
					exitCode: 1,
				};
			}
			const { unpackEnvelope } = require("./core/sync-remote");
			const { artifactPath, errors } = unpackEnvelope(resolveTarget(args), envelope);
			return {
				text:
					errors.length > 0
						? ""
						: `Envelope validated; artifact ${artifactPath} present with matching hash.`,
				errors,
				warnings: [],
				exitCode: errors.length > 0 ? 1 : 0,
			};
		},
		compat: (args) => {
			let envelope;
			try {
				envelope = JSON.parse(args.envelope || "");
			} catch {
				return {
					text: "",
					errors: ["sync envelope compat requires --envelope <json>"],
					warnings: [],
					exitCode: 1,
				};
			}
			const { checkCompatibility } = require("./core/sync-remote");
			const { compatible, reasons } = checkCompatibility(envelope);
			return {
				text: JSON.stringify({ compatible, reasons }, null, 2),
				errors: compatible ? [] : reasons,
				warnings: [],
				exitCode: compatible ? 0 : 1,
			};
		},
		validate: (args) => {
			let envelope;
			try {
				envelope = JSON.parse(args.envelope || "");
			} catch {
				return {
					text: "",
					errors: ["sync envelope validate requires --envelope <json>"],
					warnings: [],
					exitCode: 1,
				};
			}
			const { validateEnvelope } = require("./core/sync-remote");
			const { valid, errors } = validateEnvelope(envelope);
			return {
				text: JSON.stringify({ valid, errors }, null, 2),
				errors: valid ? [] : errors,
				warnings: [],
				exitCode: valid ? 0 : 1,
			};
		},
	},
});

const sessionDispatch = defineCommand({
	command: "sync session",
	actions: ["run", "push", "pull", "list", "replay", "conflicts"],
	handlers: {
		replay: (args) => {
			const { replayEnvelopes } = require("./core/sync-conflicts");
			const result = replayEnvelopes(resolveTarget(args));
			return {
				text: `Applied ${result.applied} envelope(s); conflicts ${result.conflicts.length}; errors ${result.errors.length}.`,
				errors: result.errors,
				warnings: [],
				exitCode: result.errors.length > 0 ? 1 : 0,
			};
		},
		conflicts: (args) => {
			const { listConflicts } = require("./core/sync-conflicts");
			return { text: JSON.stringify(listConflicts(resolveTarget(args)), null, 2) };
		},
		run: (args) => {
			// F035 D1: run pulls (admit + apply, refusals recorded as conflicts)
			// and then prepares the transport report; no git command runs.
			const { runSyncSession } = require("./core/sync-session");
			const { session, summary, errors } = runSyncSession(resolveTarget(args));
			return {
				text: JSON.stringify({ session, summary }, null, 2),
				errors,
				warnings: [],
				exitCode: errors.length > 0 ? 1 : 0,
			};
		},
		push: (args) => {
			// F035 D1: push is transport PREPARATION only. The report is the
			// published structured contract (F040): proposedOps carry verb +
			// confined paths, Amber never runs them, and the schema-valid
			// report rides along in the result body for --json consumers.
			const { pushEnvelopes } = require("./core/sync-session");
			const report = pushEnvelopes(resolveTarget(args));
			const lines = [
				`Transport preparation (report-only): ${report.envelopeCount} envelope(s); no git commands were executed.`,
			];
			if (report.proposedOps.length > 0) {
				lines.push("Proposed operations (not executed):");
				for (const op of report.proposedOps) {
					lines.push(`  ${proposedOpText(op)}`);
				}
			} else {
				lines.push("No envelopes to prepare; no git operations proposed.");
			}
			lines.push(
				`Remote: ${report.remoteConfigured ? "configured" : "not configured"}${report.remoteConfigured ? "" : " — git push not proposed"}.`,
			);
			lines.push(
				`Conflicts recorded: ${report.conflictCount}; refused envelopes tracked: ${report.refusedCount}.`,
			);
			return {
				text: lines.join("\n"),
				report,
				errors: report.errors,
				warnings: [],
				exitCode: report.errors.length > 0 ? 1 : 0,
			};
		},
		pull: (args) => {
			// Pull routes through the shared admission pipeline: semantic
			// refusals are recorded as conflicts (exit 0, mirroring replay);
			// invalid structural envelopes fail explicitly (exit 1).
			const { pullEnvelopes } = require("./core/sync-session");
			const result = pullEnvelopes(resolveTarget(args));
			return {
				text: `Validated ${result.validated} envelope(s); refused ${result.refused} (conflicts recorded); errors ${result.errors.length}.`,
				errors: result.errors,
				warnings: [],
				exitCode: result.errors.length > 0 ? 1 : 0,
			};
		},
		list: (args) => {
			const { listEnvelopes } = require("./core/sync-session");
			return { text: JSON.stringify(listEnvelopes(resolveTarget(args)), null, 2) };
		},
	},
});

// A nested dispatcher returns a full envelope; the root dispatcher takes a
// body, so the payload is forwarded with the envelope's control fields. A
// nested unknown action has no bypassPrint — false keeps its guidance on the
// printResult path, where the legacy nested-unknown envelope rendered it.
function relay(envelope) {
	return {
		...envelope.result,
		exitCode: envelope.exitCode,
		bypassPrint: envelope.bypassPrint ?? false,
	};
}

// Orchestration (scaffold + artifact drift + conditional refresh + note) lives
// in core/sync-project. This handler keeps the lines[] text builder and the
// result.sync payload byte-identical — artifact is intentionally NOT in sync.
function projectBody(args) {
	const targetRoot = resolveTarget(args);
	const { syncProject } = require("./core/sync-project");
	const { drift, refresh, note } = syncProject(targetRoot, {
		execute: Boolean(args.execute),
		templateRoot: args.templateRoot,
	});

	const lines = [
		`Target: ${targetRoot}`,
		`Mode: ${args.execute ? "execute" : "dry-run (no changes made)"}`,
	];
	if (drift.installed) {
		const c = drift.counts;
		lines.push(
			`Scaffold drift: fresh=${c.fresh} stale=${c.stale} customized=${c.customized} ambiguous=${c.ambiguous} missing=${c.missing}`,
		);
	} else {
		lines.push(`Scaffold drift: ${drift.note || "no provenance"}`);
	}
	if (refresh) {
		lines.push(
			`Refreshed (stale controlled): ${refresh.refreshed.length} — ${refresh.refreshed.join(", ") || "(none)"}`,
		);
		lines.push(
			`Proposals cached (customized/ambiguous): ${refresh.proposals.length} — ${refresh.proposals.join(", ") || "(none)"}`,
		);
	}
	lines.push(note);

	return {
		text: lines.join("\n"),
		sync: { executed: Boolean(args.execute), drift, refresh, note },
		errors: [],
		warnings: [],
	};
}

const dispatch = defineCommand({
	command: "sync",
	actions: ["envelope", "session", "project"],
	handlers: {
		envelope: (args) => relay(envelopeDispatch(args._?.[1], args)),
		session: (args) => relay(sessionDispatch(args._?.[1], args)),
		project: projectBody,
	},
});

function syncDispatch(args) {
	const sub = args._?.[0];
	return dispatch(sub === "envelope" || sub === "session" ? sub : "project", args);
}

module.exports = { syncDispatch };
