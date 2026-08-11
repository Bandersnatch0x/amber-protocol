"use strict";

// F014-M2: partial Maintenance evidence propagates through full inspection,
// Governance Report, and Adoption Report without becoming a blocking error.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { inspectMaintenance } = require("../../scripts/lib/core/maintenance");
const { buildGovernanceReport } = require("../../scripts/lib/core/governance-report");
const { generateAdoptionReport } = require("../../scripts/lib/core/adoption-reports");
const { scaffoldHarness } = require("../../scripts/lib/core/scaffold");

function tempTarget(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-m2-${name}-`));
}

function cleanup(dir) {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {
		// ignore
	}
}

function writeEvidence(targetRoot, taskId, contents) {
	const dir = path.join(targetRoot, ".amber", "executions", taskId);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "evidence.json"), contents, "utf8");
}

function validProposal(taskId, assertion) {
	return JSON.stringify({
		taskId,
		regressionProposal: { status: "proposed", assertion },
	});
}

test("inspectMaintenance composes evidence outcome and preserves valid facts", () => {
	const target = tempTarget("inspect");
	try {
		scaffoldHarness(target);
		writeEvidence(target, "good", validProposal("good", "must not regress"));
		const out = inspectMaintenance(target);
		// Valid evolution/regression facts preserved.
		assert.deepEqual(
			out.regressionProposals.map((p) => p.taskId),
			["good"],
		);
		assert.ok(Array.isArray(out.evolutionRollup));
		assert.equal(out.evidenceAvailability, "complete");
		// No partial warnings for a complete source.
		assert.deepEqual(
			out.warnings.filter((w) => /evidence unreadable/.test(w)),
			[],
		);
		assert.deepEqual(out.errors, []);
	} finally {
		cleanup(target);
	}
});

test("inspectMaintenance propagates partial evidence warnings without errors", () => {
	const target = tempTarget("inspect-partial");
	try {
		scaffoldHarness(target);
		writeEvidence(target, "good", validProposal("good", "must not regress"));
		writeEvidence(target, "broken", "{ nope");
		const out = inspectMaintenance(target);
		assert.equal(out.evidenceAvailability, "partial");
		// Valid data retained.
		assert.deepEqual(
			out.regressionProposals.map((p) => p.taskId),
			["good"],
		);
		// Redacted warning present, no blocking error.
		assert.ok(out.warnings.some((w) => /evidence unreadable or invalid/.test(w)));
		assert.deepEqual(out.errors, []);
	} finally {
		cleanup(target);
	}
});

test("complete evidence leaves Governance Report behavior unchanged", () => {
	const target = tempTarget("gov-complete");
	try {
		scaffoldHarness(target);
		writeEvidence(target, "good", validProposal("good", "assert"));
		const report = buildGovernanceReport(target);
		// A bare scaffold has other readiness gaps (warn), but no maintenance
		// errors and no partial warnings — the M2 invariant.
		assert.notEqual(report.decision, "block");
		assert.equal(report.summary.maintenanceErrors, 0);
		assert.deepEqual(report.maintenance.errors, []);
		assert.equal(
			report.maintenance.warnings.filter((w) => /evidence unreadable/.test(w)).length,
			0,
		);
	} finally {
		cleanup(target);
	}
});

test("partial evidence warns in Governance Report without blocking", () => {
	const target = tempTarget("gov-partial");
	try {
		scaffoldHarness(target);
		writeEvidence(target, "broken", "null");
		const report = buildGovernanceReport(target);
		// Warnings surfaced, decision path preserved (no maintenance errors).
		assert.ok(
			report.maintenance.warnings.some((w) => /evidence unreadable or invalid/.test(w)),
			"governance report includes partial evidence warning",
		);
		assert.deepEqual(report.maintenance.errors, []);
		assert.equal(report.summary.maintenanceErrors, 0);
	} finally {
		cleanup(target);
	}
});

test("Adoption Report writes from retained valid data and includes partial warnings", () => {
	const target = tempTarget("adopt");
	try {
		scaffoldHarness(target);
		writeEvidence(target, "good", validProposal("good", "assert"));
		writeEvidence(target, "broken", "{ nope");
		const outPath = path.join(target, "docs", "adoption-report.md");
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		const result = generateAdoptionReport(target, { output: outPath });
		// Report still written from valid data.
		assert.ok(fs.existsSync(outPath), "adoption report written");
		assert.equal(result.errors.length, 0);
		assert.ok(
			result.warnings.some((w) => /evidence unreadable or invalid/.test(w)),
			"adoption report includes partial evidence warning",
		);
	} finally {
		cleanup(target);
	}
});
