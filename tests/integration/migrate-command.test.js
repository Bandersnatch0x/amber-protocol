const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { migrateManifests } = require("../../scripts/lib/migrate-command");
const { dispatch } = require("../../scripts/lib/command-dispatcher");

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
		const sessionDir = path.join(testDir, ".amber", "sessions", sessionId);
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
		assert.strictEqual(updated.schemaVersion, "1.0.0-rc.1");

		const backup = path.join(sessionDir, "manifest.json.backup");
		assert.ok(fs.existsSync(backup));
	});

	it("skips manifests already at 1.0.0", () => {
		const sessionId = "test-session-2";
		const sessionDir = path.join(testDir, ".amber", "sessions", sessionId);
		fs.mkdirSync(sessionDir, { recursive: true });

		const manifest = {
			sessionId,
			schemaVersion: "1.0.0-rc.1",
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

	it("skips a corrupt manifest and still migrates healthy ones", () => {
		const healthyDir = path.join(testDir, ".amber", "sessions", "healthy");
		fs.mkdirSync(healthyDir, { recursive: true });
		fs.writeFileSync(
			path.join(healthyDir, "manifest.json"),
			JSON.stringify(
				{ sessionId: "healthy", status: "completed", goal: "x" },
				null,
				2,
			),
		);
		const corruptDir = path.join(testDir, ".amber", "sessions", "broken");
		fs.mkdirSync(corruptDir, { recursive: true });
		fs.writeFileSync(path.join(corruptDir, "manifest.json"), "{ broken json");

		const result = migrateManifests(testDir, { dryRun: false });

		// One bad file must not abort migration for the healthy session beside it.
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.migrated, 1);
		assert.strictEqual(result.skipped, 1);
		assert.ok(result.logs.some((l) => /corrupt/i.test(l)));
	});

	it("supports dry-run mode", () => {
		const sessionId = "test-session-3";
		const sessionDir = path.join(testDir, ".amber", "sessions", sessionId);
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

	it("default migrate dispatch also backfills artifact versioning", () => {
		const pageDir = path.join(testDir, ".amber", "context", "pages");
		const pagePath = path.join(pageDir, "test-page.json");
		fs.mkdirSync(pageDir, { recursive: true });
		fs.writeFileSync(pagePath, JSON.stringify({
			pageId: "test-page",
			sources: {},
			blocks: [],
		}));

		const response = dispatch("migrate", { target: testDir, _: [], json: true });
		const updated = JSON.parse(fs.readFileSync(pagePath, "utf8"));

		assert.strictEqual(response.exitCode, 0);
		assert.strictEqual(updated.artifact_type, "context-page");
		assert.strictEqual(typeof updated.amber_protocol_version, "string");
		assert.strictEqual(updated.artifact_sequence, 0);
		assert.strictEqual(typeof updated.created_at, "string");
		assert.match(response.result.text, /Backfilled 1 artifact/);
	});
});
