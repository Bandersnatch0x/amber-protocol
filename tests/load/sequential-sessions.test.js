const { describe, it } = require("node:test");
const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

describe("sequential sessions load test", () => {
	it("should complete 20 sessions in <2 minutes", () => {
		const startTime = Date.now();
		let successCount = 0;
		const total = 20;

		for (let i = 0; i < total; i++) {
			const result = spawnSync(
				process.execPath,
				[
					path.join(ROOT, "scripts/amber.js"),
					"session",
					"start",
					"--goal",
					`implement load test feature ${i}`,
					"--json",
				],
				{ cwd: ROOT, encoding: "utf8", timeout: 10000 },
			);

			if (result.status === 0) {
				successCount++;
			}
		}

		const duration = Date.now() - startTime;
		const avgTime = duration / total;

		assert.ok(
			successCount >= total * 0.9,
			`Only ${successCount}/${total} succeeded`,
		);
		assert.ok(
			avgTime < 6000,
			`Average time ${avgTime.toFixed(0)}ms exceeds 6s target`,
		);
	});
});
