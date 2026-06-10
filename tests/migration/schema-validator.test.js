const { describe, it } = require("node:test");
const assert = require("assert");
const { detectVersion } = require("../../src/migration/schema-validator");

describe("detectVersion", () => {
	const v55Settings = {
		version: "5.5",
		agents: { default: { model: "claude" } },
		routes: [{ name: "default" }],
	};

	const phaseBSettings = {
		version: "1.0.0",
		framework: "phase-b",
		agents: { default: { model: "claude" } },
		skills: ["example"],
	};

	it("identifies V5.5 settings.json by version field", () => {
		const result = detectVersion(v55Settings);
		assert.strictEqual(result, "5.5");
	});

	it("returns null for non-V5.5 and non-Phase-B schemas", () => {
		const unknown = { version: "3.0", something: "else" };
		const result = detectVersion(unknown);
		assert.strictEqual(result, null);
	});

	it("detects Phase B schemas by version and framework field", () => {
		const result = detectVersion(phaseBSettings);
		assert.strictEqual(result, "phase-b");
	});

	it("handles missing version field gracefully", () => {
		const noVersion = { agents: { default: { model: "test" } } };
		const result = detectVersion(noVersion);
		assert.strictEqual(result, null);
	});

	it("returns null for completely invalid input", () => {
		assert.strictEqual(detectVersion(null), null);
		assert.strictEqual(detectVersion(undefined), null);
		assert.strictEqual(detectVersion("not an object"), null);
	});
});

describe("validateUpgrade", () => {
	const { validateUpgrade } = require("../../src/migration/schema-validator");

	const v55Settings = {
		version: "5.5",
		agents: { default: { model: "claude" } },
		routes: [{ name: "default" }],
		deprecated_field: "should be removed",
	};

	it("checks compatibility between V5.5 and Phase B", () => {
		const result = validateUpgrade(v55Settings, "phase-b");
		assert.strictEqual(typeof result, "object");
		assert.ok(Object.hasOwn(result, "compatible"));
		assert.ok(Object.hasOwn(result, "breakingChanges"));
		assert.ok(Object.hasOwn(result, "deprecatedFields"));
		assert.ok(Object.hasOwn(result, "warnings"));
	});

	it("flags breaking changes (removed fields)", () => {
		const result = validateUpgrade(v55Settings, "phase-b");
		assert.ok(result.breakingChanges.length > 0, "Should detect removed fields");
		assert.ok(result.breakingChanges.some(c => c.field === "deprecated_field"),
			"Should flag deprecated_field as removed");
	});

	it("warns about deprecated fields", () => {
		const withDeprecated = {
			version: "5.5",
			agents: { default: { model: "claude" } },
			routes: [{ name: "default" }],
			legacy_api: "old",
			old_config: { key: "value" },
		};
		const result = validateUpgrade(withDeprecated, "phase-b");
		assert.ok(result.deprecatedFields.length > 0, "Should detect deprecated fields");
	});

	it("returns compatible=true when no issues", () => {
		const clean = {
			version: "5.5",
			agents: { default: { model: "claude" } },
			routes: [{ name: "default" }],
		};
		const result = validateUpgrade(clean, "phase-b");
		assert.strictEqual(result.compatible, true);
	});
});
