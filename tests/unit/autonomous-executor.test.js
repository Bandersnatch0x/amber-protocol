const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { executeAutonomous } = require("../../scripts/lib/autonomous-executor");

describe("autonomous-executor", () => {
	const testRoot = path.join(__dirname, "../fixtures/autonomous-test");

	beforeEach(() => {
		if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
		fs.mkdirSync(testRoot, { recursive: true });

		// Create required directory structure for autonomous executor
		const sessionsDir = path.join(
			testRoot,
			".harness",
			"sessions",
			"test-session-id",
		);
		fs.mkdirSync(sessionsDir, { recursive: true });

		// Create a minimal manifest
		const manifest = {
			sessionId: "test-session-id",
			route: { id: "feature-standard", version: "1.0.0" },
			goal: "test feature",
			status: "executing",
			budget: { total: 10000, used: 0 },
			currentStage: null,
			completedStages: [],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		fs.writeFileSync(
			path.join(sessionsDir, "manifest.json"),
			JSON.stringify(manifest, null, 2),
		);

		// Create a timeline.jsonl
		fs.writeFileSync(path.join(sessionsDir, "timeline.jsonl"), "");

		// Create policy file
		const harnessDir = path.join(testRoot, ".harness");
		const policy = {
			gates: {
				auto: "approve",
				"user-approval": "approve",
				"step-confirm": "skip",
			},
			retry: {
				maxAttempts: 3,
				backoffMs: [100, 200, 500],
				retryableStages: ["implement", "verify"],
			},
			budget: { onExceed: "pause" },
		};
		fs.writeFileSync(
			path.join(harnessDir, "autonomous-policy.json"),
			JSON.stringify(policy, null, 2),
		);

		// Copy routes to test root so loadRoutes works
		const routesSrc = path.join(__dirname, "../../routes");
		const routesDest = path.join(testRoot, "routes");
		if (fs.existsSync(routesSrc)) {
			fs.mkdirSync(routesDest, { recursive: true });
			for (const f of fs.readdirSync(routesSrc)) {
				fs.copyFileSync(path.join(routesSrc, f), path.join(routesDest, f));
			}
		}
	});

	afterEach(() => {
		if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
	});

	it("should execute session autonomously with dryRun", async () => {
		const result = await executeAutonomous(testRoot, "test-session-id", {
			dryRun: true,
		});
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.exitCode, 0);
	});

	it("should return exit code 2 on budget exceeded simulation", async () => {
		const result = await executeAutonomous(testRoot, "test-session-id", {
			dryRun: true,
			simulateBudgetExceeded: true,
		});
		assert.strictEqual(result.exitCode, 2);
	});

	it("should return error for non-existent session", async () => {
		const result = await executeAutonomous(testRoot, "nonexistent-id", {
			dryRun: true,
		});
		assert.strictEqual(result.success, false);
		assert.strictEqual(result.exitCode, 1);
	});
});
