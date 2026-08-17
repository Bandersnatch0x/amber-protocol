"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

const { validateManifests, validateSkillsPath } = require("../scripts/lib/core/manifests");

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

test("plugin manifests use host-compatible root-relative skill shapes", () => {
	const claudeManifest = JSON.parse(
		fs.readFileSync(path.join(ROOT, ".claude-plugin", "plugin.json"), "utf8"),
	);
	const codexManifest = JSON.parse(
		fs.readFileSync(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf8"),
	);

	assert.deepEqual(claudeManifest.skills, ["./skills/"]);
	assert.equal(codexManifest.skills, "./skills/");
});

test("manifest validator rejects skill paths outside the plugin root", () => {
	const errors = [];

	validateSkillsPath(ROOT, ".claude-plugin/plugin.json", ["../skills"], errors, "array");

	assert.deepEqual(errors, [
		".claude-plugin/plugin.json skills path must stay within plugin root: ../skills",
	]);
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
