const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
	executeStage,
	executeStages,
} = require("../../scripts/lib/stage-executor");

describe("Stage Executor", () => {
	const testDir = path.join(__dirname, "../fixtures/stage-executor-test");

	beforeEach(() => {
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true, force: true });
		}
		fs.mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true, force: true });
		}
	});

	it("executes a command stage successfully", async () => {
		const stage = { name: "test", type: "command", target: "echo hello" };
		const result = await executeStage(stage, {});
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.stage, "test");
	});

	it("executes a pack stage as placeholder", async () => {
		const stage = { name: "plan", type: "pack", target: "feature-planning" };
		const result = await executeStage(stage, {});
		assert.strictEqual(result.success, true);
		assert.match(result.message, /placeholder/i);
	});

	it("executes a skill stage as placeholder", async () => {
		const stage = {
			name: "capture",
			type: "skill",
			target: "requirement-clarification",
		};
		const result = await executeStage(stage, {});
		assert.strictEqual(result.success, true);
		assert.match(result.message, /placeholder/i);
	});

	it("handles command failure", async () => {
		const stage = { name: "fail", type: "command", target: "exit 1" };
		const result = await executeStage(stage, {});
		assert.strictEqual(result.success, false);
	});

	it("executes multiple stages in sequence", async () => {
		const stages = [
			{ name: "s1", type: "command", target: "echo stage1" },
			{ name: "s2", type: "command", target: "echo stage2" },
		];
		const results = await executeStages(stages, {}, () => true);
		assert.strictEqual(results.length, 2);
		assert.strictEqual(results[0].success, true);
	});

	it("stops on first failure for non-optional stages", async () => {
		const stages = [
			{ name: "s1", type: "command", target: "exit 1" },
			{ name: "s2", type: "command", target: "echo never-runs" },
		];
		const results = await executeStages(stages, {}, () => true);
		assert.strictEqual(results.length, 1);
	});

	it("rejects unknown stage type", async () => {
		const stage = { name: "bad", type: "frobnicate", target: "x" };
		const result = await executeStage(stage, {});
		assert.strictEqual(result.success, false);
		assert.match(result.error, /unknown/i);
	});
});
