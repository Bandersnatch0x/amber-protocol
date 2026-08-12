"use strict";

// Regression capstone: a repository where no work happened must never reach a
// passing `complete-check --strict`. This encodes the false-completion hole found
// on 2026-07-03 (init → start → claim-verify → approve×2 → strict pass).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, execSync } = require("node:child_process");

const AMBER = path.join(__dirname, "..", "..", "scripts", "amber.js");

function amber(cwd, args) {
	return spawnSync("node", [AMBER, ...args], { cwd, encoding: "utf8" });
}

test("empty repo cannot reach a passing complete-check --strict", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-cap-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });

	// Install the scaffold and commit it, so the tree is clean and the only way to
	// pass "work present" would be real work during the session (there is none).
	assert.equal(amber(dir, ["init", "--target", "."]).status, 0);
	execSync("git add -A && git commit -qm scaffold", { cwd: dir });

	const start = amber(dir, [
		"session",
		"start",
		"--goal",
		"add login feature",
		"--route",
		"feature-standard",
		"--confirm",
		"--json",
	]);
	assert.equal(start.status, 0, start.stderr);
	const { sessionId } = JSON.parse(start.stdout);

	// Claim-only verification (no --execute) and both approvals via --yes.
	amber(dir, [
		"session",
		"verify",
		"--session",
		sessionId,
		"--command",
		"npm test",
		"--result",
		"passed",
		"--confirm",
	]);
	amber(dir, [
		"session",
		"approve",
		"--session",
		sessionId,
		"--gate",
		"user-approval-plan",
		"--yes",
	]);
	amber(dir, [
		"session",
		"approve",
		"--session",
		sessionId,
		"--gate",
		"user-approval-implement",
		"--yes",
	]);

	const check = amber(dir, ["session", "complete-check", "--session", sessionId, "--strict"]);
	assert.equal(check.status, 1, "strict check must exit non-zero");
	assert.match(check.stdout, /Completion check status: fail/);
	// It fails for the right reasons: no work, and claim-only verification under strict.
	assert.match(check.stdout, /work/);

	fs.rmSync(dir, { recursive: true, force: true });
});
