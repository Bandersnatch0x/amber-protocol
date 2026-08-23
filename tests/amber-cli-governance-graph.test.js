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
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-graph-${label}-`));
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

test("projection query returns nodes for an explicit scope and records a receipt", () => {
	const dir = mkTarget("query");
	addPage(dir, "p1", { title: "Page 1" });
	addPage(dir, "p2", { title: "Page 2" });
	const r = runCli(["projection", "query", "--scope", "p1", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.equal(out.ok, true);
	assert.equal(out.nodes.length, 1);
	assert.equal(out.nodes[0].id, "p1");
	assert.ok(out.receiptId, "receipt recorded");
});

test("projection query denies an unknown scope (exact-scope denial)", () => {
	const dir = mkTarget("deny");
	addPage(dir, "p1", { title: "Page 1" });
	const r = runCli(["projection", "query", "--scope", "ghost", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
	const out = payload(r);
	assert.equal(out.ok, false);
	assert.equal(out.code, "AMBER_E_GRAPH_DENY");
});

test("projection query is bounded with a limit", () => {
	const dir = mkTarget("bounded");
	for (let i = 0; i < 10; i += 1) addPage(dir, `p${i}`, { title: `Page ${i}` });
	const r = runCli(["projection", "query", "--limit", "3", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.equal(out.ok, true);
	assert.ok(out.nodes.length <= 3);
	assert.equal(out.truncated, true);
});

test("projection receipt lists recorded receipts", () => {
	const dir = mkTarget("receipts");
	addPage(dir, "p1", { title: "Page 1" });
	runCli(["projection", "query", "--scope", "p1", "--target", dir, "--json"], dir);
	const r = runCli(["projection", "receipt", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const receipts = payload(r);
	assert.equal(receipts.length, 1);
	assert.equal(receipts[0].scope, "p1");
	assert.equal(receipts[0].projectionType, "governance-graph");
});

test("projection receipt verifies a specific receipt by id", () => {
	const dir = mkTarget("verify");
	addPage(dir, "p1", { title: "Page 1" });
	const q = payload(
		runCli(["projection", "query", "--scope", "p1", "--target", dir, "--json"], dir),
	);
	const r = runCli(["projection", "receipt", "--id", q.receiptId, "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.equal(out.ok, true);
	assert.equal(out.receipt.receiptId, q.receiptId);
});

test("projection receipt fails for an unknown id", () => {
	const dir = mkTarget("badverify");
	const r = runCli(["projection", "receipt", "--id", "nope", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
});

test("projection query + rebuild integration: graph derives from canonical pages", () => {
	const dir = mkTarget("integration");
	const shared = { kind: "repo", ref: "docs/spec.md" };
	addPage(dir, "p1", { title: "Page 1", sources: { s1: shared } });
	addPage(dir, "p2", { title: "Page 2", sources: { s1: shared } });
	const r = runCli(["projection", "query", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.ok(out.nodes.length >= 2, "graph derived from canonical pages");
});
