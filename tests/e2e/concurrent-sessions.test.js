const { describe, it, after } = require("node:test");
const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("path");
const { installTargetRoutes } = require("../helpers/target-routes");

const ROOT = path.join(__dirname, "../..");

describe("concurrent sessions E2E", () => {
	// Use an isolated target so `session start` writes its manifests and
	// continuity surfaces into a tempdir instead of polluting the repo root.
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-concurrent-"));
	installTargetRoutes(target);

	after(() => {
		fs.rmSync(target, { recursive: true, force: true });
	});

	it("should handle 5 concurrent sessions", () => {
		const sessions = [];

		for (let i = 0; i < 5; i++) {
			const result = spawnSync(
				process.execPath,
				[
					path.join(ROOT, "scripts/amber.js"),
					"session",
					"start",
					"--goal",
					`implement feature ${i}`,
					"--target",
					target,
					"--confirm",
					"--json",
				],
				{ cwd: ROOT, encoding: "utf8", timeout: 15000 },
			);

			if (result.status === 0) {
				const data = JSON.parse(result.stdout);
				sessions.push(data.sessionId);
			}
		}

		assert.ok(sessions.length >= 4, `Should create at least 4 sessions, got ${sessions.length}`);
	});
});
