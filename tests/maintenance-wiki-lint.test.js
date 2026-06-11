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
