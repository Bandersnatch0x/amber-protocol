"use strict";

const fs = require("fs");
const path = require("path");
const { createManifest } = require("./session-manifest");
const { TimelineWriter } = require("./timeline-writer");
const { SessionStateMachine, STATES } = require("./session-state-machine");
const {
	loadLatestCheckpoint,
	loadCheckpointByStage,
} = require("./checkpoint-manager");
const {
	checkSchemaVersion,
	SCHEMA_VERSION,
} = require("./schema-version-checker");
const { createWorktree, removeWorktree } = require("./worktree-manager");
const { selectRoute } = require("./route-selector");
const { loadRoutes } = require("./route-loader");
const { result } = require("./result");

const ROUTES_DIR = path.join(__dirname, "../../routes");

function getSessionsDir(projectRoot) {
	return path.join(projectRoot, ".harness", "sessions");
}

function getSessionDir(projectRoot, sessionId) {
	return path.join(getSessionsDir(projectRoot), sessionId);
}

function findMostRecentSession(projectRoot, { excludeCompleted = false } = {}) {
	const sessionsDir = getSessionsDir(projectRoot);
	if (!fs.existsSync(sessionsDir)) return null;

	const manifests = fs
		.readdirSync(sessionsDir)
		.filter((name) =>
			fs.existsSync(path.join(sessionsDir, name, "manifest.json")),
		)
		.map((name) =>
			JSON.parse(
				fs.readFileSync(path.join(sessionsDir, name, "manifest.json"), "utf8"),
			),
		)
		.filter(
			(m) =>
				!excludeCompleted ||
				(m.status !== "completed" &&
					m.status !== "aborted" &&
					m.status !== "failed"),
		)
		.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

	return manifests.length > 0 ? manifests[0].sessionId : null;
}

async function startSession(projectRoot, options) {
	const { goal, route: routeId, budget, worktree, mode } = options;

	if (!goal) {
		return result("Error: --goal is required", 1);
	}

	let selectedRouteId = routeId;
	let routeVersion = SCHEMA_VERSION;

	if (!selectedRouteId) {
		const { routes } = loadRoutes(ROUTES_DIR);
		const match = selectRoute(goal, routes);

		if (!match.matched) {
			return result("Error: No matching route found for goal", 1);
		}

		selectedRouteId = match.routeId;
		const route = routes.find((r) => r.routeId === selectedRouteId);
		routeVersion = route.version || "1.0.0";
	} else {
		const { routes } = loadRoutes(ROUTES_DIR);
		const route = routes.find((r) => r.routeId === selectedRouteId);
		if (!route) {
			return result(`Error: Route "${selectedRouteId}" not found`, 1);
		}
		routeVersion = route.version || SCHEMA_VERSION;
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
			return result("No sessions found", 1);
		}
	}

	const manifestPath = path.join(
		getSessionDir(projectRoot, sessionId),
		"manifest.json",
	);
	if (!fs.existsSync(manifestPath)) {
		return result(`Session not found: ${sessionId}`, 1);
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

	return result(lines.join("\n"), 0);
}

function listSessions(projectRoot, _options) {
	const sessionsDir = getSessionsDir(projectRoot);
	if (!fs.existsSync(sessionsDir)) {
		return result("No sessions found", 0);
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
		return result("No sessions found", 0);
	}

	const lines = ["Sessions:"];
	for (const s of sessions) {
		const id = s.sessionId.substring(0, 8);
		lines.push(`  ${id} [${s.status}] ${s.route.id} — ${s.goal}`);
	}

	return result(lines.join("\n"), 0);
}

async function abortSession(projectRoot, options) {
	const { sessionId } = options;

	if (!sessionId) {
		return result("Error: --session-id is required", 1);
	}

	const sessionDir = getSessionDir(projectRoot, sessionId);
	const manifestPath = path.join(sessionDir, "manifest.json");

	if (!fs.existsSync(manifestPath)) {
		return result(`Session not found: ${sessionId}`, 1);
	}

	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	const sm = new SessionStateMachine(manifest.status);
	const transition = sm.transition(STATES.ABORTED);

	if (!transition.success) {
		return result(`Cannot abort: ${transition.error}`, 1);
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

	return result(`Session aborted: ${sessionId}`, 0);
}

async function continueSession(projectRoot, options) {
	let { sessionId, fromCheckpoint } = options;

	if (!sessionId) {
		sessionId = findMostRecentNonCompletedSession(projectRoot);
		if (!sessionId) {
			return result("No resumable sessions found", 1);
		}
	}

	const sessionDir = getSessionDir(projectRoot, sessionId);
	const manifestPath = path.join(sessionDir, "manifest.json");

	if (!fs.existsSync(manifestPath)) {
		return result(`Session not found: ${sessionId}`, 1);
	}

	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

	const versionCheck = checkSchemaVersion(manifest);
	if (!versionCheck.valid) {
		return result(`Schema error: ${versionCheck.error}`, 1);
	}

	if (manifest.status === "completed") {
		return result("Session already completed", 1);
	}

	if (manifest.status === "aborted") {
		return result("Session was aborted", 1);
	}

	if (
		manifest.status !== "paused" &&
		manifest.status !== "executing" &&
		manifest.status !== "created" &&
		manifest.status !== "routed"
	) {
		return result(`Cannot continue session with status: ${manifest.status}`, 1);
	}

	let checkpoint;
	if (fromCheckpoint) {
		checkpoint = loadCheckpointByStage(projectRoot, sessionId, fromCheckpoint);
		if (!checkpoint) {
			return result(`Checkpoint not found: ${fromCheckpoint}`, 1);
		}
	} else {
		checkpoint = loadLatestCheckpoint(projectRoot, sessionId);
	}

	if (checkpoint) {
		manifest.currentStage =
			checkpoint.manifest.currentStage || manifest.currentStage;
		manifest.completedStages =
			checkpoint.manifest.completedStages || manifest.completedStages || [];
		manifest.budget = checkpoint.manifest.budget || manifest.budget;
	}

	const sm = new SessionStateMachine(manifest.status);

	// Auto-route created sessions before executing
	if (sm.currentState === STATES.CREATED) {
		const routeTransition = sm.transition(STATES.ROUTED);
		if (!routeTransition.success) {
			return result(`Cannot route session: ${routeTransition.error}`, 1);
		}
		manifest.status = STATES.ROUTED;
		manifest.updatedAt = new Date().toISOString();
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

		const routeTimeline = new TimelineWriter(
			path.join(sessionDir, "timeline.jsonl"),
		);
		await routeTimeline.append(routeTransition.event);
		await routeTimeline.close();

		sm.currentState = STATES.ROUTED;
	}

	const transition = sm.transition(STATES.EXECUTING);
	if (!transition.success) {
		return result(`Cannot resume: ${transition.error}`, 1);
	}

	manifest.status = STATES.EXECUTING;
	manifest.updatedAt = new Date().toISOString();
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

	const timelinePath = path.join(sessionDir, "timeline.jsonl");
	const writer = new TimelineWriter(timelinePath);
	await writer.append({
		type: "session_resumed",
		data: { sessionId, fromCheckpoint: checkpoint?.stage || null },
	});
	await writer.close();

	const lines = [
		`Session resumed: ${sessionId}`,
		`Current stage: ${manifest.currentStage || "none"}`,
		`Completed stages: ${(manifest.completedStages || []).join(", ") || "none"}`,
	];

	if (checkpoint) {
		lines.push(`Restored from checkpoint: ${checkpoint.stage}`);
	}

	return result(lines.join("\n"), 0);
}

function findMostRecentNonCompletedSession(projectRoot) {
	return findMostRecentSession(projectRoot, { excludeCompleted: true });
}

module.exports = {
	startSession,
	statusSession,
	listSessions,
	abortSession,
	continueSession,
	getSessionsDir,
};
