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
  return fs.mkdtempSync(path.join(os.tmpdir(), `coding-harness-v5-${name}-`));
}

function runHarness(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8"
  });
}

test("team inspect exposes registry metadata and compatibility matrix", () => {
  const target = tempDir("inspect");

  const result = runHarness(["team", "inspect", "--target", target, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.installed, false);
  assert.equal(payload.registry.name, "amber-protocol-team-registry");
  assert.ok(payload.registry.versions["1.0.0"]);
  assert.ok(payload.registry.versions["1.1.0"]);
  assert.deepEqual(payload.registry.presets.map((preset) => preset.id), ["safe-bootstrap"]);
  assert.deepEqual(payload.registry.rulePacks.map((pack) => pack.id), ["harness-delivery"]);
  assert.equal(payload.compatibilityMatrix.codex.minimum, "0.0.0");
  assert.ok(payload.compatibilityMatrix.os.includes("windows"));
});

test("team install update rollback and pin preserve target customizations", () => {
  const target = tempDir("flows");
  const readmePath = path.join(target, "README.md");
  fs.writeFileSync(readmePath, "custom project readme\n");

  const install = runHarness([
    "team",
    "install",
    "--target",
    target,
    "--version",
    "1.0.0",
    "--preset",
    "safe-bootstrap",
    "--json"
  ]);
  assert.equal(install.status, 0, install.stderr);
  assert.equal(JSON.parse(install.stdout).lock.installedVersion, "1.0.0");

  const lockPath = path.join(target, ".amber", "team", "lock.json");
  const lockBeforePreview = fs.readFileSync(lockPath, "utf8");
  const preview = runHarness(["team", "update", "--target", target, "--version", "1.1.0", "--dry-run", "--json"]);
  assert.equal(preview.status, 0, preview.stderr);
  const previewPayload = JSON.parse(preview.stdout);
  assert.equal(previewPayload.preview.willWrite, false);
  assert.equal(previewPayload.preview.customizationsPreserved, true);
  assert.deepEqual(previewPayload.preview.projectFileWrites, []);
  assert.ok(previewPayload.preview.changedArtifacts.includes("workflow-packs/safe-harness-bootstrap.pack.json"));
  assert.equal(fs.readFileSync(lockPath, "utf8"), lockBeforePreview);

  const blockedUpdate = runHarness(["team", "update", "--target", target, "--version", "1.1.0", "--json"]);
  assert.notEqual(blockedUpdate.status, 0);
  assert.match(JSON.parse(blockedUpdate.stdout).errors.join("\n"), /requires --dry-run or --confirm/);

  const update = runHarness(["team", "update", "--target", target, "--version", "1.1.0", "--confirm", "--json"]);
  assert.equal(update.status, 0, update.stderr);
  assert.equal(JSON.parse(update.stdout).lock.installedVersion, "1.1.0");
  assert.equal(fs.existsSync(path.join(target, ".amber", "team", "snapshots", "1.1.0.json")), true);

  const rollback = runHarness(["team", "rollback", "--target", target, "--version", "1.0.0", "--confirm", "--json"]);
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.equal(JSON.parse(rollback.stdout).lock.installedVersion, "1.0.0");
  assert.equal(JSON.parse(rollback.stdout).previousVersion, "1.1.0");

  const pin = runHarness(["team", "pin", "--target", target, "--version", "1.0.0", "--json"]);
  assert.equal(pin.status, 0, pin.stderr);
  assert.equal(JSON.parse(pin.stdout).lock.pinnedVersion, "1.0.0");

  assert.equal(fs.readFileSync(readmePath, "utf8"), "custom project readme\n");
  assert.equal(fs.existsSync(path.join(target, "AGENTS.md")), false);
});

