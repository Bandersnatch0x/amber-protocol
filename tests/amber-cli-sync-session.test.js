"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function runCli(args, cwd) {
	return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

function mkTarget(label) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-sess-${label}-`));
	execSync("git init", { cwd: dir, encoding: "utf8" });
	execSync('git config user.email "test@example.com"', { cwd: dir, encoding: "utf8" });
	execSync('git config user.name "Test User"', { cwd: dir, encoding: "utf8" });
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	return dir;
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

test("sync session list shows zero envelopes on a fresh target", () => {
	const dir = mkTarget("list");
	const r = runCli(["sync", "session", "list", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.deepEqual(out, []);
});

test("sync session run completes a full pipeline", () => {
	const dir = mkTarget("run");
	fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
	fs.writeFileSync(path.join(dir, "docs", "page.md"), "# Page\n");
	// Pack one envelope first
	const p = runCli(
		[
			"sync",
			"envelope",
			"pack",
			"--type",
			"context-page",
			"--artifact",
			"docs/page.md",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(p.status, 0, p.stderr);

	const r = runCli(["sync", "session", "run", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.ok(out.session, "session record present");
	assert.equal(out.session.operation, "sync");
	assert.ok(out.summary.committed >= 1, `expected committed >= 1, got ${out.summary.committed}`);
});

test("sync session push commits and reports", () => {
	const dir = mkTarget("push");
	fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
	fs.writeFileSync(path.join(dir, "docs", "page.md"), "# Page\n");
	runCli(
		[
			"sync",
			"envelope",
			"pack",
			"--type",
			"context-page",
			"--artifact",
			"docs/page.md",
			"--target",
			dir,
			"--json",
		],
		dir,
	);

	const r = runCli(["sync", "session", "push", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const outer = JSON.parse(r.stdout);
	assert.ok(outer.text.includes("envelope") || outer.text.includes("remote"));
});

test("sync session pull validates packed envelopes", () => {
	const dir = mkTarget("pull");
	fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
	fs.writeFileSync(path.join(dir, "docs", "page.md"), "# Page\n");
	runCli(
		[
			"sync",
			"envelope",
			"pack",
			"--type",
			"context-page",
			"--artifact",
			"docs/page.md",
			"--target",
			dir,
			"--json",
		],
		dir,
	);

	const r = runCli(["sync", "session", "pull", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const outer = JSON.parse(r.stdout);
	assert.match(outer.text, /Validated 1 envelope/);
});

test("sync session with unknown subcommand errors", () => {
	const dir = mkTarget("unknown");
	const r = runCli(["sync", "session", "bogus", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
});
