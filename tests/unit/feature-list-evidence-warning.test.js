"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateFeatureListFile } = require("../../scripts/lib/core/validators");

function writeFeatureList(dir, features) {
	fs.writeFileSync(path.join(dir, "feature_list.json"), JSON.stringify({ features }));
}

function baseFeature(over = {}) {
	return {
		id: "F001",
		priority: 1,
		area: "x",
		title: "T",
		user_visible_behavior: "U",
		status: "not_started",
		verification: ["run tests"],
		evidence: [],
		notes: [],
		...over,
	};
}

test("warns when a feature has evidence but status is still not_started", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-val-"));
	writeFeatureList(dir, [baseFeature({ evidence: ["ran tests on CI"] })]);
	const r = validateFeatureListFile(path.join(dir, "feature_list.json"));
	assert.equal(r.errors.length, 0);
	assert.ok(r.warnings.some((w) => /evidence.*not_started/i.test(w)), `warning present: ${JSON.stringify(r.warnings)}`);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("does not warn when evidence aligns with a non-not_started status", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-val-"));
	writeFeatureList(dir, [baseFeature({ status: "passing", evidence: ["ran tests"] })]);
	const r = validateFeatureListFile(path.join(dir, "feature_list.json"));
	assert.equal(r.errors.length, 0);
	assert.ok(!r.warnings.some((w) => /evidence.*not_started/i.test(w)), `no warning: ${JSON.stringify(r.warnings)}`);
	fs.rmSync(dir, { recursive: true, force: true });
});
