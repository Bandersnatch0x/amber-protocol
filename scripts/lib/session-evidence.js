"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { readJsonSafe } = require("./core/fs-utils");
const { readAllSessionManifests } = require("./session-manifest");
const { readSessionEvents } = require("./session-timeline");
const { resolveStateDirForRead } = require("./state-dir-resolver");

function listDirectories(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.sort()
		.map((name) => path.join(dir, name))
		.filter((entry) => {
			try {
				return fs.statSync(entry).isDirectory();
			} catch (error) {
				// Dangling symlink / TOCTOU race: not a usable execution dir.
				// Real access failures still surface.
				if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
					return false;
				}
				throw error;
			}
		});
}

function readArtifact(filePath, label) {
	if (!fs.existsSync(filePath)) return null;
	const { value, error } = readJsonSafe(filePath);
	if (error) {
		throw new Error(`invalid ${label} at ${filePath}: ${error}`);
	}
	if (value == null) return null;
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`invalid ${label} at ${filePath}: expected a JSON object`);
	}
	return value;
}

function executionCommands(ledger, evidence) {
	if (Array.isArray(ledger?.commands) && ledger.commands.length > 0) {
		return [...ledger.commands];
	}
	return Array.isArray(evidence?.commands) ? [...evidence.commands] : [];
}

function assertSharedCoordinates(ledger, evidence, executionDir) {
	if (!ledger || !evidence) return;
	for (const key of ["taskId", "sessionId"]) {
		const left = ledger[key];
		const right = evidence[key];
		if (left != null && right != null && left !== right) {
			throw new Error(
				`coordinate mismatch on ${key} in ${executionDir}: ledger=${left} evidence=${right}`,
			);
		}
	}
}

function listExecutionEvidence(targetRoot) {
	const executionsDir = path.join(resolveStateDirForRead(targetRoot), "executions");
	return listDirectories(executionsDir).map((executionDir) => {
		const ledger = readArtifact(path.join(executionDir, "ledger.json"), "Execution Ledger");
		const evidence = readArtifact(path.join(executionDir, "evidence.json"), "Task Evidence");
		assertSharedCoordinates(ledger, evidence, executionDir);
		return {
			dir: path.basename(executionDir),
			taskId: ledger?.taskId || evidence?.taskId || path.basename(executionDir),
			sessionId: ledger?.sessionId || evidence?.sessionId || null,
			commands: executionCommands(ledger, evidence),
			ledger,
			evidence,
		};
	});
}

function buildSessionEvidence(targetRoot, manifest, executions) {
	const stateDir = resolveStateDirForRead(targetRoot);
	const sessionId = manifest?.sessionId || null;
	const sessionDir = sessionId ? path.join(stateDir, "sessions", sessionId) : null;
	const sessionExecutions = sessionId
		? executions.filter((execution) => execution.sessionId === sessionId)
		: [];
	return {
		sessionId,
		manifest: manifest || null,
		timelineEvents: sessionDir && fs.existsSync(sessionDir) ? readSessionEvents(sessionDir) : [],
		executions: sessionExecutions,
		resultEvidence: sessionExecutions.map((execution) => execution.evidence).filter(Boolean),
	};
}

function loadSessionEvidence(targetRoot, sessionId) {
	if (!sessionId) return buildSessionEvidence(targetRoot, null, []);
	const stateDir = resolveStateDirForRead(targetRoot);
	const sessionsDir = path.join(stateDir, "sessions");
	const manifest = readAllSessionManifests(sessionsDir).find(
		(candidate) => candidate.sessionId === sessionId,
	) || { sessionId };
	return buildSessionEvidence(targetRoot, manifest, listExecutionEvidence(targetRoot));
}

function listSessionEvidence(targetRoot) {
	const stateDir = resolveStateDirForRead(targetRoot);
	const manifests = readAllSessionManifests(path.join(stateDir, "sessions"));
	const executions = listExecutionEvidence(targetRoot);
	return manifests.map((manifest) => buildSessionEvidence(targetRoot, manifest, executions));
}

module.exports = {
	listExecutionEvidence,
	loadSessionEvidence,
	listSessionEvidence,
};
