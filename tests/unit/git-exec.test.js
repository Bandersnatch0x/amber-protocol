"use strict";
const { trackTempDir } = require("../helpers/harness");

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("node:child_process");
const { gitExec, gitRun, gitOutput, gitOutputRaw } = require("../../scripts/lib/core/git-exec");

function mkGit() {
	const dir = trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), "amber-git-")));
	execSync("git init -q", { cwd: dir });
	execSync("git config user.email t@t.t && git config user.name t", { cwd: dir });
	fs.writeFileSync(path.join(dir, "x"), "1");
	execSync("git add -A && git commit -q -m init", { cwd: dir });
	return dir;
}

test("gitRun creates an annotated tag and reports ok", () => {
	const dir = mkGit();
	const r = gitRun(dir, ["tag", "-a", "-m", "seal", "amber-ledger-seal-test"]);
	assert.strictEqual(r.ok, true);
	assert.strictEqual(
		gitOutput(dir, ["tag", "-l", "amber-ledger-seal-test"]),
		"amber-ledger-seal-test",
	);
});

test("gitRun reports ok:false on a failing write", () => {
	const dir = mkGit();
	const r = gitRun(dir, ["tag", "-a", "-m", "seal", "bad tag name with spaces"]);
	assert.strictEqual(r.ok, false);
});

test("gitOutput trims, so a payload with significant leading whitespace needs gitOutputRaw", () => {
	const dir = trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), "amber-git-raw-")));
	execSync("git init -q", { cwd: dir });
	// A leading space is legal in a git path and is part of the name.
	fs.writeFileSync(path.join(dir, " leading.txt"), "x");
	fs.writeFileSync(path.join(dir, "plain.txt"), "y");
	execSync("git add -A", { cwd: dir });

	const raw = gitOutputRaw(dir, ["ls-files", "--cached", "-z", "--", "."]);
	const trimmed = gitOutput(dir, ["ls-files", "--cached", "-z", "--", "."]);

	assert.deepStrictEqual(raw.split("\0").filter(Boolean).sort(), [" leading.txt", "plain.txt"]);
	// Trimming eats the space, so the entry no longer names a file on disk.
	assert.deepStrictEqual(trimmed.split("\0").filter(Boolean).sort(), ["leading.txt", "plain.txt"]);
	assert.strictEqual(fs.existsSync(path.join(dir, "leading.txt")), false);
	assert.strictEqual(fs.existsSync(path.join(dir, " leading.txt")), true);
});

test("gitExec surfaces the spawn error and gives every call the 16MB default ceiling", () => {
	const dir = trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), "amber-git-err-")));
	execSync("git init -q", { cwd: dir });
	execSync("git config user.email t@t.t && git config user.name t", { cwd: dir });
	// A 1ms timeout kills any fetch deterministically on every platform —
	// the ENOBUFS overflow route turned out to be platform-dependent.
	const res = gitExec(dir, ["fetch", "http://127.0.0.1:9/repo.git", "HEAD"], { timeout: 1 });
	assert.strictEqual(res.ok, false);
	assert.strictEqual(res.status, -1);
	assert.strictEqual(res.error.code, "ETIMEDOUT");

	// The default ceiling (16 MB) covers the same command without opts.
	const ok = gitExec(dir, ["rev-parse", "--is-inside-work-tree"]);
	assert.strictEqual(ok.ok, true);
	assert.strictEqual(ok.error, null);
});
