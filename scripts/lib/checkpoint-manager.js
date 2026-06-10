"use strict";

const fs = require("fs");
const path = require("path");

function getCheckpointsDir(projectRoot, sessionId) {
	return path.join(
		projectRoot,
		".harness",
		"sessions",
		sessionId,
		"checkpoints",
	);
}

function saveCheckpoint(
	projectRoot,
	sessionId,
	stage,
	manifest,
	worktreeState,
) {
	const checkpointsDir = getCheckpointsDir(projectRoot, sessionId);
	if (!fs.existsSync(checkpointsDir)) {
		fs.mkdirSync(checkpointsDir, { recursive: true });
	}

	const checkpoint = {
		sessionId,
		stage,
		timestamp: new Date().toISOString(),
		manifest: JSON.parse(JSON.stringify(manifest)),
		worktreeState: JSON.parse(JSON.stringify(worktreeState || {})),
	};

	const filename = `${stage}-${Date.now()}.json`;
	const checkpointPath = path.join(checkpointsDir, filename);
	fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));

	return { success: true, path: checkpointPath };
}

function loadLatestCheckpoint(projectRoot, sessionId) {
	const checkpointsDir = getCheckpointsDir(projectRoot, sessionId);
	if (!fs.existsSync(checkpointsDir)) {
		return null;
	}

	const files = fs
		.readdirSync(checkpointsDir)
		.filter((f) => f.endsWith(".json"));
	if (files.length === 0) return null;

	const checkpoints = files.map((f) => {
		const content = fs.readFileSync(path.join(checkpointsDir, f), "utf8");
		return JSON.parse(content);
	});

	checkpoints.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
	return checkpoints[0];
}

function listCheckpoints(projectRoot, sessionId) {
	const checkpointsDir = getCheckpointsDir(projectRoot, sessionId);
	if (!fs.existsSync(checkpointsDir)) {
		return [];
	}

	const files = fs
		.readdirSync(checkpointsDir)
		.filter((f) => f.endsWith(".json"));
	const checkpoints = files.map((f) => {
		const content = fs.readFileSync(path.join(checkpointsDir, f), "utf8");
		return JSON.parse(content);
	});

	return checkpoints.sort(
		(a, b) => new Date(a.timestamp) - new Date(b.timestamp),
	);
}

function loadCheckpointByStage(projectRoot, sessionId, stage) {
	const checkpoints = listCheckpoints(projectRoot, sessionId);
	const matches = checkpoints.filter((c) => c.stage === stage);
	if (matches.length === 0) return null;
	return matches[matches.length - 1];
}

module.exports = {
	saveCheckpoint,
	loadLatestCheckpoint,
	listCheckpoints,
	loadCheckpointByStage,
};
