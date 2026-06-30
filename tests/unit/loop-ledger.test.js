"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const L = require("../../scripts/lib/core/loop-ledger");

function tmpLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-led-"));
  return path.join(dir, "ledger.jsonl");
}

test("canonicalize is key-order independent and drops hash", () => {
  const a = L.canonicalize({ b: 1, a: 2, hash: "x" });
  const b = L.canonicalize({ a: 2, b: 1 });
  assert.equal(a, b);
});

test("append builds a continuous chain; verify is intact", () => {
  const p = tmpLedger();
  L.appendLedgerRecord(p, { kind: "approved", approvalKey: "ap1" });
  L.appendLedgerRecord(p, { kind: "executed", consumedApprovalKey: "ap1" });
  const recs = L.readLedger(p);
  assert.equal(recs.length, 2);
  assert.equal(recs[0].prevHash, "0".repeat(64));
  assert.equal(recs[1].prevHash, recs[0].hash);
  assert.equal(L.verifyLedgerChain(p).intact, true);
});

test("tampering a record body breaks verify at its index", () => {
  const p = tmpLedger();
  L.appendLedgerRecord(p, { kind: "approved", approvalKey: "ap1" });
  L.appendLedgerRecord(p, { kind: "executed", consumedApprovalKey: "ap1" });
  const lines = fs.readFileSync(p, "utf8").trim().split("\n");
  const r0 = JSON.parse(lines[0]);
  r0.kind = "tampered";
  lines[0] = JSON.stringify(r0);
  fs.writeFileSync(p, lines.join("\n") + "\n");
  const v = L.verifyLedgerChain(p);
  assert.equal(v.intact, false);
  assert.equal(v.brokenAt, 0);
});

test("latestUnconsumedApproval finds an approval not yet executed", () => {
  const p = tmpLedger();
  L.appendLedgerRecord(p, { kind: "approved", approvalKey: "ap1" });
  assert.equal(L.latestUnconsumedApproval(L.readLedger(p))?.approvalKey, "ap1");
  L.appendLedgerRecord(p, { kind: "executed", consumedApprovalKey: "ap1" });
  assert.equal(L.latestUnconsumedApproval(L.readLedger(p)), null);
});

test("empty / missing ledger verifies as intact with zero records", () => {
  const p = tmpLedger();
  const v = L.verifyLedgerChain(p);
  assert.equal(v.intact, true);
  assert.equal(v.records, 0);
});
