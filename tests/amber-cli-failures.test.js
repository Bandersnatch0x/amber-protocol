"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-fail-${name}-`));
}

function copyFixture(name) {
  const target = tempDir(name);
  fs.cpSync(path.join(__dirname, "fixtures", name), target, { recursive: true });
  return target;
}

function runScript(script, args) {
  return spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], {
    cwd: ROOT,
    encoding: "utf8"
  });
}

test("unified CLI validator commands return non-zero parseable JSON on failures", () => {
  // `handoff` is intentionally absent: since #22 it is a GENERATOR — it
  // regenerates session-handoff.md from live state (self-healing a broken
  // file) rather than validating it. Its validator counterpart is still
  // covered below via the standalone validate-handoff.js wrapper.
  for (const command of ["wiki", "doctor"]) {
    const target = copyFixture("broken-harness");
    const result = runScript("harness.js", [command, "--target", target, "--json"]);

    assert.notEqual(result.status, 0, `${command} unexpectedly passed`);
    const payload = JSON.parse(result.stdout);
    assert.ok(Array.isArray(payload.errors), `${command} did not return errors array`);
    assert.ok(payload.errors.length > 0, `${command} returned empty errors array`);
  }
});

test("handoff regenerates a valid session-handoff.md even from a broken fixture", () => {
  const target = copyFixture("broken-harness");
  const result = runScript("harness.js", ["handoff", "--target", target, "--json"]);

  assert.equal(result.status, 0, "handoff should self-heal, not fail");
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.errors, []);
  // The regenerated file now passes the handoff validator.
  const validated = runScript("validate-handoff.js", ["--target", target, "--json"]);
  assert.equal(validated.status, 0);
});

test("standalone validator wrappers return non-zero on broken fixtures", () => {
  const cases = [
    ["validate-feature-list.js", "broken-harness"],
    ["validate-wiki.js", "broken-harness"],
    ["validate-handoff.js", "broken-harness"]
  ];

  for (const [script, fixture] of cases) {
    const target = copyFixture(fixture);
    const result = runScript(script, ["--target", target, "--json"]);

    assert.notEqual(result.status, 0, `${script} unexpectedly passed`);
    const payload = JSON.parse(result.stdout);
    assert.ok(Array.isArray(payload.errors), `${script} did not return errors array`);
    assert.ok(payload.errors.length > 0, `${script} returned empty errors array`);
  }
});
