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
