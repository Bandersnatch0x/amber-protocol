const { describe, it } = require("node:test");
const assert = require("assert");
const { dryRun } = require("../../src/migration/dry-run");

describe("dryRun", () => {
	const v55Settings = {
		version: "5.5",
		agents: {
			default: { model: "claude" },
		},
		routes: [{ name: "default", stages: [{ name: "build" }] }],
		customSetting: "keep-me",
		deprecated_field: "should-go",
	};

	it("shows migration preview without applying changes", () => {
		const result = dryRun(v55Settings);
		assert.strictEqual(typeof result, "object");
		assert.ok(Object.hasOwn(result, "before"), "Should show before state");
		assert.ok(Object.hasOwn(result, "after"), "Should show after state");
		assert.ok(Object.hasOwn(result, "diff"), "Should show diff");
	});

	it("displays before/after diff", () => {
		const result = dryRun(v55Settings);
		assert.ok(result.diff.length > 0, "Should have diff entries");
		assert.ok(result.diff.some(d => d.field === "version" && d.before === "5.5" && d.after === "1.0.0"),
			"Should show version change from 5.5 to 1.0.0");
	});

	it("does not modify the original settings", () => {
		const original = JSON.parse(JSON.stringify(v55Settings));
		dryRun(v55Settings);

		assert.deepStrictEqual(v55Settings, original, "Original should be unmodified");
		assert.strictEqual(v55Settings.version, "5.5", "Version should remain 5.5");
	});

	it("shows which fields will be added", () => {
		const result = dryRun(v55Settings);
		const addedFields = result.diff.filter(d => d.type === "added");
		assert.ok(addedFields.length > 0, "Should show added fields");
		assert.ok(addedFields.some(f => f.field === "framework"), "Should add framework field");
		assert.ok(addedFields.some(f => f.field === "skills"), "Should add skills field");
	});

	it("shows which fields will be renamed/removed", () => {
		const result = dryRun(v55Settings);
		const removedFields = result.diff.filter(d => d.type === "removed" || d.type === "renamed");
		assert.ok(removedFields.length > 0, "Should show removed/renamed fields");
		assert.ok(removedFields.some(f => f.field === "deprecated_field"),
			"Should show deprecated_field as removed");
	});

	it("provides a human-readable summary", () => {
		const result = dryRun(v55Settings);
		assert.ok(typeof result.summary === "string", "Should have a summary string");
		assert.ok(result.summary.length > 0, "Summary should not be empty");
	});

	it("handles already-migrated settings gracefully", () => {
		const phaseB = {
			version: "1.0.0",
			framework: "phase-b",
			agents: { default: { model: "claude" } },
			skills: [],
		};

		const result = dryRun(phaseB);
		assert.ok(result.diff.every(d => d.type !== "changed"),
			"No changes should be needed for already-migrated settings");
	});
});
