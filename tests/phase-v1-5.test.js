"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

const {
  classifyTarget,
  inspectProjectProfile,
  inspectWorkflowPack,
  scaffoldHarness
} = require("../scripts/lib/amber-core");

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `amber-v1-5-${name}-`));
}

function runHarness(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8"
  });
}

test("target classification distinguishes product, harnessed, and unharnessed repos", () => {
  const harnessed = tempDir("harnessed");
  const unharnessed = tempDir("unharnessed");
  scaffoldHarness(harnessed);

  assert.equal(classifyTarget(ROOT).type, "product-repo");
  assert.equal(classifyTarget(harnessed).type, "harnessed-target-repo");
  assert.equal(classifyTarget(unharnessed).type, "unharnessed-target-repo");
});

test("doctor reports product-repo status for this toolkit repository", () => {
  const result = runHarness(["doctor", "--target", ROOT, "--json"]);
  const humanResult = runHarness(["doctor", "--target", ROOT]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(humanResult.status, 0, humanResult.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.classification.type, "product-repo");
  assert.deepEqual(payload.errors, []);
  assert.match(humanResult.stdout, /Target type: product-repo/);
});

test("audit summary uses product-repo mode without root starter gaps", () => {
  const result = runHarness(["audit", "--target", ROOT, "--summary"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Target type: product-repo/);
  assert.match(result.stdout, /Template starter files: \d+\/\d+ in templates\//);
  assert.doesNotMatch(result.stdout, /Missing Amber starter files:/);
  assert.match(result.stdout, /Suggested additions: 0/);
  assert.match(result.stdout, /Conflicts: 0/);
});

test("sample workflow pack and profile can be inspected without execution", () => {
  const packPath = path.join(ROOT, "workflow-packs", "safe-amber-bootstrap.pack.json");
  const profilePath = path.join(ROOT, "profiles", "default.profile.json");

  const packResult = inspectWorkflowPack(packPath);
  const profileResult = inspectProjectProfile(profilePath);

  assert.deepEqual(packResult.errors, []);
  assert.equal(packResult.execution.executesAnything, false);
  assert.equal(packResult.pack.id, "safe-amber-bootstrap");
  assert.ok(packResult.pack.stepCount > 0);
  assert.deepEqual(profileResult.errors, []);
  assert.ok(profileResult.profile.packIds.includes("safe-amber-bootstrap"));
});
