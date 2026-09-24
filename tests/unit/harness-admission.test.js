"use strict";

// F066 — AdmissionReceipt (ADR-0100 decision 3): the six-check receipt is
// only ever stored complete; a missing or malformed check refuses the whole
// admission. The receipt rides the Run record additively — records created
// before F066 stay schema-valid without it — and run.admitted carries the
// six governed-artifact pointers.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { dispatch } = require("../../scripts/lib/command-dispatcher");
const { readRunEvents } = require("../../scripts/lib/harness/event-ledger");

function tmpTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-harness-admission-"));
}

function admitAndStart(target, runId) {
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
	dispatch("harness", { target, file: contractFile, json: true, _: ["admit"] });
	return dispatch("harness", {
		target,
		json: true,
		contract: "loop-task",
		agent: "worker",
		run: runId,
		_: ["start"],
	}).result.run;
}

function allChecks() {
	return [
		"identity:subjects/worker-1",
		"contract:harness/contracts/loop-task.json",
		"policy:governance/rules.json#default-safe",
		"context:loops/daily/context-authority",
		"execution:worktrees/run-1",
		"approval:loops/ledger#approval-9",
	];
}

function advanceArgs(target, runId, checks, to = "admitted") {
	return { target, json: true, run: runId, to, checks, _: ["advance"] };
}

test("a complete six-check receipt freezes into the record and rides run.admitted", () => {
	const target = tmpTarget();
	try {
		const run = admitAndStart(target, "run-receipt-1");
		const { result, exitCode } = dispatch("harness", advanceArgs(target, run.id, allChecks()));
		assert.equal(exitCode, 0);
		assert.equal(result.run.state, "admitted");
		assert.equal(result.run.admission.receiptedAt.length > 0, true);
		assert.equal(Object.keys(result.run.admission.checks).length, 6);
		assert.equal(result.run.admission.checks.approval.pointer, "loops/ledger#approval-9");

		const events = readRunEvents(target, run.id);
		const admitted = events.find((event) => event.kind === "run.admitted");
		assert.ok(admitted, "run.admitted must be on the trail");
		assert.deepEqual(admitted.pointers, [
			"identity:subjects/worker-1",
			"contract:harness/contracts/loop-task.json",
			"policy:governance/rules.json#default-safe",
			"context:loops/daily/context-authority",
			"execution:worktrees/run-1",
			"approval:loops/ledger#approval-9",
		]);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("a missing check refuses the whole admission and leaves the run untouched", () => {
	const target = tmpTarget();
	try {
		const run = admitAndStart(target, "run-receipt-2");
		const short = allChecks().filter((entry) => !entry.startsWith("approval:"));
		const { result, exitCode } = dispatch("harness", advanceArgs(target, run.id, short));
		assert.equal(exitCode, 1);
		assert.equal(result.code, "AMBER_E_HARNESS_ADMISSION_INCOMPLETE");
		const shown = dispatch("harness", { target, json: true, run: run.id, _: ["status"] });
		assert.equal(shown.result.run.state, "created", "the run must not have moved");
		assert.equal(shown.result.run.admission, undefined, "no partial receipt may be stored");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("records created before F066 stay schema-valid without an admission section", () => {
	const target = tmpTarget();
	try {
		const run = admitAndStart(target, "run-legacy-1");
		const stepped = dispatch("harness", {
			target,
			json: true,
			run: run.id,
			to: "admitted",
			_: ["advance"],
		});
		// An F065-era path (no --check) now refuses as incomplete — the rule is
		// global, not per-record — but the record itself reads back fine and a
		// later complete receipt still lands.
		assert.equal(stepped.exitCode, 1);
		assert.equal(stepped.result.code, "AMBER_E_HARNESS_ADMISSION_INCOMPLETE");
		const completed = dispatch("harness", advanceArgs(target, run.id, allChecks()));
		assert.equal(completed.exitCode, 0);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("unknown or malformed --check entries fail with guidance", () => {
	const target = tmpTarget();
	try {
		const run = admitAndStart(target, "run-receipt-3");
		const unknown = dispatch(
			"harness",
			advanceArgs(target, run.id, [...allChecks(), "vibes:high"]),
		);
		assert.equal(unknown.exitCode, 1);
		assert.match(unknown.result.errors[0], /unknown admission check "vibes"/);

		const malformed = dispatch(
			"harness",
			advanceArgs(target, run.id, ["identity-pointer-without-colon"]),
		);
		assert.equal(malformed.exitCode, 1);
		assert.match(malformed.result.errors[0], /<name:pointer>/);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("a re-admission attempt is an illegal transition, not a receipt rewrite", () => {
	const target = tmpTarget();
	try {
		const run = admitAndStart(target, "run-receipt-4");
		assert.equal(dispatch("harness", advanceArgs(target, run.id, allChecks())).exitCode, 0);
		const again = dispatch("harness", advanceArgs(target, run.id, allChecks()));
		assert.equal(again.exitCode, 1);
		assert.equal(again.result.code, "AMBER_E_HARNESS_RUN_ILLEGAL_TRANSITION");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

// F067-era consistency note (map 0066): the contracts list carries the same
// tombstone discipline the tools list has — a record that no longer hashes
// to its snapshot degrades to a corrupt marker in the list (listable, never
// silently dropped) while the point-inspect refuses fail-closed. Conformance
// at the real dispatcher path.
test("the contracts list degrades a drifted record to a tombstone; inspect refuses it (same discipline as tools)", () => {
	const target = tmpTarget();
	try {
		const contractFile = path.join(target, "contract.json");
		fs.writeFileSync(
			contractFile,
			JSON.stringify({
				apiVersion: "amber.dev/v1",
				kind: "HarnessContract",
				metadata: { id: "tombstone-contract", version: "1" },
				agent: { id: "worker", role: "implementation" },
				governance: { policy: "default-safe" },
			}),
			"utf8",
		);
		const admitted = dispatch("harness", { target, file: contractFile, json: true, _: ["admit"] });
		const stored = JSON.parse(fs.readFileSync(admitted.result.contractFile, "utf8"));
		stored.contract.agent.role = "tampered";
		fs.writeFileSync(admitted.result.contractFile, JSON.stringify(stored, null, "\t"), "utf8");
		// Point-inspect refuses fail-closed.
		const inspect = dispatch("harness", {
			target,
			json: true,
			contract: "tombstone-contract",
			_: ["inspect"],
		});
		assert.equal(inspect.exitCode, 1);
		assert.match(inspect.result.errors.join("\n"), /no longer hashes to its snapshot/);
		// The list degrades to a tombstone — listable, never silent.
		const listed = dispatch("harness", { target, json: true, all: true, _: ["inspect"] });
		const entry = listed.result.contracts.find((c) => c.id === "tombstone-contract");
		assert.equal(entry.corrupt, true);
		assert.equal(entry.snapshotHash, null);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});
