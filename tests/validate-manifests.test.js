"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

const { validateManifests } = require("../scripts/lib/core/manifests");

function fixture(name) {
	return path.join(__dirname, "fixtures", name);
}

function runValidateManifests(args) {
	return spawnSync(
		process.execPath,
		[path.join(ROOT, "scripts", "validate-manifests.js"), ...args],
		{
			cwd: ROOT,
			encoding: "utf8",
		},
	);
}

test("current plugin manifests are locally valid", () => {
	const result = validateManifests(ROOT);

	assert.deepEqual(result.errors, []);
});

test("manifest validator reports missing required manifest", () => {
	const result = validateManifests(fixture("bad-manifests-missing-codex"));

	assert.ok(
		result.errors.some((error) =>
			error.includes("Missing required manifest: .codex-plugin/plugin.json"),
		),
	);
});

test("manifest validator reports invalid JSON and missing skills paths", () => {
	const invalidJson = validateManifests(fixture("bad-manifests-invalid-json"));
	const missingSkills = validateManifests(fixture("bad-manifests-missing-skills"));

	assert.ok(invalidJson.errors.some((error) => /must contain valid JSON/.test(error)));
	assert.ok(missingSkills.errors.some((error) => /skills path does not exist/.test(error)));
});

test("validate-manifests wrapper returns parseable JSON and non-zero on failure", () => {
	const result = runValidateManifests([
		"--target",
		fixture("bad-manifests-missing-skills"),
		"--json",
	]);

	assert.notEqual(result.status, 0);
	const payload = JSON.parse(result.stdout);
	assert.ok(Array.isArray(payload.errors));
	assert.ok(payload.errors.length > 0);
});
