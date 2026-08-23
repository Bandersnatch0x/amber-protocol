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
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-viz-${label}-`));
	return dir;
}

function addPage(dir, pageId, { title, sources = {}, createdAt = null } = {}) {
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", `${pageId}.json`),
		JSON.stringify({
			pageId,
			title: title || pageId,
			sources,
			blocks: [],
			createdAt: createdAt || `2026-08-0${pageId.slice(1)}T00:00:00Z`,
		}),
	);
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

test("projection view temporal returns a bounded ordered list with a receipt", () => {
	const dir = mkTarget("temporal");
	addPage(dir, "p1", { title: "Page 1" });
	addPage(dir, "p2", { title: "Page 2" });
	addPage(dir, "p3", { title: "Page 3" });
	const r = runCli(
		["projection", "view", "--kind", "temporal", "--limit", "2", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.equal(out.kind, "temporal");
	assert.ok(out.items.length <= 2, "bounded");
	assert.equal(out.truncated, true);
	assert.ok(out.sourceHash);
	assert.ok(out.receiptId, "read receipt recorded");
});

test("projection view relationship returns nodes and links", () => {
	const dir = mkTarget("relationship");
	const shared = { kind: "repo", ref: "docs/spec.md" };
	addPage(dir, "p1", { title: "Page 1", sources: { s1: shared } });
	addPage(dir, "p2", { title: "Page 2", sources: { s1: shared } });
	const r = runCli(
		["projection", "view", "--kind", "relationship", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.ok(out.items.length >= 2, "nodes present");
});

test("projection view mind-map lists page sources", () => {
	const dir = mkTarget("mindmap");
	addPage(dir, "p1", { title: "Page 1", sources: { s1: { kind: "repo", ref: "a.md" } } });
	const r = runCli(["projection", "view", "--kind", "mind-map", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.ok(out.items.length >= 1);
});

test("projection view requires a kind", () => {
	const dir = mkTarget("nokind");
	const r = runCli(["projection", "view", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
});

test("projection view rejects an unknown kind", () => {
	const dir = mkTarget("badkind");
	const r = runCli(["projection", "view", "--kind", "bogus", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
});

test("projection compare reports changes", () => {
	const dir = mkTarget("compare");
	addPage(dir, "p1", { title: "Page 1" });
	runCli(["projection", "view", "--kind", "temporal", "--target", dir, "--json"], dir);
	const r = runCli(["projection", "compare", "--kind", "temporal", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.equal(typeof out.changed, "boolean");
});

test("every view leaves a verifiable receipt", () => {
	const dir = mkTarget("receipt");
	addPage(dir, "p1", { title: "Page 1" });
	const v = payload(
		runCli(["projection", "view", "--kind", "timeline", "--target", dir, "--json"], dir),
	);
	const chk = runCli(
		["projection", "receipt", "--id", v.receiptId, "--target", dir, "--json"],
		dir,
	);
	assert.equal(chk.status, 0, chk.stderr);
	const out = payload(chk);
	assert.equal(out.ok, true);
	assert.match(out.receipt.projectionType, /^visualization-/);
});
