"use strict";

// Unit coverage for the markdown text utilities in text-utils.js. These are
// pure parsing/escaping helpers used across adoption report rendering and the
// fragile prose-parsing paths, yet had no direct tests. Pin their edge cases.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	escapeMarkdownTableCell,
	extractMarkdownLinks,
	extractMarkdownListUnderSubheading,
} = require("../../scripts/lib/core/text-utils");

// ---- escapeMarkdownTableCell ----

test("escapeMarkdownTableCell escapes pipes and flattens newlines", () => {
	assert.equal(escapeMarkdownTableCell("a|b"), "a\\|b");
	assert.equal(escapeMarkdownTableCell("a\nb"), "a b");
	assert.equal(escapeMarkdownTableCell("a\r\nb"), "a b");
	assert.equal(escapeMarkdownTableCell("x|y\nz"), "x\\|y z");
});

test("escapeMarkdownTableCell coerces null/undefined to an empty string", () => {
	assert.equal(escapeMarkdownTableCell(null), "");
	assert.equal(escapeMarkdownTableCell(undefined), "");
	assert.equal(escapeMarkdownTableCell(0), "");
});

// ---- extractMarkdownLinks ----

test("extractMarkdownLinks pulls targets from inline and image links", () => {
	assert.deepEqual(extractMarkdownLinks("see [docs](./guide.md) here"), ["./guide.md"]);
	assert.deepEqual(extractMarkdownLinks("![alt](img.png)"), ["img.png"]);
	assert.deepEqual(
		extractMarkdownLinks("[a](one.md) and [b](two.md)"),
		["one.md", "two.md"],
	);
});

test("extractMarkdownLinks strips titles and angle brackets, ignores empty targets", () => {
	assert.deepEqual(extractMarkdownLinks('[a](url "Title")'), ["url"]);
	assert.deepEqual(extractMarkdownLinks("[a](<spaced url>)"), ["spaced"]);
	assert.deepEqual(extractMarkdownLinks("[a]( )"), []); // whitespace-only target
	assert.deepEqual(extractMarkdownLinks("no links here"), []);
});

// ---- extractMarkdownListUnderSubheading ----

const REPORT = [
	"### Candidate Commands",
	"- pytest",
	"- ruff",
	"### Unknowns",
	"- none",
	"## Next Section",
	"- ignored",
].join("\n");

test("extractMarkdownListUnderSubheading collects items until the next heading", () => {
	assert.deepEqual(extractMarkdownListUnderSubheading(REPORT, "Candidate Commands"), [
		"pytest",
		"ruff",
	]);
});

test("extractMarkdownListUnderSubheading treats a sole 'none' item as empty", () => {
	assert.deepEqual(extractMarkdownListUnderSubheading(REPORT, "Unknowns"), []);
});

test("extractMarkdownListUnderSubheading matches the heading case-insensitively", () => {
	assert.deepEqual(
		extractMarkdownListUnderSubheading(REPORT, "candidate commands"),
		["pytest", "ruff"],
	);
});

test("extractMarkdownListUnderSubheading returns [] when the heading is absent", () => {
	assert.deepEqual(extractMarkdownListUnderSubheading(REPORT, "Missing Heading"), []);
});
