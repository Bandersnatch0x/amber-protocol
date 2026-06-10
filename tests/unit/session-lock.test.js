const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { acquireLock, releaseLock, isLocked } = require("../../scripts/lib/session-lock");

describe("session-lock", () => {
  const testRoot = path.join(__dirname, "../fixtures/lock-test");
  const sessionId = "test-session";

  beforeEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
    fs.mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
  });

  it("should acquire lock successfully", () => {
    const result = acquireLock(testRoot, sessionId);
    assert.strictEqual(result.success, true);
    assert.ok(isLocked(testRoot, sessionId));
  });

  it("should fail to acquire when already locked", () => {
    acquireLock(testRoot, sessionId);
    const result = acquireLock(testRoot, sessionId);
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes("locked"));
  });

  it("should release lock", () => {
    acquireLock(testRoot, sessionId);
    releaseLock(testRoot, sessionId);
    assert.strictEqual(isLocked(testRoot, sessionId), false);
  });

  it("should not be locked after release", () => {
    acquireLock(testRoot, sessionId);
    releaseLock(testRoot, sessionId);
    const result = acquireLock(testRoot, sessionId);
    assert.strictEqual(result.success, true);
  });
});
