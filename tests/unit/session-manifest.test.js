const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
	createManifest,
	validateManifest,
	readSessionManifest,
	readAllSessionManifests,
	writeSessionManifest,
} = require("../../scripts/lib/session-manifest");

describe("session-manifest", () => {
	it("should create valid manifest", () => {
		const manifest = createManifest({
			route: { id: "feature-standard", version: "1.0.0-rc.1" },
			goal: "test feature",
		});
		assert.ok(manifest.sessionId);
		assert.strictEqual(manifest.schemaVersion, "1.0.0-rc.1");
		assert.strictEqual(manifest.status, "created");
		assert.ok(manifest.createdAt);
		assert.ok(manifest.updatedAt);
	});

	it("should validate manifest", () => {
		const manifest = createManifest({
			route: { id: "test", version: "1.0.0-rc.1" },
			goal: "test",
		});
		const result = validateManifest(manifest);
		assert.strictEqual(result.valid, true);
	});

	it("should reject invalid status", () => {
		const manifest = {
			sessionId: "123",
			schemaVersion: "1.0.0-rc.1",
			createdAt: new Date().toISOString(),
			route: { id: "test", version: "1.0.0-rc.1" },
			goal: "test",
			status: "invalid",
		};
		const result = validateManifest(manifest);
		assert.strictEqual(result.valid, false);
	});

	it("should reject manifest without sessionId", () => {
		const manifest = {
			schemaVersion: "1.0.0-rc.1",
			createdAt: new Date().toISOString(),
			route: { id: "test", version: "1.0.0-rc.1" },
			goal: "test",
			status: "created",
		};
		const result = validateManifest(manifest);
		assert.strictEqual(result.valid, false);
	});

	it("should create manifest with budget", () => {
		const manifest = createManifest({
			route: { id: "test", version: "1.0.0-rc.1" },
			goal: "budget test",
			budget: 1000,
		});
		assert.strictEqual(manifest.budget.total, 1000);
		assert.strictEqual(manifest.budget.used, 0);
	});

	it("should set createdAt and updatedAt to the same timestamp", () => {
		const manifest = createManifest({
			route: { id: "test", version: "1.0.0-rc.1" },
			goal: "timestamp test",
		});
		assert.strictEqual(manifest.createdAt, manifest.updatedAt);
	});

	it("should omit budget when not provided", () => {
		const manifest = createManifest({
			route: { id: "test", version: "1.0.0-rc.1" },
			goal: "no budget",
		});
		assert.strictEqual(manifest.budget, undefined);
		assert.strictEqual(validateManifest(manifest).valid, true);
	});
});

describe("session-manifest store (read/write)", () => {
	let sessionsDir;

	beforeEach(() => {
		sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-manifest-"));
	});
	afterEach(() => {
		fs.rmSync(sessionsDir, { recursive: true, force: true });
	});

	it("readSessionManifest returns null when the manifest is absent", () => {
		const sessionDir = path.join(sessionsDir, "missing");
		assert.strictEqual(readSessionManifest(sessionDir), null);
	});

	it("writeSessionManifest persists and readSessionManifest reads it back", () => {
		const sessionDir = path.join(sessionsDir, "s1");
		const manifest = createManifest({
			route: { id: "test", version: "1.0.0-rc.1" },
			goal: "round-trip",
		});
		const persisted = writeSessionManifest(sessionDir, manifest);

		const loaded = readSessionManifest(sessionDir);
		assert.ok(loaded);
		assert.strictEqual(loaded.manifest.sessionId, manifest.sessionId);
		assert.strictEqual(loaded.sessionDir, sessionDir);
		assert.ok(loaded.manifestPath.endsWith("manifest.json"));
		assert.strictEqual(persisted.updatedAt, loaded.manifest.updatedAt);
	});

	it("writeSessionManifest stamps updatedAt and does not mutate the input", () => {
		const sessionDir = path.join(sessionsDir, "s2");
		const manifest = createManifest({
			route: { id: "test", version: "1.0.0-rc.1" },
			goal: "immutable",
		});
		const originalUpdatedAt = manifest.updatedAt;
		writeSessionManifest(sessionDir, { ...manifest, status: "aborted" });

		assert.strictEqual(manifest.status, "created");
		assert.strictEqual(manifest.updatedAt, originalUpdatedAt);
		const persisted = JSON.parse(
			fs.readFileSync(path.join(sessionDir, "manifest.json"), "utf8"),
		);
		assert.strictEqual(persisted.status, "aborted");
		assert.ok(persisted.updatedAt >= originalUpdatedAt);
	});

	it("readSessionManifest flags a corrupt manifest without throwing", () => {
		const sessionDir = path.join(sessionsDir, "s3");
		fs.mkdirSync(sessionDir, { recursive: true });
		fs.writeFileSync(path.join(sessionDir, "manifest.json"), "{not json");

		const loaded = readSessionManifest(sessionDir);
		assert.ok(loaded.corrupt);
		assert.strictEqual(loaded.manifest, null);
	});

	it("readAllSessionManifests enumerates newest-first and skips corrupt files", () => {
		const older = createManifest({
			route: { id: "t", version: "1.0.0-rc.1" },
			goal: "older",
		});
		older.createdAt = "2026-01-01T00:00:00.000Z";
		const newer = createManifest({
			route: { id: "t", version: "1.0.0-rc.1" },
			goal: "newer",
		});
		newer.createdAt = "2026-06-01T00:00:00.000Z";
		writeSessionManifest(path.join(sessionsDir, "older"), older);
		writeSessionManifest(path.join(sessionsDir, "newer"), newer);

		const corruptDir = path.join(sessionsDir, "corrupt");
		fs.mkdirSync(corruptDir, { recursive: true });
		fs.writeFileSync(path.join(corruptDir, "manifest.json"), "{bad");

		const all = readAllSessionManifests(sessionsDir);
		assert.strictEqual(all.length, 2);
		assert.strictEqual(all[0].goal, "newer");
		assert.strictEqual(all[1].goal, "older");
	});

	it("readAllSessionManifests returns [] for a missing dir", () => {
		assert.deepStrictEqual(
			readAllSessionManifests(path.join(sessionsDir, "nope")),
			[],
		);
	});
});
