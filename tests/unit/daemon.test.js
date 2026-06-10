const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { startDaemon, stopDaemon, getDaemonStatus } = require("../../scripts/lib/daemon");

describe("daemon", () => {
  const testRoot = path.join(__dirname, "../fixtures/daemon-test");

  beforeEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
    fs.mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
  });

  it("should write PID file on start", () => {
    const pidFile = path.join(testRoot, ".harness", "daemon.pid");
    const result = startDaemon(testRoot, "test-session", { test: true });
    assert.ok(result.success);
    assert.ok(fs.existsSync(pidFile));
  });

  it("should return daemon status", () => {
    const status = getDaemonStatus(testRoot);
    assert.ok(status.running !== undefined);
  });

  it("should stop and clean up PID file", () => {
    startDaemon(testRoot, "test-session", { test: true });
    const result = stopDaemon(testRoot, { test: true });
    assert.ok(result.success);
    const pidFile = path.join(testRoot, ".harness", "daemon.pid");
    assert.strictEqual(fs.existsSync(pidFile), false);
  });
});
