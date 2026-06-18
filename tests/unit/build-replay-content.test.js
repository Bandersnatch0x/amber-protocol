"use strict";

// Unit tests for buildReplayContent — the pure replay.md renderer extracted
// from prepareTaskExecution. Exercises each branch (trace replay, regression
// proposal, empty) directly, which the integration test only reached via the
// written file.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	buildReplayContent,
} = require("../../scripts/lib/core/task-execution");
const { MESSAGES } = require("../../scripts/lib/core/terminology");

const baseEvidence = { traceReplay: undefined, regressionProposal: undefined };

test("renders the header with task, plan, and worktree", () => {
	const content = buildReplayContent(
		"task-1",
		"docs/plans/a.md",
		".amber/worktrees/task-1",
		baseEvidence,
	);
	assert.match(content, /^# Replay/);
	assert.match(content, /Task: task-1/);
	assert.match(content, /Plan: docs\/plans\/a\.md/);
	assert.match(content, /Worktree: \.amber\/worktrees\/task-1/);
});

test("renders the no-commands notice when there is no trace or regression", () => {
	const content = buildReplayContent("t", "p", "w", baseEvidence);
	assert.match(content, new RegExp(MESSAGES.replayNoCommandsYet));
	assert.doesNotMatch(content, /## Trace Replay/);
	assert.doesNotMatch(content, /## Regression Proposal/);
});

test("renders a trace replay section when evidence has traceReplay", () => {
	const content = buildReplayContent("t", "p", "w", {
		traceReplay: {
			traceInput: "fixtures/traces/x.json",
			agentConfig: "agent-v2",
			exactReplayRequired: true,
		},
	});
	assert.match(content, /## Trace Replay/);
	assert.match(content, /- Trace input: fixtures\/traces\/x\.json/);
	assert.match(content, /- Agent config: agent-v2/);
	assert.match(content, /- Exact replay required: true/);
});

test("renders a regression proposal section when evidence has regressionProposal", () => {
	const content = buildReplayContent("t", "p", "w", {
		regressionProposal: {
			assertion: "rejects empty input",
			modifiesTests: false,
			approvalRequired: true,
		},
	});
	assert.match(content, /## Regression Proposal/);
	assert.match(content, /- Assertion: rejects empty input/);
	assert.match(content, /- Modifies tests: false/);
	assert.match(content, /- Approval required: true/);
});

test("renders both sections when both are present", () => {
	const content = buildReplayContent("t", "p", "w", {
		traceReplay: { traceInput: "i", agentConfig: "c", exactReplayRequired: false },
		regressionProposal: { assertion: "a", modifiesTests: true, approvalRequired: true },
	});
	assert.match(content, /## Trace Replay/);
	assert.match(content, /## Regression Proposal/);
	assert.doesNotMatch(content, new RegExp(MESSAGES.replayNoCommandsYet));
});
