"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { scaffoldHarness, validateHandoff } = require("../scripts/lib/amber-core");

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `coding-harness-handoff-${name}-`));
}

test("scaffolded handoff file is valid", () => {
  const target = tempDir("valid");
  scaffoldHarness(target);

  const result = validateHandoff(target);

  assert.deepEqual(result.errors, []);
});

test("handoff validator reports missing handoff file", () => {
  const target = tempDir("missing");

  const result = validateHandoff(target);

  assert.ok(result.errors.some((error) => /session-handoff\.md is missing/.test(error)));
});

test("handoff validator requires V1 handoff sections", () => {
  const target = tempDir("incomplete");
  fs.writeFileSync(path.join(target, "session-handoff.md"), "# Session Handoff\n\nNo useful sections yet.\n");

  const result = validateHandoff(target);

  assert.ok(result.errors.some((error) => /Summary/.test(error)));
  assert.ok(result.errors.some((error) => /Repo State/.test(error)));
  assert.ok(result.errors.some((error) => /Runtime \/ Verification State/.test(error)));
  assert.ok(result.errors.some((error) => /Feature State/.test(error)));
  assert.ok(result.errors.some((error) => /Verification Evidence/.test(error)));
  assert.ok(result.errors.some((error) => /Blockers/.test(error)));
  assert.ok(result.errors.some((error) => /Next Actions/.test(error)));
});
