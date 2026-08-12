"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");
const { buildGovernanceReport } = require("../scripts/lib/core/governance-report");

function tempDir(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-v4-${name}-`));
}

function runHarness(args) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd: ROOT,
		encoding: "utf8",
	});
}

function createConfirmedPlan(target) {
	assert.equal(runHarness(["init", "--target", target]).status, 0);
	assert.equal(
		runHarness(["plan", "--target", target, "--feature", "F001", "--title", "Isolated result"])
			.status,
		0,
	);
	const plan = path.join("docs", "plans", "F001-Isolated-result.md");
	const planPath = path.join(target, plan);
	fs.writeFileSync(
		planPath,
		fs
			.readFileSync(planPath, "utf8")
			.replace("User Confirmation: pending", "User Confirmation: confirmed"),
	);
	return plan;
}

function startSession(target, goal) {
	const started = runHarness([
		"session",
		"start",
		"--target",
		target,
		"--goal",
		goal,
		"--route",
		"bugfix-quick",
		"--confirm",
		"--json",
	]);
	assert.equal(started.status, 0, started.stderr);
	return JSON.parse(started.stdout).sessionId;
}

test("task prepare creates isolated ledger, evidence pack, replay file, and worktree directory", () => {
	const target = tempDir("prepare");
	const plan = createConfirmedPlan(target);
	const sessionId = startSession(target, "prepare isolated task");

	const prepared = runHarness([
		"task",
		"prepare",
		"--target",
		target,
		"--plan",
		plan,
		"--task",
		"slice-1",
		"--json",
	]);
	const inspected = runHarness([
		"result",
		"inspect",
		"--target",
		target,
		"--task",
		"slice-1",
		"--json",
	]);
	const executionRoot = path.join(target, ".amber", "executions", "slice-1");

	assert.equal(prepared.status, 0, prepared.stderr);
	assert.equal(inspected.status, 0, inspected.stderr);
	assert.equal(fs.existsSync(path.join(target, ".amber", "worktrees", "slice-1")), true);
	assert.equal(fs.existsSync(path.join(executionRoot, "ledger.json")), true);
	assert.equal(fs.existsSync(path.join(executionRoot, "evidence.json")), true);
	assert.equal(fs.existsSync(path.join(executionRoot, "replay.md")), true);
	const evidence = JSON.parse(fs.readFileSync(path.join(executionRoot, "evidence.json"), "utf8"));
	assert.equal(evidence.sessionId, sessionId);
	assert.equal(JSON.parse(inspected.stdout).replayable, true);
	assert.equal(JSON.parse(inspected.stdout).chatHistoryRequired, false);
});

test("task prepare binds a valid explicit Session", () => {
	const target = tempDir("explicit-session");
	const plan = createConfirmedPlan(target);
	const sessionId = startSession(target, "prepare explicit task");
	const prepared = runHarness([
		"task",
		"prepare",
		"--target",
		target,
		"--plan",
		plan,
		"--task",
		"explicit-task",
		"--session",
		sessionId,
		"--json",
	]);

	assert.equal(prepared.status, 0, prepared.stderr);
	const executionRoot = path.join(target, ".amber", "executions", "explicit-task");
	const ledger = JSON.parse(fs.readFileSync(path.join(executionRoot, "ledger.json"), "utf8"));
	const evidence = JSON.parse(fs.readFileSync(path.join(executionRoot, "evidence.json"), "utf8"));
	assert.equal(ledger.sessionId, sessionId);
	assert.equal(evidence.sessionId, sessionId);
});

test("task prepare rejects an explicit Session option with no value", () => {
	const target = tempDir("missing-session-value");
	const plan = createConfirmedPlan(target);
	startSession(target, "reject missing explicit Session value");
	const prepared = runHarness([
		"task",
		"prepare",
		"--target",
		target,
		"--plan",
		plan,
		"--task",
		"missing-session-value",
		"--json",
		"--session",
	]);

	assert.notEqual(prepared.status, 0);
	assert.match(JSON.parse(prepared.stdout).errors.join("\n"), /requires a non-empty Session ID/);
	assert.equal(
		fs.existsSync(path.join(target, ".amber", "executions", "missing-session-value")),
		false,
	);
});

test("task prepare rejects an explicit blank Session instead of auto-binding", () => {
	const target = tempDir("blank-session-value");
	const plan = createConfirmedPlan(target);
	startSession(target, "reject blank explicit Session value");
	const prepared = runHarness([
		"task",
		"prepare",
		"--target",
		target,
		"--plan",
		plan,
		"--task",
		"blank-session-value",
		"--session",
		" ",
		"--json",
	]);

	assert.notEqual(prepared.status, 0);
	assert.match(JSON.parse(prepared.stdout).errors.join("\n"), /requires a non-empty Session ID/);
	assert.equal(
		fs.existsSync(path.join(target, ".amber", "executions", "blank-session-value")),
		false,
	);
});

test("task prepare fails before writes when no active Session exists", () => {
	const target = tempDir("missing-session");
	const plan = createConfirmedPlan(target);
	const prepared = runHarness([
		"task",
		"prepare",
		"--target",
		target,
		"--plan",
		plan,
		"--task",
		"no-session",
		"--json",
	]);

	assert.notEqual(prepared.status, 0);
	assert.match(
		JSON.parse(prepared.stdout).errors.join("\n"),
		/requires an active non-terminal Session/,
	);
	assert.equal(fs.existsSync(path.join(target, ".amber", "worktrees", "no-session")), false);
	assert.equal(fs.existsSync(path.join(target, ".amber", "executions", "no-session")), false);
});

test("task prepare rejects an unknown explicit Session before writes", () => {
	const target = tempDir("unknown-session");
	const plan = createConfirmedPlan(target);
	const unknown = "00000000-0000-4000-8000-000000000001";
	const prepared = runHarness([
		"task",
		"prepare",
		"--target",
		target,
		"--plan",
		plan,
		"--task",
		"unknown-session",
		"--session",
		unknown,
		"--json",
	]);

	assert.notEqual(prepared.status, 0);
	assert.match(
		JSON.parse(prepared.stdout).errors.join("\n"),
		/Session not found in target repository/,
	);
	assert.equal(fs.existsSync(path.join(target, ".amber", "worktrees", "unknown-session")), false);
	assert.equal(fs.existsSync(path.join(target, ".amber", "executions", "unknown-session")), false);
});

test("task prepare rejects a terminal explicit Session", () => {
	const target = tempDir("terminal-session");
	const plan = createConfirmedPlan(target);
	const sessionId = startSession(target, "terminal task");
	const manifestPath = path.join(target, ".amber", "sessions", sessionId, "manifest.json");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, status: "completed" }, null, 2));
	const prepared = runHarness([
		"task",
		"prepare",
		"--target",
		target,
		"--plan",
		plan,
		"--task",
		"terminal-session",
		"--session",
		sessionId,
		"--json",
	]);

	assert.notEqual(prepared.status, 0);
	assert.match(JSON.parse(prepared.stdout).errors.join("\n"), /is terminal \(completed\)/);
	assert.equal(fs.existsSync(path.join(target, ".amber", "executions", "terminal-session")), false);
});

test("task prepare evidence is consumed by active-Session governance assessment", () => {
	const target = tempDir("governance-session-evidence");
	const plan = createConfirmedPlan(target);
	startSession(target, "assess prepared task evidence");
	const prepared = runHarness([
		"task",
		"prepare",
		"--target",
		target,
		"--plan",
		plan,
		"--task",
		"assessed-task",
		"--json",
	]);
	assert.equal(prepared.status, 0, prepared.stderr);

	const evidencePath = path.join(target, ".amber", "executions", "assessed-task", "evidence.json");
	const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
	fs.writeFileSync(evidencePath, JSON.stringify({ ...evidence, diff: {} }, null, 2));
	const report = buildGovernanceReport(target);
	assert.ok(
		report.workflowEffectiveness.noProgress.some(
			(finding) => finding.id === "no-progress-empty-evidence-increment",
		),
	);
});

test("task prepare blocks unconfirmed plans", () => {
	const target = tempDir("blocked");
	assert.equal(runHarness(["init", "--target", target]).status, 0);
	assert.equal(
		runHarness(["plan", "--target", target, "--feature", "F001", "--title", "Blocked result"])
			.status,
		0,
	);

	const result = runHarness([
		"task",
		"prepare",
		"--target",
		target,
		"--plan",
		"docs/plans/F001-Blocked-result.md",
		"--task",
		"slice-1",
		"--json",
	]);

	assert.notEqual(result.status, 0);
	assert.match(JSON.parse(result.stdout).errors.join("\n"), /User confirmation is required/);
});

test("task prepare records trace-derived replay and regression proposal", () => {
	const target = tempDir("trace-regression");
	assert.equal(runHarness(["init", "--target", target]).status, 0);
	assert.equal(
		runHarness(["plan", "--target", target, "--feature", "F001", "--title", "Trace regression"])
			.status,
		0,
	);
	const plan = "docs/plans/F001-Trace-regression.md";
	const planPath = path.join(target, plan);
	fs.writeFileSync(
		planPath,
		fs
			.readFileSync(planPath, "utf8")
			.replace("User Confirmation: pending", "User Confirmation: confirmed"),
	);
	startSession(target, "prepare trace regression task");

	const result = runHarness([
		"task",
		"prepare",
		"--target",
		target,
		"--plan",
		plan,
		"--task",
		"trace-failure",
		"--trace-input",
		"fixtures/traces/failing-input.json",
		"--agent-config",
		"crm-agent-v2",
		"--regression-assertion",
		"The response must include specific deal details, not just a count",
		"--json",
	]);

	assert.equal(result.status, 0, result.stderr);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.traceReplay.traceInput, "fixtures/traces/failing-input.json");
	assert.equal(
		payload.regressionProposal.assertion,
		"The response must include specific deal details, not just a count",
	);

	const evidence = JSON.parse(
		fs.readFileSync(
			path.join(target, ".amber", "executions", "trace-failure", "evidence.json"),
			"utf8",
		),
	);
	assert.equal(evidence.traceReplay.traceInput, "fixtures/traces/failing-input.json");
	assert.equal(evidence.traceReplay.agentConfig, "crm-agent-v2");
	assert.equal(evidence.regressionProposal.status, "proposed");
	assert.equal(evidence.regressionProposal.modifiesTests, false);
});
