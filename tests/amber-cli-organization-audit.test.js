"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function runCli(args, cwd) {
	return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

function mkTarget(label) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-org-${label}-`));
	return dir;
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

test("audit org events shows empty ledger on fresh target", () => {
	const dir = mkTarget("events");
	const r = runCli(["audit", "org", "events", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.deepEqual(out, []);
});

test("audit org retention records an evidence-backed revocation", () => {
	const dir = mkTarget("retention");
	const r = runCli(
		[
			"audit",
			"org",
			"retention",
			"--tenant",
			"tenant-a",
			"--repository",
			"repo-1",
			"--action",
			"revoke",
			"--entity",
			"actor-123",
			"--reason",
			"offboarding",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 0, r.stderr);
	const event = payload(r);
	assert.equal(event.action, "revoke");
	assert.ok(event.evidenceHash);
	assert.equal(event.target, "actor-123");

	// event is in the ledger, with target/reason persisted on the ledger copy
	const ev = payload(runCli(["audit", "org", "events", "--target", dir, "--json"], dir));
	assert.equal(ev.length, 1);
	assert.equal(ev[0].target, "actor-123", "ledger copy carries target");
	assert.equal(ev[0].reason, "offboarding", "ledger copy carries reason");
});

test("audit org retention rejects an unknown action", () => {
	const dir = mkTarget("bad-action");
	const r = runCli(
		[
			"audit",
			"org",
			"retention",
			"--tenant",
			"a",
			"--repository",
			"r",
			"--action",
			"explode",
			"--entity",
			"x",
			"--reason",
			"y",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 1);
});

test("audit org isolation enforces tenant scope", () => {
	const dir = mkTarget("isolation");
	runCli(
		[
			"audit",
			"org",
			"retention",
			"--tenant",
			"tenant-a",
			"--repository",
			"repo-1",
			"--action",
			"revoke",
			"--entity",
			"u",
			"--reason",
			"x",
			"--target",
			dir,
			"--json",
		],
		dir,
	);

	const r = runCli(
		["audit", "org", "isolation", "--tenant", "tenant-a", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.equal(out.ok, true);
	assert.equal(out.events.length, 1);
	assert.equal(out.events[0].tenantId, "tenant-a");
});

test("audit org isolation denies cross-tenant queries", () => {
	const dir = mkTarget("cross-tenant");
	runCli(
		[
			"audit",
			"org",
			"retention",
			"--tenant",
			"tenant-a",
			"--repository",
			"repo-1",
			"--action",
			"revoke",
			"--entity",
			"u",
			"--reason",
			"x",
			"--target",
			dir,
			"--json",
		],
		dir,
	);

	const r = runCli(
		[
			"audit",
			"org",
			"isolation",
			"--tenant",
			"tenant-b",
			"--query-tenant",
			"tenant-a",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 1);
	const out = payload(r);
	assert.equal(out.ok, false);
});

test("audit org cross-repo is exact-scope and deny-wins", () => {
	const dir = mkTarget("cross-repo");
	runCli(
		[
			"audit",
			"org",
			"retention",
			"--tenant",
			"tenant-a",
			"--repository",
			"repo-1",
			"--action",
			"revoke",
			"--entity",
			"u",
			"--reason",
			"x",
			"--target",
			dir,
			"--json",
		],
		dir,
	);

	const ok = runCli(
		[
			"audit",
			"org",
			"cross-repo",
			"--tenant",
			"tenant-a",
			"--scope",
			"repo-1",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(ok.status, 0, ok.stderr);
	assert.equal(payload(ok).events.length, 1);

	const deny = runCli(
		[
			"audit",
			"org",
			"cross-repo",
			"--tenant",
			"tenant-a",
			"--scope",
			"ghost",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(deny.status, 1);
});

test("audit org unknown subcommand errors", () => {
	const dir = mkTarget("unknown");
	const r = runCli(["audit", "org", "bogus", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
});

test("legacy audit still works", () => {
	const dir = mkTarget("legacy");
	const r = runCli(["audit", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
});
