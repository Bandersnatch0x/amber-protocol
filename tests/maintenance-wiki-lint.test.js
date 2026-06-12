"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function tempDir(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `wiki-lint-${name}-`));
}

function runAmber(args) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd: ROOT,
		encoding: "utf8",
	});
}

test("amber maintenance wiki-lint - detects broken wikilink", () => {
	const target = tempDir("broken");
	const wikiDir = path.join(target, "docs", "wiki");
	fs.mkdirSync(wikiDir, { recursive: true });
	fs.writeFileSync(
		path.join(wikiDir, "index.md"),
		"# Index\n\n[Broken link](missing.md)\n"
	);

	const result = runAmber([
		"maintenance",
		"wiki-lint",
		"--target",
		target,
		"--json",
	]);

	assert.strictEqual(result.status, 1);
	const json = JSON.parse(result.stdout);
	assert.strictEqual(json.errors.length, 1);
	assert.ok(json.errors[0].includes("missing.md"));

	fs.rmSync(target, { recursive: true, force: true });
});

test("amber maintenance wiki-lint - valid wiki has no errors", () => {
	const target = tempDir("valid");
	const wikiDir = path.join(target, "docs", "wiki");
	fs.mkdirSync(wikiDir, { recursive: true });
	fs.writeFileSync(
		path.join(wikiDir, "index.md"),
		"# Index\n\n[Valid link](other.md)\n"
	);
	fs.writeFileSync(
		path.join(wikiDir, "other.md"),
		"# Other\n"
	);

	const result = runAmber([
		"maintenance",
		"wiki-lint",
		"--target",
		target,
		"--json",
	]);

	assert.strictEqual(result.status, 0);
	const json = JSON.parse(result.stdout);
	assert.strictEqual(json.errors.length, 0);

	fs.rmSync(target, { recursive: true, force: true });
});

test("amber maintenance wiki-lint --fix-markers appends missing marker sections", () => {
	const target = tempDir("fix-markers");
	const productDir = path.join(target, "docs", "wiki", "product");
	fs.mkdirSync(productDir, { recursive: true });
	fs.writeFileSync(
		path.join(target, "docs", "wiki", "index.md"),
		"# Index\n\n[Overview](product/overview.md)\n"
	);
	fs.writeFileSync(
		path.join(productDir, "overview.md"),
		"# Product Overview\n\n## Goal\n\nSomething.\n"
	);

	const result = runAmber([
		"maintenance",
		"wiki-lint",
		"--target",
		target,
		"--fix-markers",
		"--json",
	]);

	assert.strictEqual(result.status, 0);
	const json = JSON.parse(result.stdout);
	assert.deepEqual(json.fixedMarkers, ["docs/wiki/product/overview.md"]);
	assert.strictEqual(json.fixedMarkerCount, 1);

	const content = fs.readFileSync(path.join(productDir, "overview.md"), "utf8");
	assert.match(content, /## Unknowns \/ Needs Confirmation/);
	assert.strictEqual(
		content.match(/## Unknowns \/ Needs Confirmation/g).length,
		1,
	);

	// Second run is a no-op: the marker already exists.
	const second = runAmber([
		"maintenance",
		"wiki-lint",
		"--target",
		target,
		"--fix-markers",
		"--json",
	]);
	assert.strictEqual(second.status, 0);
	const secondJson = JSON.parse(second.stdout);
	assert.deepEqual(secondJson.fixedMarkers, []);

	fs.rmSync(target, { recursive: true, force: true });
});
