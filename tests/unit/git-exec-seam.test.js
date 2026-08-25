"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("node:child_process");
const { gitExec, isRepository, configGet } = require("../../scripts/lib/core/git-exec");

function mkGit() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-git-exec-seam-"));
	execSync("git init -q", { cwd: dir });
	execSync('git config user.email "t@t.t" && git config user.name "t"', { cwd: dir });
	fs.writeFileSync(path.join(dir, "x"), "1");
	execSync("git add -A && git commit -q -m init", { cwd: dir });
	return dir;
}

function mkPlainDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-git-exec-seam-plain-"));
}

/**
 * Run fn with PATH pointing at an empty directory so no git binary can be
 * resolved — the "git absent" failure mode the adapter must absorb.
 */
function withoutGitOnPath(fn) {
	const prev = process.env.PATH;
	process.env.PATH = fs.mkdtempSync(path.join(os.tmpdir(), "amber-no-git-"));
	try {
		return fn();
	} finally {
		process.env.PATH = prev;
	}
}

// ── gitExec ──────────────────────────────────────────────────────────

test("gitExec reports ok with trimmed stdout and empty stderr on success", () => {
	const dir = mkGit();
	const res = gitExec(dir, ["config", "user.email"]);
	assert.equal(res.ok, true);
	assert.equal(res.status, 0);
	assert.equal(res.stdout, "t@t.t", "stdout is trimmed");
	assert.equal(res.stderr, "");
});

test("gitExec reports ok:false with a positive status and stderr on a failing command", () => {
	const dir = mkGit();
	const res = gitExec(dir, ["rev-parse", "--verify", "definitely-not-a-ref"]);
	assert.equal(res.ok, false);
	assert.ok(res.status > 0);
	assert.equal(res.stdout, "");
	assert.ok(res.stderr.length > 0, "git's error message surfaces in stderr");
	assert.ok(!/\n$/.test(res.stderr), "stderr is trimmed");
});

test("gitExec reports status -1 when the git binary is absent", () => {
	const dir = mkPlainDir();
	const res = withoutGitOnPath(() => gitExec(dir, ["status"]));
	assert.equal(res.ok, false);
	assert.equal(res.status, -1);
	assert.equal(res.stdout, "");
	assert.equal(res.stderr, "");
});

test("gitExec never throws on malformed args", () => {
	const dir = mkGit();
	// A string args value is rejected by spawnSync synchronously — gitExec must
	// absorb the throw and report the spawn-failure shape instead.
	const res = gitExec(dir, "status");
	assert.equal(res.ok, false);
	assert.equal(res.status, -1);
	assert.equal(res.stdout, "");
});

// ── isRepository ─────────────────────────────────────────────────────

test("isRepository is true inside a git repository", () => {
	const dir = mkGit();
	assert.equal(isRepository(dir), true);
});

test("isRepository is false in a plain directory", () => {
	const dir = mkPlainDir();
	assert.equal(isRepository(dir), false);
});

test("isRepository is false when git is absent", () => {
	const dir = mkPlainDir();
	assert.equal(
		withoutGitOnPath(() => isRepository(dir)),
		false,
	);
});

// ── configGet ────────────────────────────────────────────────────────

test("configGet returns a locally set value, trimmed", () => {
	const dir = mkGit();
	assert.equal(configGet(dir, "user.email"), "t@t.t");
});

test("configGet returns empty string for an unset key", () => {
	const dir = mkGit();
	assert.equal(configGet(dir, "amber.f037.never.set"), "");
});

test("configGet returns empty string when git is absent", () => {
	const dir = mkPlainDir();
	assert.equal(
		withoutGitOnPath(() => configGet(dir, "user.email")),
		"",
	);
});
