"use strict";

/**
 * Snapshot test — locks all exported symbols from amber-core.js.
 *
 * Any refactoring that renames, removes, or changes the type of an
 * exported symbol will cause this test to fail, protecting against
 * accidental breakage of the 14 importing modules.
 */

const { describe, it } = require("node:test");
const assert = require("assert");
const path = require("path");
const harnessCore = require("../../scripts/lib/amber-core");

describe("amber-core exports snapshot", () => {
	// ── Constants ──────────────────────────────────────────────────────
	describe("constants", () => {
		it("DEFAULT_TEAM_REGISTRY is a string", () => {
			assert.strictEqual(typeof harnessCore.DEFAULT_TEAM_REGISTRY, "string");
		});
		it("MINIMUM_HARNESS_FILES is an array", () => {
			assert.ok(Array.isArray(harnessCore.MINIMUM_HARNESS_FILES));
		});
		it("OPTIONAL_STARTER_WIKI_FILES is an array", () => {
			assert.ok(Array.isArray(harnessCore.OPTIONAL_STARTER_WIKI_FILES));
		});
		it("REQUIRED_HANDOFF_SECTIONS is an array", () => {
			assert.ok(Array.isArray(harnessCore.REQUIRED_HANDOFF_SECTIONS));
		});
		it("REQUIRED_HARNESS_FILES is an array", () => {
			assert.ok(Array.isArray(harnessCore.REQUIRED_HARNESS_FILES));
		});
		it("TEMPLATE_ROOT is a string", () => {
			assert.strictEqual(typeof harnessCore.TEMPLATE_ROOT, "string");
		});
	});

	// ── Core functions ─────────────────────────────────────────────────
	describe("core functions", () => {
		const funcs = [
			"acceptPlan", "auditProject", "classifyTarget",
			"dispatchAgentTask", "doctor",
			"inspectLoopContract", "inspectLoopLedger",
			"inspectMaintenance", "inspectProjectProfile",
			"inspectTaskResult", "inspectTeamDistribution",
			"inspectWorkflowPack", "inspectWorkflowPackReadiness",
			"installTeamDistribution",
			"listTemplateFiles",
			"parseArgs", "pinTeamDistribution",
			"prepareTaskExecution", "printResult",
			"proposeMaintenance",
			"recordAgentReview", "recordLoopContract",
			"reviewPlan", "rollbackTeamDistribution",
			"scaffoldHarness", "scaffoldPlan", "scaffoldWiki",
			"setAgentDispatchStatus",
			"updateTeamDistribution",
			"validateContinuousImprovementStateFile",
			"validateFeatureListData", "validateFeatureListFile",
			"validateHandoff", "validateManifests",
			"validatePlanGate", "validateProjectProfileData",
			"validateWiki", "validateWorkflowPackData",
		];
		for (const name of funcs) {
			it(`${name} is a function`, () => {
				assert.strictEqual(
					typeof harnessCore[name],
					"function",
					`${name} should be a function`,
				);
			});
		}
	});

	// ── Adoption functions ─────────────────────────────────────────────
	describe("adoption functions", () => {
		const funcs = [
			"bundleAdoptionArtifacts", "compareAdoptionReports",
			"gateAdoptionReport", "generateAdoptionReport",
			"listAdoptionReports", "statusAdoptionReports",
			"validateAdoptionReports",
			"writeAdoptionApplyPlan", "writeAdoptionDecisionRecord",
			"writeAdoptionNextActions", "writeAdoptionReportsIndex",
			"writeAdoptionSelectedFiles",
		];
		for (const name of funcs) {
			it(`${name} is a function`, () => {
				assert.strictEqual(
					typeof harnessCore[name],
					"function",
					`${name} should be a function`,
				);
			});
		}
	});

	// ── Export count ───────────────────────────────────────────────────
	it("exports exactly 57 symbols", () => {
		const keys = Object.keys(harnessCore).sort();
		assert.strictEqual(
			keys.length,
			57,
			`Expected 57 exports, got ${keys.length}. ` +
				`If you intentionally added/removed an export, update this count. ` +
				`New exports: ${keys.filter(k => !KNOWN_EXPORTS.has(k)).join(", ")}`,
		);
	});
});

// Known exports list used for the count test
const KNOWN_EXPORTS = new Set([
	"DEFAULT_TEAM_REGISTRY", "MINIMUM_HARNESS_FILES",
	"OPTIONAL_STARTER_WIKI_FILES", "REQUIRED_HANDOFF_SECTIONS",
	"REQUIRED_HARNESS_FILES", "TEMPLATE_ROOT",
	"acceptPlan", "auditProject", "bundleAdoptionArtifacts",
	"classifyTarget", "compareAdoptionReports",
	"dispatchAgentTask", "doctor",
	"dryRunLoopContract", "gateAdoptionReport",
	"generateAdoptionReport", "inspectLoopContract",
	"inspectLoopLedger", "inspectMaintenance",
	"inspectProjectProfile", "inspectTaskResult",
	"inspectTeamDistribution", "inspectWorkflowPack",
	"inspectWorkflowPackReadiness", "installTeamDistribution",
	"listAdoptionReports", "listTemplateFiles",
	"parseArgs", "pinTeamDistribution",
	"prepareTaskExecution", "printResult",
	"proposeMaintenance", "recordAgentReview",
	"recordLoopContract", "reviewPlan",
	"rollbackTeamDistribution", "scaffoldHarness",
	"scaffoldPlan", "scaffoldWiki",
	"setAgentDispatchStatus", "statusAdoptionReports",
	"updateTeamDistribution", "validateAdoptionReports",
	"validateContinuousImprovementStateFile",
	"validateFeatureListData", "validateFeatureListFile",
	"validateHandoff", "validateManifests",
	"validatePlanGate", "validateProjectProfileData",
	"validateWiki", "validateWorkflowPackData",
	"writeAdoptionApplyPlan", "writeAdoptionDecisionRecord",
	"writeAdoptionNextActions", "writeAdoptionReportsIndex",
	"writeAdoptionSelectedFiles",
]);

describe("legacy alias", () => {
	it("harness-core re-exports amber-core identically", () => {
		const amberCore = require("../../scripts/lib/amber-core");
		const legacy = require("../../scripts/lib/harness-core");
		assert.strictEqual(legacy, amberCore, "alias must be the same object");
	});
});
