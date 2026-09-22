"use strict";

// F065 H0 — Harness Event Ledger (ADR-0102): the `harness` family composed
// through defineLedgerFamily. Tests assert the governed surface: schema-
// validated emission, closed event types, run-scoped attribution, chain-
// walked fail-closed reads, and the run lifecycle emitting its trail. All
// cases use their own temporary target directory (suite leak guard).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { dispatch } = require("../../scripts/lib/command-dispatcher");
const {
	HARNESS_EVENT_TYPES,
	emitHarnessEvent,
	readHarnessEvents,
	readRunEvents,
	HARNESS_LEDGER_CORRUPT_CODE,
	HARNESS_EVENT_INVALID_CODE,
} = require("../../scripts/lib/harness/event-ledger");

function tmpTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-harness-events-"));
}

function admitAndStart(target) {
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
	return dispatch("harness", {
		target,
		json: true,
		contract: "coding-task",
		agent: "worker",
		run: "run-trail-1",
		_: ["start"],
	}).result.run;
}

test("the event type enum is closed and matches the ADR-0102 H0 set", () => {
	assert.ok(HARNESS_EVENT_TYPES.includes("run.created"));
	assert.ok(HARNESS_EVENT_TYPES.includes("validation.completed"));
	assert.equal(HARNESS_EVENT_TYPES.includes("free.form"), false);
});

test("emit appends a chained, schema-valid event; the fold reads it back", () => {
	const target = tmpTarget();
	try {
		const before = readHarnessEvents(target);
		assert.equal(before.length, 0);
		const emitted = emitHarnessEvent(target, {
			kind: "run.created",
			schemaVersion: 1,
			at: "2026-09-22T00:00:00.000Z",
			runId: "run-1",
			actor: "worker",
		});
		assert.ok(emitted.ok, "governed append must succeed");
		assert.match(emitted.record.hash, /^[0-9a-f]{64}$/);
		const after = readHarnessEvents(target);
		assert.equal(after.length, 1);
		assert.equal(after[0].kind, "run.created");
		assert.equal(after[0].runId, "run-1");
		assert.ok(after[0].prevHash, "the chain rides the governed core");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("an unknown event kind or a missing runId refuses with stable codes", () => {
	const target = tmpTarget();
	try {
		assert.throws(
			() =>
				emitHarnessEvent(target, {
					kind: "free.form",
					schemaVersion: 1,
					at: "2026-09-22T00:00:00.000Z",
					runId: "run-1",
				}),
			(err) => err.amberCode === HARNESS_EVENT_INVALID_CODE,
			"an unknown event kind is an argument error, refused before the ledger",
		);
		assert.throws(
			() =>
				emitHarnessEvent(target, {
					kind: "run.created",
					schemaVersion: 1,
					at: "2026-09-22T00:00:00.000Z",
				}),
			(err) => err.amberCode === HARNESS_EVENT_INVALID_CODE,
			"an unscoped event is an argument error, refused before the ledger",
		);
		assert.equal(readHarnessEvents(target).length, 0, "refused bodies never reach the chain");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("the run lifecycle emits its trail; inspect --run shows run + verified events", () => {
	const target = tmpTarget();
	try {
		const run = admitAndStart(target);
		dispatch("harness", {
			target,
			json: true,
			run: run.id,
			to: "admitted",
			_: ["advance"],
		});
		const shown = dispatch("harness", {
			target,
			json: true,
			run: run.id,
			_: ["inspect"],
		});
		assert.equal(shown.exitCode, 0);
		assert.equal(shown.result.run.id, run.id);
		const kinds = shown.result.events.map((event) => event.kind);
		assert.deepEqual(kinds, ["run.created", "run.admitted"]);
		for (const event of shown.result.events) {
			assert.equal(event.runId, run.id);
			assert.ok(event.hash && event.prevHash, "events keep their chain fields");
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("tampering with the ledger fails every read closed", () => {
	const target = tmpTarget();
	try {
		const run = admitAndStart(target);
		dispatch("harness", { target, json: true, run: run.id, to: "admitted", _: ["advance"] });
		const ledgerPath = path.join(target, ".amber", "harness", "events.jsonl");
		const lines = fs
			.readFileSync(ledgerPath, "utf8")
			.split("\n")
			.filter((l) => l.length > 0);
		const tampered = JSON.parse(lines[0]);
		tampered.kind = "run.completed";
		lines[0] = JSON.stringify(tampered);
		fs.writeFileSync(ledgerPath, lines.join("\n") + "\n", "utf8");
		assert.throws(
			() => readRunEvents(target, run.id),
			(err) => err.amberCode === HARNESS_LEDGER_CORRUPT_CODE,
			"a tampered chain must refuse every read",
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("invalid schema enum never reaches the ledger: emit refuses before append", () => {
	const target = tmpTarget();
	try {
		assert.throws(
			() =>
				emitHarnessEvent(target, {
					kind: "run.created",
					schemaVersion: 2,
					at: "2026-09-22T00:00:00.000Z",
					runId: "run-1",
				}),
			(err) => err.amberCode === HARNESS_EVENT_INVALID_CODE,
		);
		assert.equal(
			readHarnessEvents(target).length,
			0,
			"a refused body must not leave a partial chain",
		);
		assert.equal(HARNESS_EVENT_INVALID_CODE, "AMBER_E_HARNESS_EVENT_INVALID");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});
