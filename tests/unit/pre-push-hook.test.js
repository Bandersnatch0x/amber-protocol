"use strict";

// F012: the pre-push guard (.githooks/pre-push) must refuse any push whose
// local refs include pi-rewind checkpoint refs (refs/pi-checkpoints/*) —
// those are local undo snapshots that a --mirror push would leak to the
// remote, including captured untracked files. Branch/tag pushes are
// unaffected. The suite spawns the hook with stdin fixtures, matching the
// availability-guard pattern used for git-dependent tests.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const HOOK_PATH = path.resolve(__dirname, "..", "..", ".githooks", "pre-push");

function shAvailable() {
	try {
		return spawnSync("sh", ["-c", "true"], { encoding: "utf8" }).status === 0;
	} catch {
		return false;
	}
}

function runHook(stdin) {
	return spawnSync("sh", [HOOK_PATH, "origin", "https://example.com"], {
		input: stdin,
		encoding: "utf8",
	});
}

function hookSkipped() {
	// Pre-push runs under sh (POSIX); environments without sh cannot exercise
	// it and are skipped rather than failed — same tradeoff as git-dependent
	// suites in this repo.
	return !shAvailable();
}

test("pre-push hook exists and is a POSIX script", () => {
	assert.ok(hookSkipped() || require("node:fs").existsSync(HOOK_PATH));
});

test("pre-push rejects a pi-checkpoint ref push", (t) => {
	if (hookSkipped()) return t.skip("sh unavailable");
	const result = runHook("refs/pi-checkpoints/turn-x abc refs/pi-checkpoints/turn-x def\n");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /refusing to push pi-rewind checkpoint ref/);
	assert.match(result.stderr, /refs\/pi-checkpoints\/\*/);
});

test("pre-push allows a normal branch push", (t) => {
	if (hookSkipped()) return t.skip("sh unavailable");
	const result = runHook("refs/heads/master abc refs/heads/master def\n");
	assert.equal(result.status, 0);
	assert.equal(result.stderr, "");
});

test("pre-push rejects a mixed mirror-style push", (t) => {
	if (hookSkipped()) return t.skip("sh unavailable");
	const stdin = [
		"refs/heads/master a refs/heads/master b",
		"refs/pi-checkpoints/turn-y c refs/pi-checkpoints/turn-y d",
		"",
	].join("\n");
	const result = runHook(stdin);
	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/refusing to push pi-rewind checkpoint ref 'refs\/pi-checkpoints\/turn-y'/,
	);
});

test("pre-push allows a no-op (empty stdin) push", (t) => {
	if (hookSkipped()) return t.skip("sh unavailable");
	const result = runHook("");
	assert.equal(result.status, 0);
});
