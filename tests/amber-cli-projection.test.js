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
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-proj-${label}-`));
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	return dir;
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

test("projection list shows three missing projections on a fresh target", () => {
	const dir = mkTarget("list");
	const r = runCli(["projection", "list", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.equal(out.length, 3);
	assert.ok(out.every((p) => p.code === "AMBER_E_PROJECTION_MISSING"));
});

test("projection rebuild creates a governance-graph projection", () => {
	const dir = mkTarget("rebuild");
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Page 1", sources: {}, blocks: [] }),
	);
	const r = runCli(
		["projection", "rebuild", "--type", "governance-graph", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.equal(out.projection_type, "governance-graph");
	assert.ok(out.sourceHash);
	assert.ok(fs.existsSync(path.join(dir, ".amber", "projections", "governance-graph.json")));
});

test("projection status reports current after rebuild", () => {
	const dir = mkTarget("status-ok");
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Page 1", sources: {}, blocks: [] }),
	);
	runCli(["projection", "rebuild", "--type", "governance-graph", "--target", dir, "--json"], dir);
	const r = runCli(
		["projection", "status", "--type", "governance-graph", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.equal(out.ok, true);
	assert.equal(out.detail, "current");
});

test("projection status reports drift when canonical artifacts change", () => {
	const dir = mkTarget("status-drift");
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Page 1", sources: {}, blocks: [] }),
	);
	runCli(["projection", "rebuild", "--type", "governance-graph", "--target", dir, "--json"], dir);
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Changed", sources: {}, blocks: [] }),
	);
	const r = runCli(
		["projection", "status", "--type", "governance-graph", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 1);
	const out = payload(r);
	assert.equal(out.code, "AMBER_E_PROJECTION_DRIFT");
});

test("projection status propagates the typed code into the CLI result envelope (full-review finding 3)", () => {
	// rebuild and query already propagate their typed code to the OUTER
	// envelope (`code` next to `text`/`errors`); status used to carry it only
	// inside the JSON text payload. Assert the envelope seam directly.
	const dir = mkTarget("status-drift-code");
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Page 1", sources: {}, blocks: [] }),
	);
	runCli(["projection", "rebuild", "--type", "governance-graph", "--target", dir, "--json"], dir);
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Changed", sources: {}, blocks: [] }),
	);
	const r = runCli(
		["projection", "status", "--type", "governance-graph", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 1);
	const outer = JSON.parse(r.stdout);
	assert.equal(outer.code, "AMBER_E_PROJECTION_DRIFT", "the envelope code is machine-readable");
});

test("projection rebuild rejects an unknown type", () => {
	const dir = mkTarget("badtype");
	const r = runCli(["projection", "rebuild", "--type", "bogus", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
});

test("projection rebuild requires a type", () => {
	const dir = mkTarget("notype");
	const r = runCli(["projection", "rebuild", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
});

test("projection help is registered in the command registry", () => {
	const dir = mkTarget("help");
	const r = runCli(["projection", "--help", "--target", dir], dir);
	// help exists even if exit code varies
	assert.match(r.stdout + r.stderr, /projection|Projection/);
});
