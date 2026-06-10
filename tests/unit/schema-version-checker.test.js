const { describe, it } = require("node:test");
const assert = require("assert");
const {
	checkSchemaVersion,
	SUPPORTED_VERSIONS,
} = require("../../scripts/lib/schema-version-checker");

describe("Schema Version Checker", () => {
	it("passes for supported version 1.0.0", () => {
		const manifest = { schemaVersion: "1.0.0", sessionId: "test" };
		const result = checkSchemaVersion(manifest);
		assert.strictEqual(result.valid, true);
	});

	it("fails for unsupported version", () => {
		const manifest = { schemaVersion: "0.9.0", sessionId: "test" };
		const result = checkSchemaVersion(manifest);
		assert.strictEqual(result.valid, false);
		assert.match(result.error, /unsupported/i);
		assert.match(result.error, /migrate/i);
	});

	it("fails when schemaVersion is missing", () => {
		const manifest = { sessionId: "test" };
		const result = checkSchemaVersion(manifest);
		assert.strictEqual(result.valid, false);
		assert.match(result.error, /missing/i);
	});

	it("includes supported versions in error message", () => {
		const manifest = { schemaVersion: "2.0.0", sessionId: "test" };
		const result = checkSchemaVersion(manifest);
		assert.match(result.error, /1.0.0/);
	});

	it("exports the supported versions list", () => {
		assert.ok(Array.isArray(SUPPORTED_VERSIONS));
		assert.ok(SUPPORTED_VERSIONS.includes("1.0.0"));
	});
});
