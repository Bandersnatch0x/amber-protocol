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
  assert.deepEqual(payload.ledgerPreview.inputSnapshot.sources, [
    "doctor report",
    "maintenance inspect",
    "recent evolution findings"
  ]);
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
  assert.equal(status.progress.state, "insufficient-history");
  assert.equal(status.history.source, "file");
  assert.equal(status.executesAnything, false);
  assert.equal(status.schedulesJobs, false);
  assert.equal(status.callsExternalSystems, false);
});

test("loop status reports bounded no-progress signals from a ledger directory", () => {
  const dir = tempDir("loop-history");
  const ledgerDir = path.join(dir, "history");
  const pack = path.join(ROOT, "workflow-packs", "safe-amber-bootstrap.pack.json");

  for (const name of ["01.json", "02.json"]) {
    const result = runHarness([
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
      path.join(ledgerDir, name),
      "--json"
    ]);
    assert.equal(result.status, 0, result.stderr);
  }

  const statusResult = runHarness(["loop", "status", "--ledger", ledgerDir, "--json"]);
  assert.equal(statusResult.status, 0, statusResult.stderr);
  const status = JSON.parse(statusResult.stdout);
  assert.equal(status.records.length, 2);
  assert.equal(status.history.source, "directory");
  assert.equal(status.history.loaded, 2);
  assert.equal(status.history.truncated, false);
  assert.equal(status.progress.state, "stalled");
  assert.ok(status.progress.signals.some((signal) => signal.id === "repeated-observation"));
  assert.ok(status.progress.signals.some((signal) => signal.id === "empty-evidence-delta"));
  assert.equal(status.executesAnything, false);
  assert.equal(status.schedulesJobs, false);
  assert.equal(status.callsExternalSystems, false);
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

test("loop recommend selects the safest continuous-improvement loop", () => {
  const result = runHarness([
    "loop",
    "recommend",
    "--target",
    ROOT,
    "--goal",
    "continuous improvement",
    "--json"
  ]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.selected.contractId, "daily-amber-triage");
  assert.equal(payload.selected.packId, "safe-amber-bootstrap");
  assert.match(payload.selected.nextCommand, /loop run/);
  assert.match(payload.selected.nextCommand, /--dry-run/);
  assert.equal(payload.executesAnything, false);
  assert.equal(payload.schedulesJobs, false);
  assert.equal(payload.callsExternalSystems, false);
  assert.ok(payload.candidates.length >= 4);
  assert.ok(
    payload.selected.reasons.some((reason) => reason.includes("daily cadence")),
    "expected recommendation to explain the maintenance cadence",
  );
});

test("loop recommend respects a security-specific goal", () => {
  const result = runHarness([
    "loop",
    "recommend",
    "--target",
    ROOT,
    "--goal",
    "security audit",
    "--json"
  ]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.selected.contractId, "scheduled-security-audit");
  assert.equal(payload.selected.packId, "security-audit");
  assert.ok(
    payload.selected.reasons.some((reason) => reason.includes("security")),
    "expected recommendation to explain the security goal match",
  );
});

test("loop recommend reports a missing workflow pack directory clearly", () => {
  const dir = tempDir("no-packs");
  const result = runHarness([
    "loop",
    "recommend",
    "--target",
    dir,
    "--json"
  ]);

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.errors.join("\n"), /No workflow pack files/);
  assert.match(payload.warnings.join("\n"), /No workflow-packs directory/);
  assert.equal(payload.selected, null);
});

test("loop recommend rejects a workflow-packs file instead of throwing", () => {
  const dir = tempDir("packs-file");
  fs.writeFileSync(path.join(dir, "workflow-packs"), "not a directory");
  const result = runHarness([
    "loop",
    "recommend",
    "--target",
    dir,
    "--json"
  ]);

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.errors.join("\n"), /No workflow pack files/);
  assert.match(payload.warnings.join("\n"), /not a directory/);
  assert.equal(payload.selected, null);
});

// Missing required path args previously produced a raw TypeError
// ("paths[0] must be of type string") or a cryptic EISDIR, AND exited 0 —
// reporting failure as success. Each must now give a clear message and exit 1.
test("loop/pack/profile commands reject a missing path arg clearly and exit non-zero", () => {
  const cases = [
    { args: ["pack", "inspect", "--json"], match: /specified|--file/ },
    { args: ["pack", "readiness", "--json"], match: /specified|--file/ },
    { args: ["profile", "inspect", "--json"], match: /specified|--file/ },
    { args: ["loop", "inspect", "--json"], match: /specified|--file/ },
    { args: ["loop", "record", "--json"], match: /specified|--file/ },
    { args: ["loop", "status", "--json"], match: /specified|--ledger/ },
  ];
  for (const { args, match } of cases) {
    const result = runHarness(args);
    assert.notEqual(result.status, 0, `expected non-zero exit for: ${args.join(" ")}`);
    const payload = JSON.parse(result.stdout);
    assert.match(
      payload.errors.join("\n"),
      match,
      `expected a clear missing-arg error for: ${args.join(" ")}`,
    );
    // The old raw failures leaked these into the message.
    assert.doesNotMatch(payload.errors.join("\n"), /paths\[0\]|EISDIR|TypeError/);
  }
});
