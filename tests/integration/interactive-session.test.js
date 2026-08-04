const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "../..");
const TEST_PROJECT = path.join(ROOT, ".amber-test-interactive");

describe("Interactive Session Integration", () => {
	beforeEach(() => {
		if (fs.existsSync(TEST_PROJECT)) {
			fs.rmSync(TEST_PROJECT, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 50,
			});
		}
		fs.mkdirSync(TEST_PROJECT, { recursive: true });
	});

	afterEach(() => {
		if (fs.existsSync(TEST_PROJECT)) {
			fs.rmSync(TEST_PROJECT, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 50,
			});
		}
	});

	it("creates session with interactive mode", () => {
		const result = spawnSync(
			process.execPath,
			[
				path.join(ROOT, "scripts/amber.js"),
				"session",
				"start",
				"--goal",
				"add feature",
				"--target",
				TEST_PROJECT,
				"--mode",
				"interactive",
			],
			{ encoding: "utf8", cwd: ROOT },
		);
		assert.strictEqual(result.status, 0);
		assert.match(result.stdout, /interactive/);

		// Verify manifest contains mode
		const match = result.stdout.match(/Session created: ([a-f0-9-]+)/);
		const sessionId = match[1];
		const manifestPath = path.join(
			TEST_PROJECT,
			".amber",
			"sessions",
			sessionId,
			"manifest.json",
		);
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
		assert.strictEqual(manifest.mode, "interactive");
	});

	it("session status shows interactive mode", () => {
		spawnSync(
			process.execPath,
			[
				path.join(ROOT, "scripts/amber.js"),
				"session",
				"start",
				"--goal",
				"add feature",
				"--target",
				TEST_PROJECT,
				"--mode",
				"interactive",
			],
			{ encoding: "utf8", cwd: ROOT },
		);

		const statusResult = spawnSync(
			process.execPath,
			[
				path.join(ROOT, "scripts/amber.js"),
				"session",
				"status",
				"--target",
				TEST_PROJECT,
			],
			{ encoding: "utf8", cwd: ROOT },
		);
		assert.match(statusResult.stdout, /interactive/i);
	});

	it("session continue shows ready message", () => {
		spawnSync(
			process.execPath,
			[
				path.join(ROOT, "scripts/amber.js"),
				"session",
				"start",
				"--goal",
				"add feature",
				"--target",
				TEST_PROJECT,
			],
			{ encoding: "utf8", cwd: ROOT },
		);

		const continueResult = spawnSync(
			process.execPath,
			[
				path.join(ROOT, "scripts/amber.js"),
				"session",
				"continue",
				"--target",
				TEST_PROJECT,
			],
			{ encoding: "utf8", cwd: ROOT },
		);
		assert.strictEqual(continueResult.status, 0);
		assert.match(continueResult.stdout, /Session resumed/);
	});

	it("session --help includes continue", () => {
		const result = spawnSync(
			process.execPath,
			[path.join(ROOT, "scripts/amber.js"), "session", "--help"],
			{ encoding: "utf8", cwd: ROOT },
		);
		assert.match(result.stdout, /continue/);
	});
});
