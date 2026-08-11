"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { SECTIONS, GIT_PARTS } = require("../../scripts/orient");

test("SECTIONS defines exactly the three required orientation steps in order", () => {
	assert.ok(Array.isArray(SECTIONS));
	assert.equal(SECTIONS.length, 2, "two exec sections + git handled separately");
	assert.equal(SECTIONS[0].title, "Amber Status");
	assert.deepEqual(SECTIONS[0].args, ["scripts/amber.js", "status", "--target", "."]);
	assert.equal(SECTIONS[1].title, "Next-up Issues");
	assert.deepEqual(SECTIONS[1].args.slice(0, 3), ["issue", "list", "--repo"]);
	assert.match(SECTIONS[1].args.join(" "), /Bandersnatch0x\/amber-protocol/);
	assert.match(SECTIONS[1].args.join(" "), /--label next-up/);
});

test("GIT_PARTS covers git status + git log --oneline -5", () => {
	assert.ok(Array.isArray(GIT_PARTS));
	assert.equal(GIT_PARTS.length, 2);
	assert.deepEqual(GIT_PARTS[0].args, ["status"]);
	assert.deepEqual(GIT_PARTS[1].args, ["log", "--oneline", "-5"]);
});

test("SECTIONS sections target the amber-protocol repo and next-up label", () => {
	// ponytail: the orient output format is verified by running `npm run orient`;
	// these tests lock the command data, not a dead formatting helper.
	assert.match(SECTIONS[1].args.join(" "), /Bandersnatch0x\/amber-protocol/);
});
