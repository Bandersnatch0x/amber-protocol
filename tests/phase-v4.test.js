"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `amber-v4-${name}-`));
}

function runHarness(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8"
  });
}

function createConfirmedPlan(target) {
  assert.equal(runHarness(["init", "--target", target]).status, 0);
  assert.equal(runHarness(["plan", "--target", target, "--feature", "F001", "--title", "Isolated result"]).status, 0);
  const plan = path.join("docs", "plans", "F001-Isolated-result.md");
  const planPath = path.join(target, plan);
  fs.writeFileSync(planPath, fs.readFileSync(planPath, "utf8").replace("User Confirmation: pending", "User Confirmation: confirmed"));
  return plan;
}

test("task prepare creates isolated ledger, evidence pack, replay file, and worktree directory", () => {
  const target = tempDir("prepare");
  const plan = createConfirmedPlan(target);

  const prepared = runHarness(["task", "prepare", "--target", target, "--plan", plan, "--task", "slice-1", "--json"]);
  const inspected = runHarness(["result", "inspect", "--target", target, "--task", "slice-1", "--json"]);
  const executionRoot = path.join(target, ".amber", "executions", "slice-1");

  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(fs.existsSync(path.join(target, ".amber", "worktrees", "slice-1")), true);
  assert.equal(fs.existsSync(path.join(executionRoot, "ledger.json")), true);
  assert.equal(fs.existsSync(path.join(executionRoot, "evidence.json")), true);
  assert.equal(fs.existsSync(path.join(executionRoot, "replay.md")), true);
  assert.equal(JSON.parse(inspected.stdout).replayable, true);
  assert.equal(JSON.parse(inspected.stdout).chatHistoryRequired, false);
});

test("task prepare blocks unconfirmed plans", () => {
  const target = tempDir("blocked");
  assert.equal(runHarness(["init", "--target", target]).status, 0);
  assert.equal(runHarness(["plan", "--target", target, "--feature", "F001", "--title", "Blocked result"]).status, 0);

  const result = runHarness([
    "task",
    "prepare",
    "--target",
    target,
    "--plan",
    "docs/plans/F001-Blocked-result.md",
    "--task",
    "slice-1",
    "--json"
  ]);

  assert.notEqual(result.status, 0);
  assert.match(JSON.parse(result.stdout).errors.join("\n"), /User confirmation is required/);
});

test("task prepare records trace-derived replay and regression proposal", () => {
  const target = tempDir("trace-regression");
  assert.equal(runHarness(["init", "--target", target]).status, 0);
  assert.equal(runHarness(["plan", "--target", target, "--feature", "F001", "--title", "Trace regression"]).status, 0);
  const plan = "docs/plans/F001-Trace-regression.md";
  const planPath = path.join(target, plan);
  fs.writeFileSync(planPath, fs.readFileSync(planPath, "utf8").replace("User Confirmation: pending", "User Confirmation: confirmed"));

  const result = runHarness([
    "task", "prepare",
    "--target", target,
    "--plan", plan,
    "--task", "trace-failure",
    "--trace-input", "fixtures/traces/failing-input.json",
    "--agent-config", "crm-agent-v2",
    "--regression-assertion", "The response must include specific deal details, not just a count",
    "--json"
  ]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.traceReplay.traceInput, "fixtures/traces/failing-input.json");
  assert.equal(payload.regressionProposal.assertion, "The response must include specific deal details, not just a count");

  const evidence = JSON.parse(fs.readFileSync(path.join(target, ".amber", "executions", "trace-failure", "evidence.json"), "utf8"));
  assert.equal(evidence.traceReplay.traceInput, "fixtures/traces/failing-input.json");
  assert.equal(evidence.traceReplay.agentConfig, "crm-agent-v2");
  assert.equal(evidence.regressionProposal.status, "proposed");
  assert.equal(evidence.regressionProposal.modifiesTests, false);
});

