const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { migrateManifests } = require("../../scripts/lib/migrate-command");

describe("Migrate Command", () => {
	const testDir = path.join(__dirname, "../fixtures/migrate-test");

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

	it("adds schemaVersion to manifests missing it", () => {
		const sessionId = "test-session-1";
		const sessionDir = path.join(testDir, ".harness", "sessions", sessionId);
		fs.mkdirSync(sessionDir, { recursive: true });

		const oldManifest = { sessionId, status: "completed", goal: "test" };
		fs.writeFileSync(
			path.join(sessionDir, "manifest.json"),
			JSON.stringify(oldManifest, null, 2),
		);

		const result = migrateManifests(testDir, { dryRun: false });

		assert.strictEqual(result.success, true);
		assert.strictEqual(result.migrated, 1);

		const updated = JSON.parse(
			fs.readFileSync(path.join(sessionDir, "manifest.json"), "utf8"),
		);
		assert.strictEqual(updated.schemaVersion, "1.0.0");

		const backup = path.join(sessionDir, "manifest.json.backup");
		assert.ok(fs.existsSync(backup));
	});

	it("skips manifests already at 1.0.0", () => {
		const sessionId = "test-session-2";
		const sessionDir = path.join(testDir, ".harness", "sessions", sessionId);
		fs.mkdirSync(sessionDir, { recursive: true });

		const manifest = {
			sessionId,
			schemaVersion: "1.0.0",
			status: "completed",
			goal: "test",
		};
		fs.writeFileSync(
			path.join(sessionDir, "manifest.json"),
			JSON.stringify(manifest, null, 2),
		);

		const result = migrateManifests(testDir, { dryRun: false });

		assert.strictEqual(result.success, true);
		assert.strictEqual(result.migrated, 0);
		assert.strictEqual(result.skipped, 1);
	});

	it("supports dry-run mode", () => {
		const sessionId = "test-session-3";
		const sessionDir = path.join(testDir, ".harness", "sessions", sessionId);
		fs.mkdirSync(sessionDir, { recursive: true });

		const oldManifest = { sessionId, status: "completed", goal: "test" };
		fs.writeFileSync(
			path.join(sessionDir, "manifest.json"),
			JSON.stringify(oldManifest, null, 2),
		);

		const result = migrateManifests(testDir, { dryRun: true });

		assert.strictEqual(result.success, true);
		assert.strictEqual(result.wouldMigrate, 1);

		const unchanged = JSON.parse(
			fs.readFileSync(path.join(sessionDir, "manifest.json"), "utf8"),
		);
		assert.strictEqual(unchanged.schemaVersion, undefined);
	});

	it("returns empty result when no sessions exist", () => {
		const result = migrateManifests(testDir, {});
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.migrated, 0);
	});
});
