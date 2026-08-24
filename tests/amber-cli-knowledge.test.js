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
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-kb-${label}-`));
	return dir;
}

function addPage(dir, pageId, { title, sources = {} } = {}) {
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", `${pageId}.json`),
		JSON.stringify({ pageId, title: title || pageId, sources, blocks: [] }),
	);
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

const KB_CORRUPT = "AMBER_E_KB_CORRUPT";

function ledgerFile(dir) {
	return path.join(dir, ".amber", "knowledge", "records.jsonl");
}

function goodLine(recordId = "r-1") {
	return JSON.stringify({ recordId, pageId: "p1", status: "accepted", title: "Page 1" });
}

function writeLedger(dir, lines) {
	fs.mkdirSync(path.dirname(ledgerFile(dir)), { recursive: true });
	fs.writeFileSync(ledgerFile(dir), lines.join("\n") + "\n");
}

test("knowledge admit requires provenance", () => {
	const dir = mkTarget("no-prov");
	addPage(dir, "p1", { title: "Page 1", sources: {} });
	const r = runCli(
		["knowledge", "admit", "--page", "p1", "--auth", "human-approve", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 1);
});

test("knowledge admit requires authorization", () => {
	const dir = mkTarget("no-auth");
	addPage(dir, "p1", { title: "Page 1", sources: { s1: { kind: "repo", ref: "a.md" } } });
	const r = runCli(["knowledge", "admit", "--page", "p1", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
});

test("knowledge admit creates a record", () => {
	const dir = mkTarget("admit");
	addPage(dir, "p1", { title: "Page 1", sources: { s1: { kind: "repo", ref: "a.md" } } });
	const r = runCli(
		["knowledge", "admit", "--page", "p1", "--auth", "human-approve", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 0, r.stderr);
	const record = payload(r);
	assert.equal(record.status, "accepted");
	assert.equal(record.pageId, "p1");
	assert.equal(record.provenance.length, 1);
});

test("knowledge list returns accepted records", () => {
	const dir = mkTarget("list");
	addPage(dir, "p1", { title: "Page 1", sources: { s1: { kind: "repo", ref: "a.md" } } });
	runCli(
		["knowledge", "admit", "--page", "p1", "--auth", "human-approve", "--target", dir, "--json"],
		dir,
	);
	const r = runCli(["knowledge", "list", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const records = payload(r);
	assert.equal(records.length, 1);
});

test("knowledge status reports stale after canonical drift", () => {
	const dir = mkTarget("stale");
	addPage(dir, "p1", { title: "Page 1", sources: { s1: { kind: "repo", ref: "a.md" } } });
	const r = runCli(
		["knowledge", "admit", "--page", "p1", "--auth", "human-approve", "--target", dir, "--json"],
		dir,
	);
	const record = payload(r);
	// canonical change
	addPage(dir, "p1", { title: "Page 1 changed", sources: { s1: { kind: "repo", ref: "a.md" } } });
	const s = runCli(
		["knowledge", "status", "--id", record.recordId, "--target", dir, "--json"],
		dir,
	);
	assert.equal(s.status, 1, "stale fails");
	const status = payload(s);
	assert.equal(status.status, "stale");
});

test("knowledge retire marks a record retired", () => {
	const dir = mkTarget("retire");
	addPage(dir, "p1", { title: "Page 1", sources: { s1: { kind: "repo", ref: "a.md" } } });
	const r = runCli(
		["knowledge", "admit", "--page", "p1", "--auth", "human-approve", "--target", dir, "--json"],
		dir,
	);
	const record = payload(r);
	const rt = runCli(
		[
			"knowledge",
			"retire",
			"--id",
			record.recordId,
			"--reason",
			"superseded",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(rt.status, 0, rt.stderr);
	const retired = payload(rt);
	assert.equal(retired.status, "retired");
});

test("knowledge query is exact-scope and denies unknown scope", () => {
	const dir = mkTarget("query");
	addPage(dir, "p1", { title: "Page 1", sources: { s1: { kind: "repo", ref: "a.md" } } });
	runCli(
		["knowledge", "admit", "--page", "p1", "--auth", "human-approve", "--target", dir, "--json"],
		dir,
	);

	const ok = runCli(["knowledge", "query", "--scope", "p1", "--target", dir, "--json"], dir);
	assert.equal(ok.status, 0, ok.stderr);
	assert.equal(payload(ok).records.length, 1);

	const deny = runCli(["knowledge", "query", "--scope", "ghost", "--target", dir, "--json"], dir);
	assert.equal(deny.status, 1);
	const denied = payload(deny);
	assert.equal(denied.code, "AMBER_E_KB_DENY");
});

test("knowledge unknown subcommand errors", () => {
	const dir = mkTarget("unknown");
	const r = runCli(["knowledge", "bogus", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
});

// ── Fail-closed corruption (F035-S5, decision D4) ────────────
//
// Only an ABSENT ledger is a legitimate empty state. A corrupt or unreadable
// Knowledge ledger exits 1 with the typed code AMBER_E_KB_CORRUPT, an empty
// payload, and non-empty diagnostics — never empty success.

test("knowledge list fails closed on corrupt first, middle, and last JSONL lines", () => {
	for (const [label, lines] of [
		["first line corrupt", ["{ not json", goodLine(), goodLine("r-2")]],
		["middle line corrupt", [goodLine(), "{ not json", goodLine("r-2")]],
		["last line corrupt", [goodLine(), goodLine("r-2"), "{ not json"]],
	]) {
		const dir = mkTarget("corrupt-list");
		writeLedger(dir, lines);
		const r = runCli(["knowledge", "list", "--target", dir, "--json"], dir);
		assert.equal(r.status, 1, `corrupt ledger is not empty success: ${label}`);
		const outer = payload(r);
		assert.equal(outer.code, KB_CORRUPT, `typed code: ${label}`);
		assert.equal(outer.text, "", `empty payload: ${label}`);
		assert.ok(outer.errors.length > 0, `non-empty diagnostics: ${label}`);
		assert.ok(outer.errors[0].includes(KB_CORRUPT), `code in diagnostics: ${label}`);
	}
});

test("knowledge list fails closed on an unreadable ledger (filesystem read error)", () => {
	const dir = mkTarget("corrupt-list-unreadable");
	// a directory where the ledger file is expected → readFileSync fails
	fs.mkdirSync(ledgerFile(dir), { recursive: true });
	const r = runCli(["knowledge", "list", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1, "unreadable ledger is not empty success");
	const outer = payload(r);
	assert.equal(outer.code, KB_CORRUPT);
	assert.equal(outer.text, "");
	assert.ok(outer.errors[0].includes(KB_CORRUPT));
});

test("knowledge list reports the typed corruption failure on stderr in text mode", () => {
	const dir = mkTarget("corrupt-list-text");
	writeLedger(dir, [goodLine(), "{ not json"]);
	const r = runCli(["knowledge", "list", "--target", dir], dir);
	assert.equal(r.status, 1);
	assert.ok(r.stderr.includes(KB_CORRUPT), "typed code reaches stderr diagnostics");
	assert.equal(r.stdout.trim(), "", "no payload masquerade on stdout");
});

test("knowledge status fails closed on a corrupt ledger instead of reporting not-found", () => {
	const dir = mkTarget("corrupt-status");
	writeLedger(dir, [goodLine(), "{ not json"]);
	const r = runCli(["knowledge", "status", "--id", "r-1", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1, "corrupt ledger must fail, not report a status");
	const outer = payload(r);
	assert.equal(outer.code, KB_CORRUPT);
	assert.equal(outer.text, "");
	assert.ok(outer.errors[0].includes(KB_CORRUPT));
	assert.ok(!outer.errors[0].includes("not found"), "corruption is not misreported as not-found");
});

test("knowledge query fails closed with the typed corruption code", () => {
	const dir = mkTarget("corrupt-query");
	writeLedger(dir, [goodLine(), "{ not json"]);
	const r = runCli(["knowledge", "query", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
	const outer = JSON.parse(r.stdout);
	assert.equal(outer.code, KB_CORRUPT, "typed code on the envelope");
	assert.ok(outer.errors[0].includes(KB_CORRUPT), "code in diagnostics");
	const body = JSON.parse(outer.text);
	assert.equal(body.ok, false);
	assert.equal(body.code, KB_CORRUPT);
	assert.deepEqual(body.records, [], "empty payload");
});

test("knowledge retire fails closed on a corrupt ledger instead of reporting not-found", () => {
	const dir = mkTarget("corrupt-retire");
	writeLedger(dir, [goodLine(), "{ not json"]);
	const r = runCli(
		["knowledge", "retire", "--id", "r-1", "--reason", "obsolete", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 1);
	const outer = payload(r);
	assert.equal(outer.code, KB_CORRUPT);
	assert.ok(outer.errors[0].includes(KB_CORRUPT));
	assert.ok(!outer.errors[0].includes("not found"), "corruption is not misreported as not-found");
});

test("knowledge list keeps an absent ledger as a legitimate empty success", () => {
	const dir = mkTarget("absent-list");
	const r = runCli(["knowledge", "list", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	assert.deepEqual(payload(r), []);
});
