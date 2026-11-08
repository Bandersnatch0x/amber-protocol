"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { safeId } = require("../../scripts/lib/harness/ids.js");

test("safeId preserves the filename allowlist A-Za-z0-9._-", () => {
	assert.equal(safeId("run-1_alpha.beta"), "run-1_alpha.beta");
	assert.equal(safeId("ABC123"), "ABC123");
});

test("safeId replaces every character outside the allowlist with a dash", () => {
	assert.equal(safeId("a b"), "a-b");
	assert.equal(safeId("a/b"), "a-b");
	assert.equal(safeId("a\\b"), "a-b");
	assert.equal(safeId("a:b"), "a-b");
	assert.equal(safeId("a+b"), "a-b");
	assert.equal(safeId("Ünïcode"), "-n-code");
});

test("safeId does not reject traversal dots (documented current behavior)", () => {
	// `..` stays because dots are in the allowlist. This is a known gap, not
	// an accident: changing it is a separate decision tracked in issues/0204.
	assert.equal(safeId(".."), "..");
	assert.equal(safeId("../etc/passwd"), "..-etc-passwd");
});

test("safeId stringifies non-string input", () => {
	assert.equal(safeId(123), "123");
	assert.equal(safeId(null), "null");
});
