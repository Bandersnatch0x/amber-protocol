const { describe, it } = require("node:test");
const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

describe("autonomous mode integration", () => {
	it("should accept --mode autonomous flag", () => {
		const result = spawnSync(
			process.execPath,
			[
				path.join(ROOT, "scripts/harness.js"),
				"session",
				"start",
				"--goal",
				"implement test feature",
				"--mode",
				"autonomous",
				"--json",
			],
			{ cwd: ROOT, encoding: "utf8", timeout: 15000 },
		);

		assert.strictEqual(result.status, 0);
	});

	it("should support daemon status command", () => {
		const result = spawnSync(
			process.execPath,
			[path.join(ROOT, "scripts/harness.js"), "daemon", "status"],
			{ cwd: ROOT, encoding: "utf8", timeout: 15000 },
		);

		assert.ok(result.status === 0 || result.status === 1);
	});
});
