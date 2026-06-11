"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");
const TEMP_ROOT = path.join(ROOT, "tests", ".tmp", "loop-readiness");

process.on("exit", () => {
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
});

function tempDir(name) {
  fs.mkdirSync(TEMP_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TEMP_ROOT, `${name}-`));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function runHarness(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8"
  });
}

test("pack readiness reports missing future-loop controls without executing anything", () => {
  const dir = tempDir("missing-controls");
  const pack = path.join(dir, "pack.json");
  writeJson(pack, {
    id: "unsafe-loop-pack",
    title: "Unsafe Loop Pack",
    version: "0.1.0",
    skills: [],
    standards: [],
    scripts: {},
    externalIntegrations: [],
    approvalGates: [],
    steps: [
      {
        id: "inspect",
        title: "Inspect",
        kind: "manual",
        description: "Inspect only"
      }
    ],
    loopContracts: [
      {
        id: "daily-triage",
        goal: "Review incoming signals",
        owner: "maintainers",
        trigger: { type: "scheduled", cadence: "daily" },
        inputSources: ["docs/signals.md"],
        stateSpine: ".harness/loops/daily-triage/state.json",
        inputs: ["docs/signals.md"],
        triageOutputs: ["candidate-task"],
        connectors: ["github"],
        hardStops: { maxIterations: 3, noProgressDetection: true },
        budget: { maxMinutes: 30 },
        reviewGates: ["human-review"],
        execution: { executesAnything: false, schedulesJobs: false }
      }
    ]
  });

  const result = runHarness(["pack", "readiness", "--file", pack, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.readiness.readyForLiveScheduling, false);
  assert.deepEqual(payload.readiness.allowedNow, ["describe", "validate", "dry-run", "record"]);
  assert.match(payload.readiness.blockers.join("\n"), /connector contract github/);
  assert.match(payload.readiness.blockers.join("\n"), /approval policy/);
  assert.match(payload.readiness.blockers.join("\n"), /execution ledger/);
  assert.match(payload.readiness.blockers.join("\n"), /workspace isolation/);
  assert.equal(payload.execution.executesAnything, false);
  assert.equal(payload.execution.schedulesJobs, false);
});

test("pack readiness passes only as dry-run-ready when all controls are declared", () => {
  const pack = path.join(ROOT, "workflow-packs", "safe-amber-bootstrap.pack.json");
  const result = runHarness(["pack", "readiness", "--file", pack, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.readiness.readyForLiveScheduling, false);
  assert.equal(payload.readiness.readyForDryRun, true);
  assert.equal(payload.readiness.readyForRecordOnly, true);
  assert.deepEqual(payload.readiness.blockers, ["live scheduling is disabled by product boundary"]);
  assert.ok(payload.readiness.controls.includes("loop contract"));
  assert.ok(payload.readiness.controls.includes("connector contracts"));
  assert.ok(payload.readiness.controls.includes("approval policy"));
  assert.ok(payload.readiness.controls.includes("execution ledger"));
  assert.ok(payload.readiness.controls.includes("workspace isolation"));
  assert.ok(payload.readiness.controls.includes("no-progress detection"));
  assert.ok(payload.readiness.controls.includes("reviewer gate"));
});

test("loop run only writes a dry-run ledger preview", () => {
  const dir = tempDir("loop-dry-run");
  const ledger = path.join(dir, "ledger-preview.json");
  const pack = path.join(ROOT, "workflow-packs", "safe-amber-bootstrap.pack.json");

  const result = runHarness([
    "loop",
    "run",
    "--file",
    pack,
    "--contract",
    "daily-amber-triage",
    "--dry-run",
    "--output",
    ledger,
    "--json"
  ]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.mode, "dry-run");
  assert.equal(payload.executesAnything, false);
  assert.equal(payload.schedulesJobs, false);
  assert.equal(payload.ledgerPreview.contractId, "daily-amber-triage");
  assert.equal(payload.ledgerPreview.stopReason, "dry-run-only");
  assert.equal(fs.existsSync(ledger), true);
});

test("loop run refuses non-dry-run execution", () => {
  const pack = path.join(ROOT, "workflow-packs", "safe-amber-bootstrap.pack.json");
  const result = runHarness(["loop", "run", "--file", pack, "--contract", "daily-amber-triage", "--json"]);

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.errors.join("\n"), /requires --dry-run/);
});

test("loop record stores manual loop evidence and loop status can inspect it", () => {
  const dir = tempDir("loop-record");
  const ledger = path.join(dir, "manual-ledger.json");
  const pack = path.join(ROOT, "workflow-packs", "safe-amber-bootstrap.pack.json");

  const recordResult = runHarness([
    "loop",
    "record",
    "--file",
    pack,
    "--contract",
    "daily-amber-triage",
    "--trigger-source",
    "manual",
    "--stop-reason",
    "reviewer-gate-required",
    "--output",
    ledger,
    "--json"
  ]);

  assert.equal(recordResult.status, 0, recordResult.stderr);
  const recorded = JSON.parse(recordResult.stdout);
  assert.equal(recorded.record.contractId, "daily-amber-triage");
  assert.equal(recorded.record.approvalState, "pending-review");
  assert.equal(recorded.record.reviewerOutcome, "not-reviewed");

  const statusResult = runHarness(["loop", "status", "--ledger", ledger, "--json"]);
  assert.equal(statusResult.status, 0, statusResult.stderr);
  const status = JSON.parse(statusResult.stdout);
  assert.equal(status.record.stopReason, "reviewer-gate-required");
  assert.equal(status.record.executesAnything, false);
});

test("loop inspect explains contract readiness without writing a ledger", () => {
  const pack = path.join(ROOT, "workflow-packs", "safe-amber-bootstrap.pack.json");
  const result = runHarness(["loop", "inspect", "--file", pack, "--contract", "daily-amber-triage", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.contract.id, "daily-amber-triage");
  assert.equal(payload.readiness.readyForLiveScheduling, false);
  assert.equal(payload.execution.executesAnything, false);
});
