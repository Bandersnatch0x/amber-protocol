"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { slugify } = require("../scripts/lib/core/text-utils");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function tempDir(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-v2-5-${name}-`));
}

function runHarness(args) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd: ROOT,
		encoding: "utf8",
	});
}

function createPlan(target, title) {
	const result = runHarness(["plan", "--target", target, "--feature", "F001", "--title", title]);
	assert.equal(result.status, 0, result.stderr);
	return path.join("docs", "plans", `F001-${slugify(title)}.md`);
}

function confirmPlan(target, relativePath) {
	const planPath = path.join(target, relativePath);
	fs.writeFileSync(
		planPath,
		fs
			.readFileSync(planPath, "utf8")
			.replace("User Confirmation: pending", "User Confirmation: confirmed"),
	);
}

test("review reports standards, findings, and required user action", () => {
	const target = tempDir("review-blocked");
	assert.equal(runHarness(["init", "--target", target]).status, 0);
	const plan = createPlan(target, "Review blocked");

	const result = runHarness(["review", "--target", target, "--plan", plan, "--json"]);

	assert.notEqual(result.status, 0);
	const payload = JSON.parse(result.stdout);
	assert.ok(payload.loadedStandards.includes("amber-delivery"));
	assert.ok(payload.loadedStandards.includes("owasp-agentic-2026"));
	assert.ok(
		payload.loadedStandards.every(
			(standardId) => typeof standardId === "string" && standardId.length > 0,
		),
	);
	assert.ok(payload.applicableChecks.some((check) => check.id === "user-confirmation"));
	assert.ok(
		payload.findings.some((finding) => /User confirmation is required/.test(finding.message)),
	);
	assert.ok(payload.requiredUserAction.some((action) => /confirm/i.test(action)));
	assert.equal(payload.releaseReadiness.status, "blocked");
});

test("review passes confirmed plans and accept appends evolution log", () => {
	const target = tempDir("accept");
	assert.equal(runHarness(["init", "--target", target]).status, 0);
	const plan = createPlan(target, "Accept ready");
	confirmPlan(target, plan);
	// Since #23, accept requires verification evidence — record it first.
	assert.equal(
		runHarness([
			"feature",
			"verify",
			"--target",
			target,
			"--feature",
			"F001",
			"--command",
			"npm test",
			"--result",
			"ok",
		]).status,
		0,
	);

	const review = runHarness(["review", "--target", target, "--plan", plan, "--json"]);
	const accept = runHarness(["accept", "--target", target, "--plan", plan, "--json"]);
	const evolutionPath = path.join(target, "docs", "wiki", "engineering", "harness-evolution.md");

	assert.equal(review.status, 0, review.stderr);
	assert.equal(JSON.parse(review.stdout).releaseReadiness.status, "ready");
	assert.equal(accept.status, 0, accept.stderr);
	assert.equal(JSON.parse(accept.stdout).accepted, true);
	assert.match(fs.readFileSync(evolutionPath, "utf8"), /`docs\/plans\/F001-Accept-ready\.md`/);
});

test("gate, review, and accept reject an absolute plan path", () => {
	const target = tempDir("absolute-plan");
	assert.equal(runHarness(["init", "--target", target]).status, 0);
	const plan = createPlan(target, "Absolute path");
	const absolutePlan = path.join(target, plan);

	for (const args of [
		["gate", "--confirm", "--target", target, "--plan", absolutePlan, "--json"],
		["review", "--target", target, "--plan", absolutePlan, "--json"],
		["accept", "--target", target, "--plan", absolutePlan, "--json"],
	]) {
		const result = runHarness(args);
		assert.notEqual(result.status, 0);
		assert.match(result.stdout, /Plan path must be relative to the target repository/);
	}

	assert.equal(
		fs.existsSync(path.join(target, "docs", "wiki", "engineering", "harness-evolution.md")),
		false,
	);
});
