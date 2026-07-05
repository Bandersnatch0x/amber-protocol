"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("node:child_process");
const { runDrift, renderDrift } = require("../../scripts/lib/drift-command");

// Build a minimal harnessed git repo with .amber state dir (detectors need git + feature_list).
function mkHarnessRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-drift-"));
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email t@t.t && git config user.name t", { cwd: dir });
  fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
  // feature_list with one drifted feature: evidence dated before the commit.
  fs.writeFileSync(
    path.join(dir, "feature_list.json"),
    JSON.stringify({ features: [{ id: "F1", title: "t", paths: ["src/a"], evidence: [{ command: "c", result: "pass", date: "2020-01-01" }] }] }, null, 2),
  );
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/a"), "x");
  execSync("git add -A && git commit -q -m init", { cwd: dir });
  return dir;
}

test("runDrift aggregates and exits 1 when artifact drift exists", () => {
  const dir = mkHarnessRepo();
  const r = runDrift(dir);
  assert.strictEqual(r.available, true);
  assert.ok(r.totalDrifted >= 1, "artifact drift counted");
  assert.strictEqual(r.exitCode, 1);
});

test("--no-fail forces exitCode 0 even with drift", () => {
  const dir = mkHarnessRepo();
  const r = runDrift(dir, { noFail: true });
  assert.strictEqual(r.exitCode, 0);
  assert.ok(r.totalDrifted >= 1);
});

test("non-git repo: scopes unavailable, exitCode 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-drift-"));
  fs.writeFileSync(path.join(dir, "feature_list.json"), JSON.stringify({ features: [] }));
  const r = runDrift(dir);
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(r.totalDrifted, 0);
});

test("renderDrift default emits a Total drifted line", () => {
  const dir = mkHarnessRepo();
  const out = renderDrift(runDrift(dir));
  assert.match(out, /Total drifted:/);
});

test("renderDrift gh-annotations emits ::warning lines when artifact drift exists", () => {
  const dir = mkHarnessRepo();
  const out = renderDrift(runDrift(dir), { format: "gh-annotations" });
  assert.match(out, /::warning/);
});
