"use strict";

// Characterization tests for agent dispatch status validation. These pin the
// accepted status values and their error messages before the scattered
// VALID_*_STATUSES sets are concentrated into one validated place.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	dispatchAgentTask,
	recordAgentReview,
} = require("../../scripts/lib/core/agent-orchestration");

function tempTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "agent-dispatch-"));
}

// A minimal prepared task ledger so dispatch passes the "ledger exists" guard.
function seedLedger(targetRoot, taskId) {
	const stateDir = path.join(targetRoot, ".amber");
	const execPath = path.join(stateDir, "executions", taskId);
	fs.mkdirSync(execPath, { recursive: true });
	fs.writeFileSync(
		path.join(execPath, "ledger.json"),
		JSON.stringify({ taskId, status: "prepared" }),
	);
}

const valid = (overrides = {}) => ({
	task: "task-1",
	worker: "worker-a",
	reviewer: "reviewer-b",
	...overrides,
});

test("dispatch rejects an unknown hardStopStatus", () => {
	const root = tempTarget();
	seedLedger(root, "task-1");
	const result = dispatchAgentTask(root, valid({ hardStopStatus: "bogus" }));
	assert.ok(
		result.errors.some((e) =>
			e.startsWith("Invalid hardStopStatus: bogus"),
		),
	);
});

test("dispatch accepts each valid hardStopStatus", () => {
	for (const value of ["not-recorded", "within-limits", "hit-limit"]) {
		const root = tempTarget();
		seedLedger(root, "task-1");
		const result = dispatchAgentTask(root, valid({ hardStopStatus: value }));
		assert.equal(
			result.dispatch.loop.hardStopStatus,
			value,
			`hardStopStatus ${value} should be accepted`,
		);
	}
});

test("dispatch rejects an unknown budgetStatus", () => {
	const root = tempTarget();
	seedLedger(root, "task-1");
	const result = dispatchAgentTask(root, valid({ budgetStatus: "nope" }));
	assert.ok(
		result.errors.some((e) => e.startsWith("Invalid budgetStatus: nope")),
	);
});

test("dispatch rejects an unknown reviewBandwidthStatus", () => {
	const root = tempTarget();
	seedLedger(root, "task-1");
	const result = dispatchAgentTask(
		root,
		valid({ reviewBandwidthStatus: "nope" }),
	);
	assert.ok(
		result.errors.some((e) =>
			e.startsWith("Invalid reviewBandwidthStatus: nope"),
		),
	);
});

test("dispatch rejects an unknown reviewGateStatus", () => {
	const root = tempTarget();
	seedLedger(root, "task-1");
	const result = dispatchAgentTask(root, valid({ reviewGateStatus: "nope" }));
	assert.ok(
		result.errors.some((e) => e.startsWith("Invalid reviewGateStatus: nope")),
	);
});

test("dispatch accepts each valid reviewGateStatus", () => {
	for (const value of ["pending", "satisfied", "blocked"]) {
		const root = tempTarget();
		seedLedger(root, "task-1");
		const result = dispatchAgentTask(root, valid({ reviewGateStatus: value }));
		assert.equal(result.dispatch.loop.reviewGateStatus, value);
	}
});

function seedDispatch(root, taskId, reviewer) {
	const result = dispatchAgentTask(root, valid({ task: taskId, reviewer }));
	assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
	return result.dispatch;
}

test("recordAgentReview rejects an invalid reviewGateStatus", () => {
	const root = tempTarget();
	seedLedger(root, "task-1");
	seedDispatch(root, "task-1", "reviewer-b");
	const result = recordAgentReview(root, {
		task: "task-1",
		reviewer: "reviewer-b",
		reviewGateStatus: "nope",
	});
	assert.ok(
		result.errors.some((e) => e.startsWith("Invalid reviewGateStatus: nope")),
	);
});

test("recordAgentReview accepts a valid reviewGateStatus and records it", () => {
	const root = tempTarget();
	seedLedger(root, "task-1");
	seedDispatch(root, "task-1", "reviewer-b");
	const result = recordAgentReview(root, {
		task: "task-1",
		reviewer: "reviewer-b",
		reviewGateStatus: "satisfied",
	});
	assert.equal(result.errors.length, 0);
	assert.equal(result.dispatch.loop.reviewGateStatus, "satisfied");
});
