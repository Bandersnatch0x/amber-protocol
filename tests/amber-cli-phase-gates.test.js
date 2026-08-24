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
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-phase-${label}-`));
	return dir;
}

function setupPhase0(dir) {
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({
			pageId: "p1",
			title: "Page 1",
			sources: { s1: { kind: "repo", ref: "a.md" } },
			blocks: [],
		}),
	);
	// inv-2: deployment profile resolvable
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "profile.json"),
		JSON.stringify({ deploymentProfile: "personal-node" }),
	);
	// inv-3: transitions ledger exists (append-only lineage)
	fs.mkdirSync(path.join(dir, ".amber", "phases"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".amber", "phases", "transitions.jsonl"), "");
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

test("phase evidence shows requirements for phase-0", () => {
	const dir = mkTarget("evidence");
	const r = runCli(["phase", "evidence", "--phase", "phase-0", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const evidence = payload(r);
	assert.ok(evidence.length > 0);
	assert.ok(evidence.every((e) => e.requirement));
});

test("phase validate is complete when evidence present", () => {
	const dir = mkTarget("validate");
	setupPhase0(dir);
	const r = runCli(["phase", "validate", "--phase", "phase-0", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.equal(out.complete, true);
	assert.deepEqual(out.missing, []);
});

test("phase validate fails when evidence incomplete", () => {
	const dir = mkTarget("incomplete");
	const r = runCli(["phase", "validate", "--phase", "phase-1", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
	const out = payload(r);
	assert.equal(out.complete, false);
	assert.ok(out.missing.length > 0);
});

test("phase promote requires authorization", () => {
	const dir = mkTarget("noauth");
	setupPhase0(dir);
	const r = runCli(["phase", "promote", "--phase", "phase-0", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
});

test("phase promote succeeds with evidence + authorization", () => {
	const dir = mkTarget("promote");
	setupPhase0(dir);
	const r = runCli(
		[
			"phase",
			"promote",
			"--phase",
			"phase-0",
			"--auth",
			"human-approve",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 0, r.stderr);
	const transition = payload(r);
	assert.equal(transition.status, "promoted");
	assert.equal(transition.phase, "phase-0");
});

test("phase promote refuses incomplete evidence (no silent promotion)", () => {
	const dir = mkTarget("blocked");
	const r = runCli(
		[
			"phase",
			"promote",
			"--phase",
			"phase-1",
			"--auth",
			"human-approve",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 1);
	assert.match(JSON.parse(r.stdout).errors.join(" "), /evidence/);
});

test("phase rollback records lineage and requires a checkpoint", () => {
	const dir = mkTarget("rollback");
	setupPhase0(dir);
	runCli(
		[
			"phase",
			"promote",
			"--phase",
			"phase-0",
			"--auth",
			"human-approve",
			"--target",
			dir,
			"--json",
		],
		dir,
	);

	// no checkpoint → destructive rollback refused
	const bad = runCli(["phase", "rollback", "--phase", "phase-0", "--target", dir, "--json"], dir);
	assert.equal(bad.status, 1);
	assert.match(JSON.parse(bad.stdout).errors.join(" "), /checkpoint/);

	// with checkpoint → recorded
	const ok = runCli(
		[
			"phase",
			"rollback",
			"--phase",
			"phase-0",
			"--checkpoint",
			"cp-1",
			"--reason",
			"regression",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(ok.status, 0, ok.stderr);
	assert.equal(payload(ok).status, "rolled-back");

	// lineage has promote + rollback
	const t = payload(runCli(["phase", "transitions", "--target", dir, "--json"], dir));
	assert.equal(t.length, 2);
});

test("phase invariants checks non-regression", () => {
	const dir = mkTarget("invariants");
	setupPhase0(dir);
	const r = runCli(["phase", "invariants", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const invariants = payload(r);
	assert.ok(invariants.length > 0);
	assert.ok(
		invariants.every((i) => i.satisfied === true),
		"canonical target passes invariants",
	);
});

test("phase invariants fails closed when an invariant is missing (no vacuous pass)", () => {
	const dir = mkTarget("invariants-gap");
	// context pages only — no profile, no transitions ledger
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({
			pageId: "p1",
			title: "Page 1",
			sources: { s1: { kind: "repo", ref: "a.md" } },
			blocks: [],
		}),
	);
	const r = runCli(["phase", "invariants", "--target", dir, "--json"], dir);
	const invariants = payload(r);
	assert.ok(
		invariants.some((i) => i.satisfied === false),
		"missing artifacts fail invariants",
	);
});

test("phase unknown subcommand errors", () => {
	const dir = mkTarget("unknown");
	const r = runCli(["phase", "bogus", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
});
