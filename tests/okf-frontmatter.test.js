"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { parseOkfFrontmatter, validateOkfFrontmatter } = require("../scripts/lib/core/okf-frontmatter");

const VALID_PAGE = [
	"---",
	"type: concept",
	"title: System Map",
	"description: The stable component map.",
	"tags: [architecture, map]",
	"updated: 2026-06-17",
	"---",
	"",
	"# System Map",
	"",
	"Body content here.",
].join("\n");

test("parseOkfFrontmatter extracts scalar fields from a valid block", () => {
	const { data } = parseOkfFrontmatter(VALID_PAGE);
	assert.equal(data.type, "concept");
	assert.equal(data.title, "System Map");
});

test("parseOkfFrontmatter parses inline array tags", () => {
	const { data } = parseOkfFrontmatter(VALID_PAGE);
	assert.deepEqual(data.tags, ["architecture", "map"]);
});

test("parseOkfFrontmatter separates the markdown body from frontmatter", () => {
	const { body } = parseOkfFrontmatter(VALID_PAGE);
	assert.ok(body.includes("# System Map"));
	assert.ok(!body.includes("type: concept"));
});

test("parseOkfFrontmatter returns null data when there is no frontmatter", () => {
	const { data, body } = parseOkfFrontmatter("# Just a heading\n\nNo frontmatter.");
	assert.equal(data, null);
	assert.ok(body.includes("Just a heading"));
});

test("validateOkfFrontmatter passes for a conformant page", () => {
	const result = validateOkfFrontmatter(VALID_PAGE);
	assert.deepEqual(result.errors, []);
});

test("validateOkfFrontmatter errors when the frontmatter block is missing", () => {
	const result = validateOkfFrontmatter("# No frontmatter here\n");
	assert.ok(result.errors.some((error) => /frontmatter/i.test(error)));
});

test("validateOkfFrontmatter errors when the required type field is missing", () => {
	const page = ["---", "title: Missing type", "---", "", "# Body"].join("\n");
	const result = validateOkfFrontmatter(page);
	assert.ok(result.errors.some((error) => /type/.test(error)));
});

test("validateOkfFrontmatter warns when recommended fields are absent", () => {
	const page = ["---", "type: concept", "---", "", "# Body"].join("\n");
	const result = validateOkfFrontmatter(page);
	assert.deepEqual(result.errors, []);
	assert.ok(result.warnings.some((warning) => /title|description/.test(warning)));
});
