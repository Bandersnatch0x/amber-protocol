"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { startSession, verifySession, approveSession } = require("../scripts/lib/session-commands");
const { verifyLedgerSession } = require("../scripts/lib/session-commands");

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-sl-"));
  execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
  fs.writeFileSync(path.join(dir, ".gitignore"), ".amber/\n");
  fs.writeFileSync(path.join(dir, "x.txt"), "hi");
  execSync("git add -A && git commit -qm init", { cwd: dir });
  return dir;
}

async function start(projectRoot) {
  return startSession(projectRoot, { goal: "add login feature", route: "feature-standard" });
}

test("verifySession mirrors a tamper-evident record into the session ledger", async () => {
  const dir = tmpRepo();
  const s = await start(dir);
  await verifySession(dir, { sessionId: s.sessionId, command: "npm test", result: "pass" });
  const lp = path.join(dir, ".amber", "sessions", s.sessionId, "ledger.jsonl");
  assert.ok(fs.existsSync(lp), "session ledger created");
  const recs = fs.readFileSync(lp, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].kind, "stage_completed");
  assert.ok(recs[0].hash);
  assert.equal(recs[0].prevHash, "0".repeat(64));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("approveSession appends a gate_passed ledger record; chain stays valid", async () => {
  const dir = tmpRepo();
  const s = await start(dir);
  await verifySession(dir, { sessionId: s.sessionId, command: "npm test", result: "pass" });
  await approveSession(dir, { sessionId: s.sessionId, gate: "user-approval-plan" });
  const lp = path.join(dir, ".amber", "sessions", s.sessionId, "ledger.jsonl");
  const recs = fs.readFileSync(lp, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(recs.length, 2);
  assert.equal(recs[1].kind, "gate_passed");
  assert.equal(recs[1].prevHash, recs[0].hash);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("verifyLedgerSession reports intact on a healthy session ledger", async () => {
  const dir = tmpRepo();
  const s = await start(dir);
  await verifySession(dir, { sessionId: s.sessionId, command: "npm test", result: "pass" });
  const r = verifyLedgerSession(dir, s.sessionId);
  assert.equal(r.exitCode, 0);
  assert.match(r.text, /intact/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("tampering a session ledger line is detected by verifyLedgerSession", async () => {
  const dir = tmpRepo();
  const s = await start(dir);
  await verifySession(dir, { sessionId: s.sessionId, command: "npm test", result: "pass" });
  const lp = path.join(dir, ".amber", "sessions", s.sessionId, "ledger.jsonl");
  const lines = fs.readFileSync(lp, "utf8").trim().split("\n");
  const r0 = JSON.parse(lines[0]);
  r0.data = r0.data || {};
  r0.data.result = "fail"; // tamper
  lines[0] = JSON.stringify(r0);
  fs.writeFileSync(lp, lines.join("\n") + "\n");
  const v = verifyLedgerSession(dir, s.sessionId);
  assert.equal(v.exitCode, 1);
  assert.ok(v.text.includes("AMBER_E_LEDGER_TAMPERED"), v.text);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("verifyLedgerSession on a session with no ledger reports an error", async () => {
  const dir = tmpRepo();
  const s = await start(dir);
  const r = verifyLedgerSession(dir, s.sessionId);
  assert.equal(r.exitCode, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
