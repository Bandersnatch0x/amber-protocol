"use strict";

const fs = require("fs");
const path = require("path");
const { createManifest } = require("./session-manifest");
const { TimelineWriter } = require("./timeline-writer");
const { SessionStateMachine, STATES } = require("./session-state-machine");
const { createWorktree, removeWorktree } = require("./worktree-manager");
const { selectRoute } = require("./route-selector");
const { loadRoutes } = require("./route-loader");

const ROUTES_DIR = path.join(__dirname, "../../routes");

function getSessionsDir(projectRoot) {
	return path.join(projectRoot, ".harness", "sessions");
}

function getSessionDir(projectRoot, sessionId) {
	return path.join(getSessionsDir(projectRoot), sessionId);
}

function findMostRecentSession(projectRoot) {
	const sessionsDir = getSessionsDir(projectRoot);
	if (!fs.existsSync(sessionsDir)) {
		return null;
	}

	const sessions = fs.readdirSync(sessionsDir).filter((name) => {
		const manifestPath = path.join(sessionsDir, name, "manifest.json");
		return fs.existsSync(manifestPath);
	});

	if (sessions.length === 0) return null;

	sessions.sort((a, b) => {
		const aManifest = JSON.parse(
			fs.readFileSync(path.join(sessionsDir, a, "manifest.json"), "utf8"),
		);
		const bManifest = JSON.parse(
			fs.readFileSync(path.join(sessionsDir, b, "manifest.json"), "utf8"),
		);
		return new Date(bManifest.createdAt) - new Date(aManifest.createdAt);
	});

	return sessions[0];
}

async function startSession(projectRoot, options) {
	const { goal, route: routeId, budget, worktree, mode } = options;

	if (!goal) {
		return { text: "Error: --goal is required", exitCode: 1 };
	}

	let selectedRouteId = routeId;
	let routeVersion = "1.0.0";

	if (!selectedRouteId) {
		const { routes } = loadRoutes(ROUTES_DIR);
		const match = selectRoute(goal, routes);

		if (!match.matched) {
			return { text: "Error: No matching route found for goal", exitCode: 1 };
		}

		selectedRouteId = match.routeId;
		const route = routes.find((r) => r.routeId === selectedRouteId);
		routeVersion = route.version || "1.0.0";
	} else {
		const { routes } = loadRoutes(ROUTES_DIR);
		const route = routes.find((r) => r.routeId === selectedRouteId);
		if (!route) {
			return {
				text: `Error: Route "${selectedRouteId}" not found`,
				exitCode: 1,
			};
		}
		routeVersion = route.version || "1.0.0";
	}

	const manifest = createManifest({
		route: { id: selectedRouteId, version: routeVersion },
		goal,
		budget,
	});

	const sessionDir = getSessionDir(projectRoot, manifest.sessionId);
	fs.mkdirSync(sessionDir, { recursive: true });

	const manifestPath = path.join(sessionDir, "manifest.json");
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

	const timelinePath = path.join(sessionDir, "timeline.jsonl");
	const writer = new TimelineWriter(timelinePath);
	await writer.append({
		type: "session_created",
		data: { sessionId: manifest.sessionId, goal },
	});
	await writer.close();

	const lines = [
		`Session created: ${manifest.sessionId}`,
		`Route: ${selectedRouteId}`,
		`Goal: ${goal}`,
	];

	if (worktree) {
		const worktreeResult = createWorktree(projectRoot, manifest.sessionId);
		if (worktreeResult.success) {
			manifest.worktree = `.harness/worktrees/${manifest.sessionId}`;
			fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
			lines.push(`Worktree: ${manifest.sessionId}`);
		} else {
			lines.push(`Worktree failed: ${worktreeResult.error}`);
		}
	}

	if (mode) {
		manifest.mode = mode;
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
		lines.push(`Mode: ${mode}`);
	}

	return {
		text: lines.join("\n"),
		exitCode: 0,
		sessionId: manifest.sessionId,
	};
}

function statusSession(projectRoot, options) {
	let { sessionId } = options;

	if (!sessionId) {
		sessionId = findMostRecentSession(projectRoot);
		if (!sessionId) {
			return { text: "No sessions found", exitCode: 1 };
		}
	}

	const manifestPath = path.join(
		getSessionDir(projectRoot, sessionId),
		"manifest.json",
	);
	if (!fs.existsSync(manifestPath)) {
		return { text: `Session not found: ${sessionId}`, exitCode: 1 };
	}

	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

	const lines = [
		`Session: ${manifest.sessionId}`,
		`Status: ${manifest.status}`,
		`Goal: ${manifest.goal}`,
		`Route: ${manifest.route.id} (v${manifest.route.version})`,
		`Created: ${manifest.createdAt}`,
	];

	if (manifest.currentStage) {
		lines.push(`Current stage: ${manifest.currentStage}`);
	}

	if (manifest.mode) {
		lines.push(`Mode: ${manifest.mode}`);
	}

	if (manifest.completedStages && manifest.completedStages.length > 0) {
		lines.push(`Completed stages: ${manifest.completedStages.join(", ")}`);
	}

	if (manifest.budget) {
		const pct = Math.round(
			(manifest.budget.used / manifest.budget.total) * 100,
		);
		lines.push(
			`Budget: ${manifest.budget.used}/${manifest.budget.total} (${pct}%)`,
		);
	}

	return { text: lines.join("\n"), exitCode: 0 };
}

function listSessions(projectRoot, _options) {
	const sessionsDir = getSessionsDir(projectRoot);
	if (!fs.existsSync(sessionsDir)) {
		return { text: "No sessions found", exitCode: 0 };
	}

	const sessions = fs
		.readdirSync(sessionsDir)
		.filter((name) =>
			fs.existsSync(path.join(sessionsDir, name, "manifest.json")),
		)
		.map((name) => {
			const manifest = JSON.parse(
				fs.readFileSync(path.join(sessionsDir, name, "manifest.json"), "utf8"),
			);
			return manifest;
		})
		.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

	if (sessions.length === 0) {
		return { text: "No sessions found", exitCode: 0 };
	}

	const lines = ["Sessions:"];
	for (const s of sessions) {
		const id = s.sessionId.substring(0, 8);
		lines.push(`  ${id} [${s.status}] ${s.route.id} — ${s.goal}`);
	}

	return { text: lines.join("\n"), exitCode: 0 };
}

async function abortSession(projectRoot, options) {
	const { sessionId } = options;

	if (!sessionId) {
		return { text: "Error: --session-id is required", exitCode: 1 };
	}

	const sessionDir = getSessionDir(projectRoot, sessionId);
	const manifestPath = path.join(sessionDir, "manifest.json");

	if (!fs.existsSync(manifestPath)) {
		return { text: `Session not found: ${sessionId}`, exitCode: 1 };
	}

	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	const sm = new SessionStateMachine(manifest.status);
	const transition = sm.transition(STATES.ABORTED);

	if (!transition.success) {
		return { text: `Cannot abort: ${transition.error}`, exitCode: 1 };
	}

	manifest.status = STATES.ABORTED;
	manifest.updatedAt = new Date().toISOString();
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

	const timelinePath = path.join(sessionDir, "timeline.jsonl");
	const writer = new TimelineWriter(timelinePath);
	await writer.append(transition.event);
	await writer.close();

	if (manifest.worktree) {
		removeWorktree(projectRoot, sessionId);
	}

	return { text: `Session aborted: ${sessionId}`, exitCode: 0 };
}

async function continueSession(projectRoot, options) {
	let { sessionId } = options;

	if (!sessionId) {
		sessionId = findMostRecentSession(projectRoot);
		if (!sessionId) {
			return { text: "No sessions found to continue", exitCode: 1 };
		}
	}

	const sessionDir = getSessionDir(projectRoot, sessionId);
	const manifestPath = path.join(sessionDir, "manifest.json");

	if (!fs.existsSync(manifestPath)) {
		return { text: `Session not found: ${sessionId}`, exitCode: 1 };
	}

	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

	if (manifest.status === "completed") {
		return { text: "Session already completed", exitCode: 1 };
	}

	if (manifest.status === "aborted") {
		return { text: "Session was aborted", exitCode: 1 };
	}

	return {
		text: `Ready to continue session ${sessionId} from stage: ${manifest.currentStage || "start"}`,
		exitCode: 0,
		sessionId,
		manifest,
	};
}

module.exports = { startSession, statusSession, listSessions, abortSession, continueSession };
