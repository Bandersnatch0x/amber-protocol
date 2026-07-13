"use strict";

// Unit coverage for shellQuote in text-utils.js — the target-safety primitive
// (#41) that keeps spaces/metacharacters in emitted remedy paths from splitting
// a copy-pasted command into multiple shell arguments.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { shellQuote } = require("../../scripts/lib/core/text-utils");

test("shellQuote leaves safe single-token args unquoted", () => {
	assert.equal(shellQuote("."), ".");
	assert.equal(shellQuote("docs/plans/Foo.md"), "docs/plans/Foo.md");
	assert.equal(shellQuote("npm"), "npm");
});

test("shellQuote single-quotes args containing spaces or metacharacters", () => {
	assert.equal(shellQuote("a b"), "'a b'");
	assert.equal(shellQuote("/path/with space"), "'/path/with space'");
	assert.equal(shellQuote("npm test"), "'npm test'");
});

test("shellQuote escapes embedded single quotes (POSIX '\\'')", () => {
	assert.equal(shellQuote("a'b"), "'a'\\''b'");
});

test("shellQuote quotes empty strings and stringifies non-strings", () => {
	assert.equal(shellQuote(""), "''");
	assert.equal(shellQuote(null), "''");
	assert.equal(shellQuote(undefined), "''");
});
