"use strict";

// Unit tests for loadAllSessionManifests — the batch enumerator extracted
// from findMostRecentSession and listSessions. Pins "newest first" ordering
// and the empty case.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	loadAllSessionManifests,
} = require("../../scripts/lib/session-commands");

function tempProject() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "session-all-"));
}

function writeManifest(projectRoot, sessionId, createdAt) {
	const dir = path.join(projectRoot, ".amber", "sessions", sessionId);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "manifest.json"),
		JSON.stringify({ sessionId, createdAt }),
	);
}

test("returns [] when there are no sessions", () => {
	assert.deepEqual(loadAllSessionManifests(tempProject()), []);
});

test("returns [] when the state dir does not exist", () => {
	assert.deepEqual(loadAllSessionManifests(tempProject()), []);
});

test("enumerates manifests sorted newest-first by createdAt", () => {
	const root = tempProject();
	writeManifest(root, "old", "2025-01-01T00:00:00Z");
	writeManifest(root, "new", "2025-06-01T00:00:00Z");
	writeManifest(root, "mid", "2025-03-01T00:00:00Z");
	const sessions = loadAllSessionManifests(root);
	assert.deepEqual(
		sessions.map((s) => s.sessionId),
		["new", "mid", "old"],
	);
});

test("skips directories without a manifest.json", () => {
	const root = tempProject();
	writeManifest(root, "real", "2025-01-01T00:00:00Z");
	fs.mkdirSync(path.join(root, ".amber", "sessions", "empty"), {
		recursive: true,
	});
	const sessions = loadAllSessionManifests(root);
	assert.deepEqual(
		sessions.map((s) => s.sessionId),
		["real"],
	);
});

test("skips a manifest that is not valid JSON instead of throwing", () => {
	const root = tempProject();
	writeManifest(root, "healthy", "2025-01-01T00:00:00Z");
	// A half-written/corrupt manifest (e.g. process killed mid-write) must not
	// crash enumeration for the healthy sessions alongside it.
	const corruptDir = path.join(root, ".amber", "sessions", "corrupt");
	fs.mkdirSync(corruptDir, { recursive: true });
	fs.writeFileSync(path.join(corruptDir, "manifest.json"), "{ broken json");
	const sessions = loadAllSessionManifests(root);
	assert.deepEqual(
		sessions.map((s) => s.sessionId),
		["healthy"],
	);
});
