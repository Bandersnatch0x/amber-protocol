"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
	DEFAULT_REPEAT_THRESHOLD,
	detectNoProgress,
	detectRepeatedToolCalls,
	toolTargetFromEvent,
} = require("../scripts/lib/workflow-assessment/internal/no-progress");
const { detectNoProgress: detectNoProgressPublic } = require("../scripts/lib/workflow-assessment");

function toolEvent(command) {
	return { type: "tool_call", data: { tool: "bash", command }, timestamp: "2026-08-07T00:00:00.000Z" };
}

test("repeated tool calls: raw targets differing only by digits stay distinct", () => {
	const events = [
		toolEvent("cat log1.txt"),
		toolEvent("cat log2.txt"),
		toolEvent("cat log1.txt"),
		toolEvent("cat log2.txt"),
	];
	// 2x each — below the default threshold of 3, and never folded together.
	assert.deepEqual(detectRepeatedToolCalls(events), []);
	assert.deepEqual(detectNoProgress({ timelineEvents: events }), []);
});

test("repeated tool calls: same raw target three times is a repeated finding", () => {
	const events = [
		toolEvent("cat log1.txt"),
		toolEvent("cat log1.txt"),
		toolEvent("cat log1.txt"),
	];
	const findings = detectNoProgress({ timelineEvents: events });
	assert.equal(findings.length, 1);
	assert.equal(findings[0].id, "no-progress-repeated-tool-call");
	assert.equal(findings[0].severity, "warning");
	assert.match(findings[0].title, /cat log1\.txt/);
	assert.equal(DEFAULT_REPEAT_THRESHOLD, 3);
});

test("repeated tool calls: log1 and log2 each repeated are two separate findings", () => {
	const events = [
		toolEvent("cat log1.txt"),
		toolEvent("cat log1.txt"),
		toolEvent("cat log1.txt"),
		toolEvent("cat log2.txt"),
		toolEvent("cat log2.txt"),
		toolEvent("cat log2.txt"),
	];
	const findings = detectNoProgress({ timelineEvents: events });
	assert.equal(findings.length, 2);
	const targets = findings.map((finding) => finding.title);
	assert.ok(targets.some((title) => title.includes("cat log1.txt")));
	assert.ok(targets.some((title) => title.includes("cat log2.txt")));
});

test("toolTargetFromEvent extracts targets from the supported event shapes", () => {
	assert.equal(toolTargetFromEvent({ type: "tool_call", data: { tool: "bash", command: "ls -la" } }), "ls -la");
	assert.equal(toolTargetFromEvent({ type: "tool_call", data: { tool: "Read" } }), "Read");
	assert.equal(toolTargetFromEvent({ type: "command_executed", data: { command: "npm test" } }), "npm test");
	assert.equal(toolTargetFromEvent({ type: "stage_completed", data: { command: "node run" } }), "node run");
	assert.equal(toolTargetFromEvent({ type: "verification_failed", data: { command: "node verify" } }), "node verify");
	assert.equal(toolTargetFromEvent({ type: "session_created", data: { goal: "x" } }), null);
	assert.equal(toolTargetFromEvent({ type: "tool_call", data: {} }), null);
	assert.equal(toolTargetFromEvent(null), null);
});

test("empty evidence increment: empty diff reports one warning", () => {
	for (const resultEvidence of [{ diff: [] }, { diff: "" }, { diff: null }, { delta: { changes: 0 } }, { changes: 0 }]) {
		const findings = detectNoProgress({ resultEvidence });
		assert.equal(findings.length, 1, `expected a finding for ${JSON.stringify(resultEvidence)}`);
		assert.equal(findings[0].id, "no-progress-empty-evidence-increment");
		assert.equal(findings[0].severity, "warning");
	}
});

test("empty evidence increment: non-empty diff reports nothing", () => {
	const findings = detectNoProgress({
		resultEvidence: { diff: "updated 3 files, added feature_list entry" },
	});
	assert.deepEqual(findings, []);
});

test("empty evidence increment: array results all empty report one finding, mixed do not", () => {
	const allEmpty = detectNoProgress({ resultEvidence: [{ diff: "" }, { diff: {} }] });
	assert.equal(allEmpty.length, 1);
	const mixed = detectNoProgress({ resultEvidence: [{ diff: "" }, { diff: "changed" }] });
	assert.deepEqual(mixed, []);
});

test("empty evidence increment: absent or diff-less evidence reports nothing", () => {
	assert.deepEqual(detectNoProgress({ resultEvidence: null }), []);
	assert.deepEqual(detectNoProgress({ resultEvidence: undefined }), []);
	assert.deepEqual(detectNoProgress({ resultEvidence: [] }), []);
	assert.deepEqual(detectNoProgress({ resultEvidence: { evidence: ["a"] } }), []);
});

test("budget exhausted: cumulative usage over budgetCeiling reports an error", () => {
	const events = [
		{ type: "stage_completed", data: { tokens: 60 } },
		{ type: "stage_completed", data: { tokens: 70 } },
	];
	const findings = detectNoProgress({ timelineEvents: events, loopContract: { budgetCeiling: 100 } });
	assert.equal(findings.length, 1);
	assert.equal(findings[0].id, "no-progress-budget-exhausted");
	assert.equal(findings[0].severity, "error");
	assert.match(findings[0].detail, /130 exceeds loop-contract budgetCeiling 100/);
});

test("budget exhausted: usage within ceiling reports nothing", () => {
	const events = [{ type: "stage_completed", data: { tokens: 60 } }];
	assert.deepEqual(detectNoProgress({ timelineEvents: events, loopContract: { budgetCeiling: 100 } }), []);
});

test("budget exhausted: no budgetCeiling skips the signal", () => {
	const events = [{ type: "stage_completed", data: { tokens: 1000 } }];
	assert.deepEqual(detectNoProgress({ timelineEvents: events, loopContract: { budget: { maxTokens: 10 } } }), []);
	assert.deepEqual(detectNoProgress({ timelineEvents: events, loopContract: null }), []);
});

test("budget exhausted: budget_exceeded event reports regardless of arithmetic", () => {
	const findings = detectNoProgress({
		timelineEvents: [{ type: "budget_exceeded", data: {} }],
		loopContract: { budgetCeiling: 1000 },
	});
	assert.equal(findings.length, 1);
	assert.equal(findings[0].id, "no-progress-budget-exhausted");
});

test("budget exhausted: budget.ceiling is accepted and result evidence usage counts", () => {
	const findings = detectNoProgress({
		timelineEvents: [{ type: "tool_call", data: { tokens: 40 } }],
		resultEvidence: [{ usage: { totalTokens: 70 } }],
		loopContract: { budget: { ceiling: 100 } },
	});
	assert.equal(findings.length, 1);
	assert.match(findings[0].detail, /110 exceeds loop-contract budgetCeiling 100/);
});

test("detectNoProgress with no input returns an empty array", () => {
	assert.deepEqual(detectNoProgress(), []);
	assert.deepEqual(detectNoProgress({}), []);
	assert.deepEqual(detectNoProgress({ timelineEvents: [], resultEvidence: null, loopContract: null }), []);
});

test("detectNoProgress is re-exported from the workflow-assessment index", () => {
	assert.equal(typeof detectNoProgressPublic, "function");
	assert.deepEqual(detectNoProgressPublic(), []);
});
