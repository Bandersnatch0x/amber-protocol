const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

describe("autonomous session E2E", () => {
  const testRoot = path.join(__dirname, "../fixtures/e2e-autonomous");

  beforeEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
    fs.mkdirSync(testRoot, { recursive: true });

    // Copy routes so session start can find them
    const routesSrc = path.join(ROOT, "routes");
    const routesDest = path.join(testRoot, "routes");
    fs.mkdirSync(routesDest, { recursive: true });
    for (const f of fs.readdirSync(routesSrc)) {
      fs.copyFileSync(path.join(routesSrc, f), path.join(routesDest, f));
    }
  });

  afterEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
  });

  it("should start an autonomous session", () => {
    const start = spawnSync(process.execPath, [
      path.join(ROOT, "scripts/harness.js"),
      "session", "start",
      "--goal", "implement test feature",
      "--mode", "autonomous",
      "--json"
    ], { cwd: testRoot, encoding: "utf8", timeout: 15000 });

    assert.strictEqual(start.status, 0, `start failed: ${start.stderr}`);

    const startResult = JSON.parse(start.stdout);
    assert.ok(startResult.sessionId);
    assert.ok(startResult.text.includes("Mode: autonomous"));
  });

  it("should store autonomous mode in manifest", () => {
    const start = spawnSync(process.execPath, [
      path.join(ROOT, "scripts/harness.js"),
      "session", "start",
      "--goal", "implement test feature",
      "--mode", "autonomous",
      "--json"
    ], { cwd: testRoot, encoding: "utf8", timeout: 15000 });

    const startResult = JSON.parse(start.stdout);
    const manifestPath = path.join(testRoot, ".amber", "sessions", startResult.sessionId, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    assert.strictEqual(manifest.mode, "autonomous");
    assert.strictEqual(manifest.sessionId, startResult.sessionId);
  });
});
