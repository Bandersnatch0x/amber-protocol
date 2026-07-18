"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { scaffoldHarness } = require("../../scripts/lib/core/scaffold");
const { buildGovernanceReport, renderGovernanceReportMarkdown } = require("../../scripts/lib/core/governance-report");

function tempDir(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-governance-report-${name}-`));
}

test("buildGovernanceReport returns scores and structured next actions", () => {
	const target = tempDir("missing-evidence");
	scaffoldHarness(target);

	const report = buildGovernanceReport(target);

	assert.equal(report.target, target);
	assert.equal(typeof report.scores.overall, "number");
	assert.ok(report.scores.overall >= 0 && report.scores.overall <= 100);
	assert.ok(report.scores.governance >= 0 && report.scores.governance <= 100);
	assert.ok(report.scores.evidence < 100, "missing evidence lowers evidence score");

	const action = report.nextActions.find((item) => item.id === "no-audit-evidence");
	assert.ok(action, "missing audit evidence creates a structured next action");
	assert.equal(action.severity, "medium");
	assert.match(action.command, /session start|governance evidence/);
	assert.ok(Array.isArray(action.blocks));
	assert.ok(action.blocks.includes("handoff-readiness"));
});

test("renderGovernanceReportMarkdown exposes the product loop", () => {
	const target = tempDir("markdown");
	scaffoldHarness(target);

	const markdown = renderGovernanceReportMarkdown(buildGovernanceReport(target));

	assert.match(markdown, /# Amber Governance Report/);
	assert.match(markdown, /Amber Readiness Score/);
	assert.match(markdown, /Product Value Loop/);
	assert.match(markdown, /Assess repo -> Score risks -> Recommend next actions -> Run governed workflow -> Verify evidence -> Produce handoff bundle/);
	assert.match(markdown, /## Next Actions/);
});

test("buildGovernanceReport blocks when the team registry is invalid", () => {
	const target = tempDir("invalid-registry");
	const registry = path.join(target, "team-registry.json");
	scaffoldHarness(target);
	fs.writeFileSync(registry, "{}\n");

	const report = buildGovernanceReport(target, { registry });

	assert.equal(report.decision, "block");
	assert.ok(report.errors.includes("Team registry must define versions."));
	assert.equal(report.summary.maintenanceErrors, report.maintenance.errors.length);
	assert.equal(report.maintenance.rulePackDrift.available, false);
});

test("security-standard remediation creates the standard and clears the finding (#44 AC1)", () => {
	const target = tempDir("secstd");
	scaffoldHarness(target);
	// scaffoldHarness ships the standard too; remove it to simulate a repo where
	// it is missing — the condition that fires the finding.
	fs.rmSync(path.join(target, "standards", "security-governance.json"));
	// Before: no standard → finding fires.
	let report = buildGovernanceReport(target);
	let action = report.nextActions.find((item) => item.id === "missing-security-standard");
	assert.ok(action, "missing-security-standard finding present on a bare scaffold");
	assert.match(action.command, /governance standards init/);
	assert.match(action.expectedOutcome, /creates standards\/security-governance\.json/i);
	assert.match(action.expectedOutcome, /clearing this finding/i);
	// Run the remediation: scaffold the standard.
	const { standardsInitCommand } = require("../../scripts/lib/governance-commands");
	const initResult = standardsInitCommand(target);
	assert.equal(initResult.skipped, false);
	assert.ok(fs.existsSync(path.join(target, "standards", "security-governance.json")));
	// After: finding is cleared.
	report = buildGovernanceReport(target);
	assert.ok(
		!report.nextActions.some((item) => item.id === "missing-security-standard"),
		"missing-security-standard no longer advised once the standard exists",
	);
});

test("standards init is idempotent — a second run leaves the file untouched (#44)", () => {
	const target = tempDir("secstd-idem");
	scaffoldHarness(target);
	fs.rmSync(path.join(target, "standards", "security-governance.json"));
	const { standardsInitCommand } = require("../../scripts/lib/governance-commands");
	assert.equal(standardsInitCommand(target).skipped, false);
	const second = standardsInitCommand(target);
	assert.equal(second.skipped, true);
});
