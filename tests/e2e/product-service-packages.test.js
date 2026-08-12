"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function tempDir(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-e2e-${name}-`));
}

function runAmber(args, options = {}) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd: ROOT,
		encoding: "utf8",
		...options,
	});
}

test("Repository Onboarding: init and doctor", () => {
	const target = tempDir("onboarding");

	const init = runAmber(["init", "--target", target]);
	assert.equal(init.status, 0, init.stderr);
	assert.match(init.stdout, /Created:/);

	const doctor = runAmber(["doctor", "--target", target]);
	assert.equal(doctor.status, 0, doctor.stderr);
});

test("Adoption Review: report, gate, and bundle", () => {
	const target = tempDir("adoption");
	const outputDir = tempDir("adoption-output");
	fs.writeFileSync(path.join(target, "package-lock.json"), JSON.stringify({}));

	const report = runAmber([
		"adoption",
		"report",
		"--target",
		target,
		"--output-dir",
		outputDir,
		"--json",
	]);
	assert.equal(report.status, 0, report.stderr);
	const reportPayload = JSON.parse(report.stdout);
	assert.ok(fs.existsSync(reportPayload.reportPath));

	const gate = runAmber(["adoption", "gate", "--report", reportPayload.reportPath, "--json"]);
	assert.equal(gate.status, 0, gate.stderr);
	const gatePayload = JSON.parse(gate.stdout);
	assert.ok(["ready", "wait"].includes(gatePayload.decision));

	const reportsDir = path.dirname(reportPayload.reportPath);
	const index = runAmber([
		"adoption",
		"index",
		"--reports-dir",
		reportsDir,
		"--output",
		path.join(outputDir, "index.md"),
		"--json",
	]);
	assert.equal(index.status, 0, index.stderr);

	const bundleDir = path.join(tempDir("bundle"), "bundle");
	const bundle = runAmber([
		"adoption",
		"bundle",
		"--reports-dir",
		reportsDir,
		"--index",
		path.join(outputDir, "index.md"),
		"--output-dir",
		bundleDir,
		"--json",
	]);
	assert.equal(bundle.status, 0, bundle.stderr);
	assert.ok(fs.existsSync(path.join(bundleDir, "manifest.json")));
});

test("Governed Delivery: plan, gate, review, and session complete-check", () => {
	const target = tempDir("delivery");

	const init = runAmber(["init", "--target", target]);
	assert.equal(init.status, 0, init.stderr);

	const plan = runAmber([
		"plan",
		"--target",
		target,
		"--feature",
		"F001",
		"--title",
		"Small slice",
	]);
	assert.equal(plan.status, 0, plan.stderr);

	const planPath = path.join(target, "docs", "plans", "F001-Small-slice.md");
	assert.ok(fs.existsSync(planPath));

	const gate = runAmber(["gate", "--target", target, "--plan", "docs/plans/F001-Small-slice.md"]);
	assert.notEqual(gate.status, 0);
	assert.match(gate.stdout, /User confirmation/);

	const review = runAmber([
		"review",
		"--target",
		target,
		"--plan",
		"docs/plans/F001-Small-slice.md",
	]);
	assert.notEqual(review.status, 0);
	assert.match(review.stdout, /User confirmation/);

	const session = runAmber([
		"session",
		"start",
		"--target",
		target,
		"--goal",
		"deliver small slice",
		"--route",
		"feature-standard",
		"--confirm",
		"--json",
	]);
	assert.equal(session.status, 0, session.stderr);
	const { sessionId } = JSON.parse(session.stdout);

	const complete = runAmber([
		"session",
		"complete-check",
		"--target",
		target,
		"--session",
		sessionId,
		"--json",
	]);
	assert.equal(complete.status, 0, complete.stderr);
	const payload = JSON.parse(complete.stdout);
	assert.match(payload.text, /Completion check status: fail/);
});

test("Continuity Layer: session start and status", () => {
	const target = tempDir("continuity");

	const start = runAmber([
		"session",
		"start",
		"--target",
		target,
		"--goal",
		"fix login bug",
		"--route",
		"bugfix-quick",
		"--confirm",
		"--json",
	]);
	assert.equal(start.status, 0, start.stderr);
	const { sessionId } = JSON.parse(start.stdout);

	const status = runAmber(["session", "status", "--target", target, sessionId]);
	assert.equal(status.status, 0, status.stderr);
	assert.match(status.stdout, /fix login bug/);
});

test("Security Governance: security audit and pack validation", () => {
	const target = tempDir("security");
	const output = path.join(target, "security-audit.md");

	const audit = runAmber(["security", "audit", "--target", target, "--output", output, "--json"]);
	assert.equal(audit.status, 0, audit.stderr);
	const payload = JSON.parse(audit.stdout);
	assert.equal(payload.outputPath, output);
	assert.ok(fs.existsSync(output));

	const validate = runAmber([
		"pack",
		"validate",
		"--file",
		path.join(ROOT, "workflow-packs", "security-audit.pack.json"),
		"--json",
	]);
	assert.equal(validate.status, 0, validate.stderr);
	const validation = JSON.parse(validate.stdout);
	assert.equal(validation.valid, true);
});
