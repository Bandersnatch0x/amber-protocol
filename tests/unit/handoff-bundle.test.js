"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { scaffoldHarness } = require("../../scripts/lib/core/scaffold");
const { addFeature, recordFeatureEvidence } = require("../../scripts/lib/feature-commands");
const { writeHandoffBundle, validateHandoffBundle } = require("../../scripts/lib/core/handoff-bundle");

function tempDir(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-handoff-bundle-${name}-`));
}

test("writeHandoffBundle creates the complete continuation artifact set", () => {
	const target = tempDir("write");
	scaffoldHarness(target);
	addFeature(target, { id: "F002", title: "complete delivery loop", area: "product" });
	recordFeatureEvidence(target, {
		feature: "F002",
		command: "npm test",
		result: "passed (exit 0)",
	});

	const result = writeHandoffBundle(target);

	assert.deepEqual(result.errors, []);
	assert.equal(result.files.length, 7);
	for (const rel of [
		"README.md",
		"session-summary.md",
		"verification-evidence.md",
		"next-actions.md",
		"risks.md",
		"recovery-commands.md",
		"manifest.json",
	]) {
		assert.ok(fs.existsSync(path.join(result.outputDir, rel)), `${rel} exists`);
	}

	const manifest = JSON.parse(fs.readFileSync(path.join(result.outputDir, "manifest.json"), "utf8"));
	assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.artifactType, "amber-handoff-bundle");
	assert.ok(manifest.files.includes("next-actions.md"));

	const validation = validateHandoffBundle(result.outputDir);
	assert.equal(validation.valid, true);
	assert.deepEqual(validation.errors, []);
});

test("validateHandoffBundle reports missing required files", () => {
	const target = tempDir("validate");
	const bundleDir = path.join(target, ".amber", "handoff", "latest");
	fs.mkdirSync(bundleDir, { recursive: true });
	fs.writeFileSync(path.join(bundleDir, "README.md"), "# partial\n");

	const validation = validateHandoffBundle(bundleDir);

	assert.equal(validation.valid, false);
	assert.ok(validation.errors.some((error) => error.includes("manifest.json is missing")));
	assert.ok(validation.errors.some((error) => error.includes("session-summary.md is missing")));
});
