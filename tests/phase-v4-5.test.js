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
  return fs.mkdtempSync(path.join(os.tmpdir(), `coding-harness-v4-5-${name}-`));
}

function runHarness(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8"
  });
}

function preparedTarget(name) {
  const target = tempDir(name);
  assert.equal(runHarness(["init", "--target", target]).status, 0);
  assert.equal(runHarness(["plan", "--target", target, "--feature", "F001", "--title", "Agent slice"]).status, 0);
  const plan = path.join("docs", "plans", "F001-agent-slice.md");
  const planPath = path.join(target, plan);
  fs.writeFileSync(planPath, fs.readFileSync(planPath, "utf8").replace("User Confirmation: pending", "User Confirmation: confirmed"));
  assert.equal(runHarness(["task", "prepare", "--target", target, "--plan", plan, "--task", "slice-1"]).status, 0);
  return target;
}

test("agent dispatch enforces worker reviewer separation", () => {
  const target = preparedTarget("separation");

  const result = runHarness([
    "agent",
    "dispatch",
    "--target",
    target,
    "--task",
    "slice-1",
    "--worker",
    "same-agent",
    "--reviewer",
    "same-agent",
    "--json"
  ]);

  assert.notEqual(result.status, 0);
  assert.match(JSON.parse(result.stdout).errors.join("\n"), /Workers cannot self-approve/);
});

test("agent dispatch supports stop resume and separate reviewer evidence", () => {
  const target = preparedTarget("dispatch");

  const dispatch = runHarness([
    "agent",
    "dispatch",
    "--target",
    target,
    "--task",
    "slice-1",
    "--worker",
    "worker-a",
    "--reviewer",
    "reviewer-b",
    "--backend",
    "local",
    "--concurrency",
    "1",
    "--loop-contract",
    "daily-harness-triage",
    "--hard-stop-status",
    "within-limits",
    "--budget-status",
    "within-budget",
    "--review-bandwidth-status",
    "available",
    "--review-gate-status",
    "pending",
    "--json"
  ]);
  const stop = runHarness(["agent", "stop", "--target", target, "--task", "slice-1", "--json"]);
  const resume = runHarness(["agent", "resume", "--target", target, "--task", "slice-1", "--json"]);
  const review = runHarness([
    "agent",
    "review",
    "--target",
    target,
    "--task",
    "slice-1",
    "--reviewer",
    "reviewer-b",
    "--decision",
    "approved",
    "--evidence",
    "reviewed ledger",
    "--review-gate-status",
    "satisfied",
    "--json"
  ]);
  const dispatchPath = path.join(target, ".harness", "orchestration", "slice-1", "dispatch.json");
  const reviewPath = path.join(target, ".harness", "orchestration", "slice-1", "reviewer-evidence.json");

  assert.equal(dispatch.status, 0, dispatch.stderr);
  assert.equal(stop.status, 0, stop.stderr);
  assert.equal(JSON.parse(stop.stdout).dispatch.status, "stopped");
  assert.equal(resume.status, 0, resume.stderr);
  assert.equal(JSON.parse(resume.stdout).dispatch.status, "dispatched");
  assert.equal(review.status, 0, review.stderr);
  assert.equal(JSON.parse(review.stdout).reviewerEvidence.decision, "approved");
  assert.equal(fs.existsSync(dispatchPath), true);
  assert.equal(fs.existsSync(reviewPath), true);
  assert.equal(JSON.parse(fs.readFileSync(dispatchPath, "utf8")).workerOutput, null);
  assert.equal(JSON.parse(fs.readFileSync(reviewPath, "utf8")).reviewer, "reviewer-b");

  // Loop contract status assertions
  const dispatchPayload = JSON.parse(dispatch.stdout);
  assert.equal(dispatchPayload.dispatch.loop.contractId, "daily-harness-triage");
  assert.equal(dispatchPayload.dispatch.loop.hardStopStatus, "within-limits");
  assert.equal(dispatchPayload.dispatch.loop.budgetStatus, "within-budget");
  assert.equal(dispatchPayload.dispatch.loop.reviewBandwidthStatus, "available");
  assert.equal(dispatchPayload.dispatch.loop.reviewGateStatus, "pending");

  const reviewPayload = JSON.parse(review.stdout);
  const dispatchData = JSON.parse(fs.readFileSync(dispatchPath, "utf8"));
  assert.equal(dispatchData.loop.reviewGateStatus, "satisfied");
});

