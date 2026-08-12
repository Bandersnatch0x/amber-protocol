"use strict";

// Amber MCP Function: session evidence summary (read-only).
//
// Deterministic helper exposing a session's evidence trail as structured
// data: manifest state, timeline event count, ledger line count. Runs
// in-process against the target repository's `.amber/sessions/` directory.
// No execution, no mutation — pure read.

const fs = require("node:fs");
const path = require("node:path");

const ACTIVE_STATUSES = new Set(["created", "routed", "executing", "paused"]);

function readSessionSummary(ctx, sessionId) {
	// Route the sessionId-scoped path through the guarded resolver so a crafted
	// id (e.g. "../../escape") cannot traverse out of the configured repo.
	const manifestPath = ctx.resolvePath(path.join(".amber/sessions", sessionId, "manifest.json"));
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	const countLines = (file) => {
		const full = ctx.resolvePath(path.join(".amber/sessions", sessionId, file));
		if (!fs.existsSync(full)) return 0;
		return fs
			.readFileSync(full, "utf8")
			.trim()
			.split("\n")
			.filter((l) => l.trim()).length;
	};
	return {
		sessionId,
		status: manifest.status,
		active: ACTIVE_STATUSES.has(manifest.status),
		goal: manifest.goal,
		route: manifest.route && manifest.route.id,
		agentId: manifest.agentId || null,
		timelineEvents: countLines("timeline.jsonl"),
		ledgerLines: countLines("ledger.jsonl"),
	};
}

module.exports = {
	name: "amber.fn.sessionEvidence",
	description:
		"Summarize a session's evidence trail (manifest state, timeline events, ledger lines) for a target repository. Read-only.",
	inputSchema: {
		type: "object",
		additionalProperties: false,
		properties: {
			sessionId: {
				type: "string",
				description:
					"Session id to summarize. Omitted: the most recently updated session (empty list when the repository has none).",
			},
		},
	},
	handler(params, ctx) {
		const sessionsDir = ctx.resolvePath(".amber/sessions");
		if (!fs.existsSync(sessionsDir)) return { sessions: [] };

		let ids = fs
			.readdirSync(sessionsDir)
			.filter((id) => fs.statSync(ctx.resolvePath(path.join(".amber/sessions", id))).isDirectory());

		if (params.sessionId) {
			if (!ids.includes(params.sessionId)) {
				throw new Error(`session not found: ${params.sessionId}`);
			}
			ids = [params.sessionId];
		} else {
			ids.sort(
				(a, b) =>
					fs.statSync(ctx.resolvePath(path.join(".amber/sessions", b))).mtimeMs -
					fs.statSync(ctx.resolvePath(path.join(".amber/sessions", a))).mtimeMs,
			);
			ids = ids.slice(0, 1);
		}

		return { sessions: ids.map((id) => readSessionSummary(ctx, id)) };
	},
};
