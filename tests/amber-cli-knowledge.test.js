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
	assert.equal(record.status, "admitted");
	assert.equal(record.pageId, "p1");
	assert.equal(record.provenance.length, 1);
});

test("knowledge list returns admitted records", () => {
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
