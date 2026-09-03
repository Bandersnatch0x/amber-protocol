"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateSessionId } = require("../../scripts/lib/session-commands");

test("validateSessionId accepts valid UUID v4", () => {
	const result = validateSessionId("550e8400-e29b-41d4-a716-446655440000");
	assert.strictEqual(result.valid, true);
});

test("validateSessionId accepts lowercase UUID v4", () => {
	const result = validateSessionId("a1b2c3d4-e5f6-4789-abcd-ef0123456789");
	assert.strictEqual(result.valid, true);
});

test("validateSessionId accepts uppercase UUID v4", () => {
	const result = validateSessionId("A1B2C3D4-E5F6-4789-ABCD-EF0123456789");
	assert.strictEqual(result.valid, true);
});

test("validateSessionId accepts mixed case UUID v4", () => {
	const result = validateSessionId("A1b2C3d4-E5f6-4789-aBcD-Ef0123456789");
	assert.strictEqual(result.valid, true);
});

test("validateSessionId rejects .. sequences", () => {
	const result = validateSessionId("../../etc/passwd");
	assert.strictEqual(result.valid, false);
	assert.strictEqual(result.error, "Invalid session ID format");
});

test("validateSessionId rejects forward slashes", () => {
	const result = validateSessionId("a1b2c3d4-e5f6-4789-abcd-ef0123456789/../../etc/passwd");
	assert.strictEqual(result.valid, false);
	assert.strictEqual(result.error, "Invalid session ID format");
});

test("validateSessionId rejects backslashes", () => {
	const result = validateSessionId("..\\..\\windows\\system32");
	assert.strictEqual(result.valid, false);
	assert.strictEqual(result.error, "Invalid session ID format");
});

test("validateSessionId rejects mixed path separators", () => {
	const result = validateSessionId("../..\\sensitive");
	assert.strictEqual(result.valid, false);
	assert.strictEqual(result.error, "Invalid session ID format");
});

test("validateSessionId rejects null", () => {
	const result = validateSessionId(null);
	assert.strictEqual(result.valid, false);
	assert.strictEqual(result.error, "Session ID is required");
});

test("validateSessionId rejects undefined", () => {
	const result = validateSessionId(undefined);
	assert.strictEqual(result.valid, false);
	assert.strictEqual(result.error, "Session ID is required");
});

test("validateSessionId rejects empty string", () => {
	const result = validateSessionId("");
	assert.strictEqual(result.valid, false);
	assert.strictEqual(result.error, "Session ID is required");
});

test("validateSessionId rejects non-UUID string", () => {
	const result = validateSessionId("not-a-uuid");
	assert.strictEqual(result.valid, false);
	assert.strictEqual(result.error, "Invalid session ID format");
});

test("validateSessionId rejects spaces", () => {
	const result = validateSessionId("a1b2c3d4 e5f6 4789 abcd ef0123456789");
	assert.strictEqual(result.valid, false);
	assert.strictEqual(result.error, "Invalid session ID format");
});

test("validateSessionId rejects UUID v1", () => {
	const result = validateSessionId("550e8400-e29b-11d4-a716-446655440000");
	assert.strictEqual(result.valid, false);
	assert.strictEqual(result.error, "Invalid session ID format");
});

test("validateSessionId rejects UUID v3", () => {
	const result = validateSessionId("a987fbc9-4bed-3078-cf07-9141ba07c9f3");
	assert.strictEqual(result.valid, false);
	assert.strictEqual(result.error, "Invalid session ID format");
});

test("validateSessionId rejects UUID v5", () => {
	const result = validateSessionId("886313e1-3b8a-5372-9b90-0c9aee199e5d");
	assert.strictEqual(result.valid, false);
	assert.strictEqual(result.error, "Invalid session ID format");
});

test("validateSessionId rejects wrong variant bits", () => {
	const result = validateSessionId("550e8400-e29b-41d4-0716-446655440000");
	assert.strictEqual(result.valid, false);
	assert.strictEqual(result.error, "Invalid session ID format");
});
