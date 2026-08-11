const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { startSession, continueSession } = require("../../scripts/lib/session-commands");
const { saveCheckpoint } = require("../../scripts/lib/checkpoint-manager");

describe("Continue Recovery", () => {
	const testDir = path.join(__dirname, "../fixtures/continue-test");

	beforeEach(() => {
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 50,
			});
		}
		fs.mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 50,
			});
		}
	});

	it("continues from latest checkpoint", async () => {
		const result = await startSession(testDir, {
			goal: "test goal",
			route: "feature-standard",
		});
		const sessionId = result.sessionId;

		const manifestPath = path.join(testDir, ".amber", "sessions", sessionId, "manifest.json");
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
		manifest.status = "paused";
		manifest.currentStage = "plan";
		manifest.completedStages = ["capture"];
		manifest.schemaVersion = "1.0.0-rc.1";
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

		saveCheckpoint(testDir, sessionId, "plan", manifest, {
			branch: "main",
			commit: "abc123",
			uncommittedFiles: [],
		});

		const continueResult = await continueSession(testDir, { sessionId });
		assert.strictEqual(continueResult.exitCode, 0);
		assert.match(continueResult.text, /resumed/i);
	});

	it("finds most recent non-completed session when no id provided", async () => {
		await startSession(testDir, {
			goal: "goal 1",
			route: "feature-standard",
		});
		const result2 = await startSession(testDir, {
			goal: "goal 2",
			route: "feature-standard",
		});

		// Set most recent (result2) to paused
		const manifest2Path = path.join(
			testDir,
			".amber",
			"sessions",
			result2.sessionId,
			"manifest.json",
		);
		const manifest2 = JSON.parse(fs.readFileSync(manifest2Path, "utf8"));
		manifest2.status = "paused";
		fs.writeFileSync(manifest2Path, JSON.stringify(manifest2, null, 2));

		const continueResult = await continueSession(testDir, {});
		assert.strictEqual(continueResult.exitCode, 0);
		assert.ok(continueResult.text.includes(result2.sessionId.substring(0, 8)));
	});

	it("rejects continuing a completed session", async () => {
		const result = await startSession(testDir, {
			goal: "done",
			route: "feature-standard",
		});
		const manifestPath = path.join(
			testDir,
			".amber",
			"sessions",
			result.sessionId,
			"manifest.json",
		);
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
		manifest.status = "completed";
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

		const continueResult = await continueSession(testDir, {
			sessionId: result.sessionId,
		});
		assert.notEqual(continueResult.exitCode, 0);
	});
});
