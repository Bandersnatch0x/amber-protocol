"use strict";

// Unit tests for loadSessionManifest — the centralized session-manifest
// reader extracted from statusSession/abortSession/continueSession. Pins its
// "present vs missing" behavior directly.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadSessionManifest } = require("../../scripts/lib/session-commands");

function tempProject() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "session-load-"));
}

function writeManifest(projectRoot, sessionId, manifest) {
	const sessionDir = path.join(projectRoot, ".amber", "sessions", sessionId);
	fs.mkdirSync(sessionDir, { recursive: true });
	fs.writeFileSync(path.join(sessionDir, "manifest.json"), JSON.stringify(manifest));
	return sessionDir;
}

test("returns null when the session manifest is missing", () => {
	const root = tempProject();
	assert.equal(loadSessionManifest(root, "nope"), null);
});

test("reads and parses the manifest and exposes the session dir", () => {
	const root = tempProject();
	const dir = writeManifest(root, "s1", {
		sessionId: "s1",
		status: "paused",
		goal: "ship it",
	});
	const loaded = loadSessionManifest(root, "s1");
	assert.equal(loaded.manifest.sessionId, "s1");
	assert.equal(loaded.manifest.status, "paused");
	assert.equal(loaded.manifestPath, path.join(dir, "manifest.json"));
	assert.equal(loaded.sessionDir, dir);
});

test("parses manifests with nested route and budget fields", () => {
	const root = tempProject();
	writeManifest(root, "s2", {
		sessionId: "s2",
		status: "executing",
		route: { id: "bugfix-quick", version: "1.0.0" },
		budget: { used: 10, total: 100 },
	});
	const loaded = loadSessionManifest(root, "s2");
	assert.equal(loaded.manifest.route.id, "bugfix-quick");
	assert.equal(loaded.manifest.budget.total, 100);
});

test("flags a corrupt manifest instead of throwing", () => {
	const root = tempProject();
	const sessionDir = path.join(root, ".amber", "sessions", "broken");
	fs.mkdirSync(sessionDir, { recursive: true });
	fs.writeFileSync(path.join(sessionDir, "manifest.json"), "{ broken json");
	const loaded = loadSessionManifest(root, "broken");
	// Distinguishes corrupt (file present, unparseable) from missing (null), so
	// callers can report it precisely instead of crashing on a bare parse.
	assert.equal(loaded.corrupt, true);
	assert.equal(loaded.manifest, null);
	assert.equal(loaded.manifestPath, path.join(sessionDir, "manifest.json"));
});
