const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
	collectMetrics,
	getMetricsSummary,
} = require("../../scripts/lib/metrics-collector");

describe("metrics-collector", () => {
	const testRoot = path.join(__dirname, "../fixtures/metrics-test");

	beforeEach(() => {
		if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
		fs.mkdirSync(testRoot, { recursive: true });

		// Create test sessions
		const sessionsDir = path.join(testRoot, ".harness", "sessions");
		fs.mkdirSync(sessionsDir, { recursive: true });

		// Session 1: completed
		const s1Dir = path.join(sessionsDir, "session-1");
		fs.mkdirSync(s1Dir, { recursive: true });
		fs.writeFileSync(
			path.join(s1Dir, "manifest.json"),
			JSON.stringify({
				sessionId: "session-1",
				status: "completed",
				completedStages: ["capture", "plan", "implement", "verify"],
				budget: { total: 10000, used: 8000 },
				createdAt: new Date(Date.now() - 3600000).toISOString(),
				updatedAt: new Date().toISOString(),
				route: { id: "feature-standard", version: "1.0.0" },
				goal: "test feature 1",
			}),
		);

		// Session 2: failed
		const s2Dir = path.join(sessionsDir, "session-2");
		fs.mkdirSync(s2Dir, { recursive: true });
		fs.writeFileSync(
			path.join(s2Dir, "manifest.json"),
			JSON.stringify({
				sessionId: "session-2",
				status: "failed",
				completedStages: ["capture"],
				duration: 60000,
				budget: { total: 10000, used: 2000 },
				createdAt: new Date(Date.now() - 1800000).toISOString(),
				updatedAt: new Date(Date.now() - 1740000).toISOString(),
				route: { id: "bugfix-quick", version: "1.0.0" },
				goal: "fix a bug",
			}),
		);
	});

	afterEach(() => {
		if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
	});

	it("should collect session metrics", () => {
		const metrics = collectMetrics(testRoot, "session-1");
		assert.ok(metrics);
		assert.ok(metrics.duration !== undefined);
		assert.strictEqual(metrics.status, "completed");
		assert.strictEqual(metrics.stagesCompleted, 4);
		assert.strictEqual(metrics.budgetUsed, 8000);
	});

	it("should calculate success rate", () => {
		const summary = getMetricsSummary(testRoot);
		assert.strictEqual(summary.totalSessions, 2);
		assert.strictEqual(summary.successRate, 0.5);
		assert.ok(summary.avgDuration !== undefined);
	});

	it("should return zeros for empty sessions dir", () => {
		const emptyDir = path.join(testRoot, "empty");
		fs.mkdirSync(emptyDir, { recursive: true });
		const summary = getMetricsSummary(emptyDir);
		assert.strictEqual(summary.totalSessions, 0);
		assert.strictEqual(summary.successRate, 0);
		assert.strictEqual(summary.avgDuration, 0);
	});

	it("should return null for non-existent session", () => {
		const metrics = collectMetrics(testRoot, "nonexistent");
		assert.strictEqual(metrics, null);
	});
});
