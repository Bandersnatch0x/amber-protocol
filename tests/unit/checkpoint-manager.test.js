const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
	saveCheckpoint,
	loadLatestCheckpoint,
	listCheckpoints,
	loadCheckpointByStage,
} = require("../../scripts/lib/checkpoint-manager");

describe("Checkpoint Manager", () => {
	const testDir = path.join(__dirname, "../fixtures/checkpoint-test");
	const sessionId = "test-session-123";

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

	it("saves a checkpoint with manifest and worktree state", () => {
		const manifest = { sessionId, status: "executing", currentStage: "plan" };
		const worktreeState = {
			branch: "main",
			commit: "abc123",
			uncommittedFiles: [],
		};

		const result = saveCheckpoint(
			testDir,
			sessionId,
			"plan",
			manifest,
			worktreeState,
		);

		assert.strictEqual(result.success, true);
		assert.ok(fs.existsSync(result.path));

		const saved = JSON.parse(fs.readFileSync(result.path, "utf8"));
		assert.strictEqual(saved.sessionId, sessionId);
		assert.strictEqual(saved.stage, "plan");
		assert.strictEqual(saved.manifest.currentStage, "plan");
		assert.strictEqual(saved.worktreeState.commit, "abc123");
	});

	it("loads the latest checkpoint by timestamp", () => {
		const manifest1 = { sessionId, currentStage: "capture" };
		const manifest2 = { sessionId, currentStage: "plan" };

		saveCheckpoint(testDir, sessionId, "capture", manifest1, {});
		saveCheckpoint(testDir, sessionId, "plan", manifest2, {});

		const latest = loadLatestCheckpoint(testDir, sessionId);
		assert.ok(latest);
		assert.strictEqual(latest.stage, "plan");
	});

	it("returns null when no checkpoints exist", () => {
		const latest = loadLatestCheckpoint(testDir, sessionId);
		assert.strictEqual(latest, null);
	});

	it("lists all checkpoints sorted by timestamp", () => {
		saveCheckpoint(testDir, sessionId, "capture", { sessionId }, {});
		saveCheckpoint(testDir, sessionId, "plan", { sessionId }, {});

		const list = listCheckpoints(testDir, sessionId);
		assert.strictEqual(list.length, 2);
		assert.ok(list[0].stage === "capture" && list[1].stage === "plan");
	});

	it("loads checkpoint by stage name", () => {
		saveCheckpoint(testDir, sessionId, "capture", { sessionId }, {});
		saveCheckpoint(testDir, sessionId, "plan", { sessionId }, {});

		const cp = loadCheckpointByStage(testDir, sessionId, "capture");
		assert.ok(cp);
		assert.strictEqual(cp.stage, "capture");
	});

	it("returns null when loading non-existent stage", () => {
		const cp = loadCheckpointByStage(testDir, sessionId, "nope");
		assert.strictEqual(cp, null);
	});
});
