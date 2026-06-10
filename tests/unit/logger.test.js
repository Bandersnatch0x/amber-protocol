const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createLogger } = require("../../scripts/lib/logger");

describe("logger", () => {
  const testRoot = path.join(__dirname, "../fixtures/logger-test");
  const logPath = path.join(testRoot, "test.log");

  beforeEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
    fs.mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
  });

  it("should write JSON log entry", () => {
    const logger = createLogger(logPath);
    logger.info("test message", { key: "value" });
    logger.close();

    const content = fs.readFileSync(logPath, "utf8");
    const log = JSON.parse(content.trim().split("\n")[0]);

    assert.strictEqual(log.level, "info");
    assert.strictEqual(log.message, "test message");
    assert.strictEqual(log.key, "value");
    assert.ok(log.timestamp);
  });

  it("should write error logs", () => {
    const logger = createLogger(logPath);
    logger.error("error message", { error: "details" });
    logger.close();

    const content = fs.readFileSync(logPath, "utf8");
    const log = JSON.parse(content.trim());

    assert.strictEqual(log.level, "error");
  });

  it("should write warn logs", () => {
    const logger = createLogger(logPath);
    logger.warn("warning message");
    logger.close();

    const content = fs.readFileSync(logPath, "utf8");
    const log = JSON.parse(content.trim());

    assert.strictEqual(log.level, "warn");
    assert.strictEqual(log.message, "warning message");
  });
});
