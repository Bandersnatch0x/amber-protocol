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
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-v2-${name}-`));
}

function runHarness(args) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd: ROOT,
		encoding: "utf8",
	});
}

test("plan creates a feature-linked vertical-slice plan without overwriting", () => {
	const target = tempDir("plan");
	assert.equal(runHarness(["init", "--target", target]).status, 0);

	const result = runHarness([
		"plan",
		"--target",
		target,
		"--feature",
		"F001",
		"--title",
		"Starter customization",
	]);
	const second = runHarness([
		"plan",
		"--target",
		target,
		"--feature",
		"F001",
		"--title",
		"Starter customization",
	]);
	const planPath = path.join(target, "docs", "plans", "F001-Starter-customization.md");

	assert.equal(result.status, 0, result.stderr);
	assert.equal(second.status, 0, second.stderr);
	assert.match(result.stdout, /Created:/);
	assert.match(second.stdout, /Skipped:/);
	assert.match(fs.readFileSync(planPath, "utf8"), /Feature: F001/);
	assert.match(fs.readFileSync(planPath, "utf8"), /## Vertical Slices/);
	const content = fs.readFileSync(planPath, "utf8");
	assert.match(content, /## Verification/);
	assert.match(content, /## Resume Checkpoint/);
	assert.match(content, /Next Action: review docs\/plans\/F001-Starter-customization\.md/);
});

test("gate blocks implementation-ready plans without user confirmation", () => {
	const target = tempDir("gate");
	assert.equal(runHarness(["init", "--target", target]).status, 0);
	assert.equal(
		runHarness(["plan", "--target", target, "--feature", "F001", "--title", "Gate check"]).status,
		0,
	);

	const blocked = runHarness([
		"gate",
		"--target",
		target,
		"--plan",
		"docs/plans/F001-Gate-check.md",
		"--json",
	]);
	const planPath = path.join(target, "docs", "plans", "F001-Gate-check.md");
	fs.writeFileSync(
		planPath,
		fs
			.readFileSync(planPath, "utf8")
			.replace("User Confirmation: pending", "User Confirmation: confirmed")
			// Curate the F027 scaffold placeholders so the manifest rules pass.
			.replace(
				"- implement: <fill: knowledge-surface paths the implementer needs>",
				"- implement: docs/wiki/engineering/verification.md",
			)
			.replace(
				"- review: <fill: knowledge-surface paths the reviewer needs>",
				"- review: docs/wiki/engineering/runbook.md",
			),
	);
	const accepted = runHarness([
		"gate",
		"--target",
		target,
		"--plan",
		"docs/plans/F001-Gate-check.md",
		"--json",
	]);

	assert.notEqual(blocked.status, 0);
	assert.match(JSON.parse(blocked.stdout).errors.join("\n"), /User confirmation is required/);
	assert.equal(accepted.status, 0, accepted.stderr);
	assert.deepEqual(JSON.parse(accepted.stdout).errors, []);
});

test("plan rejects missing feature ids instead of creating detached plans", () => {
	const target = tempDir("missing-feature");
	assert.equal(runHarness(["init", "--target", target]).status, 0);

	const result = runHarness([
		"plan",
		"--target",
		target,
		"--feature",
		"F404",
		"--title",
		"Detached",
	]);

	assert.notEqual(result.status, 0);
	assert.match(result.stdout, /Feature F404 was not found/);
	assert.equal(fs.existsSync(path.join(target, "docs", "plans", "F404-detached.md")), false);
});
