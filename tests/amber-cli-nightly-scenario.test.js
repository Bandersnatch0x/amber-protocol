"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SCENARIO = path.join(ROOT, "scripts", "demo", "nightly-host-scenario.js");

function runScenario(args, env = {}) {
	return spawnSync(process.execPath, [SCENARIO, ...args], {
		cwd: ROOT,
		encoding: "utf8",
		env: { ...process.env, ...env },
		timeout: 120_000,
	});
}

test("--help exits 0 and documents the judge", () => {
	const r = runScenario(["--help"]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /complete-check/);
	assert.match(r.stdout, /nightly|Nightly/);
});

test("with no host agent, the run fails on missing Session evidence (never passes)", () => {
	const r = runScenario(["--objective", "verify seed feature"]);
	// No host agent runs, so no Session exists → evidence-based FAIL (exit 1),
	// never a silent pass.
	assert.equal(r.status, 1, `expected fail, got ${r.status}: ${r.stdout}`);
	assert.match(r.stdout, /FAIL/);
	assert.match(r.stdout, /Session artifacts|complete-check|evidence/);
});

test("missing host binary is an explicit skip (exit 42), never a silent pass", () => {
	const r = runScenario([], { AMBER_NIGHTLY_HOST_BINARY: "definitely-not-a-real-binary-xyz" });
	assert.equal(r.status, 42, `expected skip exit 42, got ${r.status}`);
	assert.match(r.stdout, /SKIP/);
});

test("scenario does not dispatch live subagents — script has no agent invocation", () => {
	const fs = require("node:fs");
	const src = fs.readFileSync(SCENARIO, "utf8");
	// no spawn/exec of a host agent binary (claude/codex/cursor); only amber.js and git
	assert.ok(
		!/spawnSync\([^)]*(claude|codex|cursor)|execSync\([^)]*(claude|codex|cursor)/i.test(src),
		"no host-agent invocation",
	);
});
