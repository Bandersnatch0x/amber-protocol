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
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-th-${label}-`));
	execSync("git init", { cwd: dir, encoding: "utf8" });
	execSync('git config user.email "test@example.com"', { cwd: dir, encoding: "utf8" });
	execSync('git config user.name "Test User"', { cwd: dir, encoding: "utf8" });
	return dir;
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

// ── Team Hub synchronization tracer (#166) ────────────────────

test("TH1: repository-local authority — sync never touches non-.amber paths", () => {
	const dir = mkTarget("authority");
	// Source file outside .amber/ must never be enveloped
	fs.mkdirSync(path.join(dir, "src"), { recursive: true });
	fs.writeFileSync(path.join(dir, "src", "app.js"), "module.exports = { secret: 1 };\n");
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Page 1", sources: {}, blocks: [] }),
	);

	// Envelope a canonical artifact
	const pack = runCli(
		[
			"sync",
			"envelope",
			"pack",
			"--type",
			"context-page",
			"--artifact",
			".amber/context/pages/p1.json",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(pack.status, 0, pack.stderr);

	// The source file is untouched by any sync operation
	const src = fs.readFileSync(path.join(dir, "src", "app.js"), "utf8");
	assert.equal(src, "module.exports = { secret: 1 };\n", "source code must remain untouched");

	// Replay leaves source alone
	runCli(["sync", "session", "replay", "--target", dir, "--json"], dir);
	assert.equal(
		fs.readFileSync(path.join(dir, "src", "app.js"), "utf8"),
		"module.exports = { secret: 1 };\n",
	);
});

test("TH2: conflict records are append-only and resolution is explicit", () => {
	const dir = mkTarget("conflicts");
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".amber", "context", "pages", "page.json"), "# Original\n");
	runCli(
		[
			"sync",
			"envelope",
			"pack",
			"--type",
			"context-page",
			"--artifact",
			".amber/context/pages/page.json",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	fs.writeFileSync(path.join(dir, ".amber", "context", "pages", "page.json"), "# Diverged\n");

	runCli(["sync", "session", "replay", "--target", dir, "--json"], dir);
	const c1 = payload(runCli(["sync", "session", "conflicts", "--target", dir, "--json"], dir));
	assert.equal(c1.length, 1);
	assert.equal(c1[0].resolution, "pending", "conflict starts pending");

	// Run again → no duplicate conflict entry (append-only, not re-appended per envelope)
	runCli(["sync", "session", "replay", "--target", dir, "--json"], dir);
	const c2 = payload(runCli(["sync", "session", "conflicts", "--target", dir, "--json"], dir));
	assert.equal(c2.length, 1, "conflict recorded exactly once");
});

test("TH3: checkpoint and freshness evidence are deterministic", () => {
	const dir = mkTarget("checkpoint");
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Page 1", sources: {}, blocks: [] }),
	);

	const r1 = runCli(
		["projection", "rebuild", "--type", "governance-graph", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r1.status, 0, r1.stderr);
	const m1 = payload(r1);

	// Fresh rebuild from identical canonical state → identical sourceHash (deterministic)
	const r2 = runCli(
		["projection", "rebuild", "--type", "governance-graph", "--target", dir, "--json"],
		dir,
	);
	const m2 = payload(r2);
	assert.equal(m1.sourceHash, m2.sourceHash, "sourceHash must be deterministic across rebuilds");
	assert.match(m1.sourceHash, /^sha256:[0-9a-f]{64}$/);
	assert.ok(m1.rebuild_checkpoint, "checkpoint present");
});

test("TH4: rebuild from admitted records is proven (drift → rebuild → current)", () => {
	const dir = mkTarget("rebuild");
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Page 1", sources: {}, blocks: [] }),
	);
	runCli(["projection", "rebuild", "--type", "governance-graph", "--target", dir, "--json"], dir);

	// canonical change → drift
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Page 2", sources: {}, blocks: [] }),
	);
	const drift = payload(
		runCli(["projection", "status", "--type", "governance-graph", "--target", dir, "--json"], dir),
	);
	assert.equal(drift.code, "AMBER_E_PROJECTION_DRIFT");

	// rebuild → current again
	runCli(["projection", "rebuild", "--type", "governance-graph", "--target", dir, "--json"], dir);
	const fresh = payload(
		runCli(["projection", "status", "--type", "governance-graph", "--target", dir, "--json"], dir),
	);
	assert.equal(fresh.ok, true);
	assert.equal(fresh.detail, "current", "rebuild from admitted records restores currency");
});

test("TH5: full Team Hub flow — profile, sync session, conflict, projection", () => {
	const dir = mkTarget("full");
	// Baseline commit so the tracer can prove sync performs zero git mutations
	execSync('git commit --allow-empty -m "baseline"', { cwd: dir, encoding: "utf8" });
	const headBefore = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
	// declare team-hub profile
	runCli(["profile", "deployment", "set", "--profile", "team-hub", "--target", dir, "--json"], dir);
	const prof = payload(
		runCli(["profile", "deployment", "resolve", "--target", dir, "--json"], dir),
	);
	assert.equal(prof.deploymentProfile, "team-hub");

	// envelope with team-hub origin
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".amber", "context", "pages", "page.json"), "# Page\n");
	const pack = payload(
		runCli(
			[
				"sync",
				"envelope",
				"pack",
				"--type",
				"context-page",
				"--artifact",
				".amber/context/pages/page.json",
				"--target",
				dir,
				"--json",
			],
			dir,
		),
	);
	assert.equal(pack.origin.profile, "team-hub");

	// sync session run — transport is preparation/report-only (F035 D1): the
	// report is replayable, git is never executed
	const run = runCli(["sync", "session", "run", "--target", dir, "--json"], dir);
	assert.equal(run.status, 0, run.stderr);
	const out = payload(run);
	assert.ok(out.summary.preparation, "run produces a transport preparation report");
	assert.ok(
		out.summary.preparation.proposedOps.some((op) => op.verb === "add"),
		"proposed git operations are reported as structured ops (F040 contract)",
	);
	assert.ok(
		out.summary.preparation.envelopeCount >= 1,
		"envelopes are listed in the preparation report",
	);
	assert.equal(
		execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim(),
		headBefore,
		"sync session run must not create a commit",
	);

	// sync session push — same contract: report produced, never executed
	const push = runCli(["sync", "session", "push", "--target", dir, "--json"], dir);
	assert.equal(push.status, 0, push.stderr);
	const pushText = JSON.parse(push.stdout).text;
	assert.ok(pushText.includes("git add .amber/sync"), "push proposes git add as a string");
	assert.ok(pushText.includes("git commit"), "push proposes git commit as a string");
	assert.equal(
		execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim(),
		headBefore,
		"sync session push must not create a commit",
	);

	// projection rebuild
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
