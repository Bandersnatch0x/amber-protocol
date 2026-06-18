"use strict";

// Unit tests for inspectProjectProfile's corrupt-file hardening. readJson
// returns whatever the file parses to, so a profile whose contents are a valid
// JSON literal `null` (or any non-object) parses cleanly but is not an object.
// The inspector must surface that as a validation error instead of crashing on
// a bare `data.standards` / `data.id` access — mirroring how the session and
// manifest readers already survive a corrupt file.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	inspectProjectProfile,
} = require("../../scripts/lib/core/profiles");

function tempProfile(contents) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "profile-corrupt-"));
	const filePath = path.join(dir, "default.profile.json");
	fs.writeFileSync(filePath, contents);
	return filePath;
}

test("inspectProjectProfile reports an error instead of throwing on a JSON null body", () => {
	const filePath = tempProfile("null");
	const result = inspectProjectProfile(filePath);
	assert.ok(
		result.errors.some((e) => /must contain an object/.test(e)),
		`expected an object-shape error, got: ${JSON.stringify(result.errors)}`,
	);
});

test("inspectProjectProfile reports an error instead of throwing on a JSON scalar body", () => {
	const filePath = tempProfile("42");
	const result = inspectProjectProfile(filePath);
	assert.ok(result.errors.length > 0);
});

test("inspectProjectProfile reports an error instead of throwing on a JSON array body", () => {
	const filePath = tempProfile("[]");
	const result = inspectProjectProfile(filePath);
	assert.ok(result.errors.length > 0);
});
