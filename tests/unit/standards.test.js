"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { mapStandards } = require("../../scripts/lib/core/standards");

test("maps all 10 ASI risks with honest, valid coverage labels", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-std-"));
  const r = mapStandards(dir, "owasp-agentic");
  assert.equal(r.risks.length, 10);
  // a runtime-only risk must NEVER be marked covered
  assert.equal(r.risks.find((x) => x.id === "ASI01").amberCoverage, "out-of-scope");
  assert.ok(r.risks.every((x) => ["governance", "partial", "out-of-scope"].includes(x.amberCoverage)));
  // honest summary: more out-of-scope than covered (Amber is static)
  assert.ok(r.summary.outOfScope >= r.summary.governance + r.summary.partial - 6);
  assert.ok(r.disclaimer.toLowerCase().includes("not a certification") || r.disclaimer.toLowerCase().includes("self-assessment"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a rules.json with a deny rule marks ASI02 (not ASI04) present — control-specific", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-std-"));
  fs.mkdirSync(path.join(dir, ".amber", "governance"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".amber", "governance", "rules.json"),
    JSON.stringify({ rules: [{ id: "x", action: "deny", match: "regex", pattern: "rm", mapsTo: ["ASI04"] }] }),
  );
  const r = mapStandards(dir, "owasp-agentic");
  // A deny rule backs ASI02 (tool-misuse denial), NOT ASI04 (which needs an allow/pinning rule).
  assert.equal(r.risks.find((x) => x.id === "ASI02").present, true);
  assert.equal(r.risks.find((x) => x.id === "ASI04").present, false);
  assert.equal(r.risks.find((x) => x.id === "ASI01").present, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("unknown framework returns an error envelope, no throw", () => {
  const r = mapStandards(".", "bogus-framework");
  assert.ok(r.errors.length > 0);
  assert.equal(r.risks.length, 0);
});
