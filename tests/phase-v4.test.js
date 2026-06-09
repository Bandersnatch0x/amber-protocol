"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "harness.js");

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `coding-harness-v4-${name}-`));
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
  const plan = path.join("docs", "plans", "F001-isolated-result.md");
  const planPath = path.join(target, plan);
  fs.writeFileSync(planPath, fs.readFileSync(planPath, "utf8").replace("User Confirmation: pending", "User Confirmation: confirmed"));
  return plan;
}

test("task prepare creates isolated ledger, evidence pack, replay file, and worktree directory", () => {
  const target = tempDir("prepare");
  const plan = createConfirmedPlan(target);

  const prepared = runHarness(["task", "prepare", "--target", target, "--plan", plan, "--task", "slice-1", "--json"]);
  const inspected = runHarness(["result", "inspect", "--target", target, "--task", "slice-1", "--json"]);
  const executionRoot = path.join(target, ".harness", "executions", "slice-1");

  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(fs.existsSync(path.join(target, ".harness", "worktrees", "slice-1")), true);
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
    "docs/plans/F001-blocked-result.md",
    "--task",
    "slice-1",
    "--json"
  ]);

  assert.notEqual(result.status, 0);
  assert.match(JSON.parse(result.stdout).errors.join("\n"), /User confirmation is required/);
});

