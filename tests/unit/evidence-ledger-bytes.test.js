"use strict";

// F061 follow-up (#308) — evidence family migration: ledger BYTE equivalence.
//
// The family migration's contract (ADR-0028 decision 2; F061 Testing
// Decisions) is byte compatibility: the ledger ritual assembled by
// `defineLedgerFamily` must write the exact bytes the hand-written ritual
// wrote. This test replays one deterministic full lifecycle over the
// evidence ledger — record (every optional field bound, replayable) →
// record (a second, minimal observed receipt) → verify (independent
// principal, promoting effective assurance) — under a mocked ambient
// clock, and asserts the produced ledger under
// `.amber/evidence/receipts.jsonl` is byte-identical to the recorded
// golden:
//
//   receipts.jsonl — recorded, recorded, verified
//
// The write seams stamp `at` / `recordedAt` from the ambient clock
// (recordEvidence / verifyEvidence take no injected-clock option for the
// stored timestamp), so the suite pins the clock through `mock.timers`
// (Date API): every stored timestamp — and with it every chain hash — is
// a fixed function of the fixture. The ids are caller-supplied and fixed.
//
// Recording method (do not re-record against a factory-assembled
// implementation — the golden bytes are the migration's before/after
// evidence and are only ever valid when recorded from a PRE-migration,
// hand-written ritual): the golden fixture
// `tests/fixtures/evidence/receipts-lifecycle.golden.jsonl` was recorded
// in this worktree BEFORE the migration, against the hand-written
// implementation at commit c1f8fad ("refactor(core): assemble the
// approval registry through defineLedgerFamily (#307)"), by running
//
//   AMBER_RECORD_EVIDENCE_GOLDEN=1 node --test tests/unit/evidence-ledger-bytes.test.js
//
// twice and verifying both recordings were byte-identical before
// committing. `.gitattributes` normalizes the fixture to LF, matching the
// `\n` the ledger writer appends.

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { recordEvidence, verifyEvidence } = require("../../scripts/lib/core/evidence-receipts");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { mkLedgerTarget, readEvents } = require("../helpers/harness");

const mkTarget = mkLedgerTarget("amber-evidence-bytes");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "evidence");
const GOLDEN = path.join(FIXTURES_DIR, "receipts-lifecycle.golden.jsonl");

const RECORD_RUN1_AT = new Date("2026-08-30T12:00:00.000Z");
const RECORD_RUN2_AT = new Date("2026-08-30T12:00:01.000Z");
const VERIFY_RUN1_AT = new Date("2026-08-30T12:00:02.000Z");

function ledgerPathOf(dir) {
	return path.join(dir, ".amber", "evidence", "receipts.jsonl");
}

function ok(result, label) {
	assert.equal(result.ok, true, `${label}: ${(result.errors || []).join("; ")}`);
	return result;
}

/**
 * The fixed operation sequence: register the producer and an independent
 * verifier, record a fully-bound replayable receipt, record a minimal
 * observed receipt, then verify the first. Appends exactly three events
 * to the one `.amber/evidence/` ledger and returns its path.
 */
function runLifecycle(dir) {
	mock.timers.enable({ apis: ["Date"], now: RECORD_RUN1_AT.getTime() });
	try {
		ok(
			registerPrincipal(dir, {
				id: "ci-runner",
				principalKind: "service",
				capability: "execute",
			}),
			"register ci-runner",
		);
		ok(
			registerPrincipal(dir, {
				id: "reviewer-alice",
				principalKind: "human",
				role: "reviewer",
			}),
			"register reviewer-alice",
		);
		ok(
			recordEvidence(dir, {
				id: "evidence/run-1",
				producer: "ci-runner",
				assurance: "replayable",
				scope: "F050",
				subject: "spec/login@2",
				inputs: ["npm test"],
				tools: ["node"],
				environment: { os: "linux" },
				outputs: ["all green"],
				status: "pass",
				replayOf: "eval.instruction-surface",
			}),
			"record evidence/run-1",
		);
		mock.timers.setTime(RECORD_RUN2_AT.getTime());
		ok(
			recordEvidence(dir, {
				id: "evidence/run-2",
				producer: "ci-runner",
				assurance: "observed",
				subject: "spec/deploy@1",
				status: "pass",
			}),
			"record evidence/run-2",
		);
		mock.timers.setTime(VERIFY_RUN1_AT.getTime());
		ok(
			verifyEvidence(dir, { id: "evidence/run-1", verifier: "reviewer-alice" }),
			"verify evidence/run-1",
		);
	} finally {
		mock.timers.reset();
	}
	return ledgerPathOf(dir);
}

test("the factory-assembled evidence ledger is byte-identical to the pre-migration recording", () => {
	const ledgerPath = runLifecycle(mkTarget("lifecycle"));
	const events = readEvents(ledgerPath);
	assert.deepEqual(
		events.map((event) => event.kind),
		["recorded", "recorded", "verified"],
	);
	assert.deepEqual(
		events.map((event) => event.at),
		[RECORD_RUN1_AT.toISOString(), RECORD_RUN2_AT.toISOString(), VERIFY_RUN1_AT.toISOString()],
		"the mocked ambient clock must pin every stored timestamp",
	);
	assert.equal(events[2].evidenceId, "evidence/run-1");
	if (process.env.AMBER_RECORD_EVIDENCE_GOLDEN === "1") {
		fs.mkdirSync(FIXTURES_DIR, { recursive: true });
		fs.writeFileSync(GOLDEN, fs.readFileSync(ledgerPath));
	}
	const actual = fs.readFileSync(ledgerPath);
	const golden = fs.readFileSync(GOLDEN);
	assert.equal(
		actual.equals(golden),
		true,
		"the migrated evidence ledger ritual wrote different bytes than the pre-migration implementation recorded in tests/fixtures/evidence/receipts-lifecycle.golden.jsonl",
	);
});
