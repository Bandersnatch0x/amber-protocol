"use strict";

// Extracted from command-dispatcher.js (architecture review #1).

const { resolveTarget, unknownAction } = require("./command-helpers");

function syncDispatch(args) {
	const targetRoot = resolveTarget(args);
	const sub = args._?.[0];
	if (sub === "envelope") {
		return handleSyncEnvelope(args, targetRoot);
	}
	if (sub === "session") {
		return handleSyncSession(args, targetRoot);
	}
	// Orchestration (scaffold + artifact drift + conditional refresh + note) lives
	// in core/sync-project. Handler keeps the lines[] text builder and result.sync
	// envelope byte-identical — artifact is intentionally NOT in result.sync.
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
		result: {
			target: args.target,
			text: lines.join("\n"),
			sync: { executed: Boolean(args.execute), drift, refresh, note },
			errors: [],
			warnings: [],
		},
		bypassPrint: !args.json,
	};
}

function handleSyncEnvelope(args, targetRoot) {
	const {
		packEnvelope,
		unpackEnvelope,
		checkCompatibility,
		validateEnvelope,
	} = require("./core/sync-remote");
	const sub = args._?.[1];
	if (sub === "pack") {
		const artifactType = args.type;
		const artifactPath = args.artifact;
		if (!artifactType || !artifactPath) {
			return {
				result: {
					target: args.target,
					text: "",
					errors: ["sync envelope pack requires --type <artifact-type> --artifact <path>"],
					warnings: [],
				},
				exitCode: 1,
				bypassPrint: !args.json,
			};
		}
		const { envelope, errors } = packEnvelope(targetRoot, artifactType, artifactPath);
		const exitCode = errors.length > 0 ? 1 : 0;
		return {
			result: {
				target: args.target,
				text: envelope ? JSON.stringify(envelope, null, 2) : "",
				errors,
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "unpack") {
		let envelope;
		try {
			envelope = JSON.parse(args.envelope || "");
		} catch {
			return {
				result: {
					target: args.target,
					text: "",
					errors: ["sync envelope unpack requires --envelope <json>"],
					warnings: [],
				},
				exitCode: 1,
				bypassPrint: !args.json,
			};
		}
		const { artifactPath, errors } = unpackEnvelope(targetRoot, envelope);
		const exitCode = errors.length > 0 ? 1 : 0;
		return {
			result: {
				target: args.target,
				text:
					errors.length > 0
						? ""
						: `Envelope validated; artifact ${artifactPath} present with matching hash.`,
				errors,
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "compat") {
		let envelope;
		try {
			envelope = JSON.parse(args.envelope || "");
		} catch {
			return {
				result: {
					target: args.target,
					text: "",
					errors: ["sync envelope compat requires --envelope <json>"],
					warnings: [],
				},
				exitCode: 1,
				bypassPrint: !args.json,
			};
		}
		const { compatible, reasons } = checkCompatibility(envelope);
		const exitCode = compatible ? 0 : 1;
		return {
			result: {
				target: args.target,
				text: JSON.stringify({ compatible, reasons }, null, 2),
				errors: compatible ? [] : reasons,
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "validate") {
		let envelope;
		try {
			envelope = JSON.parse(args.envelope || "");
		} catch {
			return {
				result: {
					target: args.target,
					text: "",
					errors: ["sync envelope validate requires --envelope <json>"],
					warnings: [],
				},
				exitCode: 1,
				bypassPrint: !args.json,
			};
		}
		const { valid, errors } = validateEnvelope(envelope);
		return {
			result: {
				target: args.target,
				text: JSON.stringify({ valid, errors }, null, 2),
				errors: valid ? [] : errors,
				warnings: [],
			},
			exitCode: valid ? 0 : 1,
			bypassPrint: !args.json,
		};
	}
	return {
		result: unknownAction("sync envelope", ["pack", "unpack", "compat", "validate"]),
	};
}

function handleSyncSession(args, targetRoot) {
	const {
		runSyncSession,
		pushEnvelopes,
		pullEnvelopes,
		listEnvelopes,
	} = require("./core/sync-session");
	const sub = args._?.[1];
	if (sub === "replay") {
		const { replayEnvelopes } = require("./core/sync-conflicts");
		const result = replayEnvelopes(targetRoot);
		const exitCode = result.errors.length > 0 ? 1 : 0;
		return {
			result: {
				target: args.target,
				text: `Applied ${result.applied} envelope(s); conflicts ${result.conflicts.length}; errors ${result.errors.length}.`,
				errors: result.errors,
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "conflicts") {
		const { listConflicts } = require("./core/sync-conflicts");
		const conflicts = listConflicts(targetRoot);
		return {
			result: {
				target: args.target,
				text: JSON.stringify(conflicts, null, 2),
				errors: [],
				warnings: [],
			},
			exitCode: 0,
			bypassPrint: !args.json,
		};
	}
	if (sub === "run") {
		// F035 D1: run pulls (admit + apply, refusals recorded as conflicts)
		// and then prepares the transport report; no git command runs.
		const { session, summary, errors } = runSyncSession(targetRoot);
		const exitCode = errors.length > 0 ? 1 : 0;
		return {
			result: {
				target: args.target,
				text: JSON.stringify({ session, summary }, null, 2),
				errors,
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "push") {
		// F035 D1: push is transport PREPARATION only. The report lists the
		// proposed git operations as strings; Amber never runs them.
		const report = pushEnvelopes(targetRoot);
		const exitCode = report.errors.length > 0 ? 1 : 0;
		const lines = [
			`Transport preparation (report-only): ${report.envelopeCount} envelope(s); no git commands were executed.`,
		];
		if (report.proposedOps.length > 0) {
			lines.push("Proposed operations (not executed):");
			for (const op of report.proposedOps) {
				lines.push(`  ${op}`);
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
			result: {
				target: args.target,
				text: lines.join("\n"),
				errors: report.errors,
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "pull") {
		// Pull routes through the shared admission pipeline: semantic
		// refusals are recorded as conflicts (exit 0, mirroring replay);
		// invalid structural envelopes fail explicitly (exit 1).
		const result = pullEnvelopes(targetRoot);
		const exitCode = result.errors.length > 0 ? 1 : 0;
		return {
			result: {
				target: args.target,
				text: `Validated ${result.validated} envelope(s); refused ${result.refused} (conflicts recorded); errors ${result.errors.length}.`,
				errors: result.errors,
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "list") {
		const envelopes = listEnvelopes(targetRoot);
		return {
			result: {
				target: args.target,
				text: JSON.stringify(envelopes, null, 2),
				errors: [],
				warnings: [],
			},
			exitCode: 0,
			bypassPrint: !args.json,
		};
	}
	return {
		result: unknownAction("sync session", ["run", "push", "pull", "list", "replay", "conflicts"]),
	};
}

module.exports = { syncDispatch };
