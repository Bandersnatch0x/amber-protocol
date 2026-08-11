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
	return fs.mkdtempSync(path.join(os.tmpdir(), `evolution-rollup-${name}-`));
}

function runAmber(args) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd: ROOT,
		encoding: "utf8",
	});
}

test("amber maintenance evolution-rollup - filters by threshold", () => {
	const target = tempDir("threshold");
	const evolutionDir = path.join(target, "docs", "wiki", "engineering");
	fs.mkdirSync(evolutionDir, { recursive: true });
	fs.writeFileSync(
		path.join(evolutionDir, "harness-evolution.md"),
		"# Evolution\n\nFinding: X\nFinding: X\nFinding: X\nFinding: Y\n",
	);

	const result = runAmber(["maintenance", "evolution-rollup", "--target", target, "--json"]);

	assert.strictEqual(result.status, 0);
	const json = JSON.parse(result.stdout);
	assert.strictEqual(json.findings.length, 1);
	assert.strictEqual(json.findings[0].text, "X");
	assert.strictEqual(json.findings[0].count, 3);
	assert.strictEqual(json.threshold, 2);

	fs.rmSync(target, { recursive: true, force: true });
});

test("amber maintenance evolution-rollup - --threshold 1 surfaces single-occurrence findings", () => {
	const target = tempDir("threshold-low");
	const evolutionDir = path.join(target, "docs", "wiki", "engineering");
	fs.mkdirSync(evolutionDir, { recursive: true });
	fs.writeFileSync(
		path.join(evolutionDir, "harness-evolution.md"),
		"# Evolution\n\nFinding: X\nFinding: X\nFinding: Y\n",
	);

	const result = runAmber([
		"maintenance",
		"evolution-rollup",
		"--target",
		target,
		"--threshold",
		"1",
		"--json",
	]);

	assert.strictEqual(result.status, 0);
	const json = JSON.parse(result.stdout);
	assert.strictEqual(json.threshold, 1);
	assert.deepStrictEqual(
		json.findings.map((f) => [f.text, f.count]),
		[
			["X", 2],
			["Y", 1],
		],
	);

	fs.rmSync(target, { recursive: true, force: true });
});

test("amber maintenance evolution-rollup - --threshold 3 excludes findings below the cutoff", () => {
	const target = tempDir("threshold-high");
	const evolutionDir = path.join(target, "docs", "wiki", "engineering");
	fs.mkdirSync(evolutionDir, { recursive: true });
	fs.writeFileSync(
		path.join(evolutionDir, "harness-evolution.md"),
		"# Evolution\n\nFinding: X\nFinding: X\nFinding: X\nFinding: Y\nFinding: Y\n",
	);

	const result = runAmber([
		"maintenance",
		"evolution-rollup",
		"--target",
		target,
		"--threshold",
		"3",
		"--json",
	]);

	assert.strictEqual(result.status, 0);
	const json = JSON.parse(result.stdout);
	assert.strictEqual(json.threshold, 3);
	assert.deepStrictEqual(
		json.findings.map((f) => f.text),
		["X"],
	);

	fs.rmSync(target, { recursive: true, force: true });
});
