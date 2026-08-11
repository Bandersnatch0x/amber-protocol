"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	MAX_LOOP_HISTORY_RECORDS,
	assessLoopProgress,
	inspectLoopLedger,
} = require("../../scripts/lib/core/loops");

function loopRecord(index = 0, overrides = {}) {
	const recordedAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
	return {
		schemaVersion: 1,
		recordedAt,
		triggerSource: "manual",
		workflowPackVersion: "0.1.0",
		contractId: "daily-amber-triage",
		contractVersion: "0.1.0",
		inputSnapshot: {
			sources: ["doctor report", "maintenance inspect"],
			capturedAt: recordedAt,
		},
		actionSummary: "reviewed the same local inputs",
		producedArtifacts: [],
		replayEvidence: [],
		budgetUsage: { minutes: 0 },
		stopReason: "manual-record",
		approvalState: "pending-review",
		reviewerOutcome: "not-reviewed",
		executesAnything: false,
		schedulesJobs: false,
		callsExternalSystems: false,
		...overrides,
	};
}

function tempDir(t, prefix) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	t.after(() => {
		fs.rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 50,
		});
	});
	return dir;
}

test("assessLoopProgress needs at least two ordinary records", () => {
	const progress = assessLoopProgress([loopRecord()]);

	assert.equal(progress.state, "insufficient-history");
	assert.equal(progress.sampleSize, 1);
	assert.equal(progress.counts.equivalentObservationTail, 1);
	assert.equal(progress.counts.emptyEvidenceDeltaTail, 1);
	assert.deepEqual(progress.signals, []);
	assert.match(progress.remedies.join("\n"), /at least two/i);
});

test("assessLoopProgress flags repeated observations with empty evidence deltas", () => {
	const progress = assessLoopProgress([loopRecord(0), loopRecord(1)]);

	assert.equal(progress.state, "stalled");
	assert.equal(progress.counts.equivalentObservationTail, 2);
	assert.equal(progress.counts.emptyEvidenceDeltaTail, 2);
	assert.ok(progress.signals.some((signal) => signal.id === "repeated-observation"));
	assert.ok(progress.signals.some((signal) => signal.id === "empty-evidence-delta"));
});

test("assessLoopProgress reports progressing when latest evidence changes", () => {
	const progress = assessLoopProgress([
		loopRecord(0),
		loopRecord(1, {
			replayEvidence: [{ type: "verification", result: "pass" }],
		}),
	]);

	assert.equal(progress.state, "progressing");
	assert.equal(progress.counts.equivalentObservationTail, 1);
	assert.equal(progress.counts.emptyEvidenceDeltaTail, 0);
});

test("assessLoopProgress surfaces repeated stop reasons conservatively", () => {
	const records = [0, 1, 2].map((index) =>
		loopRecord(index, {
			actionSummary: `distinct observation ${index}`,
			producedArtifacts: [`artifact-${index}.md`],
			stopReason: "reviewer-gate-required",
		}),
	);
	const progress = assessLoopProgress(records);

	assert.equal(progress.state, "stalled");
	assert.equal(progress.counts.sameStopReasonTail, 3);
	assert.ok(progress.signals.some((signal) => signal.id === "repeated-stop-reason"));
	assert.match(progress.remedies.join("\n"), /reviewer-gate-required/);
});

test("assessLoopProgress treats explicit budget exhaustion as stalled", () => {
	const progress = assessLoopProgress([loopRecord(0, { stopReason: "budget-exhausted" })]);

	assert.equal(progress.state, "stalled");
	assert.equal(progress.counts.budgetExhausted, 1);
	assert.ok(progress.signals.some((signal) => signal.id === "budget-exhausted"));
});

test("inspectLoopLedger preserves single-file record compatibility", (t) => {
	const dir = tempDir(t, "amber-loop-ledger-file-");
	const ledger = path.join(dir, "record.json");
	fs.writeFileSync(ledger, JSON.stringify(loopRecord(), null, 2));

	const result = inspectLoopLedger({ ledger });

	assert.deepEqual(result.record, loopRecord());
	assert.equal(result.records.length, 1);
	assert.equal(result.progress.state, "insufficient-history");
	assert.equal(result.history.source, "file");
	assert.equal(result.executesAnything, false);
	assert.equal(result.schedulesJobs, false);
	assert.equal(result.callsExternalSystems, false);
	assert.deepEqual(result.errors, []);
});

test("inspectLoopLedger retains valid directory history when one record is corrupt", (t) => {
	const dir = tempDir(t, "amber-loop-ledger-history-");
	fs.writeFileSync(path.join(dir, "01.json"), JSON.stringify(loopRecord(0), null, 2));
	fs.writeFileSync(path.join(dir, "02.json"), "{ broken");
	fs.writeFileSync(path.join(dir, "03.json"), JSON.stringify(loopRecord(2), null, 2));

	const result = inspectLoopLedger({ ledger: dir });

	assert.equal(result.records.length, 2);
	assert.equal(result.record.recordedAt, loopRecord(2).recordedAt);
	assert.equal(result.progress.state, "stalled");
	assert.equal(result.history.source, "directory");
	assert.equal(result.history.partial, true);
	assert.equal(result.warnings.length, 1);
	assert.match(result.warnings[0], /02\.json/);
	assert.doesNotMatch(result.warnings[0], /broken/);
	assert.deepEqual(result.errors, []);
});

test("inspectLoopLedger caps directory history to newest records", (t) => {
	const dir = tempDir(t, "amber-loop-ledger-cap-");
	const total = MAX_LOOP_HISTORY_RECORDS + 5;
	for (let index = 0; index < total; index += 1) {
		const filePath = path.join(dir, `${String(index).padStart(3, "0")}.json`);
		fs.writeFileSync(filePath, JSON.stringify(loopRecord(index), null, 2));
		const modifiedAt = new Date(Date.UTC(2026, 0, 1, 0, index));
		fs.utimesSync(filePath, modifiedAt, modifiedAt);
	}

	const result = inspectLoopLedger({ ledger: dir });

	assert.equal(result.records.length, MAX_LOOP_HISTORY_RECORDS);
	assert.equal(result.records[0].recordedAt, loopRecord(5).recordedAt);
	assert.equal(result.history.available, total);
	assert.equal(result.history.considered, MAX_LOOP_HISTORY_RECORDS);
	assert.equal(result.history.truncated, true);
	assert.ok(result.warnings.some((warning) => /newest 100/i.test(warning)));
});
