"use strict";

const fs = require("fs");
const path = require("path");
const {
	createManifest,
	readSessionManifest,
	readAllSessionManifests,
	writeSessionManifest,
} = require("./session-manifest");
const { appendSessionEvent, readSessionEvents } = require("./session-timeline");
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
const { promptYesNo } = require("./prompt");
const { ensureContinuitySurfaces } = require("./continuity-surfaces");
const { writeRouteGates, writeGateDecision } = require("./gate-writer");
const { codedError } = require("./core/error-catalog");
const { appendLedgerRecord, verifyLedgerChain } = require("./core/loop-ledger");
const { runEvidenceCommand } = require("./core/evidence-runner");
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
	// Thin projectRoot-flavoured wrapper over session-manifest.readSessionManifest
	// (the deep module owning the read). Returns { manifest, sessionDir,
	// manifestPath }, { ... corrupt: true }, or null — see that module.
	return readSessionManifest(getSessionDir(projectRoot, sessionId));
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
	// Thin wrapper over session-manifest.readAllSessionManifests.
	return readAllSessionManifests(getSessionsDir(projectRoot));
}

async function startSession(projectRoot, options) {
	const { goal, route: routeId, budget, worktree, mode } = options;

	if (!goal) {
		return result("Error: --goal is required", 1);
	}

	// Autonomous mode removed in 1.3.0 (ADR-0005): refuse at start, not just at
	// continue, so no autonomous session manifest is ever written. (continueSession
	// still guards legacy manifests created before this gate.)
	if (mode === "autonomous") {
		return result(
			"Error: Autonomous execution is not available. " +
			"Amber focuses on governance (audit, gate, inspect) without live execution (ADR-0001, ADR-0005).",
			1,
		);
	}

	let selectedRouteId = routeId;
	let routeVersion = SCHEMA_VERSION;

	// Load routes once — reused for version, goal-mismatch warning, and gate persistence.
	const { routes } = loadRoutes(ROUTES_DIR);
	let route;
	let fallbackWarning = null;

	if (!selectedRouteId) {
		const match = selectRoute(goal, routes);

		if (!match.matched) {
			// No trigger matched. Rather than hard-error on a first-time user, default
			// to feature-standard with a low-confidence warning. --route still overrides.
			selectedRouteId = "feature-standard";
			route = routes.find((r) => r.routeId === selectedRouteId);
			if (!route) {
				const availableRoutes = routes
					.map((r) => `  ${r.routeId} — matches goals matching: ${r.trigger.goalPattern}`)
					.join("\n");
				return result(
					`Error: No route matched goal "${goal}" and the default route "feature-standard" is missing.\n\nAvailable routes:\n${availableRoutes}\n\nTip: pass --route <id> to select a route explicitly.`,
					1,
				);
			}
			routeVersion = route.version || "1.0.0";
			fallbackWarning =
				`No route matched goal "${goal}"; defaulting to feature-standard (low confidence). ` +
				"Pass --route to choose explicitly.";
		} else {
			selectedRouteId = match.routeId;
			route = routes.find((r) => r.routeId === selectedRouteId);
			routeVersion = (route && route.version) || "1.0.0";
		}
	} else {
		route = routes.find((r) => r.routeId === selectedRouteId);
		if (!route) {
			const routeList = routes.map((r) => `  ${r.routeId}`).join("\n");
				return result(
					`Error: Route "${selectedRouteId}" not found.\n\nAvailable routes:\n${routeList}`,
					1,
				);
		}
		routeVersion = route.version || SCHEMA_VERSION;
	}

		// When the user explicitly passes --route, warn if the goal does not match
		// the route's own goalPattern — the session will work, but the route may
		// not fit the stated intent.
		let goalMismatchWarning = null;
		if (routeId && route.trigger && route.trigger.goalPattern) {
			try {
				const pattern = new RegExp(route.trigger.goalPattern, "i");
				if (!pattern.test(goal)) {
					goalMismatchWarning =
						`Warning: goal "${goal}" does not match the route pattern ` +
						`"${route.trigger.goalPattern}". The session will proceed ` +
						`but the route may not fit the stated intent.`;
				}
			} catch (_) {
				// Invalid goalPattern regex — skip the warning but don't crash.
			}
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

	if (fallbackWarning) {
		lines.push("");
		lines.push(fallbackWarning);
	}
	if (goalMismatchWarning) {
		lines.push("");
		lines.push(goalMismatchWarning);
	}

	const finalManifest = writeSessionManifest(sessionDir, { ...manifest, ...extras });

	appendSessionEvent(sessionDir, {
		type: "session_created",
		data: { sessionId: finalManifest.sessionId, goal },
	});

	// Materialize route gates as pending .gate.json files for the web viewer.
	if (route) {
		const gateCount = writeRouteGates(sessionDir, finalManifest.sessionId, route);
		const declared = (route.gates || []).length;
		if (declared > 0 && gateCount < declared) {
			lines.push("");
			lines.push(
				`Warning: ${declared - gateCount} of ${declared} route gates could not be written ` +
				"(check route definition for invalid gate IDs).",
			);
		}
	}

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
	const { manifest, sessionDir } = loaded;

	const lines = [
		`Session: ${manifest.sessionId}`,
		`Status: ${manifest.status}`,
		`Goal: ${manifest.goal}`,
		`Route: ${manifest.route.id} (v${manifest.route.version})`,
		`Created: ${manifest.createdAt}`,
		`Data dir: ${sessionDir}`,
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
	const { manifest, sessionDir } = loaded;

	const sm = new SessionStateMachine(manifest.status);
	const transition = sm.transition(STATES.ABORTED);

	if (!transition.success) {
		return result(`Cannot abort: ${transition.error}`, 1);
	}

	writeSessionManifest(sessionDir, { ...manifest, status: STATES.ABORTED });

	appendSessionEvent(sessionDir, transition.event);

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
	const { manifest, sessionDir } = loaded;

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

	// Autonomous mode removed in 1.3.0 (ADR-0005): the experimental execution
	// engine was deleted — unreachable, broken-chained, and shipping dead code.
	// Amber remains governance-first (ADR-0001): no live execution.
	if (manifest.mode === "autonomous") {
		return result(
			"Error: Autonomous execution is not available. " +
			"Amber focuses on governance (audit, gate, inspect) without live execution (ADR-0001, ADR-0005).",
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
		writeSessionManifest(sessionDir, { ...manifest, status: STATES.ROUTED });

		appendSessionEvent(sessionDir, routeTransition.event);

		sm.currentState = STATES.ROUTED;
	}

	const transition = sm.transition(STATES.EXECUTING);
	if (!transition.success) {
		return result(`Cannot resume: ${transition.error}`, 1);
	}

	writeSessionManifest(sessionDir, { ...manifest, status: STATES.EXECUTING });

	appendSessionEvent(sessionDir, {
		type: "session_resumed",
		data: { sessionId, fromCheckpoint: checkpoint?.stage || null },
	});

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

async function verifySession(projectRoot, options) {
	const { sessionId, stage: stageName } = options;

	if (!sessionId) {
		return result("Error: session verify requires --session <id>.", 1);
	}

	const loaded = requireSession(projectRoot, sessionId);
	if (loaded.exitCode !== undefined) return loaded;
	const { manifest, sessionDir } = loaded;

	if (manifest.status === "completed" || manifest.status === "aborted") {
		return result(
			`Cannot verify: session is already ${manifest.status}.`,
			1,
		);
	}

	// Resolve the route definition to find verification stage metadata.
	const { routes } = loadRoutes(ROUTES_DIR);
	const route = routes.find((r) => r.routeId === manifest.route.id);
	const stages = route && Array.isArray(route.stages) ? route.stages : [];
	const verifyStage = route ? stages.find((s) => s.name === (stageName || "verify")) : null;
	const actualStageName = (verifyStage && verifyStage.name) || (stageName || "verify");
	const stageDisplayName = (verifyStage && verifyStage.displayName) || actualStageName;

	const ledgerPath = path.join(sessionDir, "ledger.jsonl");

	// --execute: actually run the verification command and record its real exit
	// code as evidence. Without --execute, verify records a self-reported claim
	// (executed:false) — kept for backward compatibility.
	let executed = false;
	let execResult = null;
	if (options.execute) {
		const command = options.command || (verifyStage && verifyStage.target);
		if (!command) {
			return result(
				'Error: --execute needs a command. Pass --command "<cmd>" or use a route whose verify stage declares one.',
				1,
			);
		}
		execResult = runEvidenceCommand({
			target: projectRoot,
			command,
			ledgerPath,
			subject: { sessionId, stage: actualStageName },
		});
		if (execResult.denied) {
			return result(
				`Verification command denied by policy: ${execResult.reason}\nCommand: ${command}`,
				1,
			);
		}
		executed = true;
		if (execResult.exitCode !== 0) {
			// Negative evidence: record the failure on the timeline, do NOT mark the
			// stage complete, and fail the command.
			appendSessionEvent(sessionDir, {
				type: "verification_failed",
				data: {
					stage: actualStageName,
					displayName: stageDisplayName,
					command,
					exitCode: execResult.exitCode,
					durationMs: execResult.durationMs,
				},
			});
			return result(
				`Verification FAILED (exit ${execResult.exitCode}) for session: ${sessionId}\n` +
					`Command: ${command}\n` +
					(execResult.stderrTail ? `stderr (tail):\n${execResult.stderrTail}\n` : "") +
					"The stage was NOT marked complete.",
				1,
			);
		}
	}

	// Record the stage_completed event so complete-check can see it.
	appendSessionEvent(sessionDir, {
		type: "stage_completed",
		data: {
			stage: actualStageName,
			displayName: stageDisplayName,
			command: options.command || (executed ? execResult.ledgerRecord.command : null),
			result: options.result || (executed ? "passed" : null),
			executed,
			...(executed ? { exitCode: 0, durationMs: execResult.durationMs } : {}),
		},
	});

	// In --execute mode the evidence-runner already wrote the tamper-evident ledger
	// record. In legacy (claim) mode, mirror the claim into the ledger here.
	if (!executed) {
		appendLedgerRecord(ledgerPath, {
			schemaVersion: 2,
			kind: "stage_completed",
			sessionId,
			stage: actualStageName,
			command: options.command || null,
			result: options.result || null,
			recordedAt: new Date().toISOString(),
		});
	}

	// Update the manifest's completedStages so complete-check also finds it there.
	const completedStages = Array.isArray(manifest.completedStages) ? [...manifest.completedStages] : [];
	if (!completedStages.includes(actualStageName)) {
		completedStages.push(actualStageName);
	}
	writeSessionManifest(sessionDir, { ...manifest, completedStages });

	const lines = [`Verification recorded for session: ${sessionId}`, `Stage: ${stageDisplayName}`];
	if (executed) {
		lines.push(`Executed: ${execResult.ledgerRecord.command} (exit 0, ${execResult.durationMs}ms)`);
	} else if (verifyStage && verifyStage.target) {
		lines.push(`Suggested verification command: ${verifyStage.target}`);
		lines.push("(claim only — re-run with --execute to record real evidence)");
	}
	lines.push("", "Tip: run `amber session approve --session " + sessionId + "` to record gate approval.");
	return result(lines.join("\n"), 0);
}

async function approveSession(projectRoot, options) {
	const { sessionId, gate: gateId } = options;

	if (!sessionId) {
		return result("Error: session approve requires --session <id>.", 1);
	}

	const loaded = requireSession(projectRoot, sessionId);
	if (loaded.exitCode !== undefined) return loaded;
	const { manifest, sessionDir } = loaded;

	if (manifest.status === "completed" || manifest.status === "aborted") {
		return result(
			`Cannot approve: session is already ${manifest.status}.`,
			1,
		);
	}

	// Resolve route gates so we can name the gate being approved.
	const { routes } = loadRoutes(ROUTES_DIR);
	const route = routes.find((r) => r.routeId === manifest.route.id);

	const gates = route && Array.isArray(route.gates) ? route.gates : [];
	if (!gateId && gates.length !== 1) {
		if (gates.length === 0) {
			return result(
				`Error: route "${manifest.route.id}" has no gates to approve.`,
				1,
			);
		}
		return result(
			`Error: route has ${gates.length} gates — specify one with --gate <id>.\n` +
			`Available: ${gates.map((g) => g.id).join(", ")}`,
			1,
		);
	}

	if (gateId && !gates.some((g) => g.id === gateId)) {
			return result(
				`Error: gate "${gateId}" not found in route "${manifest.route.id}".\n` +
				`Available: ${gates.map((g) => g.id).join(", ") || "(none)"}`,
				1,
			);
		}

		const resolvedGateId = gateId || gates[0].id;

	// Identity gate: a "user-approval" gate must be approved by a human, not by an
	// agent piping commands. In a non-interactive shell we refuse unless --yes is
	// explicitly passed; templates/CLAUDE.md instructs agents never to pass --yes.
	let approvedBy;
	if (options.yes) {
		approvedBy = "flag (--yes)";
	} else if (process.stdin.isTTY) {
		const ok = await promptYesNo(`Approve gate "${resolvedGateId}"? [y/N] `);
		if (!ok) {
			return result(`Approval declined for gate "${resolvedGateId}".`, 1);
		}
		approvedBy = "user (interactive)";
	} else {
		return result(
			`Error: gate "${resolvedGateId}" needs human approval.\n` +
				"Run this in an interactive terminal, or pass --yes to approve non-interactively.",
			1,
		);
	}

	// Record gate_passed event so complete-check can see it.
	appendSessionEvent(sessionDir, {
		type: "gate_passed",
		data: {
			gateId: resolvedGateId,
			approvedBy,
		},
	});

	// Mirror the gate approval into the tamper-evident ledger.
	appendLedgerRecord(path.join(sessionDir, "ledger.jsonl"), {
		schemaVersion: 2,
		kind: "gate_passed",
		sessionId,
		gateId: resolvedGateId,
		approvedBy,
		recordedAt: new Date().toISOString(),
	});

	// Persist a .decision.json for the web viewer.
	const isRealGate = gates.some((g) => g.id === resolvedGateId);
	let gateWarning = null;
	if (isRealGate) {
		if (!writeGateDecision(sessionDir, resolvedGateId, "approved")) {
			gateWarning = `Warning: could not write decision for gate "${resolvedGateId}".`;
		}
	}

	// If all route gates have now been approved, complete the session.
	const gateEvents = readSessionEvents(sessionDir).filter(
		(e) => e.type === "gate_passed",
	);
	const routeGateIds = gates.map((g) => g.id);
	const allGatesPassed =
		routeGateIds.length > 0 &&
		routeGateIds.every((id) =>
			gateEvents.some(
				(e) => e.data && e.data.gateId === id,
			),
		);

	const sm = new SessionStateMachine(manifest.status);
	let completionEvent = null;
	let newStatus = manifest.status;
	if (allGatesPassed) {
		const transition = sm.transition(STATES.COMPLETED);
		if (transition.success && transition.event) {
			completionEvent = transition.event;
			newStatus = STATES.COMPLETED;
			appendSessionEvent(sessionDir, completionEvent);
		}
	}

	writeSessionManifest(sessionDir, { ...manifest, status: newStatus });

	const lines = [
		`Approval recorded for session: ${sessionId}`,
		`Gate: ${resolvedGateId}`,
	];
	if (allGatesPassed) {
		lines.push("All gates passed — session marked completed.");
	} else if (gates.length > 1) {
		const pending = gates.filter(
			(g) =>
				!gateEvents.some(
					(e) => e.data && e.data.gateId === g.id,
				),
		);
		lines.push(
			`Pending gates: ${pending.map((g) => g.id).join(", ")}`,
		);
	}
	if (gateWarning) {
		lines.push(gateWarning);
	}
	lines.push(
		"",
		"Tip: run `amber session complete-check --session " + sessionId + "` to verify all evidence.",
	);

	return result(lines.join("\n"), 0);
}

function verifyLedgerSession(projectRoot, sessionId) {
	const loaded = requireSession(projectRoot, sessionId);
	if (loaded.exitCode !== undefined) return loaded;
	const { sessionDir } = loaded;
	const ledgerPath = path.join(sessionDir, "ledger.jsonl");
	if (!fs.existsSync(ledgerPath)) {
		return result(`No governance ledger found for session ${sessionId}.`, 1);
	}
	const v = verifyLedgerChain(ledgerPath);
	if (v.intact) {
		return result(`Session ledger intact (${v.records} records).`, 0);
	}
	return result(
		codedError("AMBER_E_LEDGER_TAMPERED", `broken at record ${v.brokenAt}: ${v.reason}`),
		1,
	);
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
	verifySession,
	approveSession,
	verifyLedgerSession,
	getSessionsDir,
	loadSessionManifest,
	loadAllSessionManifests,
	requireSession,
	findMostRecentSession,
};
