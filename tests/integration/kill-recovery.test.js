const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
	startSession,
	continueSession,
} = require("../../scripts/lib/session-commands");
const { saveCheckpoint } = require("../../scripts/lib/checkpoint-manager");

describe("Kill Recovery", () => {
	const testDir = path.join(__dirname, "../fixtures/kill-recovery");

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

	it("recovers from interruption at each stage", async () => {
		const result = await startSession(testDir, {
			goal: "multi-stage test",
			route: "feature-standard",
		});
		const sessionId = result.sessionId;

		const interruptionPoints = [
			{ stage: "capture", completedStages: [] },
			{ stage: "plan", completedStages: ["capture"] },
			{ stage: "implement", completedStages: ["capture", "plan"] },
		];

		for (const point of interruptionPoints) {
			const manifestPath = path.join(
				testDir,
				".amber",
				"sessions",
				sessionId,
				"manifest.json",
			);
			const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

			manifest.status = "paused";
			manifest.currentStage = point.stage;
			manifest.completedStages = point.completedStages;
			manifest.schemaVersion = "1.0.0-rc.1";
			fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

			saveCheckpoint(testDir, sessionId, point.stage, manifest, {
				branch: "main",
				commit: "abc123",
				uncommittedFiles: [],
			});

			const continueResult = await continueSession(testDir, { sessionId });
			assert.strictEqual(continueResult.exitCode, 0);
			assert.match(continueResult.text, /resumed/i);

			const updated = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
			assert.strictEqual(updated.status, "executing");
		}
	});

	it("recovers with checkpoint state applied to manifest", async () => {
		const result = await startSession(testDir, {
			goal: "recovery test",
			route: "feature-standard",
		});
		const sessionId = result.sessionId;

		const manifestPath = path.join(
			testDir,
			".amber",
			"sessions",
			sessionId,
			"manifest.json",
		);
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
		manifest.status = "paused";
		manifest.currentStage = "implement";
		manifest.completedStages = ["capture", "plan"];
		manifest.schemaVersion = "1.0.0-rc.1";
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

		saveCheckpoint(testDir, sessionId, "implement", manifest, {
			branch: "main",
			commit: "def456",
			uncommittedFiles: ["changes.md"],
		});

		await continueSession(testDir, { sessionId });
		const updated = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

		assert.strictEqual(updated.status, "executing");
		assert.ok(updated.completedStages.includes("capture"));
		assert.ok(updated.completedStages.includes("plan"));
	});
});
