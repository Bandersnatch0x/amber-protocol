"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
	loadReleaseVersions,
	validateReleaseVersions,
} = require("../../scripts/validate-release-versions");

test("stable release accepts matching root and dsh package versions", () => {
	const errors = validateReleaseVersions({
		tag: "v1.6.0",
		rootVersion: "1.6.0",
		dshVersion: "1.6.0",
		dshDependency: "^1.6.0",
	});

	assert.deepEqual(errors, []);
});

test("stable release rejects a tag that does not match the root version", () => {
	const errors = validateReleaseVersions({
		tag: "v1.6.0",
		rootVersion: "1.5.1",
		dshVersion: "1.6.0",
		dshDependency: "^1.6.0",
	});

	assert.deepEqual(errors, ['root version "1.5.1" does not match tag v1.6.0']);
});

test("stable release rejects a dsh version that drifted from the tag", () => {
	const errors = validateReleaseVersions({
		tag: "v1.6.0",
		rootVersion: "1.6.0",
		dshVersion: "1.5.1",
		dshDependency: "^1.6.0",
	});

	assert.deepEqual(errors, ['dsh version "1.5.1" does not match tag v1.6.0']);
});

test("stable release rejects a dsh dependency that is not the tag lower bound", () => {
	const errors = validateReleaseVersions({
		tag: "v1.6.0",
		rootVersion: "1.6.0",
		dshVersion: "1.6.0",
		dshDependency: "^1.5.1",
	});

	assert.deepEqual(errors, ['dsh amber-protocol dependency "^1.5.1" does not match "^1.6.0"']);
});

test("stable release collects every lockstep mismatch", () => {
	const errors = validateReleaseVersions({
		tag: "v1.6.0",
		rootVersion: "1.5.1",
		dshVersion: "1.4.0",
		dshDependency: "^1.4.0",
	});

	assert.deepEqual(errors, [
		'root version "1.5.1" does not match tag v1.6.0',
		'dsh version "1.4.0" does not match tag v1.6.0',
		'dsh amber-protocol dependency "^1.4.0" does not match "^1.6.0"',
	]);
});

test("prerelease tags are not a valid lockstep release", () => {
	const errors = validateReleaseVersions({
		tag: "v1.6.0-rc.1",
		rootVersion: "1.6.0",
		dshVersion: "1.6.0",
		dshDependency: "^1.6.0",
	});

	assert.deepEqual(errors, ['tag must be a stable vX.Y.Z ref, got "v1.6.0-rc.1"']);
});

test("loadReleaseVersions reads root and dsh manifests from a workspace", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-release-versions-"));
	fs.writeFileSync(
		path.join(dir, "package.json"),
		JSON.stringify({ name: "amber-protocol", version: "1.6.0" }),
	);
	fs.mkdirSync(path.join(dir, "dsh"));
	fs.writeFileSync(
		path.join(dir, "dsh", "package.json"),
		JSON.stringify({
			name: "dsh-amber-protocol",
			version: "1.6.0",
			dependencies: { "amber-protocol": "^1.6.0" },
		}),
	);

	assert.deepEqual(loadReleaseVersions(dir), {
		rootVersion: "1.6.0",
		dshVersion: "1.6.0",
		dshDependency: "^1.6.0",
	});
	fs.rmSync(dir, { recursive: true, force: true });
});
