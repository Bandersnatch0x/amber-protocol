"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");
const {
	getRepoSnapshot,
	isGitRepository,
	parsePorcelainPaths,
} = require("../../scripts/lib/core/git-state");

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
	assert.equal(snap.dirtyUntrackedOnly, true, "only ?? path → untracked-only");
	assert.ok(typeof snap.lastCommit === "string" && snap.lastCommit.length > 0);
	assert.equal(isGitRepository(dir), true);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("getRepoSnapshot dirtyUntrackedOnly is false when a tracked file is modified", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-gs-mod-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
	fs.writeFileSync(path.join(dir, "README.md"), "# x\n");
	execSync("git add -A && git commit -qm init", { cwd: dir });
	fs.writeFileSync(path.join(dir, "README.md"), "# changed\n");
	const snap = getRepoSnapshot(dir);
	assert.equal(snap.dirty, true);
	assert.equal(snap.dirtyUntrackedOnly, false);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("getRepoSnapshot degrades cleanly for a non-git directory", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-gs-"));
	const snap = getRepoSnapshot(dir);
	assert.equal(snap.isGit, false);
	assert.equal(snap.branch, null);
	assert.equal(snap.dirty, false);
	assert.equal(snap.dirtyUntrackedOnly, false);
	assert.equal(snap.lastCommit, null);
	// dirtyPaths degrades to null (git never ran) — not an empty list.
	assert.equal(snap.dirtyPaths, null);
	assert.equal(isGitRepository(dir), false);
	fs.rmSync(dir, { recursive: true, force: true });
});

// ---- dirtyPaths: parsed porcelain entries (F026) ----

test("getRepoSnapshot dirtyPaths lists modified and untracked files, empty when clean", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-gs-paths-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
	fs.writeFileSync(path.join(dir, "README.md"), "# x\n");
	fs.writeFileSync(path.join(dir, "src.txt"), "s\n");
	execSync("git add -A && git commit -qm init", { cwd: dir });

	assert.deepEqual(getRepoSnapshot(dir).dirtyPaths, [], "clean tree → empty array, not null");

	fs.writeFileSync(path.join(dir, "README.md"), "# changed\n");
	fs.writeFileSync(path.join(dir, "untracked.txt"), "u\n");
	const snap = getRepoSnapshot(dir);
	assert.deepEqual(snap.dirtyPaths.sort(), ["README.md", "untracked.txt"]);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("getRepoSnapshot dirtyPaths normalizes renames to the final path", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-gs-rename-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
	fs.writeFileSync(path.join(dir, "old.md"), "# x\n");
	execSync("git add -A && git commit -qm init", { cwd: dir });
	execSync("git mv old.md renamed.md", { cwd: dir });
	// porcelain renders "R  old.md -> renamed.md"; only the destination counts.
	const snap = getRepoSnapshot(dir);
	assert.deepEqual(snap.dirtyPaths, ["renamed.md"]);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("getRepoSnapshot dirtyPaths carries untracked directories as dir/ entries", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-gs-dir-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
	fs.writeFileSync(path.join(dir, "README.md"), "# x\n");
	execSync("git add -A && git commit -qm init", { cwd: dir });
	fs.mkdirSync(path.join(dir, "brand-new"));
	fs.writeFileSync(path.join(dir, "brand-new", "file.js"), "x\n");
	const snap = getRepoSnapshot(dir);
	assert.deepEqual(snap.dirtyPaths, ["brand-new/"]);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("parsePorcelainPaths handles quoted paths and dedupes (pure parser)", () => {
	// Quoted path: git wraps paths with special characters in double quotes.
	assert.deepEqual(parsePorcelainPaths('?? "weird name.txt"'), ["weird name.txt"]);
	// Rename with spaces on both sides keeps only the destination.
	assert.deepEqual(parsePorcelainPaths('R  "old dir/a.md" -> "new dir/b.md"'), ["new dir/b.md"]);
	// The same final path via two entries collapses to one.
	assert.deepEqual(parsePorcelainPaths("M  a.txt\n?? a.txt"), ["a.txt"]);
	// gitOutput trims stdout, so an unstaged " M x" first line arrives as
	// "M x" — the parser must not eat the first path character.
	assert.deepEqual(parsePorcelainPaths("M README.md\n?? new.txt"), ["README.md", "new.txt"]);
	// Empty/non-string input is an empty list (callers distinguish git failure
	// via snapshot.dirtyPaths === null).
	assert.deepEqual(parsePorcelainPaths(""), []);
	assert.deepEqual(parsePorcelainPaths(null), []);
});

// F026 review fixes: the T (typechange) status parses, and quoted non-ASCII
// escape sequences survive without backslash rewriting.
test("parsePorcelainPaths accepts typechange entries and keeps quoted escapes intact", () => {
	assert.deepEqual(parsePorcelainPaths("T  docs/link.md"), ["docs/link.md"]);
	assert.deepEqual(parsePorcelainPaths(" T docs/link.md"), ["docs/link.md"]);
	// git C-quotes non-ASCII paths; the escapes must not be rewritten.
	const quoted = '?? "src/' + "\\346\\226\\207" + '.txt"';
	assert.deepEqual(parsePorcelainPaths(quoted), ["src/" + "\\346\\226\\207" + ".txt"]);
});
