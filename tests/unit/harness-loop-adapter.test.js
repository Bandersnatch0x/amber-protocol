"use strict";

// F066 — Loop ↔ Run mapping adapter (ADR-0101 decision 4, §52 Rule 5): one
// governed loop execution maps to Task + Run + AdmissionReceipt + Events.
// The adapter only READS the loop's tamper-evident ledger; every receipt
// check points at a real artifact, and outcomes come from real executions,
// never from claims. The loop ledger is built here through the loop's own
// appendLedgerRecord so the records carry a real hash chain.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { dispatch } = require("../../scripts/lib/command-dispatcher");
const { appendLedgerRecord } = require("../../scripts/lib/core/loop-ledger");
const { readRunEvents } = require("../../scripts/lib/harness/event-ledger");
const {
	CODE_LOOP_APPROVAL_MISSING,
	CODE_LOOP_OUTCOME_MISSING,
} = require("../../scripts/lib/harness/loop-adapter");

function tmpTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-harness-loop-"));
}

function admitContract(target) {
	const contractFile = path.join(target, "contract.json");
	fs.writeFileSync(
		contractFile,
		JSON.stringify({
			apiVersion: "amber.dev/v1",
			kind: "HarnessContract",
			metadata: { id: "loop-task", version: "1" },
			agent: { id: "worker", role: "implementation" },
			governance: { policy: "default-safe" },
		}),
		"utf8",
	);
	return dispatch("harness", { target, file: contractFile, json: true, _: ["admit"] });
}

function appendLoopApproval(target, loopId, approvalKey) {
	// The loop's own admission gate writes this record; the adapter only reads it.
	return appendLedgerRecord(path.join(target, ".amber", "loops", loopId, "ledger.jsonl"), {
		schemaVersion: 2,
		kind: "approved",
		approvalState: "approved",
		contractId: loopId,
		approvalKey,
		reviewer: "alice",
		policyVersion: "sha256:" + "a".repeat(64),
		recordedAt: "2026-09-22T00:00:00.000Z",
		executesAnything: false,
	});
}

function appendLoopExecution(target, loopId, approvalKey, exitCode) {
	return appendLedgerRecord(path.join(target, ".amber", "loops", loopId, "ledger.jsonl"), {
		schemaVersion: 2,
		kind: "executed",
		approvalState: "executed",
		consumedApprovalKey: approvalKey,
		action: { command: "npm test", exitCode },
		recordedAt: "2026-09-22T00:01:00.000Z",
		executesAnything: true,
		stopReason: exitCode === 0 ? "completed" : "command-failed",
	});
}

function startViaCli(target, loopId) {
	return dispatch("harness", {
		target,
		json: true,
		contract: "loop-task",
		fromLoop: loopId,
		file: "workflow-packs/sample.pack.json",
		agent: "worker",
		run: "run-loop-1",
		_: ["start"],
	});
}

test("start --from-loop admits a run whose six checks point at real gate artifacts", () => {
	const target = tmpTarget();
	try {
		assert.equal(admitContract(target).exitCode, 0);
		const approval = appendLoopApproval(target, "daily-1", "key-1");
		const { result, exitCode } = startViaCli(target, "daily-1");
		assert.equal(exitCode, 0);
		assert.equal(result.run.state, "admitted");
		assert.equal(result.run.subject.task, "loop/daily-1");
		const checks = result.run.admission.checks;
		assert.match(checks.approval.pointer, /#approved:key-1$/);
		assert.match(checks.policy.pointer, new RegExp(`policyVersion:${approval.policyVersion}`));
		assert.match(checks.context.pointer, /sample\.pack\.json#contract:daily-1/);
		assert.match(checks.execution.pointer, /sample\.pack\.json#governed\.command/);
		assert.equal(checks.identity.result, "pass");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("start --from-loop without an unconsumed approval refuses closed", () => {
	const target = tmpTarget();
	try {
		assert.equal(admitContract(target).exitCode, 0);
		// No ledger at all
		const missing = startViaCli(target, "never-approved");
		assert.equal(missing.exitCode, 1);
		assert.equal(missing.result.code, CODE_LOOP_APPROVAL_MISSING);
		// A ledger whose approval is already consumed by an execution
		appendLoopApproval(target, "daily-2", "key-2");
		appendLoopExecution(target, "daily-2", "key-2", 0);
		const consumed = startViaCli(target, "daily-2");
		assert.equal(consumed.exitCode, 1);
		assert.equal(consumed.result.code, CODE_LOOP_APPROVAL_MISSING);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("bind maps the real executed outcome: success completes the run with execution events", () => {
	const target = tmpTarget();
	try {
		assert.equal(admitContract(target).exitCode, 0);
		appendLoopApproval(target, "daily-3", "key-3");
		startViaCli(target, "daily-3");
		appendLoopExecution(target, "daily-3", "key-3", 0);

		const { result, exitCode } = dispatch("harness", {
			target,
			json: true,
			run: "run-loop-1",
			fromLoop: "daily-3",
			_: ["bind"],
		});
		assert.equal(exitCode, 0);
		assert.equal(result.run.state, "completed");
		assert.equal(result.outcomeExitCode, 0);

		const kinds = readRunEvents(target, "run-loop-1").map((event) => event.kind);
		assert.deepEqual(kinds, [
			"run.created",
			"run.admitted",
			"run.started",
			"execution.started",
			"policy.evaluated",
			"run.completed",
			"execution.completed",
		]);
		const evaluated = readRunEvents(target, "run-loop-1").find(
			(event) => event.kind === "policy.evaluated",
		);
		assert.equal(evaluated.decision.result, "allow");
		assert.equal(evaluated.decision.policy, "default-safe");
		for (const event of readRunEvents(target, "run-loop-1")) {
			if (event.kind.startsWith("execution.")) {
				assert.match(event.pointers[0], /#executed:\d+$/);
			}
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("a failed execution leaves a failed run — the terminal record is never rewritten", () => {
	const target = tmpTarget();
	try {
		assert.equal(admitContract(target).exitCode, 0);
		appendLoopApproval(target, "daily-4", "key-4");
		startViaCli(target, "daily-4");
		appendLoopExecution(target, "daily-4", "key-4", 5);

		const { result } = dispatch("harness", {
			target,
			json: true,
			run: "run-loop-1",
			fromLoop: "daily-4",
			_: ["bind"],
		});
		assert.equal(result.run.state, "failed");
		const kinds = readRunEvents(target, "run-loop-1").map((event) => event.kind);
		assert.ok(kinds.includes("execution.failed"));
		assert.ok(kinds.includes("run.failed"));
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("bind without a real executed outcome refuses with a stable code", () => {
	const target = tmpTarget();
	try {
		assert.equal(admitContract(target).exitCode, 0);
		appendLoopApproval(target, "daily-5", "key-5");
		startViaCli(target, "daily-5");
		const { result, exitCode } = dispatch("harness", {
			target,
			json: true,
			run: "run-loop-1",
			fromLoop: "daily-5",
			_: ["bind"],
		});
		assert.equal(exitCode, 1);
		assert.equal(result.code, CODE_LOOP_OUTCOME_MISSING);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});
