"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { getRepoSnapshot, isGitRepository } = require("../../scripts/lib/core/git-state");

test("getRepoSnapshot reports branch/dirty/lastCommit in a git repo", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-gs-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
	fs.writeFileSync(path.join(dir, "README.md"), "# x\n");
	execSync("git add -A && git commit -qm init", { cwd: dir });
	fs.writeFileSync(path.join(dir, "dirty.txt"), "x"); // dirty tree, untracked
	const snap = getRepoSnapshot(dir);
	assert.equal(snap.isGit, true);
	assert.ok(
		snap.branch && !snap.branch.includes(" "),
		`branch is a real name, not a flag echo: ${JSON.stringify(snap.branch)}`,
	);
	assert.equal(snap.dirty, true);
	assert.ok(typeof snap.lastCommit === "string" && snap.lastCommit.length > 0);
	assert.equal(isGitRepository(dir), true);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("getRepoSnapshot degrades cleanly for a non-git directory", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-gs-"));
	const snap = getRepoSnapshot(dir);
	assert.equal(snap.isGit, false);
	assert.equal(snap.branch, null);
	assert.equal(snap.dirty, false);
	assert.equal(snap.lastCommit, null);
	assert.equal(isGitRepository(dir), false);
	fs.rmSync(dir, { recursive: true, force: true });
});
