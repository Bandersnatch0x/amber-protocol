"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { HANDLERS } = require("../scripts/lib/command-dispatcher");

test("governance standards returns 10 ASI risks + an honest summary table", () => {
  const r = HANDLERS.governance({ _: ["standards"], target: ".", framework: "owasp-agentic" });
  assert.equal(r.result.risks.length, 10);
  assert.ok(r.result.summary);
  assert.ok(r.result.text.includes("out-of-scope"), "report shows out-of-scope rows");
  assert.ok(r.result.text.toLowerCase().includes("note:"), "report carries the honesty disclaimer");
});

test("unknown governance action lists the new standards subcommand", () => {
  const u = HANDLERS.governance({ _: ["bogus"], target: "." });
  assert.ok(u.result.errors.join(" ").includes("standards"));
});

test("governance standards init scaffolds security-governance.json via the dispatch route (#44)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-std-init-"));
  const stdPath = path.join(dir, "standards", "security-governance.json");
  // bare dir — standard is absent, so init must write it.
  const r = HANDLERS.governance({ _: ["standards", "init"], target: dir });
  assert.equal(r.result.skipped, false);
  assert.ok(fs.existsSync(stdPath), "standard written via governance standards init");
  // idempotent through the same route.
  const r2 = HANDLERS.governance({ _: ["standards", "init"], target: dir });
  assert.equal(r2.result.skipped, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
