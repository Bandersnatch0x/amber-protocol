"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { validateFeatureListData } = require("../../scripts/lib/core/validators");

// Characterization tests for validateFeatureListData, the only pure export in
// validators.js (the rest — loadFeatureList, findFeatureById,
// validateFeatureListFile, validateContinuousImprovementStateFile, validateWiki
// — are fs-coupled and intentionally skipped here). Pin ACTUAL behavior across
// normal inputs and edge cases before any future refactor.

function validFeature(overrides = {}) {
	return {
		id: "F1",
		area: "auth",
		title: "Login",
		user_visible_behavior: "user can log in",
		status: "passing",
		priority: 1,
		verification: ["run login flow"],
		evidence: ["e1"],
		notes: [],
		...overrides,
	};
}

test("rejects null with the object error and empty warnings", () => {
	const result = validateFeatureListData(null);
	assert.deepEqual(result.errors, ["feature_list.json must contain an object."]);
	assert.deepEqual(result.warnings, []);
});

test("rejects an array with the object error", () => {
	const result = validateFeatureListData([1, 2, 3]);
	assert.deepEqual(result.errors, ["feature_list.json must contain an object."]);
});

test("rejects a primitive string with the object error", () => {
	const result = validateFeatureListData("hello");
	assert.deepEqual(result.errors, ["feature_list.json must contain an object."]);
});

test("rejects an object without a features array", () => {
	const result = validateFeatureListData({});
	assert.deepEqual(result.errors, [
		"feature_list.json must contain a features array.",
	]);
});

test("rejects a non-array features field", () => {
	const result = validateFeatureListData({ features: "not-an-array" });
	assert.deepEqual(result.errors, [
		"feature_list.json must contain a features array.",
	]);
});

test("accepts a well-formed single feature with no errors or warnings", () => {
	const result = validateFeatureListData({ features: [validFeature()] });
	assert.deepEqual(result.errors, []);
	assert.deepEqual(result.warnings, []);
});

test("flags duplicate feature ids with the index prefix", () => {
	const result = validateFeatureListData({
		features: [validFeature(), validFeature({ id: "F1" })],
	});
	assert.deepEqual(result.errors, ["features[1].id duplicates F1."]);
});

test("errors when more than one feature is in_progress", () => {
	const result = validateFeatureListData({
		features: [
			validFeature({ id: "F1", status: "in_progress" }),
			validFeature({ id: "F2", status: "in_progress" }),
		],
	});
	assert.deepEqual(result.errors, ["At most one feature can be in_progress."]);
});

test("errors when a passing feature has no evidence", () => {
	const result = validateFeatureListData({
		features: [validFeature({ status: "passing", evidence: [] })],
	});
	assert.deepEqual(result.errors, ["features[0] is passing but has no evidence."]);
});

test("warns when a blocked feature has no notes", () => {
	const result = validateFeatureListData({
		features: [validFeature({ status: "blocked", notes: [] })],
	});
	assert.deepEqual(result.errors, []);
	assert.deepEqual(result.warnings, [
		"features[0] is blocked but has no notes.",
	]);
});

test("errors on an invalid status using the canonical set order", () => {
	const result = validateFeatureListData({
		features: [validFeature({ status: "done" })],
	});
	assert.deepEqual(result.errors, [
		"features[0].status must be one of not_started, in_progress, blocked, passing, accepted.",
	]);
});

test("errors on a non-integer priority (float)", () => {
	const result = validateFeatureListData({
		features: [validFeature({ priority: 1.5 })],
	});
	assert.deepEqual(result.errors, ["features[0].priority must be an integer."]);
});

test("errors on an empty verification array and on a blank step", () => {
	const empty = validateFeatureListData({
		features: [validFeature({ verification: [] })],
	});
	assert.deepEqual(empty.errors, [
		"features[0].verification must contain at least one step.",
	]);

	const blankStep = validateFeatureListData({
		features: [validFeature({ verification: ["  "] })],
	});
	assert.deepEqual(blankStep.errors, [
		"features[0].verification steps must be non-empty strings.",
	]);
});

test("paths is optional — feature without paths is valid", () => {
	const r = validateFeatureListData({ features: [validFeature()] });
	assert.strictEqual(r.errors.length, 0);
});

test("paths present and valid is accepted", () => {
	const r = validateFeatureListData({
		features: [validFeature({ paths: ["src/auth", "docs/auth.md"] })],
	});
	assert.strictEqual(r.errors.length, 0);
});

test("paths must be a non-empty array if present", () => {
	const r1 = validateFeatureListData({
		features: [validFeature({ paths: "src/auth" })],
	});
	assert.ok(r1.errors.some((e) => e.includes("paths must be a non-empty array")));
	const r2 = validateFeatureListData({
		features: [validFeature({ paths: [] })],
	});
	assert.ok(r2.errors.some((e) => e.includes("paths must be a non-empty array")));
});

test("paths entries must be non-empty strings", () => {
	const r = validateFeatureListData({
		features: [validFeature({ paths: ["ok", "  "] })],
	});
	assert.ok(r.errors.some((e) => e.includes("paths entries must be non-empty strings")));
});

test("accumulates every field error for an empty feature object", () => {
	const result = validateFeatureListData({ features: [{}] });
	assert.deepEqual(result.errors, [
		"features[0].id must be a non-empty string.",
		"features[0].area must be a non-empty string.",
		"features[0].title must be a non-empty string.",
		"features[0].user_visible_behavior must be a non-empty string.",
		"features[0].status must be a non-empty string.",
		"features[0].priority must be an integer.",
		"features[0].verification must contain at least one step.",
		"features[0].evidence must be an array.",
		"features[0].notes must be an array.",
		"features[0].status must be one of not_started, in_progress, blocked, passing, accepted.",
	]);
});
