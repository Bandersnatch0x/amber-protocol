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
	return fs.mkdtempSync(path.join(os.tmpdir(), `stale-docs-${name}-`));
}

function runAmber(args) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd: ROOT,
		encoding: "utf8",
	});
}

test("amber maintenance stale-docs - flags doc with old Last Reviewed", () => {
	const target = tempDir("old");
	const wikiDir = path.join(target, "docs", "wiki");
	fs.mkdirSync(wikiDir, { recursive: true });
	fs.writeFileSync(path.join(wikiDir, "old.md"), "# Old Doc\n\nLast Reviewed: 2020-01-01\n");

	const result = runAmber([
		"maintenance",
		"stale-docs",
		"--target",
		target,
		"--threshold-days",
		"180",
		"--json",
	]);

	assert.strictEqual(result.status, 0);
	const json = JSON.parse(result.stdout);
	assert.strictEqual(json.staleDocs.length, 1);
	assert.strictEqual(json.staleDocs[0].lastReviewed, "2020-01-01");
	assert.ok(json.staleDocs[0].ageDays > 180);

	fs.rmSync(target, { recursive: true, force: true });
});

test("amber maintenance stale-docs - flags doc without marker", () => {
	const target = tempDir("missing");
	const wikiDir = path.join(target, "docs", "wiki");
	fs.mkdirSync(wikiDir, { recursive: true });
	fs.writeFileSync(path.join(wikiDir, "missing.md"), "# Missing Doc\n\nNo Last Reviewed marker.\n");

	const result = runAmber([
		"maintenance",
		"stale-docs",
		"--target",
		target,
		"--threshold-days",
		"180",
		"--json",
	]);

	assert.strictEqual(result.status, 0);
	const json = JSON.parse(result.stdout);
	assert.strictEqual(json.staleDocs.length, 1);
	assert.strictEqual(json.staleDocs[0].lastReviewed, null);
	assert.strictEqual(json.staleDocs[0].reason, "missing Last Reviewed marker");

	fs.rmSync(target, { recursive: true, force: true });
});

test("amber maintenance stale-docs - reports thresholdDays as a number for an explicit value", () => {
	const target = tempDir("numeric");
	fs.mkdirSync(path.join(target, "docs", "wiki"), { recursive: true });

	const result = runAmber([
		"maintenance",
		"stale-docs",
		"--target",
		target,
		"--threshold-days",
		"90",
		"--json",
	]);

	assert.strictEqual(result.status, 0);
	const json = JSON.parse(result.stdout);
	// The threshold echoed back must be a number, matching the default path.
	assert.strictEqual(json.thresholdDays, 90);
});

test("amber maintenance stale-docs - defaults thresholdDays to 180 when omitted", () => {
	const target = tempDir("default");
	fs.mkdirSync(path.join(target, "docs", "wiki"), { recursive: true });

	const result = runAmber(["maintenance", "stale-docs", "--target", target, "--json"]);

	assert.strictEqual(result.status, 0);
	const json = JSON.parse(result.stdout);
	assert.strictEqual(json.thresholdDays, 180);
});

test("amber maintenance stale-docs - skips an unedited wiki template placeholder", () => {
	const target = tempDir("pristine");
	const wikiDir = path.join(target, "docs", "wiki");
	fs.mkdirSync(wikiDir, { recursive: true });

	// Copy a real template verbatim. It has no Last Reviewed marker, so the old
	// behaviour would flag it; the placeholder-skip rule should exempt it.
	const templateGlossary = path.join(ROOT, "templates", "docs", "wiki", "glossary.md");
	fs.copyFileSync(templateGlossary, path.join(wikiDir, "glossary.md"));

	const result = runAmber(["maintenance", "stale-docs", "--target", target, "--json"]);

	assert.strictEqual(result.status, 0);
	const json = JSON.parse(result.stdout);
	assert.strictEqual(
		json.staleDocs.length,
		0,
		"an unedited template copy must not be reported as stale",
	);
});

test("amber maintenance stale-docs - flags a wiki template once it is edited", () => {
	const target = tempDir("edited");
	const wikiDir = path.join(target, "docs", "wiki");
	fs.mkdirSync(wikiDir, { recursive: true });

	const templateGlossary = path.join(ROOT, "templates", "docs", "wiki", "glossary.md");
	const dest = path.join(wikiDir, "glossary.md");
	fs.copyFileSync(templateGlossary, dest);
	// Edit the file so it no longer matches the template byte-for-byte. Now the
	// missing Last Reviewed marker is a fair signal again.
	fs.appendFileSync(dest, "\n- project-specific term added by the team\n");

	const result = runAmber(["maintenance", "stale-docs", "--target", target, "--json"]);

	assert.strictEqual(result.status, 0);
	const json = JSON.parse(result.stdout);
	assert.strictEqual(json.staleDocs.length, 1);
	assert.strictEqual(json.staleDocs[0].reason, "missing Last Reviewed marker");
});
