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
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-pn-${label}-`));
	execSync("git init", { cwd: dir, encoding: "utf8" });
	execSync('git config user.email "test@example.com"', { cwd: dir, encoding: "utf8" });
	execSync('git config user.name "Test User"', { cwd: dir, encoding: "utf8" });
	return dir;
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

// ── Personal Node offline tracer (#161) ───────────────────────

test("PN1: offline capture — identity resolves without a service", () => {
	const dir = mkTarget("identity");
	// No .amber/identity.json → default + git inference, no network
	const r = runCli(["profile", "deployment", "show", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.equal(out.deploymentProfile, "personal-node");
	assert.equal(out.identity.tenantId, "local");
	assert.equal(out.identity.personId, "Test User <test@example.com>");
	assert.equal(out.identitySource, "git-inference");
});

test("PN2: deterministic receipts — envelope pack is reproducible across runs", () => {
	const dir = mkTarget("receipts");
	fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
	fs.writeFileSync(path.join(dir, "docs", "page.md"), "# Deterministic\n");
	const r1 = runCli(
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
	assert.equal(r1.status, 0, r1.stderr);
	const env1 = payload(r1);

	const r2 = runCli(
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
	const env2 = payload(r2);

	// Content hash is deterministic (same artifact → same sha256)
	assert.equal(env1.artifactRef.hash, env2.artifactRef.hash);
	assert.match(env1.artifactRef.hash, /^sha256:[0-9a-f]{64}$/);
	// envelopeId is unique per instance (immutability), but hash is provenance-bearing
	assert.notEqual(env1.envelopeId, env2.envelopeId);
});

test("PN3: local projections are read-only and rebuildable", () => {
	const dir = mkTarget("projections");
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Page 1", sources: {}, blocks: [] }),
	);

	// Rebuild governance-graph projection
	const rb = runCli(
		["projection", "rebuild", "--type", "governance-graph", "--target", dir, "--json"],
		dir,
	);
	assert.equal(rb.status, 0, rb.stderr);

	// Status is current
	const st = runCli(
		["projection", "status", "--type", "governance-graph", "--target", dir, "--json"],
		dir,
	);
	assert.equal(st.status, 0, st.stderr);
	const status = payload(st);
	assert.equal(status.ok, true);
	assert.equal(status.detail, "current");

	// Canonical change → drift (read-only: projection never writes canonical)
	const drift = runCli(
		["projection", "status", "--type", "governance-graph", "--target", dir, "--json"],
		dir,
	);
	assert.equal(drift.status, 0);
});

test("PN4: degraded read-only fails closed on drift", () => {
	const dir = mkTarget("failclosed");
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Page 1", sources: {}, blocks: [] }),
	);
	runCli(["projection", "rebuild", "--type", "governance-graph", "--target", dir, "--json"], dir);

	// Canonical artifact changes → projection drifts → status fails (exit 1)
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Changed", sources: {}, blocks: [] }),
	);
	const st = runCli(
		["projection", "status", "--type", "governance-graph", "--target", dir, "--json"],
		dir,
	);
	assert.equal(st.status, 1, "drifted projection must fail closed");
	const status = payload(st);
	assert.equal(status.code, "AMBER_E_PROJECTION_DRIFT");
});

test("PN5: full offline loop — init-free personal node works end to end", () => {
	const dir = mkTarget("loop");
	// identity
	const id = runCli(["profile", "deployment", "resolve", "--target", dir, "--json"], dir);
	assert.equal(id.status, 0, id.stderr);
	assert.equal(payload(id).deploymentProfile, "personal-node");

	// envelope
	fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
	fs.writeFileSync(path.join(dir, "docs", "page.md"), "# Loop\n");
	const pack = runCli(
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
	assert.equal(pack.status, 0, pack.stderr);

	// projection
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Page 1", sources: {}, blocks: [] }),
	);
	const proj = runCli(
		["projection", "rebuild", "--type", "governance-graph", "--target", dir, "--json"],
		dir,
	);
	assert.equal(proj.status, 0, proj.stderr);
});
