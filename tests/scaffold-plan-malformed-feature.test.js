"use strict";

// scaffoldPlan reads feature_list.json (untrusted target input) and hands the
// feature to buildPlanContent, whose pinned contract maps feature.verification
// unconditionally. A feature missing its verification array used to crash the
// builder and escape to the CLI top-level catch, bypassing the {errors} envelope.
// scaffoldPlan must surface a clean error at the command boundary instead.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { scaffoldPlan } = require("../scripts/lib/core/planning");

function tempProject(features) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-plan-"));
	fs.writeFileSync(
		path.join(root, "feature_list.json"),
		JSON.stringify({ features })
	);
	return root;
}

test("scaffoldPlan errors instead of throwing when the feature lacks a verification array", () => {
	const root = tempProject([
		{ id: "f1", title: "T", user_visible_behavior: "x" },
	]);
	const result = scaffoldPlan(root, { feature: "f1" });
	assert.ok(
		result.errors.some((e) => /verification/i.test(e)),
		`expected a verification error, got: ${JSON.stringify(result.errors)}`
	);
	assert.deepEqual(result.created, []);
	fs.rmSync(root, { recursive: true, force: true });
});

test("scaffoldPlan still scaffolds a plan for a well-formed feature", () => {
	const root = tempProject([
		{
			id: "f2",
			title: "Good Feature",
			user_visible_behavior: "x",
			verification: ["run npm test"],
		},
	]);
	const result = scaffoldPlan(root, { feature: "f2" });
	assert.deepEqual(result.errors, []);
	assert.equal(result.created.length, 1);
	fs.rmSync(root, { recursive: true, force: true });
});
