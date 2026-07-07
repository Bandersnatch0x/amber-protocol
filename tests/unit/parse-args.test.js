"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { parseArgs } = require("../../scripts/lib/core/cli-output");

test("defaults target to cwd with json and dryRun false", () => {
	const args = parseArgs([]);
	assert.equal(args.target, process.cwd());
	assert.equal(args.json, false);
	assert.equal(args.dryRun, false);
});

test("value flags consume the next token", () => {
	const args = parseArgs(["--goal", "fix bug", "--route", "bugfix-quick"]);
	assert.equal(args.goal, "fix bug");
	assert.equal(args.route, "bugfix-quick");
});

test("hyphenated flags map to camelCase keys", () => {
	const args = parseArgs([
		"--output-dir",
		"out",
		"--bundle-dir",
		"bundle",
		"--threshold-days",
		"30",
		"--review-gate-status",
		"pass",
		"--request-id",
		"resume-request-1",
	]);
	assert.equal(args.outputDir, "out");
	assert.equal(args.bundleDir, "bundle");
	assert.equal(args.thresholdDays, "30");
	assert.equal(args.reviewGateStatus, "pass");
	assert.equal(args.requestId, "resume-request-1");
});

test("boolean flags set true without consuming a token", () => {
	const args = parseArgs(["--json", "--dry-run", "--worktree", "extra"]);
	assert.equal(args.json, true);
	assert.equal(args.dryRun, true);
	assert.equal(args.worktree, true);
	assert.deepEqual(args._, ["extra"]);
});

test("-h and --help both set help", () => {
	assert.equal(parseArgs(["-h"]).help, true);
	assert.equal(parseArgs(["--help"]).help, true);
});

test("--decision sets the scalar and accumulates", () => {
	const args = parseArgs([
		"--decision",
		"a=approved",
		"--decision",
		"b=rejected",
	]);
	assert.equal(args.decision, "b=rejected");
	assert.deepEqual(args.decisions, ["a=approved", "b=rejected"]);
});

test("--include accumulates into includes", () => {
	const args = parseArgs(["--include", "AGENTS.md", "--include", "CLAUDE.md"]);
	assert.equal(args.include, "CLAUDE.md");
	assert.deepEqual(args.includes, ["AGENTS.md", "CLAUDE.md"]);
});

test("unknown tokens collect into _", () => {
	const args = parseArgs(["list", "--json", "inspect"]);
	assert.deepEqual(args._, ["list", "inspect"]);
});

test("drift/ledger flags are registered (not silently dropped to _)", () => {
	// Regression guard: a new command flag MUST be added to FLAG_SPECS, else
	// parseArgs silently drops it into args._ and the handler never sees it.
	const args = parseArgs([
		"--scope", "artifact",
		"--format", "gh-annotations",
		"--no-fail",
		"--home", "sessions",
		"--out", "audits/ledger.csv",
	]);
	assert.equal(args.scope, "artifact");
	assert.equal(args.format, "gh-annotations");
	assert.equal(args.noFail, true);
	assert.equal(args.home, "sessions");
	assert.equal(args.out, "audits/ledger.csv");
	assert.deepEqual(args._ || [], []);
});

test("a value flag at the end of argv yields undefined", () => {
	const args = parseArgs(["--output"]);
	assert.equal("output" in args, true);
	assert.equal(args.output, undefined);
});

test("--target overrides the cwd default", () => {
	const args = parseArgs(["--target", "/some/repo"]);
	assert.equal(args.target, "/some/repo");
});
