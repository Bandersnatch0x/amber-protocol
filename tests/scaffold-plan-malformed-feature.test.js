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
	fs.writeFileSync(path.join(root, "feature_list.json"), JSON.stringify({ features }));
	return root;
}

test("scaffoldPlan errors instead of throwing when the feature lacks a verification array", () => {
	const root = tempProject([{ id: "f1", title: "T", user_visible_behavior: "x" }]);
	const result = scaffoldPlan(root, { feature: "f1" });
	assert.ok(
		result.errors.some((e) => /verification/i.test(e)),
		`expected a verification error, got: ${JSON.stringify(result.errors)}`,
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

test("scaffoldPlan refuses a feature id that would escape the target", () => {
	const escapeId = `../../../../tmp/amber-plan-escape-${process.pid}`;
	const root = tempProject([
		{
			id: escapeId,
			title: "Escape",
			user_visible_behavior: "x",
			verification: ["run npm test"],
		},
	]);
	const escaped = path.resolve(root, "docs", "plans", `${escapeId}-Escape.md`);
	try {
		const result = scaffoldPlan(root, { feature: escapeId });
		assert.deepEqual(result.created, []);
		assert.match(result.errors.join("\n"), /outside the target root/i);
		assert.equal(fs.existsSync(escaped), false);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(escaped, { force: true });
	}
});

test("scaffoldPlan refuses a symlinked plans directory", () => {
	const root = tempProject([
		{ id: "f3", title: "Linked", user_visible_behavior: "x", verification: ["run npm test"] },
	]);
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-plan-outside-"));
	try {
		fs.mkdirSync(path.join(root, "docs"), { recursive: true });
		fs.symlinkSync(outside, path.join(root, "docs", "plans"), "dir");
		const result = scaffoldPlan(root, { feature: "f3" });
		assert.deepEqual(result.created, []);
		assert.match(result.errors.join("\n"), /outside the target root/i);
		assert.deepEqual(fs.readdirSync(outside), []);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

test("scaffoldPlan trims feature-title padding in the derived plan heading", () => {
	const root = tempProject([
		{
			id: "f4",
			title: "  Good Feature  ",
			user_visible_behavior: "x",
			verification: ["run npm test"],
		},
	]);
	const result = scaffoldPlan(root, { feature: "f4" });
	assert.deepEqual(result.errors, []);
	assert.equal(result.created.length, 1);
	const content = fs.readFileSync(path.join(root, result.created[0]), "utf8");
	assert.equal(content.split(/\r?\n/)[0], "# Plan: Good Feature");
	assert.match(path.basename(result.created[0]), /f4-Good-Feature\.md$/);
	fs.rmSync(root, { recursive: true, force: true });
});

test("scaffoldPlan rejects a whitespace-only explicit title", () => {
	const root = tempProject([
		{
			id: "f5",
			title: "Good Feature",
			user_visible_behavior: "x",
			verification: ["run npm test"],
		},
	]);
	try {
		const result = scaffoldPlan(root, { feature: "f5", title: "   " });
		assert.ok(
			result.errors.includes("--title must be a non-empty string when provided."),
			`expected a title error, got: ${JSON.stringify(result.errors)}`,
		);
		assert.deepEqual(result.created, []);
		assert.equal(fs.existsSync(path.join(root, "docs", "plans")), false);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("scaffoldPlan errors instead of throwing when the feature has no title", () => {
	const root = tempProject([
		{ id: "f6", user_visible_behavior: "x", verification: ["run npm test"] },
	]);
	try {
		const result = scaffoldPlan(root, { feature: "f6" });
		assert.ok(
			result.errors.includes(
				"Feature f6 has no non-empty title in feature_list.json; run validate-feature-list to fix it.",
			),
			`expected a title error, got: ${JSON.stringify(result.errors)}`,
		);
		assert.deepEqual(result.created, []);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("scaffoldPlan rejects a whitespace-only feature title", () => {
	const root = tempProject([
		{
			id: "f7",
			title: "   ",
			user_visible_behavior: "x",
			verification: ["run npm test"],
		},
	]);
	try {
		const result = scaffoldPlan(root, { feature: "f7" });
		assert.ok(
			result.errors.includes(
				"Feature f7 has no non-empty title in feature_list.json; run validate-feature-list to fix it.",
			),
			`expected a title error, got: ${JSON.stringify(result.errors)}`,
		);
		assert.deepEqual(result.created, []);
		assert.equal(fs.existsSync(path.join(root, "docs", "plans")), false);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
