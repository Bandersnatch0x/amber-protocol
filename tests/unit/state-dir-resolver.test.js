"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
	resolveStateDirForRead,
	resolveStateDirForCreate,
	CANONICAL_STATE_DIR,
	LEGACY_STATE_DIR,
} = require("../../scripts/lib/state-dir-resolver");
const { installTargetRoutes } = require("../helpers/target-routes");

function tmpRoot() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-resolver-"));
}

test("no state exists: both read and create resolve to .amber", () => {
	const root = tmpRoot();
	assert.equal(resolveStateDirForRead(root, { quiet: true }), path.join(root, ".amber"));
	assert.equal(resolveStateDirForCreate(root), path.join(root, ".amber"));
});

test("only .amber exists: read and create resolve to .amber", () => {
	const root = tmpRoot();
	fs.mkdirSync(path.join(root, ".amber"));
	assert.equal(resolveStateDirForRead(root, { quiet: true }), path.join(root, ".amber"));
	assert.equal(resolveStateDirForCreate(root), path.join(root, ".amber"));
});

test("only .harness exists: read resolves legacy, create resolves .amber", () => {
	const root = tmpRoot();
	fs.mkdirSync(path.join(root, ".harness"));
	assert.equal(resolveStateDirForRead(root, { quiet: true }), path.join(root, ".harness"));
	assert.equal(resolveStateDirForCreate(root), path.join(root, ".amber"));
});

test("both exist: .amber wins for read and create", () => {
	const root = tmpRoot();
	fs.mkdirSync(path.join(root, ".amber"));
	fs.mkdirSync(path.join(root, ".harness"));
	assert.equal(resolveStateDirForRead(root, { quiet: true }), path.join(root, ".amber"));
	assert.equal(resolveStateDirForCreate(root), path.join(root, ".amber"));
});

test("exports canonical and legacy dir names", () => {
	assert.equal(CANONICAL_STATE_DIR, ".amber");
	assert.equal(LEGACY_STATE_DIR, ".harness");
});

test("startSession creates sessions under .amber, not .harness", async () => {
	const root = tmpRoot();
	installTargetRoutes(root);
	const { startSession } = require("../../scripts/lib/session-commands");
	const start = await startSession(root, {
		goal: "demo goal",
		route: "feature-standard",
	});
	assert.equal(start.exitCode, 0, start.text);
	assert.ok(fs.existsSync(path.join(root, ".amber", "sessions")));
	assert.ok(!fs.existsSync(path.join(root, ".harness")));
});

test("legacy .harness sessions remain readable", () => {
	const root = tmpRoot();
	const legacySession = path.join(root, ".harness", "sessions", "old-1");
	fs.mkdirSync(legacySession, { recursive: true });
	fs.writeFileSync(
		path.join(legacySession, "manifest.json"),
		JSON.stringify({
			sessionId: "old-1",
			state: "completed",
			goal: "legacy goal",
			route: { id: "feature-standard", version: "1.0.0" },
		}),
	);
	const { statusSession } = require("../../scripts/lib/session-commands");
	const result = statusSession(root, { sessionId: "old-1" });
	assert.equal(result.exitCode, 0, result.text);
	assert.ok(result.text.includes("old-1"));
});
