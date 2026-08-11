"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	MESSAGES,
	formatAdoptionBoundaryLines,
	defaultAdoptionBoundaries,
} = require("../../scripts/lib/core/terminology");

test("terminology exposes canonical adoption boundary labels", () => {
	const boundaries = defaultAdoptionBoundaries();
	const lines = formatAdoptionBoundaryLines(boundaries);
	assert.match(lines.join("\n"), /Target repository files copied: false/);
	assert.match(lines.join("\n"), /Target repository commands executed: false/);
});

test("terminology avoids legacy target project wording in adoption messages", () => {
	assert.doesNotMatch(MESSAGES.adoptionReviewBeforeChange, /target project/i);
	assert.doesNotMatch(MESSAGES.adoptionReadOnlyBundleNotice, /target project/i);
});
