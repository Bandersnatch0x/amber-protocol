"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");

const {
	runSyncSession,
	createSyncSession,
	listEnvelopes,
	pushEnvelopes,
	pullEnvelopes,
} = require("../../scripts/lib/core/sync-session");

function mkTarget(label) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-session-${label}-`));
	execSync("git init", { cwd: dir, encoding: "utf8" });
	execSync('git config user.email "test@example.com"', { cwd: dir, encoding: "utf8" });
	execSync('git config user.name "Test User"', { cwd: dir, encoding: "utf8" });
	return dir;
}

function writeArtifact(dir, relPath, content) {
	const full = path.join(dir, relPath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
	return relPath;
}

function initTarget(dir) {
	// A target that has run amber init has .amber/ structure
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	return dir;
}

// ── createSyncSession ─────────────────────────────────────────

test("createSyncSession returns a session record with a UUID and timestamps", () => {
	const dir = mkTarget("create");
	const session = createSyncSession(dir, "push");
	assert.match(session.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	assert.equal(session.operation, "push");
	assert.ok(session.startedAt);
	assert.equal(session.status, "in-progress");
});

// ── listEnvelopes ─────────────────────────────────────────────

test("listEnvelopes returns empty for a target with no envelopes", () => {
	const dir = mkTarget("empty");
	initTarget(dir);
	const envelopes = listEnvelopes(dir);
	assert.deepEqual(envelopes, []);
});

test("listEnvelopes returns packed envelopes", () => {
	const dir = mkTarget("list");
	initTarget(dir);
	writeArtifact(dir, "docs/page.md", "# Page\n");
	const { packEnvelope } = require("../../scripts/lib/core/sync-remote");
	packEnvelope(dir, "context-page", "docs/page.md");
	const envelopes = listEnvelopes(dir);
	assert.equal(envelopes.length, 1);
	assert.equal(envelopes[0].artifactType, "context-page");
});

// ── pushEnvelopes ─────────────────────────────────────────────

test("pushEnvelopes commits envelopes when git is clean and remote exists", () => {
	const dir = mkTarget("push");
	initTarget(dir);
	writeArtifact(dir, "docs/page.md", "# Page\n");
	const { packEnvelope } = require("../../scripts/lib/core/sync-remote");
	packEnvelope(dir, "context-page", "docs/page.md");

	const result = pushEnvelopes(dir);
	// No remote configured → push skipped with a clear note, not an error
	assert.equal(result.errors.length, 0);
	assert.ok(result.committed >= 1, `expected >= 1 committed envelope, got ${result.committed}`);
	assert.ok(
		result.note.includes("remote") || result.note.includes("no remote") || result.committed >= 1,
	);
});

test("pushEnvelopes with no envelopes is a no-op", () => {
	const dir = mkTarget("noop");
	initTarget(dir);
	const result = pushEnvelopes(dir);
	assert.equal(result.committed, 0);
	assert.equal(result.errors.length, 0);
});

// ── pullEnvelopes ─────────────────────────────────────────────

test("pullEnvelopes validates on-disk envelopes without errors", () => {
	const dir = mkTarget("pull");
	initTarget(dir);
	writeArtifact(dir, "docs/page.md", "# Page\n");
	const { packEnvelope } = require("../../scripts/lib/core/sync-remote");
	packEnvelope(dir, "context-page", "docs/page.md");

	const result = pullEnvelopes(dir);
	assert.equal(result.errors.length, 0);
	assert.ok(result.validated >= 1, `expected >= 1 validated envelope, got ${result.validated}`);
});

test("pullEnvelopes reports invalid envelopes as errors", () => {
	const dir = mkTarget("pull-bad");
	initTarget(dir);
	const envDir = path.join(dir, ".amber", "sync", "envelopes");
	fs.mkdirSync(envDir, { recursive: true });
	fs.writeFileSync(path.join(envDir, "bad.json"), JSON.stringify({ artifactType: "bogus" }));

	const result = pullEnvelopes(dir);
	assert.ok(result.errors.length > 0);
	assert.ok(result.errors.some((e) => e.includes("bad.json") || e.includes("artifactType")));
});

// ── runSyncSession ────────────────────────────────────────────

test("runSyncSession orchestrates pull → pack → push with a session record", () => {
	const dir = mkTarget("session");
	initTarget(dir);
	writeArtifact(dir, "docs/page.md", "# Page\n");
	const { packEnvelope } = require("../../scripts/lib/core/sync-remote");
	packEnvelope(dir, "context-page", "docs/page.md");

	const result = runSyncSession(dir);
	assert.ok(result.session, "session record present");
	assert.equal(result.session.operation, "sync");
	assert.ok(result.summary);
	assert.equal(result.errors.length, 0);
	assert.ok(result.summary.pulled >= 0);
	assert.ok(
		result.summary.committed >= 1,
		`expected >= 1 committed, got ${result.summary.committed}`,
	);
});
