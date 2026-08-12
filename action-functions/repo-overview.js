"use strict";

// Amber MCP Function: cross-repository governance overview (read-only).
//
// Aggregates a governance snapshot across every configured repository:
// per-repo session counts, active sessions, routes available, and the
// presence of `.amber` state. This is the multi-target unified view —
// one call, N repositories.

const fs = require("node:fs");
const path = require("node:path");

const ACTIVE_STATUSES = new Set(["created", "routed", "executing", "paused"]);

function repoSnapshot(ctx, target) {
	const sessionsDir = ctx.resolvePath(".amber/sessions", target);
	let sessions = [];
	if (fs.existsSync(sessionsDir)) {
		sessions = fs
			.readdirSync(sessionsDir)
			.filter((id) =>
				fs.statSync(ctx.resolvePath(path.join(".amber/sessions", id), target)).isDirectory(),
			)
			.map((id) => {
				const manifestPath = ctx.resolvePath(
					path.join(".amber/sessions", id, "manifest.json"),
					target,
				);
				const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
				return {
					sessionId: id,
					status: manifest.status,
					active: ACTIVE_STATUSES.has(manifest.status),
					goal: manifest.goal,
					route: manifest.route && manifest.route.id,
				};
			});
	}
	const routesDir = ctx.resolvePath("routes", target);
	let routes = [];
	if (fs.existsSync(routesDir)) {
		routes = fs
			.readdirSync(routesDir)
			.filter((f) => f.endsWith(".route.json"))
			.map((f) => f.replace(/\.route\.json$/, ""));
	}
	return {
		target,
		hasAmberState: fs.existsSync(ctx.resolvePath(".amber", target)),
		sessionCount: sessions.length,
		activeSessions: sessions.filter((s) => s.active),
		routes,
	};
}

module.exports = {
	name: "amber.fn.repoOverview",
	description:
		"Aggregate governance overview across all configured repositories: per-repo session counts, active sessions, and route inventory. Read-only.",
	inputSchema: {
		type: "object",
		additionalProperties: false,
		properties: {},
	},
	handler(_params, ctx) {
		const repos = ctx.targets.map((target) => repoSnapshot(ctx, target));
		return {
			repoCount: repos.length,
			repos,
			totalSessions: repos.reduce((sum, r) => sum + r.sessionCount, 0),
			totalActive: repos.reduce((sum, r) => sum + r.activeSessions.length, 0),
		};
	},
};
