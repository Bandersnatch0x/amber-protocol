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
  return fs.mkdtempSync(path.join(os.tmpdir(), `coding-harness-v5-5-${name}-`));
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
  const lockPath = path.join(target, ".harness", "team", "lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  lock.rulePacks = ["custom.rule-pack.json"];
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const result = runHarness(["maintenance", "inspect", "--target", target, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.readOnly, true);
  assert.ok(payload.staleDocs.some((doc) => doc.path === "docs/wiki/product/overview.md"));
  assert.match(payload.wikiLint.ciCommand, /harness\.js wiki/);
  assert.equal(payload.rulePackDrift.drifted, true);
  assert.deepEqual(payload.rulePackDrift.actual, ["custom.rule-pack.json"]);
  assert.equal(payload.upgradeAssistant.currentVersion, "1.0.0");
  assert.equal(payload.upgradeAssistant.latestVersion, "1.1.0");
  assert.match(payload.upgradeAssistant.previewCommand, /team update .*--dry-run/);
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
  assert.equal(fs.readFileSync(overviewPath, "utf8"), beforeOverview);
});
