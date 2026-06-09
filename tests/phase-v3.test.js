"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "harness.js");

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `coding-harness-v3-${name}-`));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function runHarness(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8"
  });
}

function validPack(overrides = {}) {
  return {
    id: "example-pack",
    title: "Example Pack",
    version: "0.1.0",
    skills: [],
    standards: ["harness-delivery"],
    externalIntegrations: [],
    steps: [
      {
        id: "inspect",
        title: "Inspect",
        kind: "manual",
        description: "Inspect only."
      }
    ],
    ...overrides
  };
}

test("pack inspect and profile inspect explain declarations without execution", () => {
  const pack = path.join(ROOT, "workflow-packs", "safe-harness-bootstrap.pack.json");
  const profile = path.join(ROOT, "profiles", "default.profile.json");

  const packResult = runHarness(["pack", "inspect", "--file", pack, "--json"]);
  const profileResult = runHarness(["profile", "inspect", "--file", profile, "--json"]);

  assert.equal(packResult.status, 0, packResult.stderr);
  assert.equal(profileResult.status, 0, profileResult.stderr);
  const packPayload = JSON.parse(packResult.stdout);
  const profilePayload = JSON.parse(profileResult.stdout);
  assert.equal(packPayload.execution.executesAnything, false);
  assert.match(packPayload.dryRun.summary, /without dispatching workers/);
  assert.ok(profilePayload.profile.packIds.includes("safe-harness-bootstrap"));
});

test("pack validate catches missing skills, broken standards, unsafe scripts, and undeclared integrations", () => {
  const root = tempDir("bad-pack");
  const file = path.join(root, "bad.pack.json");
  writeJson(
    file,
    validPack({
      skills: ["missing-skill"],
      standards: ["missing-standard"],
      steps: [
        {
          id: "unsafe",
          title: "Unsafe",
          kind: "command",
          command: "npm test",
          externalIntegration: "github"
        }
      ]
    })
  );

  const result = runHarness(["pack", "validate", "--file", file, "--json"]);

  assert.notEqual(result.status, 0);
  const errors = JSON.parse(result.stdout).errors.join("\n");
  assert.match(errors, /skills\/missing-skill\/SKILL\.md/);
  assert.match(errors, /missing-standard/);
  assert.match(errors, /must not declare executable scripts/);
  assert.match(errors, /undeclared external integration github/);
});

