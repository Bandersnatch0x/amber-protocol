"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { addFeature } = require("../../scripts/lib/feature-commands");

function tmpDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-feat-"));
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify({ features: [] }, null, 2) + "\n",
	);
	return dir;
}

test("addFeature stores paths array from comma-separated string", () => {
	const dir = tmpDir();
	const r = addFeature(dir, { id: "F10", title: "T", paths: "src/a,src/b" });
	assert.deepStrictEqual(r.feature.paths, ["src/a", "src/b"]);
});

test("addFeature omits paths when not provided", () => {
	const dir = tmpDir();
	const r = addFeature(dir, { id: "F11", title: "T" });
	assert.strictEqual("paths" in r.feature, false);
});

test("addFeature stores user_visible_behavior from --behavior (#75)", () => {
	const dir = tmpDir();
	const r = addFeature(dir, {
		id: "F12",
		title: "T",
		area: "core",
		behavior: "User sees a clear result.",
	});
	assert.strictEqual(r.feature.user_visible_behavior, "User sees a clear result.");
	assert.deepStrictEqual(r.errors, []);
});

test("addFeature stores verification array from repeatable --verify (#75)", () => {
	const dir = tmpDir();
	const r = addFeature(dir, {
		id: "F13",
		title: "T",
		area: "core",
		behavior: "User sees X.",
		verify: ["npm test", "npm run build"],
	});
	assert.deepStrictEqual(r.feature.verification, ["npm test", "npm run build"]);
	assert.deepStrictEqual(r.errors, []);
	assert.deepStrictEqual(r.warnings, []);
});

test("addFeature accepts comma-separated --verify string (#75)", () => {
	const dir = tmpDir();
	const r = addFeature(dir, {
		id: "F14",
		title: "T",
		area: "core",
		behavior: "User sees X.",
		verify: "npm test,npm run build",
	});
	assert.deepStrictEqual(r.feature.verification, ["npm test", "npm run build"]);
});

test("addFeature warns when fields doctor requires are missing (#75)", () => {
	const dir = tmpDir();
	const r = addFeature(dir, { id: "F15", title: "T", area: "core" });
	const joined = (r.warnings || []).join(" ");
	assert.ok(
		joined.includes("--behavior"),
		`expected warning to mention --behavior, got: ${joined}`,
	);
	assert.ok(joined.includes("--verify"), `expected warning to mention --verify, got: ${joined}`);
});

test("addFeature produces a doctor-valid feature when all flags are passed (#75)", () => {
	const dir = tmpDir();
	const r = addFeature(dir, {
		id: "F16",
		title: "T",
		area: "core",
		behavior: "User sees X.",
		verify: ["npm test"],
	});
	assert.deepStrictEqual(r.warnings, []);
	const { validateFeatureListData } = require("../../scripts/lib/core/validators");
	const v = validateFeatureListData({ features: [r.feature] });
	assert.deepStrictEqual(v.errors, []);
});
