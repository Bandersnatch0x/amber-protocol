"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("node:child_process");

const {
	detectArtifactDrift,
} = require("../../scripts/lib/core/artifact-drift");

function mkRepo(features, touchPath = null) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-art-"));
	execSync("git init -q", { cwd: dir });
	execSync("git config user.email t@t.t && git config user.name t", { cwd: dir });
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify({ features }, null, 2),
	);
	if (touchPath) {
		fs.mkdirSync(path.dirname(path.join(dir, touchPath)), { recursive: true });
		fs.writeFileSync(path.join(dir, touchPath), "x");
		execSync("git add -A && git commit -q -m init", { cwd: dir });
	} else {
		execSync("git add -A && git commit -q -m init", { cwd: dir });
	}
	return dir;
}

const E = (date) => [{ command: "c", result: "pass", date }];
const baseF = (over) => ({
	id: "F1",
	priority: 1,
	area: "a",
	title: "t",
	user_visible_behavior: "b",
	status: "passing",
	verification: ["v"],
	evidence: [],
	notes: [],
	...over,
});

test("non-git repo -> available:false with note", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-art-"));
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify({ features: [] }),
	);
	const r = detectArtifactDrift(dir);
	assert.strictEqual(r.available, false);
	assert.match(r.note, /non-git/);
});

test("drifted: commit date newer than evidence date", () => {
	const dir = mkRepo([baseF({ paths: ["src/a"], evidence: E("2020-01-01") })], "src/a");
	const r = detectArtifactDrift(dir);
	assert.strictEqual(r.counts.drifted, 1);
	assert.strictEqual(r.counts.aligned, 0);
});

test("aligned: no commit after evidence date", () => {
	const dir = mkRepo([baseF({ paths: ["src/a"], evidence: E("2099-01-01") })], "src/a");
	const r = detectArtifactDrift(dir);
	assert.strictEqual(r.counts.aligned, 1);
	assert.strictEqual(r.counts.drifted, 0);
});

test("path-unknown: declared path git never touched", () => {
	const dir = mkRepo([baseF({ paths: ["does/not/exist"], evidence: E("2020-01-01") })], "src/a");
	const r = detectArtifactDrift(dir);
	assert.strictEqual(r.skippedBreakdown.pathUnknown, 1);
});

test("no-evidence: paths but empty evidence", () => {
	const dir = mkRepo([baseF({ paths: ["src/a"], evidence: [] })], "src/a");
	const r = detectArtifactDrift(dir);
	assert.strictEqual(r.skippedBreakdown.noEvidence, 1);
});

test("anchor-invalid: evidence with non-YYYY-MM-DD date", () => {
	const dir = mkRepo(
		[baseF({ paths: ["src/a"], evidence: [{ command: "c", result: "p", date: "yesterday" }] })],
		"src/a",
	);
	const r = detectArtifactDrift(dir);
	assert.strictEqual(r.skippedBreakdown.anchorInvalid, 1);
});

test("untracked: feature without paths", () => {
	const dir = mkRepo([baseF({})], "src/a");
	const r = detectArtifactDrift(dir);
	assert.strictEqual(r.skippedBreakdown.untracked, 1);
});

test("product-repo -> available:false with note", () => {
	const dir = mkRepo([baseF({ paths: ["src/a"] })], "src/a");
	fs.writeFileSync(path.join(dir, "SPEC.md"), "s");
	fs.writeFileSync(path.join(dir, "ROADMAP.md"), "r");
	fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
	fs.writeFileSync(path.join(dir, "scripts", "amber.js"), "#");
	fs.mkdirSync(path.join(dir, "templates"), { recursive: true });
	execSync("git add -A && git commit -q -m product", { cwd: dir });
	const r = detectArtifactDrift(dir);
	assert.strictEqual(r.available, false);
	assert.match(r.note, /product-repo/);
});
