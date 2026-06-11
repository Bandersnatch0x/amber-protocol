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
  for (const command of ["wiki", "handoff", "doctor"]) {
    const target = copyFixture("broken-harness");
    const result = runScript("harness.js", [command, "--target", target, "--json"]);

    assert.notEqual(result.status, 0, `${command} unexpectedly passed`);
    const payload = JSON.parse(result.stdout);
    assert.ok(Array.isArray(payload.errors), `${command} did not return errors array`);
    assert.ok(payload.errors.length > 0, `${command} returned empty errors array`);
  }
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
