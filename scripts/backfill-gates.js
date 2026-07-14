#!/usr/bin/env node
"use strict";

// One-shot backfill: materialize `.gate.json` / `.decision.json` files for
// sessions created before the CLI started persisting gates. The web viewer
// (apps/web) reads gates from disk via gate-reader.ts, so historical sessions
// show no gates until this runs.
//
// For each session it:
//   1. resolves the session's route definition (manifest.route.id)
//   2. writes a pending `.gate.json` for every gate the route declares,
//      stamped with the session's createdAt
//   3. scans timeline.jsonl for `gate_passed` events and writes an approved
//      `.decision.json` for each matching gate, stamped with the event time
//
// Idempotent: a gate that already has a `.gate.json` or `.decision.json` on
// disk is left untouched, so re-running never clobbers real CLI-written state.
//
// Usage:
//   node scripts/backfill-gates.js [--target <repo>] [--dry-run] [--json]

const fs = require("fs");
const path = require("path");
const { loadRoutes } = require("./lib/route-loader");
const { readSessionEvents } = require("./lib/session-timeline");
const { resolveStateDirForRead } = require("./lib/state-dir-resolver");
const { readJsonSafe } = require("./lib/core/fs-utils");
const {
	buildGateStageMap,
	writeGateDefinition,
	writeGateDecision,
} = require("./lib/gate-writer");

const ROUTES_DIR = path.join(__dirname, "../routes");

function parseArgv(argv) {
	const args = { target: process.cwd(), dryRun: false, json: false, help: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") args.help = true;
		else if (arg === "--dry-run") args.dryRun = true;
		else if (arg === "--json") args.json = true;
		else if (arg === "--target") args.target = argv[++i];
	}
	return args;
}

// Collect the gateIds that were approved, with the timestamp of the approval
// event. A gate may legitimately appear more than once across resumes; the
// first occurrence wins since that is when the approval actually happened.
function approvedGatesFromTimeline(sessionDir) {
	const approvals = new Map();
	for (const event of readSessionEvents(sessionDir)) {
		if (event.type !== "gate_passed") continue;
		const gateId = event.data && event.data.gateId;
		if (typeof gateId !== "string" || approvals.has(gateId)) continue;
		approvals.set(gateId, event.timestamp || null);
	}
	return approvals;
}

function backfillSession(sessionDir, routesById) {
	const stats = { gatesWritten: 0, decisionsWritten: 0, skipped: false };

	const { value: manifest } = readJsonSafe(path.join(sessionDir, "manifest.json"));
	if (!manifest || !manifest.route || !manifest.route.id) {
		stats.skipped = true;
		stats.reason = "no manifest / route";
		return stats;
	}

	const route = routesById.get(manifest.route.id);
	if (!route || !Array.isArray(route.gates) || route.gates.length === 0) {
		stats.skipped = true;
		stats.reason = `route "${manifest.route.id}" has no gates`;
		return stats;
	}

	const sessionId = manifest.sessionId || path.basename(sessionDir);
	const gatesDir = path.join(sessionDir, "gates");
	const stageMap = buildGateStageMap(route);
	const approvals = approvedGatesFromTimeline(sessionDir);

	for (const gate of route.gates) {
		const gatePath = path.join(gatesDir, `${gate.id}.gate.json`);
		const decisionPath = path.join(gatesDir, `${gate.id}.decision.json`);

		// Pending definition: only write if absent (idempotent).
		if (!fs.existsSync(gatePath)) {
			if (
				writeGateDefinition(
					sessionDir,
					sessionId,
					gate,
					stageMap.get(gate.id),
					manifest.createdAt,
				)
			) {
				stats.gatesWritten++;
			}
		}

		// Approved decision: only if the timeline recorded it and no decision
		// file exists yet.
		if (approvals.has(gate.id) && !fs.existsSync(decisionPath)) {
			if (
				writeGateDecision(
					sessionDir,
					gate.id,
					"approved",
					undefined,
					approvals.get(gate.id) || undefined,
				)
			) {
				stats.decisionsWritten++;
			}
		}
	}

	return stats;
}

// Dry-run variant: count what *would* be written without touching disk.
function planSession(sessionDir, routesById) {
	const stats = { gatesWritten: 0, decisionsWritten: 0, skipped: false };

	const { value: manifest } = readJsonSafe(path.join(sessionDir, "manifest.json"));
	if (!manifest || !manifest.route || !manifest.route.id) {
		stats.skipped = true;
		return stats;
	}
	const route = routesById.get(manifest.route.id);
	if (!route || !Array.isArray(route.gates) || route.gates.length === 0) {
		stats.skipped = true;
		return stats;
	}

	const gatesDir = path.join(sessionDir, "gates");
	const approvals = approvedGatesFromTimeline(sessionDir);
	for (const gate of route.gates) {
		if (!fs.existsSync(path.join(gatesDir, `${gate.id}.gate.json`))) {
			stats.gatesWritten++;
		}
		if (
			approvals.has(gate.id) &&
			!fs.existsSync(path.join(gatesDir, `${gate.id}.decision.json`))
		) {
			stats.decisionsWritten++;
		}
	}
	return stats;
}

function main() {
	const args = parseArgv(process.argv.slice(2));
	if (args.help) {
		console.log(
			"Usage: node scripts/backfill-gates.js [--target <repo>] [--dry-run] [--json]\n\n" +
				"Materialize .gate.json / .decision.json files for sessions created\n" +
				"before the CLI persisted gates, so the web viewer can render them.",
		);
		return;
	}

	const sessionsDir = path.join(
		resolveStateDirForRead(args.target),
		"sessions",
	);
	if (!fs.existsSync(sessionsDir)) {
		console.error(`No sessions directory found at ${sessionsDir}`);
		process.exitCode = 1;
		return;
	}

	const { routes } = loadRoutes(ROUTES_DIR);
	const routesById = new Map(routes.map((r) => [r.routeId, r]));

	const sessionIds = fs
		.readdirSync(sessionsDir)
		.filter((name) =>
			fs.existsSync(path.join(sessionsDir, name, "manifest.json")),
		);

	const totals = {
		sessions: sessionIds.length,
		sessionsModified: 0,
		gatesWritten: 0,
		decisionsWritten: 0,
		skipped: 0,
	};

	for (const id of sessionIds) {
		const sessionDir = path.join(sessionsDir, id);
		const stats = args.dryRun
			? planSession(sessionDir, routesById)
			: backfillSession(sessionDir, routesById);
		if (stats.skipped) {
			totals.skipped++;
			continue;
		}
		if (stats.gatesWritten > 0 || stats.decisionsWritten > 0) {
			totals.sessionsModified++;
		}
		totals.gatesWritten += stats.gatesWritten;
		totals.decisionsWritten += stats.decisionsWritten;
	}

	if (args.json) {
		console.log(JSON.stringify({ dryRun: args.dryRun, ...totals }, null, 2));
		return;
	}

	const verb = args.dryRun ? "Would write" : "Wrote";
	console.log(
		[
			`${args.dryRun ? "[dry-run] " : ""}Backfill complete.`,
			`  Sessions scanned:   ${totals.sessions}`,
			`  Sessions modified:  ${totals.sessionsModified}`,
			`  Skipped (no gates): ${totals.skipped}`,
			`  ${verb} gate files:  ${totals.gatesWritten}`,
			`  ${verb} decisions:   ${totals.decisionsWritten}`,
		].join("\n"),
	);
}

if (require.main === module) {
	main();
}

module.exports = { backfillSession, planSession, approvedGatesFromTimeline };
