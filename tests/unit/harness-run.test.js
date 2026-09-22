"use strict";

// F065 H0 — Harness Run lifecycle (ADR-0101): the closed nine-state machine,
// contract binding with fail-closed snapshot references, immutable terminal
// records, and the `amber harness start|advance|status` seam. All cases use
// their own temporary target directory (suite leak guard).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { dispatch } = require("../../scripts/lib/command-dispatcher");
const {
	STATES,
	TRANSITIONS,
	FINAL_STATES,
	isLegalTransition,
	legalTargets,
	isFinal,
} = require("../../scripts/lib/harness/run-state-machine");

function tmpTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-harness-run-"));
}

function admitContract(target) {
	const file = path.join(target, "contract.json");
	fs.writeFileSync(
		file,
		JSON.stringify({
			apiVersion: "amber.dev/v1",
			kind: "HarnessContract",
			metadata: { id: "coding-task", version: "1" },
			agent: { id: "worker", role: "implementation" },
			governance: { policy: "default-safe" },
		}),
		"utf8",
	);
	return dispatch("harness", { target, file, json: true, _: ["admit"] });
}

test("the nine-state machine exposes the SSOT predicates with closed transitions", () => {
	assert.deepEqual(Object.keys(STATES).length, 9);
	assert.ok(isLegalTransition("created", "admitted"));
	assert.ok(isLegalTransition("running", "blocked"));
	assert.ok(isLegalTransition("blocked", "running"));
	assert.equal(isLegalTransition("created", "running"), false, "created must be admitted first");
	assert.equal(isLegalTransition("blocked", "completed"), false, "unblocking precedes completion");
	assert.equal(isLegalTransition("completed", "running"), false, "final states are frozen");
	for (const [from, targets] of Object.entries(TRANSITIONS)) {
		assert.deepEqual(legalTargets(from), targets, `legalTargets(${from}) must copy TRANSITIONS`);
		for (const to of targets) assert.ok(isLegalTransition(from, to));
	}
	assert.deepEqual(
		[...FINAL_STATES].sort(),
		["cancelled", "completed", "expired", "failed"].sort(),
	);
	for (const state of FINAL_STATES) assert.ok(isFinal(state));
	assert.equal(isFinal("running"), false);
});

test("start binds a run to the admitted contract snapshot hash", () => {
	const target = tmpTarget();
	try {
		const admitted = admitContract(target);
		assert.equal(admitted.exitCode, 0);
		const { result, exitCode } = dispatch("harness", {
			target,
			json: true,
			contract: "coding-task",
			agent: "worker",
			task: "slice-1",
			_: ["start"],
		});
		assert.equal(exitCode, 0);
		assert.equal(result.run.kind, "HarnessRun");
		assert.equal(result.run.state, "created");
		assert.equal(result.run.harness.contract, "coding-task");
		assert.equal(result.run.harness.contractSnapshotHash, admitted.result.snapshotHash);
		assert.equal(result.run.harness.policy, "default-safe");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("start without an admitted contract fails closed", () => {
	const target = tmpTarget();
	try {
		const { result, exitCode } = dispatch("harness", {
			target,
			json: true,
			contract: "never-admitted",
			agent: "worker",
			_: ["start"],
		});
		assert.equal(exitCode, 1);
		assert.equal(result.code, "AMBER_E_HARNESS_CONTRACT_NOT_FOUND");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("advance walks the legal path created→admitted→running→completed", () => {
	const target = tmpTarget();
	try {
		admitContract(target);
		const started = dispatch("harness", {
			target,
			json: true,
			contract: "coding-task",
			agent: "worker",
			_: ["start"],
		});
		const runId = started.result.run.id;
		for (const to of ["admitted", "running", "completed"]) {
			const step = dispatch("harness", {
				target,
				json: true,
				run: runId,
				to,
				reason: "tracer walk",
				_: ["advance"],
			});
			assert.equal(step.exitCode, 0, `advance to ${to} should succeed`);
			assert.equal(step.result.run.state, to);
		}
		const last = started.result.run.id;
		const shown = dispatch("harness", { target, json: true, run: last, _: ["status"] });
		assert.equal(shown.result.run.state, "completed");
		assert.ok(shown.result.run.outcome.startedAt, "entering running records startedAt");
		assert.ok(shown.result.run.outcome.finishedAt, "entering a final state records finishedAt");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("terminal runs are immutable and illegal transitions refuse with stable codes", () => {
	const target = tmpTarget();
	try {
		admitContract(target);
		const started = dispatch("harness", {
			target,
			json: true,
			contract: "coding-task",
			agent: "worker",
			_: ["start"],
		});
		const runId = started.result.run.id;
		dispatch("harness", { target, json: true, run: runId, to: "cancelled", _: ["advance"] });
		const afterFinal = dispatch("harness", {
			target,
			json: true,
			run: runId,
			to: "running",
			_: ["advance"],
		});
		assert.equal(afterFinal.exitCode, 1);
		assert.equal(afterFinal.result.code, "AMBER_E_HARNESS_RUN_FINAL");

		const fresh = dispatch("harness", {
			target,
			json: true,
			contract: "coding-task",
			agent: "worker",
			_: ["start"],
		});
		const illegal = dispatch("harness", {
			target,
			json: true,
			run: fresh.result.run.id,
			to: "running",
			_: ["advance"],
		});
		assert.equal(illegal.exitCode, 1);
		assert.equal(illegal.result.code, "AMBER_E_HARNESS_RUN_ILLEGAL_TRANSITION");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("status lists runs; an explicit duplicate run id refuses", () => {
	const target = tmpTarget();
	try {
		admitContract(target);
		dispatch("harness", {
			target,
			json: true,
			contract: "coding-task",
			agent: "worker",
			run: "run-fixed-1",
			_: ["start"],
		});
		const duplicate = dispatch("harness", {
			target,
			json: true,
			contract: "coding-task",
			agent: "worker",
			run: "run-fixed-1",
			_: ["start"],
		});
		assert.equal(duplicate.exitCode, 1);
		assert.equal(duplicate.result.code, "AMBER_E_INVALID_ARG");

		const listed = dispatch("harness", { target, json: true, _: ["status"] });
		assert.equal(listed.exitCode, 0);
		assert.equal(listed.result.runs.length, 1);
		assert.equal(listed.result.runs[0].id, "run-fixed-1");
		assert.equal(listed.result.runs[0].state, "created");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});
