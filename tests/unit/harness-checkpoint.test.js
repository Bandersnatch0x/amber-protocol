"use strict";

// F072 H4 tickets 0112 + 0113 — Run-scoped checkpoints and the unified
// lifecycle view. Conformance at the real path: capture (non-final only,
// idempotent per content), recovery verification (drift refuses; verified
// recovery reads the same state), the additive run summary, and the §42
// lifecycle mapping view (run-scoped + registry-wide, fail-closed on a
// corrupt record). All cases use their own temporary target directory
// (suite leak guard).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	captureCheckpoint,
	listCheckpoints,
	verifyCheckpoint,
	getCheckpoint,
	CODE_FINAL,
	CODE_DRIFT,
	CODE_NOT_FOUND,
} = require("../../scripts/lib/harness/checkpoint-core");
const { lifecycleView } = require("../../scripts/lib/harness/lifecycle-view");
const { recordAttempt } = require("../../scripts/lib/harness/attempt-core");

function tmpTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-harness-ckpt-"));
}

function admitAndStart(target, runId) {
	const { dispatch } = require("../../scripts/lib/command-dispatcher");
	const contractFile = path.join(target, "contract.json");
	fs.writeFileSync(
		contractFile,
		JSON.stringify({
			apiVersion: "amber.dev/v1",
			kind: "HarnessContract",
			metadata: { id: "coding-task", version: "1" },
			agent: { id: "worker", role: "implementation" },
			governance: { policy: "default-safe" },
		}),
		"utf8",
	);
	dispatch("harness", { target, file: contractFile, json: true, _: ["admit"] });
	dispatch("harness", {
		target,
		json: true,
		contract: "coding-task",
		agent: "worker",
		run: runId,
		_: ["start"],
	});
}

function transition(target, runId, to, reason, checks) {
	const { dispatch } = require("../../scripts/lib/command-dispatcher");
	// Dispatch-level args bypass parseArgs: the accumulate field is `checks`.
	dispatch("harness", {
		target,
		json: true,
		run: runId,
		to,
		reason,
		...(checks ? { checks } : {}),
		_: ["advance"],
	});
}

// `created → admitted` requires the complete six-check receipt (each pointer
// citing the governed artifact it witnessed — minimal test pointers suffice).
const SIX_CHECKS = [
	"identity:p/identity",
	"contract:p/contract",
	"policy:p/policy",
	"context:p/context",
	"execution:p/execution",
	"approval:p/approval",
];

test("captureCheckpoint records a citing snapshot; terminal capture refuses", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-ck-1");
	const captured = captureCheckpoint(target, {
		runId: "run-ck-1",
		reason: "before governed work",
		now: "2026-09-23T10:00:00.000Z",
	});
	assert.equal(captured.checkpoint.state, "created");
	assert.match(captured.checkpoint.refs.runRecordDigest, /^sha256:[0-9a-f]{64}$/);
	assert.equal(captured.checkpoint.refs.attemptCount, 0);
	assert.equal(captured.idempotent, false);
	// A terminal run refuses capture.
	transition(target, "run-ck-1", "cancelled", "test terminal");
	assert.throws(
		() => captureCheckpoint(target, { runId: "run-ck-1" }),
		(err) => err.amberCode === CODE_FINAL,
	);
});

test("capture is idempotent per content; distinct runs get distinct ids", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-ck-2");
	const first = captureCheckpoint(target, { runId: "run-ck-2" });
	const second = captureCheckpoint(target, { runId: "run-ck-2" });
	assert.equal(second.idempotent, true);
	assert.equal(second.checkpoint.checkpointId, first.checkpoint.checkpointId);
	assert.equal(listCheckpoints(target, { runId: "run-ck-2" }).length, 1);
	// An attempt changes the run file → new content → new checkpoint.
	recordAttempt(target, { runId: "run-ck-2", attemptId: "att-1", commandId: "cmd-x" });
	const third = captureCheckpoint(target, { runId: "run-ck-2" });
	assert.notEqual(third.checkpoint.checkpointId, first.checkpoint.checkpointId);
	assert.equal(listCheckpoints(target, { runId: "run-ck-2" }).length, 2);
});

test("recovery verifies an unchanged run and refuses a drifted one (fail closed)", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-ck-3");
	captureCheckpoint(target, { runId: "run-ck-3" });
	// Unchanged → verified; the run stands where the checkpoint captured it.
	const verified = verifyCheckpoint(target, { runId: "run-ck-3" });
	assert.equal(verified.ok, true);
	assert.equal(verified.checkpoint.state, "created");
	// A transition drifts the run → recovery refuses with the drift reasons.
	transition(target, "run-ck-3", "admitted", "drift after checkpoint", SIX_CHECKS);
	assert.throws(
		() => verifyCheckpoint(target, { runId: "run-ck-3" }),
		(err) => {
			assert.equal(err.amberCode, CODE_DRIFT);
			assert.match(err.message, /state created → admitted/);
			assert.match(err.message, /run record digest changed/);
			return true;
		},
	);
	// Recovery never rewrote anything — the run is still admitted.
	const { getRun } = require("../../scripts/lib/harness/run-core");
	assert.equal(getRun(target, { runId: "run-ck-3" }).run.state, "admitted");
});

test("checkpoint listing sorts by capture time; a corrupt record fails closed", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-ck-4");
	assert.deepEqual(listCheckpoints(target, { runId: "run-ck-4" }), []);
	captureCheckpoint(target, { runId: "run-ck-4", now: "2026-09-23T10:00:00.000Z" });
	recordAttempt(target, { runId: "run-ck-4", attemptId: "att-1", commandId: "cmd-x" });
	captureCheckpoint(target, { runId: "run-ck-4", now: "2026-09-23T11:00:00.000Z" });
	const listed = listCheckpoints(target, { runId: "run-ck-4" });
	assert.equal(listed.length, 2);
	assert.equal(listed[1].at, "2026-09-23T11:00:00.000Z");
	assert.deepEqual(listed[1].refs, { ...listed[1].refs });
	assert.ok(listed[1].refs.attemptCount >= 1);
	// Corrupt record → fail closed.
	const dir = path.join(target, ".amber", "harness", "checkpoints", "run-ck-4");
	fs.writeFileSync(path.join(dir, "ck-broken.json"), "{not json", "utf8");
	assert.throws(
		() => listCheckpoints(target, { runId: "run-ck-4" }),
		(err) => err.amberCode === "AMBER_E_HARNESS_CHECKPOINT_CORRUPT",
	);
	// verify with no checkpoints at all → NOT_FOUND.
	admitAndStart(target, "run-ck-5");
	assert.throws(
		() => verifyCheckpoint(target, { runId: "run-ck-5" }),
		(err) => err.amberCode === CODE_NOT_FOUND,
	);
});

test("the run's additive checkpoints summary reflects captures", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-ck-6");
	const { getRun } = require("../../scripts/lib/harness/run-core");
	assert.equal(getRun(target, { runId: "run-ck-6" }).run.checkpoints, undefined);
	const { checkpoint } = captureCheckpoint(target, { runId: "run-ck-6" });
	const run = getRun(target, { runId: "run-ck-6" }).run;
	assert.deepEqual(run.checkpoints, {
		count: 1,
		lastCheckpointId: checkpoint.checkpointId,
		lastCheckpointAt: checkpoint.at,
	});
	assert.ok(
		getCheckpoint(target, { runId: "run-ck-6", checkpointId: checkpoint.checkpointId }).checkpoint,
	);
});

test("the lifecycle view maps one run: spine, execution witness, attempts, checkpoints", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-lc-1");
	transition(target, "run-lc-1", "admitted", "receipt", SIX_CHECKS);
	captureCheckpoint(target, { runId: "run-lc-1" });
	recordAttempt(target, { runId: "run-lc-1", attemptId: "att-1", commandId: "cmd-x" });
	recordAttempt(target, {
		runId: "run-lc-1",
		attemptId: "att-1",
		commandId: "cmd-x",
		state: "failed",
		exitCode: 1,
	});
	const { run } = lifecycleView(target, { runId: "run-lc-1" });
	assert.equal(run.state, "admitted");
	assert.equal(run.harness.contract, "coding-task");
	assert.deepEqual(run.subject, { agent: "worker" });
	assert.equal(run.execution, null); // never prepared → cited as null, not inferred
	// The six-check receipt the test passed makes the loop/session provenance
	// citable (the admission pointers name the witnessed artifacts).
	assert.equal(run.loop.approvalPointer, "p/approval");
	assert.equal(run.loop.contractPointer, "p/contract");
	assert.ok(run.loop.receiptedAt);
	assert.equal(run.attempts.count, 1);
	assert.equal(run.attempts.lastAttemptState, "failed");
	assert.equal(run.attempts.noProgress.detected, false); // single failure
	assert.equal(run.checkpoints.count, 1);
	// The registry-wide view carries the mapping statement.
	const all = lifecycleView(target, {});
	assert.equal(all.runs.length, 1);
	assert.equal(typeof all.mapping.route, "string");
	assert.match(all.mapping.loop, /F066/);
});

test("the lifecycle view fails closed on a corrupt run record", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-lc-2");
	const runFile = path.join(target, ".amber", "harness", "runs", "run-lc-2.json");
	fs.writeFileSync(runFile, "{broken", "utf8");
	assert.throws(
		() => lifecycleView(target, { runId: "run-lc-2" }),
		(err) => err.amberCode === "AMBER_E_HARNESS_RUN_CORRUPT",
	);
});

test("the new subverbs smoke through the real dispatcher (checkpoint/attempt/lifecycle)", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-smoke-1");
	const { dispatch } = require("../../scripts/lib/command-dispatcher");
	// checkpoint capture / list / verify
	const captured = dispatch("harness", {
		target,
		json: true,
		run: "run-smoke-1",
		_: ["checkpoint", "capture"],
	});
	assert.equal(captured.exitCode, 0);
	assert.ok(captured.result.checkpoint.checkpointId);
	const listed = dispatch("harness", {
		target,
		json: true,
		run: "run-smoke-1",
		_: ["checkpoint", "list"],
	});
	assert.equal(listed.result.checkpoints.length, 1);
	const verified = dispatch("harness", {
		target,
		json: true,
		run: "run-smoke-1",
		_: ["checkpoint", "verify"],
	});
	assert.equal(verified.exitCode, 0);
	assert.ok(verified.result.verifiedAt);
	// attempt list (+ the dispatch-level summary)
	const attempts = dispatch("harness", {
		target,
		json: true,
		run: "run-smoke-1",
		_: ["attempt", "list"],
	});
	assert.equal(attempts.exitCode, 0);
	assert.deepEqual(attempts.result.attempts, []);
	// attempt inspect via the dispatch-level `attemptId` key (the raw-CLI
	// --attempt mapping is covered by FLAG_SPECS + the smoke below). A missing
	// attempt is a governed failure result, not a throw (the handler wraps
	// core errors through writeFailure).
	const missing = dispatch("harness", {
		target,
		json: true,
		run: "run-smoke-1",
		attemptId: "att-none",
		_: ["attempt", "inspect"],
	});
	assert.equal(missing.exitCode, 1);
	assert.equal(missing.result.code, "AMBER_E_HARNESS_ATTEMPT_NOT_FOUND");
	// lifecycle (--run)
	const view = dispatch("harness", {
		target,
		json: true,
		run: "run-smoke-1",
		_: ["lifecycle"],
	});
	assert.equal(view.exitCode, 0);
	assert.equal(view.result.run.id, "run-smoke-1");
	assert.equal(view.result.run.checkpoints.count, 1);
	// registry-wide lifecycle carries the mapping statement
	const all = dispatch("harness", { target, json: true, _: ["lifecycle"] });
	assert.ok(all.result.mapping);
});
