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

const ORG_CORRUPT = "AMBER_E_ORG_CORRUPT";

function auditLedgerFile(dir) {
	return path.join(dir, ".amber", "audit", "events.jsonl");
}

function goodEventLine(tenantId = "tenant-a", repositoryId = "repo-1") {
	return JSON.stringify({
		eventId: "e-1",
		tenantId,
		repositoryId,
		action: "policy-assign",
		actor: "admin@org",
		evidenceHash: "sha256:" + "a".repeat(64),
	});
}

function writeLedger(dir, lines) {
	fs.mkdirSync(path.dirname(auditLedgerFile(dir)), { recursive: true });
	fs.writeFileSync(auditLedgerFile(dir), lines.join("\n") + "\n");
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

// ── Fail-closed corruption (F035-S5, decision D4) ────────────
//
// Only an ABSENT ledger is a legitimate empty state. A corrupt or unreadable
// Organization audit ledger exits 1 with the typed code AMBER_E_ORG_CORRUPT,
// an empty payload, and non-empty diagnostics — never empty success.

test("audit org events fails closed on corrupt first, middle, and last JSONL lines", () => {
	for (const [label, lines] of [
		["first line corrupt", ["{ not json", goodEventLine(), goodEventLine("tenant-b", "repo-2")]],
		["middle line corrupt", [goodEventLine(), "{ not json", goodEventLine("tenant-b", "repo-2")]],
		["last line corrupt", [goodEventLine(), goodEventLine("tenant-b", "repo-2"), "{ not json"]],
	]) {
		const dir = mkTarget("corrupt-events");
		writeLedger(dir, lines);
		const r = runCli(["audit", "org", "events", "--target", dir, "--json"], dir);
		assert.equal(r.status, 1, `corrupt ledger is not empty success: ${label}`);
		const outer = payload(r);
		assert.equal(outer.code, ORG_CORRUPT, `typed code: ${label}`);
		assert.equal(outer.text, "", `empty payload: ${label}`);
		assert.ok(outer.errors.length > 0, `non-empty diagnostics: ${label}`);
		assert.ok(outer.errors[0].includes(ORG_CORRUPT), `code in diagnostics: ${label}`);
	}
});

test("audit org events fails closed on an unreadable ledger (filesystem read error)", () => {
	const dir = mkTarget("corrupt-events-unreadable");
	// a directory where the ledger file is expected → readFileSync fails
	fs.mkdirSync(auditLedgerFile(dir), { recursive: true });
	const r = runCli(["audit", "org", "events", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1, "unreadable ledger is not empty success");
	const outer = payload(r);
	assert.equal(outer.code, ORG_CORRUPT);
	assert.equal(outer.text, "");
	assert.ok(outer.errors[0].includes(ORG_CORRUPT));
});

test("audit org events reports the typed corruption failure on stderr in text mode", () => {
	const dir = mkTarget("corrupt-events-text");
	writeLedger(dir, [goodEventLine(), "{ not json"]);
	const r = runCli(["audit", "org", "events", "--target", dir], dir);
	assert.equal(r.status, 1);
	assert.ok(r.stderr.includes(ORG_CORRUPT), "typed code reaches stderr diagnostics");
	assert.equal(r.stdout.trim(), "", "no payload masquerade on stdout");
});

test("audit org isolation fails closed with the typed corruption code", () => {
	const dir = mkTarget("corrupt-isolation");
	writeLedger(dir, [goodEventLine(), "{ not json"]);
	const r = runCli(
		["audit", "org", "isolation", "--tenant", "tenant-a", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 1, "corrupt ledger must fail");
	const outer = JSON.parse(r.stdout);
	assert.equal(outer.code, ORG_CORRUPT, "typed code on the envelope");
	assert.ok(outer.errors[0].includes(ORG_CORRUPT), "code in diagnostics");
	const body = JSON.parse(outer.text);
	assert.equal(body.ok, false);
	assert.deepEqual(body.events, [], "empty payload");
});

test("audit org cross-repo fails closed with the typed corruption code", () => {
	const dir = mkTarget("corrupt-cross-repo");
	writeLedger(dir, [goodEventLine(), "{ not json"]);
	const r = runCli(
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
	assert.equal(r.status, 1, "corrupt ledger must fail");
	const outer = JSON.parse(r.stdout);
	assert.equal(outer.code, ORG_CORRUPT, "typed code on the envelope");
	assert.ok(outer.errors[0].includes(ORG_CORRUPT), "code in diagnostics");
	const body = JSON.parse(outer.text);
	assert.equal(body.ok, false);
	assert.deepEqual(body.events, [], "empty payload");
});
