"use strict";
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
