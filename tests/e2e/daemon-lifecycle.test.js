const { describe, it } = require("node:test");
const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

describe("daemon lifecycle E2E", () => {
  it("should report status correctly", () => {
    const status = spawnSync(process.execPath, [
      path.join(ROOT, "scripts/harness.js"),
      "daemon", "status"
    ], { cwd: ROOT, encoding: "utf8", timeout: 15000 });

    assert.ok(status.status === 0 || status.status === 1);
    assert.ok(status.stdout.includes("Daemon"), `Expected 'Daemon' in output, got: ${status.stdout}`);
  });

  it("should show 'not running' when no daemon", () => {
    const status = spawnSync(process.execPath, [
      path.join(ROOT, "scripts/harness.js"),
      "daemon", "status"
    ], { cwd: ROOT, encoding: "utf8", timeout: 15000 });

    assert.strictEqual(status.status, 1, "Expected exit code 1 when no daemon running");
    assert.ok(status.stdout.includes("not running"), `Expected 'not running', got: ${status.stdout}`);
  });
});
