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
  await approveSession(dir, { sessionId: s.sessionId, gate: "user-approval-plan", yes: true });
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

test("verify --execute runs an allowed command and marks the stage complete", async () => {
  const dir = tmpRepo();
  // Allow "node " commands so the evidence-runner policy gate passes.
  const gov = path.join(dir, ".amber", "governance");
  fs.mkdirSync(gov, { recursive: true });
  fs.writeFileSync(
    path.join(gov, "rules.json"),
    JSON.stringify({ schemaVersion: 1, defaultAction: "deny", rules: [{ id: "n", action: "allow", match: "prefix", pattern: "node " }] }),
  );
  const s = await start(dir);
  const r = await verifySession(dir, {
    sessionId: s.sessionId,
    execute: true,
    command: 'node -e "process.exit(0)"',
  });
  assert.equal(r.exitCode, 0);
  const tl = path.join(dir, ".amber", "sessions", s.sessionId, "timeline.jsonl");
  const events = fs.readFileSync(tl, "utf8").trim().split("\n").map(JSON.parse);
  const stage = events.find((e) => e.type === "stage_completed");
  assert.ok(stage, "stage_completed present");
  assert.equal(stage.data.executed, true);
  assert.equal(stage.data.exitCode, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("verify --execute on a failing command records verification_failed and does NOT complete the stage", async () => {
  const dir = tmpRepo();
  const gov = path.join(dir, ".amber", "governance");
  fs.mkdirSync(gov, { recursive: true });
  fs.writeFileSync(
    path.join(gov, "rules.json"),
    JSON.stringify({ schemaVersion: 1, defaultAction: "deny", rules: [{ id: "n", action: "allow", match: "prefix", pattern: "node " }] }),
  );
  const s = await start(dir);
  const r = await verifySession(dir, {
    sessionId: s.sessionId,
    execute: true,
    command: 'node -e "process.exit(1)"',
  });
  assert.equal(r.exitCode, 1);
  const tl = path.join(dir, ".amber", "sessions", s.sessionId, "timeline.jsonl");
  const events = fs.readFileSync(tl, "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(events.some((e) => e.type === "verification_failed"), "verification_failed present");
  assert.ok(!events.some((e) => e.type === "stage_completed"), "no stage_completed on failure");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("verify --execute with no command available errors", async () => {
  const dir = tmpRepo();
  const s = await start(dir);
  // feature-standard's verify stage declares "npm test", so pass an explicit empty
  // command by overriding the stage lookup: use a stage that has no target.
  const r = await verifySession(dir, { sessionId: s.sessionId, execute: true, stage: "nonexistent-stage" });
  assert.equal(r.exitCode, 1);
  assert.match(r.text, /--execute needs a command/);
  fs.rmSync(dir, { recursive: true, force: true });
});
