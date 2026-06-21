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
const { ensureContinuitySurfaces } = require("./continuity-surfaces");
const { writeJson } = require("./core/fs-utils");
const {
	resolveStateDirForRead,
	resolveStateDirForCreate,
	CANONICAL_STATE_DIR,
} = require("./state-dir-resolver");

const ROUTES_DIR = path.join(__dirname, "../../routes");

function getSessionsDir(projectRoot) {
	// Discovery/read path: prefers .amber, falls back to legacy .harness.
	return path.join(resolveStateDirForRead(projectRoot), "sessions");
}

function getSessionDir(projectRoot, sessionId) {
	return path.join(getSessionsDir(projectRoot), sessionId);
}

function getSessionDirForCreate(projectRoot, sessionId) {
	// New sessions are always created under the canonical .amber state dir.
	return path.join(resolveStateDirForCreate(projectRoot), "sessions", sessionId);
}

function findMostRecentSession(projectRoot, { excludeCompleted = false } = {}) {
	const manifests = loadAllSessionManifests(projectRoot).filter(
		(m) =>
			!excludeCompleted ||
			(m.status !== "completed" &&
				m.status !== "aborted" &&
				m.status !== "failed"),
	);

	return manifests.length > 0 ? manifests[0].sessionId : null;
}

function loadSessionManifest(projectRoot, sessionId) {
	// Centralized read+parse of a session manifest. Three commands previously
	// each duplicated: build the path, check existence, JSON.parse the file.
	// Returns { manifest, sessionDir, manifestPath } or null when missing.
	const sessionDir = getSessionDir(projectRoot, sessionId);
	const manifestPath = path.join(sessionDir, "manifest.json");
	if (!fs.existsSync(manifestPath)) {
		return null;
	}
	try {
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
		return { manifest, sessionDir, manifestPath };
	} catch {
		// Present but unparseable (e.g. half-written). Distinguished from missing
		// (null) so callers report it precisely instead of crashing on a bare parse.
		return { manifest: null, sessionDir, manifestPath, corrupt: true };
	}
}

function requireSession(projectRoot, sessionId) {
	// Validates that a session exists and its manifest is readable.
	// Used by statusSession, abortSession, and continueSession — previously
	// each duplicated this 6-line not-found/corrupt check.
	const loaded = loadSessionManifest(projectRoot, sessionId);
	if (!loaded) {
		return result(`Session not found: ${sessionId}`, 1);
	}
	if (loaded.corrupt) {
		return result(`Session manifest is corrupt: ${sessionId}`, 1);
	}
	return loaded;
}

function loadAllSessionManifests(projectRoot) {
	// Enumerate every session manifest under the state dir, newest first. Both
	// findMostRecentSession and listSessions previously duplicated this
	// readdir+filter+parse+sort. Returns [] when there are no sessions.
	const sessionsDir = getSessionsDir(projectRoot);
	if (!fs.existsSync(sessionsDir)) {
		return [];
	}
	return fs
		.readdirSync(sessionsDir)
		.filter((name) =>
			fs.existsSync(path.join(sessionsDir, name, "manifest.json")),
		)
		.map((name) => {
			try {
				return JSON.parse(
					fs.readFileSync(
						path.join(sessionsDir, name, "manifest.json"),
						"utf8",
					),
				);
			} catch {
				// A half-written or corrupt manifest is unreadable; skip it so one
				// bad file cannot crash enumeration for the healthy sessions.
				return null;
			}
		})
		.filter(Boolean)
		.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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
	const sessionDir = getSessionDirForCreate(projectRoot, manifest.sessionId);
	fs.mkdirSync(sessionDir, { recursive: true });

	const lines = [
		`Session created: ${manifest.sessionId}`,
		`Route: ${selectedRouteId}`,
		`Goal: ${goal}`,
	];

	const extras = {
		continuitySurfaces: ensureContinuitySurfaces(projectRoot),
	};
	lines.push(
		`Continuity surfaces: ${extras.continuitySurfaces.memory}, ${extras.continuitySurfaces.notes}, ${extras.continuitySurfaces.tasksReadme}`,
	);

	if (worktree) {
		const worktreeResult = createWorktree(projectRoot, manifest.sessionId);
		if (worktreeResult.success) {
			extras.worktree = `${CANONICAL_STATE_DIR}/worktrees/${manifest.sessionId}`;
			lines.push(`Worktree: ${manifest.sessionId}`);
		} else {
			lines.push(`Worktree failed: ${worktreeResult.error}`);
		}
	}

	if (mode) {
		extras.mode = mode;
		lines.push(`Mode: ${mode}`);
	}

	const finalManifest = { ...manifest, ...extras };
	const manifestPath = path.join(sessionDir, "manifest.json");
	writeJson(manifestPath, finalManifest);

	const timelinePath = path.join(sessionDir, "timeline.jsonl");
	const writer = new TimelineWriter(timelinePath);
	await writer.append({
		type: "session_created",
		data: { sessionId: finalManifest.sessionId, goal },
	});
	await writer.close();

	return {
		text: lines.join("\n"),
		exitCode: 0,
		sessionId: finalManifest.sessionId,
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

	const loaded = requireSession(projectRoot, sessionId);
	if (loaded.exitCode !== undefined) return loaded; // error result from requireSession
	const { manifest } = loaded;

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
	const sessions = loadAllSessionManifests(projectRoot);

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

	const loaded = requireSession(projectRoot, sessionId);
	if (loaded.exitCode !== undefined) return loaded;
	const { manifest, sessionDir, manifestPath } = loaded;

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

	const loaded = requireSession(projectRoot, sessionId);
	if (loaded.exitCode !== undefined) return loaded;
	const { manifest, sessionDir, manifestPath } = loaded;

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

	// Autonomous mode: EXPERIMENTAL - moved to src/experimental/execution/
	// Removed from V1 to align with ADR-0001 (governance-first, no live execution)
	// See src/experimental/execution/README.md for V2 considerations
	if (manifest.mode === "autonomous") {
		return result(
			"Error: Autonomous execution is experimental and not available in V1. " +
			"Amber V1 focuses on governance (audit, gate, inspect) without live execution. " +
			"See src/experimental/execution/README.md for details.",
			1
		);
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
	loadSessionManifest,
	loadAllSessionManifests,
	requireSession,
};
