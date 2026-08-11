"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");

// Isolated session root so manifests and continuity surfaces land in a tempdir
// instead of the amber source tree. cwd stays at ROOT so routes resolve.
const SESSION_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "amber-session-int-"));

test.after(() => {
	fs.rmSync(SESSION_ROOT, { recursive: true, force: true });
});

function runHarness(args) {
	return spawnSync(
		process.execPath,
		[path.join(ROOT, "scripts", "harness.js"), ...args, "--target", SESSION_ROOT],
		{
			cwd: ROOT,
			encoding: "utf8",
		},
	);
}

test("session start creates manifest and timeline", () => {
	const result = runHarness([
		"session",
		"start",
		"--goal",
		"implement test feature",
		"--route",
		"feature-standard",
	]);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /Session created:/);

	const match = result.stdout.match(/Session created: ([a-f0-9-]+)/);
	assert.ok(match);

	const sessionId = match[1];
	const manifestPath = path.join(SESSION_ROOT, ".amber", "sessions", sessionId, "manifest.json");
	assert.ok(fs.existsSync(manifestPath));

	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	assert.equal(manifest.status, "created");
	assert.equal(manifest.goal, "implement test feature");

	const timelinePath = path.join(SESSION_ROOT, ".amber", "sessions", sessionId, "timeline.jsonl");
	assert.ok(fs.existsSync(timelinePath));
});

test("session status shows current session", () => {
	const startResult = runHarness([
		"session",
		"start",
		"--goal",
		"implement status test",
		"--route",
		"feature-standard",
	]);
	const match = startResult.stdout.match(/Session created: ([a-f0-9-]+)/);
	const sessionId = match[1];

	const result = runHarness(["session", "status", sessionId]);
	assert.equal(result.status, 0);
	assert.match(result.stdout, new RegExp(sessionId));
	assert.match(result.stdout, /Status: created/);
});

test("session status by ID shows specific session", () => {
	const startResult = runHarness([
		"session",
		"start",
		"--goal",
		"implement status by id test",
		"--route",
		"feature-standard",
	]);
	const match = startResult.stdout.match(/Session created: ([a-f0-9-]+)/);
	const sessionId = match[1];

	const result = runHarness(["session", "status", sessionId]);
	assert.equal(result.status, 0);
	assert.match(result.stdout, new RegExp(sessionId));
	assert.match(result.stdout, /implement status by id test/);
});

test("session list shows all sessions", () => {
	runHarness([
		"session",
		"start",
		"--goal",
		"implement first feature",
		"--route",
		"feature-standard",
	]);
	runHarness([
		"session",
		"start",
		"--goal",
		"implement second feature",
		"--route",
		"feature-standard",
	]);

	const result = runHarness(["session", "list"]);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /first/);
	assert.match(result.stdout, /second/);
});

test("session abort sets status to aborted", () => {
	const startResult = runHarness([
		"session",
		"start",
		"--goal",
		"implement abort test",
		"--route",
		"feature-standard",
	]);
	const match = startResult.stdout.match(/Session created: ([a-f0-9-]+)/);
	const sessionId = match[1];

	const result = runHarness(["session", "abort", sessionId]);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /Session aborted/);

	const manifestPath = path.join(SESSION_ROOT, ".amber", "sessions", sessionId, "manifest.json");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	assert.equal(manifest.status, "aborted");
});

test("session start with explicit route", () => {
	const result = runHarness([
		"session",
		"start",
		"--goal",
		"implement explicit route",
		"--route",
		"bugfix-quick",
	]);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /bugfix-quick/);
});

test("session --json emits standard envelope", () => {
	const result = runHarness([
		"session",
		"start",
		"--goal",
		"implement json test",
		"--route",
		"feature-standard",
		"--json",
	]);
	assert.equal(result.status, 0);

	const payload = JSON.parse(result.stdout);
	assert.ok(Array.isArray(payload.errors));
	assert.equal(payload.errors.length, 0);
	assert.ok(typeof payload.text === "string");
});

test("unknown session subcommand exits non-zero", () => {
	const result = runHarness(["session", "frobnicate"]);
	assert.notEqual(result.status, 0);
});

test("session start with goal matching bugfix-quick route auto-selects route", () => {
	const result = runHarness(["session", "start", "--goal", "fix critical login bug"]);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /bugfix-quick/);
});
