"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { approveLoopContract, executeLoopContract } = require("../scripts/lib/core/loop-execution");

function tmpGitRepoWithPack(governedCommand, rules) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-glx-"));
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email a@b.c", { cwd: dir });
  execSync("git config user.name t", { cwd: dir });
  fs.writeFileSync(path.join(dir, ".gitignore"), ".amber/\n"); // local state is git-ignored, as in real repos
  fs.writeFileSync(path.join(dir, "x.txt"), "hi");
  const pack = { id: "p", version: "1", loopContracts: [{
    id: "c1", trigger: { type: "manual", enabled: false }, cadence: "on-demand",
    stateSpine: ".amber/loops/c1/state.json", hardStops: { maxIterations: 1 },
    reviewGates: ["human-approval"],
    governed: { command: governedCommand, requiresApproval: true },
    execution: { executesAnything: false } }] };
  const packPath = path.join(dir, "pack.json");
  fs.writeFileSync(packPath, JSON.stringify(pack));
  execSync("git add -A", { cwd: dir });
  execSync("git commit -qm init", { cwd: dir });
  if (rules) {
    fs.mkdirSync(path.join(dir, ".amber", "governance"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".amber", "governance", "rules.json"), JSON.stringify(rules));
  }
  return { dir, packPath };
}

const ALLOW_NODE = {
  schemaVersion: 1, defaultAction: "deny",
  confidence_gating: {
    enabled: true,
    byRule: { "allow-node": "high" },
    defaultConfidence: "low",
  },
  rules: [{ id: "allow-node", action: "allow", match: "prefix", pattern: "node " }],
};

test("execute without an approval is blocked (gate 2)", () => {
  const { dir, packPath } = tmpGitRepoWithPack("node --version", ALLOW_NODE);
  const r = executeLoopContract({ file: packPath, contract: "c1", target: dir, execute: true });
  assert.ok(r.errors.join("\n").includes("AMBER_E_LOOP_NOT_APPROVED"), r.errors.join("\n"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("execute of a denied command is blocked by policy (gate 1, before approval)", () => {
  const { dir, packPath } = tmpGitRepoWithPack("rm -rf /tmp/whatever"); // DEFAULT_RULES denies
  approveLoopContract({ file: packPath, contract: "c1", target: dir, reviewer: "me" });
  const r = executeLoopContract({ file: packPath, contract: "c1", target: dir, execute: true });
  assert.ok(r.errors.join("\n").includes("AMBER_E_POLICY_DENY"), r.errors.join("\n"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("approved + allowed command executes, records ledger, main checkout stays clean", () => {
  const { dir, packPath } = tmpGitRepoWithPack("node --version", ALLOW_NODE);
  approveLoopContract({ file: packPath, contract: "c1", target: dir, reviewer: "me" });
  const r = executeLoopContract({ file: packPath, contract: "c1", target: dir, execute: true });
  assert.deepEqual(r.errors, [], JSON.stringify(r));
  assert.equal(r.executed, true);
  assert.equal(r.exitCode, 0);
  const status = execSync("git status --porcelain", { cwd: dir, encoding: "utf8" });
  assert.equal(status.trim(), "", "main checkout untouched");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a second execute is blocked — one approval, one execution (replay protection)", () => {
  const { dir, packPath } = tmpGitRepoWithPack("node --version", ALLOW_NODE);
  approveLoopContract({ file: packPath, contract: "c1", target: dir, reviewer: "me" });
  executeLoopContract({ file: packPath, contract: "c1", target: dir, execute: true });
  const second = executeLoopContract({ file: packPath, contract: "c1", target: dir, execute: true });
  assert.ok(second.errors.join("\n").includes("AMBER_E_LOOP_NOT_APPROVED"), second.errors.join("\n"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("no --execute falls through to dry-run (no execution)", () => {
  const { dir, packPath } = tmpGitRepoWithPack("node --version", ALLOW_NODE);
  const r = executeLoopContract({ file: packPath, contract: "c1", target: dir, dryRun: true });
  assert.equal(r.executed, undefined);
  assert.equal(r.mode, "dry-run");
  fs.rmSync(dir, { recursive: true, force: true });
});
