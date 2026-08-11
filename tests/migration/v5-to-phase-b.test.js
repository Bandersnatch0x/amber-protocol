const { describe, it } = require("node:test");
const assert = require("assert");
const { migrateSettings } = require("../../src/migration/v5-to-phase-b");

describe("migrateSettings", () => {
	const validV55 = {
		version: "5.5",
		agents: {
			default: { model: "claude" },
			reviewer: { model: "gpt-4" },
		},
		routes: [
			{
				name: "default",
				stages: [{ name: "build", command: "npm run build" }],
			},
		],
		customSetting: "keep-me",
		deprecated_field: "remove-me",
		legacy_api: { key: "old-val" },
	};

	it("converts V5.5 settings to Phase B format", () => {
		const result = migrateSettings(validV55);

		assert.strictEqual(result.version, "1.0.0");
		assert.strictEqual(result.framework, "phase-b");
		assert.ok(Object.hasOwn(result, "migratedAt"), "Should include migration timestamp");
	});

	it("preserves custom user settings", () => {
		const result = migrateSettings(validV55);
		assert.strictEqual(result.customSetting, "keep-me");
	});

	it("renames deprecated fields", () => {
		const result = migrateSettings(validV55);
		assert.ok(!Object.hasOwn(result, "deprecated_field"), "Should remove deprecated_field");
		assert.ok(!Object.hasOwn(result, "legacy_api"), "Should remove legacy_api");
	});

	it("adds required Phase B fields with defaults", () => {
		const minimal = {
			version: "5.5",
			agents: { default: { model: "test" } },
		};

		const result = migrateSettings(minimal);

		assert.ok(Object.hasOwn(result, "skills"), "Should add skills array");
		assert.ok(Array.isArray(result.skills), "Skills should be an array");
		assert.ok(Object.hasOwn(result, "routes"), "Should add routes array");
		assert.ok(Object.hasOwn(result, "profiles"), "Should add profiles");
	});

	it("preserves agent configurations", () => {
		const result = migrateSettings(validV55);
		assert.ok(result.agents, "Should have agents");
		assert.ok(result.agents.default, "Should have default agent");
		assert.strictEqual(result.agents.default.model, "claude");
		assert.ok(result.agents.reviewer, "Should preserve reviewer agent");
	});

	it("handles minimal V5.5 settings", () => {
		const minimal = { version: "5.5" };
		const result = migrateSettings(minimal);
		assert.strictEqual(result.version, "1.0.0");
		assert.strictEqual(result.framework, "phase-b");
	});

	it("handles empty agents section", () => {
		const noAgents = { version: "5.5", agents: {} };
		const result = migrateSettings(noAgents);
		assert.ok(result.agents.default, "Should create default agent");
	});

	it("generates a migration id for traceability", () => {
		const result = migrateSettings(validV55);
		assert.ok(Object.hasOwn(result, "migrationId"), "Should have migration ID");
		assert.ok(typeof result.migrationId === "string");
		assert.ok(result.migrationId.length > 0);
	});
});
