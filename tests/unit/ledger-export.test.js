"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const L = require("../../scripts/lib/core/loop-ledger");
const { exportLedger } = require("../../scripts/lib/core/ledger-export");

function mkStateWithLedger(home, sub, records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-exp-"));
  const ledgerDir = path.join(dir, ".amber", home, sub);
  fs.mkdirSync(ledgerDir, { recursive: true });
  const ledgerPath = path.join(ledgerDir, "ledger.jsonl");
  for (const r of records) L.appendLedgerRecord(ledgerPath, r);
  return dir;
}

test("json export serializes an intact ledger", () => {
  const dir = mkStateWithLedger("sessions", "S1", [{ kind: "approved", approvalKey: "a1" }]);
  const r = exportLedger(dir, { format: "json" });
  assert.strictEqual(r.brokenCount, 0);
  assert.strictEqual(r.intactCount, 1);
  const parsed = JSON.parse(r.payload);
  assert.strictEqual(parsed.ledgers[0].records[0].kind, "approved");
});

test("csv export has a header and one row per record", () => {
  const dir = mkStateWithLedger("loops", "daily", [
    { kind: "approved", approvalKey: "a1" },
    { kind: "executed", consumedApprovalKey: "a1" },
  ]);
  const r = exportLedger(dir, { format: "csv" });
  const rows = r.payload.split("\n");
  assert.match(rows[0], /ledger_home/);
  assert.strictEqual(rows.length, 3); // header + 2 records
});

test("otlp-json export is a valid resourceSpans document", () => {
  const dir = mkStateWithLedger("routes", "R1", [{ kind: "verification_passed" }]);
  const r = exportLedger(dir, { format: "otlp-json" });
  const parsed = JSON.parse(r.payload);
  assert.ok(Array.isArray(parsed.resourceSpans));
  assert.ok(parsed.resourceSpans[0].scopeSpans[0].spans.length >= 1);
});

test("broken chain: intact=false and brokenCount counts it", () => {
  const dir = mkStateWithLedger("sessions", "S2", [{ kind: "approved", approvalKey: "a1" }]);
  const ledgerPath = path.join(dir, ".amber", "sessions", "S2", "ledger.jsonl");
  const lines = fs.readFileSync(ledgerPath, "utf8").trim().split("\n");
  const rec = JSON.parse(lines[0]);
  rec.kind = "tampered"; // body change breaks the hash chain
  fs.writeFileSync(ledgerPath, JSON.stringify(rec) + "\n");
  const r = exportLedger(dir, { format: "json" });
  assert.strictEqual(r.brokenCount, 1);
  assert.strictEqual(r.ledgers[0].intact, false);
});

test("--home filter limits the walk", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-exp-"));
  const lp = path.join(dir, ".amber", "sessions", "S1", "ledger.jsonl");
  fs.mkdirSync(path.dirname(lp), { recursive: true });
  L.appendLedgerRecord(lp, { kind: "approved", approvalKey: "a1" });
  const lp2 = path.join(dir, ".amber", "loops", "daily", "ledger.jsonl");
  fs.mkdirSync(path.dirname(lp2), { recursive: true });
  L.appendLedgerRecord(lp2, { kind: "approved", approvalKey: "a2" });
  const r = exportLedger(dir, { format: "json", home: "sessions" });
  assert.strictEqual(r.ledgers.length, 1);
  assert.strictEqual(r.ledgers[0].home, "sessions");
});
