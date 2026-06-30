"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { inspectGovernanceReadiness } = require("../../scripts/lib/core/governance-readiness");
const { appendLedgerRecord } = require("../../scripts/lib/core/loop-ledger");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "amber-rdglx-"));
}

function findingIds(result) {
  return new Set(result.findings.map((f) => f.id));
}

test("readiness warns when governance rules.json is missing", () => {
  const dir = tmpDir();
  const r = inspectGovernanceReadiness(dir);
  assert.ok(findingIds(r).has("missing-governance-rules"), "missing-governance-rules finding");
  assert.notEqual(r.decision, "ready");
  assert.ok(r.nextActions.some((a) => a.includes("governance rules init")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("readiness blocks when rules.json has unsafe defaultAction=allow", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, ".amber", "governance"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".amber", "governance", "rules.json"),
    JSON.stringify({ schemaVersion: 1, defaultAction: "allow", rules: [] }));
  const r = inspectGovernanceReadiness(dir);
  assert.equal(r.decision, "block");
  assert.ok(findingIds(r).has("unsafe-default-allow"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("readiness blocks when any hash-chain ledger is tampered", () => {
  const dir = tmpDir();
  // safe rules.json so the only blocker is the tampered ledger
  fs.mkdirSync(path.join(dir, ".amber", "governance"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".amber", "governance", "rules.json"),
    JSON.stringify({ schemaVersion: 1, defaultAction: "deny", rules: [
      { id: "d", action: "deny", match: "regex", pattern: "rm" }] }));
  // a tampered loop ledger
  fs.mkdirSync(path.join(dir, ".amber", "loops", "c1"), { recursive: true });
  const lp = path.join(dir, ".amber", "loops", "c1", "ledger.jsonl");
  appendLedgerRecord(lp, { kind: "approved", approvalKey: "k1" });
  const lines = fs.readFileSync(lp, "utf8").trim().split("\n");
  const r0 = JSON.parse(lines[0]);
  r0.kind = "tampered";
  lines[0] = JSON.stringify(r0);
  fs.writeFileSync(lp, lines.join("\n") + "\n");
  const r = inspectGovernanceReadiness(dir);
  assert.equal(r.decision, "block");
  assert.ok(findingIds(r).has("ledger-tampered"), "ledger-tampered finding");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("readiness is quiet on a healthy GLX setup (safe rules, intact ledger)", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, ".amber", "governance"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".amber", "governance", "rules.json"),
    JSON.stringify({ schemaVersion: 1, defaultAction: "deny", rules: [
      { id: "d", action: "deny", match: "regex", pattern: "rm" },
      { id: "a", action: "allow", match: "prefix", pattern: "node " }] }));
  fs.mkdirSync(path.join(dir, ".amber", "loops", "c1"), { recursive: true });
  appendLedgerRecord(path.join(dir, ".amber", "loops", "c1", "ledger.jsonl"), { kind: "approved", approvalKey: "k1" });
  const r = inspectGovernanceReadiness(dir);
  const glxIds = ["missing-governance-rules", "unsafe-default-allow", "ledger-tampered"];
  for (const id of glxIds) assert.ok(!findingIds(r).has(id), `${id} should NOT be present on healthy GLX`);
  fs.rmSync(dir, { recursive: true, force: true });
});
