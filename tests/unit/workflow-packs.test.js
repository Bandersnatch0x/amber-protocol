"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	validateWorkflowPackData,
	validateLoopContracts,
	describeLoopContracts,
	inspectLoopReadiness,
	validateWorkflowPackReferences,
} = require("../../scripts/lib/core/workflow-packs");

// Characterization tests for the pure validation/description helpers exported
// from workflow-packs.js. These functions are the testable seam behind the
// fs-coupled pack inspectors (inspectWorkflowPack / inspectWorkflowPackReadiness
// read JSON from disk and are intentionally skipped here). Pin current behavior
// across normal inputs and edge cases before any future refactor.

function minimalValidPack(overrides = {}) {
	return {
		id: "pack-1",
		title: "Pack One",
		version: "1.0.0",
		steps: [{ id: "s1", title: "Step One", kind: "review" }],
		...overrides,
	};
}

// ---- validateWorkflowPackData ----

test("validateWorkflowPackData accepts a minimal valid pack", () => {
	const result = validateWorkflowPackData(minimalValidPack());
	assert.deepEqual(result.errors, []);
	assert.deepEqual(result.warnings, []);
});

test("validateWorkflowPackData rejects null and arrays as non-object", () => {
	const nullResult = validateWorkflowPackData(null);
	assert.deepEqual(nullResult.errors, ["Workflow pack must contain an object."]);

	const arrayResult = validateWorkflowPackData([]);
	assert.deepEqual(arrayResult.errors, ["Workflow pack must contain an object."]);
});

test("validateWorkflowPackData flags missing id, title, and version", () => {
	const result = validateWorkflowPackData({ steps: [] });
	assert.ok(
		result.errors.includes(
			"Workflow pack field id must be a non-empty string.",
		),
	);
	assert.ok(
		result.errors.includes(
			"Workflow pack field title must be a non-empty string.",
		),
	);
	assert.ok(
		result.errors.includes(
			"Workflow pack field version must be a non-empty string.",
		),
	);
});

test("validateWorkflowPackData rejects a non-semver version", () => {
	const result = validateWorkflowPackData(
		minimalValidPack({ version: "not-a-version" }),
	);
	assert.deepEqual(result.errors, ["Workflow pack version must be semver."]);
});

test("validateWorkflowPackData accepts semver with a prerelease OR build segment", () => {
	// The SEMVER_PATTERN allows a single optional [-+...] segment: a prerelease
	// (1.2.3-rc.1) or a build (1.2.3+build.5) is accepted on its own.
	assert.deepEqual(
		validateWorkflowPackData(minimalValidPack({ version: "1.2.3-rc.1" })).errors,
		[],
	);
	assert.deepEqual(
		validateWorkflowPackData(minimalValidPack({ version: "1.2.3+build.5" })).errors,
		[],
	);
});

test("validateWorkflowPackData rejects semver with both prerelease and build metadata", () => {
	// Pin the pattern's real behavior: a single (?:[-+][0-9A-Za-z.-]+)? group
	// matches only one segment, so 1.2.3-rc.1+build.5 (both - and +) is rejected.
	const result = validateWorkflowPackData(
		minimalValidPack({ version: "1.2.3-rc.1+build.5" }),
	);
	assert.deepEqual(result.errors, ["Workflow pack version must be semver."]);
});

test("validateWorkflowPackData requires at least one step", () => {
	const result = validateWorkflowPackData(minimalValidPack({ steps: [] }));
	assert.deepEqual(result.errors, [
		"Workflow pack steps must contain at least one step.",
	]);
});

test("validateWorkflowPackData flags a step that declares an executable script", () => {
	const result = validateWorkflowPackData(
		minimalValidPack({
			steps: [{ id: "s1", title: "Step One", kind: "review", execute: true }],
		}),
	);
	assert.deepEqual(result.errors, [
		"Workflow pack steps[0] must not declare executable scripts in smoke validation.",
	]);
});

test("validateWorkflowPackData flags skills when present but not an array", () => {
	const result = validateWorkflowPackData(
		minimalValidPack({ skills: "not-an-array" }),
	);
	assert.deepEqual(result.errors, [
		"Workflow pack skills must be an array when present.",
	]);
});

// ---- validateLoopContracts ----

test("validateLoopContracts returns empty arrays when loopContracts is undefined", () => {
	const { errors, warnings } = validateLoopContracts(undefined);
	assert.deepEqual(errors, []);
	assert.deepEqual(warnings, []);
});

test("validateLoopContracts rejects a non-array loopContracts value", () => {
	const { errors } = validateLoopContracts("not-an-array");
	assert.deepEqual(errors, [
		"Workflow pack loopContracts must be an array when present.",
	]);
});

test("validateLoopContracts accepts a fully valid contract", () => {
	const { errors } = validateLoopContracts(
		[
			{
				id: "loop-1",
				goal: "g",
				stateSpine: "ss",
				trigger: { type: "manual" },
				triageOutputs: ["archive"],
				hardStops: {
					maxIterations: 5,
					noProgressDetection: true,
					timeoutMinutes: 30,
				},
				reviewGates: ["g1"],
				execution: {
					executesAnything: false,
					schedulesJobs: false,
					dispatchesAgents: false,
					writesExternalSystems: false,
				},
			},
		],
	);
	assert.deepEqual(errors, []);
});

test("validateLoopContracts flags an invalid trigger type", () => {
	const { errors } = validateLoopContracts(
		[
			{
				id: "loop-1",
				goal: "g",
				stateSpine: "ss",
				trigger: { type: "bogus" },
				hardStops: {
					maxIterations: 1,
					noProgressDetection: true,
					timeoutMinutes: 5,
				},
				reviewGates: ["g"],
				execution: { executesAnything: false },
			},
		],
	);
	assert.ok(
		errors.includes(
			"Loop contract [0].trigger.type must be one of: manual, scheduled, goal, external-signal.",
		),
	);
});

test("validateLoopContracts reports both missing hardStops and the budget fallback", () => {
	const { errors } = validateLoopContracts(
		[{ id: "loop-1", goal: "g", stateSpine: "ss", reviewGates: ["g"] }],
	);
	assert.deepEqual(errors, [
		"Loop contract [0].hardStops is required.",
		"Loop contract [0] must specify at least one of: hardStops.timeoutMinutes, budget.maxMinutes, budget.maxTokens, or budget.maxUsd.",
	]);
});

test("validateLoopContracts rejects maxIterations of zero or less", () => {
	const { errors } = validateLoopContracts(
		[
			{
				id: "l",
				goal: "g",
				stateSpine: "s",
				hardStops: {
					maxIterations: 0,
					noProgressDetection: true,
					timeoutMinutes: 5,
				},
				reviewGates: ["g"],
				execution: { executesAnything: false },
			},
		],
	);
	assert.deepEqual(errors, [
		"Loop contract [0].hardStops.maxIterations must be greater than 0.",
	]);
});

// ---- describeLoopContracts ----

test("describeLoopContracts returns an empty array when loopContracts is absent", () => {
	assert.deepEqual(describeLoopContracts({}), []);
	assert.deepEqual(describeLoopContracts({ loopContracts: "x" }), []);
});

test("describeLoopContracts fills defaults for missing optional fields", () => {
	const described = describeLoopContracts({
		loopContracts: [{ id: "only-id" }],
	})[0];
	assert.equal(described.id, "only-id");
	// title falls back to the id when absent
	assert.equal(described.title, "only-id");
	assert.equal(described.trigger, null);
	assert.equal(described.goal, "");
	assert.equal(described.stateSpine, "");
	assert.deepEqual(described.triageOutputs, []);
	assert.deepEqual(described.hardStops, {});
	assert.deepEqual(described.budget, {});
	assert.deepEqual(described.connectors, []);
	assert.deepEqual(described.reviewGates, []);
	assert.deepEqual(described.execution, {
		executesAnything: false,
		schedulesJobs: false,
		dispatchesAgents: false,
		writesExternalSystems: false,
	});
});

test("describeLoopContracts always forces execution.executesAnything to false", () => {
	// Even if the source contract claims it executes, the description hard-codes false.
	const described = describeLoopContracts({
		loopContracts: [
			{
				id: "x",
				execution: {
					executesAnything: true,
					schedulesJobs: true,
					dispatchesAgents: true,
					writesExternalSystems: true,
				},
			},
		],
	})[0];
	assert.equal(described.execution.executesAnything, false);
	// The other execution flags reflect the source booleans.
	assert.equal(described.execution.schedulesJobs, true);
	assert.equal(described.execution.dispatchesAgents, true);
	assert.equal(described.execution.writesExternalSystems, true);
});

// ---- inspectLoopReadiness ----

test("inspectLoopReadiness reports missing controls for empty input", () => {
	const result = inspectLoopReadiness({});
	assert.equal(result.readyForDryRun, false);
	assert.equal(result.readyForRecordOnly, false);
	assert.equal(result.readyForLiveScheduling, false);
	assert.deepEqual(result.allowedNow, [
		"describe",
		"validate",
		"dry-run",
		"record",
	]);
	assert.ok(result.blockers.includes("loop contract is missing"));
	assert.ok(
		result.blockers.includes(
			"live scheduling is disabled by product boundary",
		),
	);
});

test("inspectLoopReadiness marks a fully-provisioned pack ready for dry-run but never live", () => {
	const ready = {
		loopContracts: [
			{
				id: "loop-1",
				goal: "g",
				stateSpine: "ss",
				connectors: ["c1"],
				hardStops: { noProgressDetection: true, timeoutMinutes: 10 },
				budget: { maxMinutes: 10 },
				reviewGates: ["g1"],
			},
		],
		connectorContracts: [{ id: "c1" }],
		approvalPolicy: { selfApprovalAllowed: false },
		loopLedger: {
			required: true,
			chatHistoryRequired: false,
			recordsInputSnapshot: true,
			recordsToolSummary: true,
			recordsBudgetUsage: true,
			recordsStopReason: true,
			recordsApprovalState: true,
			recordsReviewerOutcome: true,
		},
		workspaceIsolation: {
			mutatingLoopsUseWorktree: true,
			mainCheckoutMutation: false,
		},
	};
	const result = inspectLoopReadiness(ready);
	assert.equal(result.readyForDryRun, true);
	assert.equal(result.readyForRecordOnly, true);
	// Live scheduling is always disabled by product boundary.
	assert.equal(result.readyForLiveScheduling, false);
	assert.deepEqual(result.blockers, [
		"live scheduling is disabled by product boundary",
	]);
});

test("inspectLoopReadiness flags a missing connector contract as a blocker", () => {
	const ready = {
		loopContracts: [
			{
				id: "loop-1",
				goal: "g",
				stateSpine: "ss",
				connectors: ["c1"],
				hardStops: { noProgressDetection: true, timeoutMinutes: 10 },
				budget: { maxMinutes: 10 },
				reviewGates: ["g1"],
			},
		],
		// connectorContracts omitted entirely -> c1 is unresolved.
		connectorContracts: [],
		approvalPolicy: { selfApprovalAllowed: false },
		loopLedger: {
			required: true,
			chatHistoryRequired: false,
			recordsInputSnapshot: true,
			recordsToolSummary: true,
			recordsBudgetUsage: true,
			recordsStopReason: true,
			recordsApprovalState: true,
			recordsReviewerOutcome: true,
		},
		workspaceIsolation: {
			mutatingLoopsUseWorktree: true,
			mainCheckoutMutation: false,
		},
	};
	const blockers = inspectLoopReadiness(ready).blockers;
	assert.ok(
		blockers.includes(
			"connector contract c1 is missing for loop loop-1",
		),
	);
});

// ---- validateWorkflowPackReferences (external-integration branch is pure) ----

test("validateWorkflowPackReferences flags an undeclared external integration", () => {
	const errors = validateWorkflowPackReferences("/fake/path", {
		steps: [{ id: "s1", externalIntegration: "missing-int" }],
		externalIntegrations: ["declared-int"],
	});
	assert.deepEqual(errors, [
		"Workflow pack step s1 uses undeclared external integration missing-int.",
	]);
});

test("validateWorkflowPackReferences uses (unknown) for a step with no id", () => {
	const errors = validateWorkflowPackReferences("/fake/path", {
		steps: [{ externalIntegration: "x" }],
		externalIntegrations: [],
	});
	assert.deepEqual(errors, [
		"Workflow pack step (unknown) uses undeclared external integration x.",
	]);
});

test("validateWorkflowPackReferences accepts a declared external integration", () => {
	const errors = validateWorkflowPackReferences("/fake/path", {
		steps: [{ id: "s1", externalIntegration: "ok-int" }],
		externalIntegrations: ["ok-int"],
	});
	assert.deepEqual(errors, []);
});
