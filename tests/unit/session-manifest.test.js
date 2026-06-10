const { describe, it } = require("node:test");
const assert = require("assert");
const {
	createManifest,
	validateManifest,
} = require("../../scripts/lib/session-manifest");

describe("session-manifest", () => {
	it("should create valid manifest", () => {
		const manifest = createManifest({
			route: { id: "feature-standard", version: "1.0.0" },
			goal: "test feature",
		});
		assert.ok(manifest.sessionId);
		assert.strictEqual(manifest.schemaVersion, "1.0.0");
		assert.strictEqual(manifest.status, "created");
		assert.ok(manifest.createdAt);
		assert.ok(manifest.updatedAt);
	});

	it("should validate manifest", () => {
		const manifest = createManifest({
			route: { id: "test", version: "1.0.0" },
			goal: "test",
		});
		const result = validateManifest(manifest);
		assert.strictEqual(result.valid, true);
	});

	it("should reject invalid status", () => {
		const manifest = {
			sessionId: "123",
			schemaVersion: "1.0.0",
			createdAt: new Date().toISOString(),
			route: { id: "test", version: "1.0.0" },
			goal: "test",
			status: "invalid",
		};
		const result = validateManifest(manifest);
		assert.strictEqual(result.valid, false);
	});

	it("should reject manifest without sessionId", () => {
		const manifest = {
			schemaVersion: "1.0.0",
			createdAt: new Date().toISOString(),
			route: { id: "test", version: "1.0.0" },
			goal: "test",
			status: "created",
		};
		const result = validateManifest(manifest);
		assert.strictEqual(result.valid, false);
	});

	it("should create manifest with budget", () => {
		const manifest = createManifest({
			route: { id: "test", version: "1.0.0" },
			goal: "budget test",
			budget: 1000,
		});
		assert.strictEqual(manifest.budget.total, 1000);
		assert.strictEqual(manifest.budget.used, 0);
	});

	it("should set createdAt and updatedAt to the same timestamp", () => {
		const manifest = createManifest({
			route: { id: "test", version: "1.0.0" },
			goal: "timestamp test",
		});
		assert.strictEqual(manifest.createdAt, manifest.updatedAt);
	});

	it("should omit budget when not provided", () => {
		const manifest = createManifest({
			route: { id: "test", version: "1.0.0" },
			goal: "no budget",
		});
		assert.strictEqual(manifest.budget, undefined);
		assert.strictEqual(validateManifest(manifest).valid, true);
	});
});
