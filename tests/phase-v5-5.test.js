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
  return fs.mkdtempSync(path.join(os.tmpdir(), `amber-v5-5-${name}-`));
}

function runHarness(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8"
  });
}

function initializedTeamTarget(name) {
  const target = tempDir(name);
  assert.equal(runHarness(["init", "--target", target]).status, 0);
  assert.equal(
    runHarness(["team", "install", "--target", target, "--version", "1.0.0", "--preset", "safe-bootstrap"]).status,
    0
  );
  return target;
}

test("maintenance inspect detects stale docs upgrade guidance and rule-pack drift", () => {
  const target = initializedTeamTarget("inspect");
  const overviewPath = path.join(target, "docs", "wiki", "product", "overview.md");
  fs.writeFileSync(overviewPath, "# Overview\n\nLast Reviewed: 2020-01-01\n\nOld product context.\n");
  const lockPath = path.join(target, ".amber", "team", "lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  lock.rulePacks = ["custom.rule-pack.json"];
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const result = runHarness(["maintenance", "inspect", "--target", target, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.readOnly, true);
  assert.ok(payload.staleDocs.some((doc) => doc.path === "docs/wiki/product/overview.md"));
  assert.match(payload.wikiLint.ciCommand, /amber\.js wiki/);
  assert.equal(payload.rulePackDrift.drifted, true);
  assert.deepEqual(payload.rulePackDrift.actual, ["custom.rule-pack.json"]);
  assert.equal(payload.upgradeAssistant.currentVersion, "1.0.0");
  assert.equal(payload.upgradeAssistant.latestVersion, "1.1.0");
  assert.match(payload.upgradeAssistant.previewCommand, /team update .*--dry-run/);
});

test("maintenance inspect recommends a dry-run team install before writing local state", () => {
  const target = tempDir("uninstalled");

  const result = runHarness(["maintenance", "inspect", "--target", target, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.migrationAssistant.needed, true);
  assert.match(payload.migrationAssistant.nextCommand, /team install .*--dry-run --json/);
  assert.match(payload.upgradeAssistant.installCommand, /team install .*--dry-run --json/);
});

test("maintenance inspect reports an invalid team registry without running registry assistants", () => {
  const target = tempDir("invalid-registry");
  const registryPath = path.join(target, "team-registry.json");
  fs.writeFileSync(registryPath, "{}\n");

  const result = runHarness([
    "maintenance",
    "inspect",
    "--target",
    target,
    "--registry",
    registryPath,
    "--json"
  ]);

  assert.equal(result.status, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.ok(payload.errors.includes("Team registry must define versions."));
  assert.deepEqual(payload.rulePackDrift, {
    available: false,
    reason: "team registry validation failed",
    installed: false,
    drifted: false,
    expected: [],
    actual: []
  });
  assert.equal(payload.migrationAssistant.available, false);
  assert.equal(payload.migrationAssistant.nextCommand, null);
  assert.equal(payload.upgradeAssistant.available, false);
  assert.equal(payload.upgradeAssistant.latestVersion, null);
  assert.doesNotMatch(result.stderr, /TypeError/);

  const install = runHarness([
    "team",
    "install",
    "--target",
    target,
    "--registry",
    registryPath,
    "--version",
    "1.0.0",
    "--preset",
    "safe-bootstrap",
    "--dry-run",
    "--json"
  ]);
  assert.equal(install.status, 1, install.stderr);
  const installPayload = JSON.parse(install.stdout);
  assert.ok(installPayload.errors.includes("Team registry must define versions."));
  assert.doesNotMatch(`${install.stdout}\n${install.stderr}`, /TypeError|Cannot read properties/);
});

test("team install rejects nested-malformed registry entries without TypeError", () => {
  const target = tempDir("nested-malformed-registry");
  const registryPath = path.join(target, "team-registry.json");
  fs.writeFileSync(
    registryPath,
    `${JSON.stringify({
      name: "amber-protocol-team-registry",
      presets: [null],
      rulePacks: [{ id: "amber-delivery" }],
      profiles: [{ id: "default" }],
      versions: {
        "1.0.0": {
          preset: "safe-bootstrap",
          profile: "default",
          workflowPacks: [],
          rulePacks: [],
          managedProjectFiles: [],
          compatibility: {}
        }
      }
    })}\n`
  );

  const result = runHarness([
    "team",
    "install",
    "--target",
    target,
    "--registry",
    registryPath,
    "--version",
    "1.0.0",
    "--preset",
    "safe-bootstrap",
    "--dry-run",
    "--json"
  ]);

  assert.equal(result.status, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.ok(payload.errors.includes("Team registry presets[0] must be an object."));
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /TypeError|Cannot read properties/);
});

test("maintenance propose writes reviewable gardening proposal without changing source docs", () => {
  const target = initializedTeamTarget("propose");
  const evolutionPath = path.join(target, "docs", "wiki", "engineering", "harness-evolution.md");
  fs.mkdirSync(path.dirname(evolutionPath), { recursive: true });
  fs.writeFileSync(
    evolutionPath,
    [
      "# Harness Evolution",
      "",
      "- Finding: Missing rollback evidence",
      "- Finding: Missing rollback evidence",
      "- Finding: Unclear reviewer gate",
      ""
    ].join("\n")
  );
  const overviewPath = path.join(target, "docs", "wiki", "product", "overview.md");
  const beforeOverview = fs.readFileSync(overviewPath, "utf8");

  // Add trace-derived evidence
  const executionPath = path.join(target, ".amber", "executions", "trace-failure");
  fs.mkdirSync(executionPath, { recursive: true });
  fs.writeFileSync(path.join(executionPath, "evidence.json"), JSON.stringify({
    taskId: "trace-failure",
    plan: "docs/plans/F001-trace-failure.md",
    evidence: [],
    requiredForReplay: ["ledger.json", "evidence.json", "replay.md"],
    chatHistoryRequired: false,
    traceReplay: {
      traceInput: "fixtures/traces/failing-input.json",
      agentConfig: "crm-agent-v2",
      exactReplayRequired: true
    },
    regressionProposal: {
      assertion: "The response must include specific deal details, not just a count",
      status: "proposed",
      modifiesTests: false,
      approvalRequired: true
    }
  }, null, 2));

  const inspect = runHarness(["maintenance", "inspect", "--target", target, "--json"]);
  assert.equal(inspect.status, 0, inspect.stderr);
  const inspectPayload = JSON.parse(inspect.stdout);
  assert.ok(inspectPayload.regressionProposals.some((proposal) => proposal.taskId === "trace-failure"));

  const result = runHarness(["maintenance", "propose", "--target", target, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.reviewable, true);
  assert.equal(payload.sourceFilesChanged, false);
  const proposalPath = path.join(target, payload.proposalPath);
  assert.equal(fs.existsSync(proposalPath), true);
  const proposal = fs.readFileSync(proposalPath, "utf8");
  assert.match(proposal, /Missing rollback evidence/);
  assert.match(proposal, /Suggested Standards Diff/);
  assert.match(proposal, /Regression Proposals/);
  assert.match(proposal, /trace-failure/);
  assert.match(proposal, /The response must include specific deal details/);
  assert.equal(fs.readFileSync(overviewPath, "utf8"), beforeOverview);
  assert.equal(fs.existsSync(path.join(target, "tests", "trace-failure.test.js")), false);
});
