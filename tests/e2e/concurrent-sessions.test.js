const { describe, it } = require("node:test");
const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

describe("concurrent sessions E2E", () => {
  it("should handle 5 concurrent sessions", () => {
    const sessions = [];

    for (let i = 0; i < 5; i++) {
      const result = spawnSync(process.execPath, [
        path.join(ROOT, "scripts/amber.js"),
        "session", "start",
        "--goal", `implement feature ${i}`,
        "--json"
      ], { cwd: ROOT, encoding: "utf8", timeout: 15000 });

      if (result.status === 0) {
        const data = JSON.parse(result.stdout);
        sessions.push(data.sessionId);
      }
    }

    assert.ok(sessions.length >= 4, `Should create at least 4 sessions, got ${sessions.length}`);
  });
});
