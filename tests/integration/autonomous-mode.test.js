const { describe, it, after } = require("node:test");
const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

describe("autonomous mode integration", () => {
	// Isolated target so session start does not write continuity surfaces into
	// the amber source tree. cwd stays at ROOT so routes resolve.
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-autonomous-mode-"));

	after(() => {
		fs.rmSync(target, { recursive: true, force: true });
	});

	it("should accept --mode autonomous flag", () => {
		const result = spawnSync(
			process.execPath,
			[
				path.join(ROOT, "scripts/amber.js"),
				"session",
				"start",
				"--goal",
				"implement test feature",
				"--mode",
				"autonomous",
				"--target",
				target,
				"--json",
			],
			{ cwd: ROOT, encoding: "utf8", timeout: 15000 },
		);

		assert.strictEqual(result.status, 0);
	});

	it("should support daemon status command", () => {
		const result = spawnSync(
			process.execPath,
			[path.join(ROOT, "scripts/amber.js"), "daemon", "status"],
			{ cwd: ROOT, encoding: "utf8", timeout: 15000 },
		);

		assert.ok(result.status === 0 || result.status === 1);
	});
});
