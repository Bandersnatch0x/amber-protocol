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
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-conf-${label}-`));
	execSync("git init", { cwd: dir, encoding: "utf8" });
	execSync('git config user.email "test@example.com"', { cwd: dir, encoding: "utf8" });
	execSync('git config user.name "Test User"', { cwd: dir, encoding: "utf8" });
	return dir;
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

test("sync session conflicts shows empty ledger on fresh target", () => {
	const dir = mkTarget("empty");
	const r = runCli(["sync", "session", "conflicts", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.deepEqual(out, []);
});

test("sync session replay applies envelopes idempotently", () => {
	const dir = mkTarget("replay");
	fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
	fs.writeFileSync(path.join(dir, "docs", "page.md"), "# Page\n");
	// pack → writes envelope to .amber/sync/envelopes/
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

	const r1 = runCli(["sync", "session", "replay", "--target", dir, "--json"], dir);
	assert.equal(r1.status, 0, r1.stderr);
	assert.match(JSON.parse(r1.stdout).text, /Applied 1 envelope/);

	const r2 = runCli(["sync", "session", "replay", "--target", dir, "--json"], dir);
	assert.equal(r2.status, 0, r2.stderr);
	assert.match(
		JSON.parse(r2.stdout).text,
		/Applied 0 envelope/,
		"second replay must be idempotent",
	);
});

test("sync session replay records a conflict when local content diverges", () => {
	const dir = mkTarget("conflict");
	fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
	fs.writeFileSync(path.join(dir, "docs", "page.md"), "# Original\n");
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
	// local diverges
	fs.writeFileSync(path.join(dir, "docs", "page.md"), "# Changed locally\n");

	const r = runCli(["sync", "session", "replay", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	assert.match(JSON.parse(r.stdout).text, /conflicts 1/);

	const c = runCli(["sync", "session", "conflicts", "--target", dir, "--json"], dir);
	assert.equal(c.status, 0, c.stderr);
	const conflicts = payload(c);
	assert.equal(conflicts.length, 1);
	assert.equal(conflicts[0].conflictType, "concurrent-edit");
	assert.equal(conflicts[0].resolution, "pending");
});

test("sync session replay never overwrites local content on conflict", () => {
	const dir = mkTarget("preserve");
	fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
	fs.writeFileSync(path.join(dir, "docs", "page.md"), "# Original\n");
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
	fs.writeFileSync(path.join(dir, "docs", "page.md"), "# Diverged\n");
	runCli(["sync", "session", "replay", "--target", dir, "--json"], dir);

	const content = fs.readFileSync(path.join(dir, "docs", "page.md"), "utf8");
	assert.equal(content, "# Diverged\n", "local content must be preserved on conflict");
});

test("sync session unknown subcommand errors", () => {
	const dir = mkTarget("unknown");
	const r = runCli(["sync", "session", "bogus", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
});
