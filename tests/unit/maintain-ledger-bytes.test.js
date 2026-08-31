"use strict";

// F061 follow-up (#304) — maintain family migration: ledger BYTE equivalence.
//
// The family migration's contract (ADR-0028 decision 2; F061 Testing
// Decisions) is byte compatibility: the ledger ritual assembled by
// `defineLedgerFamily` must write the exact bytes the hand-written ritual
// wrote — for every ledger the family owns. This test replays one
// deterministic full lifecycle across all three maintain ledgers —
// register-detector → detect (Finding) → propose (opened) → detect →
// propose (evidence) → triage (fix) → complete → register-detector (v2) —
// with injected clocks against a seeded fixture, and asserts each produced
// ledger under `.amber/maintain/` is byte-identical to its recorded
// golden:
//
//   detectors.jsonl — detector, detector
//   findings.jsonl  — finding, finding
//   proposals.jsonl — proposal, evidence, triage (fix), completion
//
// Recording method (do not re-record against a factory-assembled
// implementation — the golden bytes are the migration's before/after
// evidence and are only ever valid when recorded from a PRE-migration,
// hand-written ritual): the golden fixtures
// `tests/fixtures/maintain/{detectors,findings,proposals}-lifecycle.golden.jsonl`
// were recorded in this worktree BEFORE the migration, against the
// hand-written implementation at commit 81c8d91 ("refactor(core): assemble
// the external ledgers through defineLedgerFamily (#303)"), by running
//
//   AMBER_RECORD_MAINTAIN_GOLDEN=1 node --test tests/unit/maintain-ledger-bytes.test.js
//
// twice and verifying both recordings were byte-identical before
// committing. Every input is pinned (injected clocks, fixed identities,
// fixed observation windows and input hashes — so every fingerprint,
// baselineHash, and chain hash is a fixed function of the fixture), and
// `.gitattributes` normalizes the fixtures to LF, matching the `\n` the
// ledger writer appends.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
	registerDetector,
	detect,
	propose,
	triage,
	complete,
	detectorsPath,
	findingsPath,
	proposalsPath,
} = require("../../scripts/lib/core/maintain-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { mkLedgerTarget, readEvents, seedDecisionFixture } = require("../helpers/harness");

const mkTarget = mkLedgerTarget("amber-maintain-bytes");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "maintain");
const GOLDEN = Object.freeze({
	detectors: path.join(FIXTURES_DIR, "detectors-lifecycle.golden.jsonl"),
	findings: path.join(FIXTURES_DIR, "findings-lifecycle.golden.jsonl"),
	proposals: path.join(FIXTURES_DIR, "proposals-lifecycle.golden.jsonl"),
});
const GOLDEN_SHA256 = Object.freeze({
	detectors: "8396a52b6df9f34cb973ff361323275f248e32d62787d237967644d9045fef60",
	findings: "70d41244c69b572e631fcd2b15aa02e13288ff330a738b5798e4e9d7adae8b19",
	proposals: "256668104d3e0b212feb68e422a3059693748095be443452018037f45616257e",
});
const GOLDEN_BYTES = Object.freeze({ detectors: 1414, findings: 1380, proposals: 1852 });

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const NOW = new Date("2026-08-29T02:00:00.000Z");

function detectorInput(overrides = {}) {
	return {
		id: "detector/error-rate",
		version: "1",
		metric: "http-5xx-rate",
		source: "observability/api",
		baseline: 10,
		rules: [
			{ tier: "warn", comparator: "ge", threshold: 100 },
			{ tier: "page", comparator: "ge", threshold: 500 },
		],
		windowMs: 3_600_000,
		scope: "service/api",
		cooldownMs: 3_600_000,
		maxObservations: 100,
		outputType: "finding",
		owner: "alice@example.com",
		policy: null,
		decision: { identity: "decision/detector-1", revision: 1 },
		...overrides,
	};
}

function observation(overrides = {}) {
	return {
		detectorId: "detector/error-rate",
		detectorVersion: "1",
		subject: "service/api",
		window: { from: "2026-08-29T00:00:00.000Z", to: "2026-08-29T00:30:00.000Z" },
		value: 120,
		inputHash: HASH_A,
		...overrides,
	};
}

/**
 * The fixed operation sequence (suite fixture conventions: injected
 * clocks, seedDecisionFixture anchors, the F054 pipeline verbs). Appends
 * exactly two detector events, two finding events, and four proposal
 * events across the three `.amber/maintain/` ledgers and returns their
 * paths keyed like GOLDEN.
 */
function runLifecycle(dir) {
	const ok = (result, label) =>
		assert.equal(result.ok, true, `${label}: ${(result.errors || []).join("; ")}`);
	seedDecisionFixture(dir, {
		principal: "alice@example.com",
		intent: "intent/maintain-bytes",
		body: "# Maintain bytes\n",
		identities: ["decision/detector-1", "decision/detector-2", "decision/triage-1"],
	});
	// Detectors event 1 — the v1 Control Band definition behind its
	// single-use committed human Decision.
	ok(registerDetector(dir, detectorInput(), { now: NOW }), "register detector v1");
	// Findings event 1 — the out-of-band verdict (warn) on the first window.
	ok(detect(dir, observation(), { now: NOW }), "detect finding 0");
	// Proposals event 1 — the Finding opens the Trigger Proposal.
	const opened = propose(dir, { findingIndex: 0 }, { now: NOW });
	ok(opened, "propose finding 0");
	assert.equal(opened.action, "opened");
	const fingerprint = opened.record.fingerprint;
	// Findings event 2 — a sliding-window repeat (new fingerprint, same
	// detector + subject) inside the cooldown.
	ok(
		detect(
			dir,
			observation({
				window: { from: "2026-08-29T00:30:00.000Z", to: "2026-08-29T01:00:00.000Z" },
				value: 130,
				inputHash: HASH_B,
			}),
			{ now: NOW },
		),
		"detect finding 1",
	);
	// Proposals event 2 — the repeat appends as evidence on the open
	// proposal instead of minting a parallel one.
	const appended = propose(dir, { findingIndex: 1 }, { now: NOW });
	ok(appended, "propose finding 1");
	assert.equal(appended.action, "appended");
	// Proposals event 3 — the declared service owner's fix triage, whose
	// candidate Intent payload still passes the NORMAL canonical surface.
	const fixed = triage(
		dir,
		{
			fingerprint,
			outcome: "fix",
			reason: null,
			decision: { identity: "decision/triage-1", revision: 1 },
		},
		{ now: NOW },
	);
	ok(fixed, "triage fix");
	assert.equal(admitArtifact(dir, fixed.candidate).ok, true);
	assert.equal(
		admitArtifact(dir, { type: "eval", identity: "eval/maintain-check", body: "# Eval\n" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, {
			type: "eval-result",
			identity: "eval-result/maintain-check-run",
			body: "# Result\n",
			extensions: {
				evalResult: { definition: { identity: "eval/maintain-check", revision: 1 } },
			},
		}).ok,
		true,
	);
	// Proposals event 4 — completion pins the shipped fix to the committed
	// intent/eval/eval-result revisions.
	ok(
		complete(
			dir,
			{
				fingerprint,
				intent: { identity: fixed.candidate.identity, revision: 1 },
				eval: { identity: "eval/maintain-check", revision: 1 },
				evalResult: { identity: "eval-result/maintain-check-run", revision: 1 },
			},
			{ now: NOW },
		),
		"complete fix",
	);
	// Detectors event 2 — a changed definition registers a new version, so
	// the detectors chain also proves a non-genesis link.
	ok(
		registerDetector(
			dir,
			detectorInput({
				version: "2",
				baseline: 20,
				decision: { identity: "decision/detector-2", revision: 1 },
			}),
			{ now: NOW },
		),
		"register detector v2",
	);
	return {
		detectors: detectorsPath(dir),
		findings: findingsPath(dir),
		proposals: proposalsPath(dir),
	};
}

test("the factory-assembled maintain ledgers are byte-identical to the pre-migration recording", () => {
	const ledgers = runLifecycle(mkTarget("lifecycle"));
	// Sanity on the scenario itself before any byte talk: every event kind
	// each ledger owns, in the fixed append order.
	assert.deepEqual(
		readEvents(ledgers.detectors).map((event) => event.kind),
		["detector", "detector"],
	);
	assert.deepEqual(
		readEvents(ledgers.detectors).map((event) => event.version),
		["1", "2"],
	);
	assert.deepEqual(
		readEvents(ledgers.findings).map((event) => event.kind),
		["finding", "finding"],
	);
	assert.deepEqual(
		readEvents(ledgers.proposals).map((event) => event.kind),
		["proposal", "evidence", "triage", "completion"],
	);
	assert.equal(
		readEvents(ledgers.proposals).find((event) => event.kind === "triage").outcome,
		"fix",
	);
	for (const name of Object.keys(GOLDEN)) {
		const actual = fs.readFileSync(ledgers[name]);
		const golden = fs.readFileSync(GOLDEN[name]);
		assert.equal(
			golden.byteLength,
			GOLDEN_BYTES[name],
			`the recorded pre-migration ${name} golden size changed unexpectedly`,
		);
		assert.equal(
			crypto.createHash("sha256").update(golden).digest("hex"),
			GOLDEN_SHA256[name],
			`the recorded pre-migration ${name} golden changed unexpectedly`,
		);
		assert.equal(
			actual.equals(golden),
			true,
			`the migrated ${name} ledger ritual wrote different bytes than the pre-migration implementation recorded in tests/fixtures/maintain/${name}-lifecycle.golden.jsonl`,
		);
	}
});
