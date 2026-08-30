"use strict";

// F061 follow-up (#305) — retention family migration: ledger BYTE equivalence.
//
// The family migration's contract (ADR-0028 decision 2; F061 Testing
// Decisions) is byte compatibility: the ledger ritual assembled by
// `defineLedgerFamily` must write the exact bytes the hand-written ritual
// wrote — for every ledger the family owns. This test replays one
// deterministic full lifecycle across all five retention ledgers —
// register two Holders → classify two records → hold (subject) → hold
// (record pin) → release → prepare candidate → authorize (Approval
// consumption) → execute → settle (failed retry, then full coverage) →
// derive the Deletion Proof — with injected clocks against a seeded
// fixture, and asserts each produced ledger under `.amber/retention/` is
// byte-identical to its recorded golden:
//
//   classifications.jsonl — classification, classification
//   holds.jsonl           — hold, hold, release
//   holders.jsonl         — holder, holder
//   candidates.jsonl      — candidate, authorized
//   transactions.jsonl    — execution, settlement (failed),
//                           settlement (settled), settlement (settled)
//
// Recording method (do not re-record against a factory-assembled
// implementation — the golden bytes are the migration's before/after
// evidence and are only ever valid when recorded from a PRE-migration,
// hand-written ritual): the golden fixtures
// `tests/fixtures/retention/{classifications,holds,holders,candidates,transactions}-lifecycle.golden.jsonl`
// were recorded in this worktree BEFORE the migration, against the
// hand-written implementation at commit a57e7f7 ("refactor(core): assemble
// the maintain ledgers through defineLedgerFamily (#304)"), by running
//
//   AMBER_RECORD_RETENTION_GOLDEN=1 node --test tests/unit/retention-ledger-bytes.test.js
//
// twice and verifying both recordings were byte-identical before
// committing. Every input is pinned (injected clocks, fixed identities,
// fixed receipt hashes — so every candidateHash, every frozen Decision
// snapshot, and every chain hash is a fixed function of the fixture), and
// `.gitattributes` normalizes the fixtures to LF, matching the `\n` the
// ledger writer appends.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	classify,
	hold,
	releaseHold,
	registerHolder,
	prepareDeletionCandidate,
	authorizeDeletion,
	executeDeletion,
	settleHolder,
	deletionProof,
	classificationsPath,
	holdsPath,
	holdersPath,
	candidatesPath,
	transactionsPath,
} = require("../../scripts/lib/core/retention-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { registerAdapter } = require("../../scripts/lib/core/adapter-registry");
const { grantApproval } = require("../../scripts/lib/core/approval-registry");
const { mkLedgerTarget, readEvents, seedDecisionFixture } = require("../helpers/harness");

const mkTarget = mkLedgerTarget("amber-retention-bytes");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "retention");
const GOLDEN = Object.freeze({
	classifications: path.join(FIXTURES_DIR, "classifications-lifecycle.golden.jsonl"),
	holds: path.join(FIXTURES_DIR, "holds-lifecycle.golden.jsonl"),
	holders: path.join(FIXTURES_DIR, "holders-lifecycle.golden.jsonl"),
	candidates: path.join(FIXTURES_DIR, "candidates-lifecycle.golden.jsonl"),
	transactions: path.join(FIXTURES_DIR, "transactions-lifecycle.golden.jsonl"),
});

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const NOW = new Date("2026-08-29T00:00:00.000Z");
const HOUR_MS = 3_600_000;
const RELEASE_AT = new Date(NOW.getTime() + 30 * 60_000);
const EXPIRED_AT = new Date(NOW.getTime() + HOUR_MS);
const SETTLE_AT = new Date(NOW.getTime() + 2 * HOUR_MS);

function holderInput(overrides = {}) {
	return {
		id: "holder/canonical-body",
		version: "1",
		surface: "canonical-body",
		adapter: { id: "adapter/store", version: "1" },
		decision: { identity: "decision/holder-1", revision: 1 },
		...overrides,
	};
}

/**
 * The fixed operation sequence (suite fixture conventions: injected
 * clocks, seedDecisionFixture anchors, the F055 pipeline verbs). Appends
 * exactly two classification events, three hold events, two holder
 * events, two candidate events, and four transaction events across the
 * five `.amber/retention/` ledgers and returns their paths keyed like
 * GOLDEN.
 */
function runLifecycle(dir) {
	const ok = (result, label) =>
		assert.equal(result.ok, true, `${label}: ${(result.errors || []).join("; ")}`);
	seedDecisionFixture(dir, {
		principal: "legal@example.com",
		intent: "intent/retention-bytes",
		body: "# Retention bytes\n",
		identities: [
			"decision/hold-1",
			"decision/hold-2",
			"decision/release-1",
			"decision/holder-1",
			"decision/holder-2",
		],
	});
	assert.equal(registerPrincipal(dir, { id: "bob@example.com", principalKind: "human" }).ok, true);
	assert.equal(
		admitArtifact(dir, { type: "intent", identity: "intent/login", body: "# L\n" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, { type: "intent", identity: "intent/audit-log", body: "# A\n" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, {
			type: "policy",
			identity: "policy/tenant-retention",
			body: "# Tenant retention\n",
			extensions: {
				retention: {
					classes: { operational: { ttlMs: HOUR_MS, legalBasis: "ops-contract" } },
				},
			},
		}).ok,
		true,
	);
	ok(
		registerAdapter(dir, {
			id: "adapter/store",
			owner: "storage-team",
			adapterVersion: "1",
			recordTypes: [{ type: "canonical-record", versions: ["v1"] }],
			scope: "F055",
			identityMapping: { strategy: "path" },
			freshness: { maxAgeMs: 86_400_000 },
			permissions: { readOnly: true, allowedPaths: ["store"] },
		}),
		"registerAdapter",
	);
	// Holders events 1 + 2 — the two copy-holding surfaces, each behind its
	// own single-use committed human Decision.
	ok(registerHolder(dir, holderInput(), { now: NOW }), "register holder/canonical-body");
	ok(
		registerHolder(
			dir,
			holderInput({
				id: "holder/cache",
				surface: "cache",
				decision: { identity: "decision/holder-2", revision: 1 },
			}),
			{ now: NOW },
		),
		"register holder/cache",
	);
	// Classifications events 1 + 2 — both records bind the operational
	// basis (1h TTL) from the pinned committed tenant Policy.
	const classifyInput = (identity) => ({
		record: { type: "intent", identity, revision: 1 },
		retentionClass: "operational",
		policy: { identity: "policy/tenant-retention", revision: 1 },
	});
	ok(classify(dir, classifyInput("intent/login"), { now: NOW }), "classify intent/login");
	ok(classify(dir, classifyInput("intent/audit-log"), { now: NOW }), "classify intent/audit-log");
	// Holds event 1 — the subject-scoped Legal Hold that stays active, so
	// the candidate later names intent/audit-log as a hold exclusion.
	ok(
		hold(
			dir,
			{
				id: "hold/litigation-1",
				scope: { subject: "intent/audit-log" },
				reason: "litigation hold",
				decision: { identity: "decision/hold-1", revision: 1 },
			},
			{ now: NOW },
		),
		"hold hold/litigation-1",
	);
	// Holds event 2 — a record-pinned hold on intent/login...
	ok(
		hold(
			dir,
			{
				id: "hold/review-2",
				scope: { record: { type: "intent", identity: "intent/login", revision: 1 } },
				reason: "records review",
				decision: { identity: "decision/hold-2", revision: 1 },
			},
			{ now: NOW },
		),
		"hold hold/review-2",
	);
	// Holds event 3 — ...released behind its own Decision, so the record
	// returns to plain TTL expiry while the released hold stays listable.
	ok(
		releaseHold(
			dir,
			{ id: "hold/review-2", decision: { identity: "decision/release-1", revision: 1 } },
			{ now: RELEASE_AT },
		),
		"release hold/review-2",
	);
	// Candidates event 1 — at the expiry clock intent/login is
	// expired-eligible and intent/audit-log is excluded by the active hold.
	const prepared = prepareDeletionCandidate(dir, { id: "deletion/1" }, { now: EXPIRED_AT });
	ok(prepared, "prepare deletion/1");
	ok(
		grantApproval(
			dir,
			{
				id: "approval/deletion-1",
				approver: "bob@example.com",
				scope: null,
				subject: `retention-deletion:${prepared.record.candidateHash}`,
				validUntil: "2036-01-01T00:00:00.000Z",
			},
			{ now: EXPIRED_AT },
		),
		"grant approval/deletion-1",
	);
	// Candidates event 2 — the drift-checked single-use authorization.
	ok(
		authorizeDeletion(
			dir,
			{
				id: "deletion/1",
				approval: "approval/deletion-1",
				decisionIdentity: "decision/deletion-consume-1",
				body: "# Authorize deletion\n",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/retention-bytes" } }],
				scope: null,
			},
			{ now: EXPIRED_AT },
		),
		"authorize deletion/1",
	);
	// Transactions event 1 — the one transaction the authorized candidate
	// opens, snapshotting the reviewed two-Holder coverage.
	ok(
		executeDeletion(dir, { id: "tx/1", candidateId: "deletion/1" }, { now: EXPIRED_AT }),
		"execute tx/1",
	);
	// Transactions event 2 — a failed receipt stays retryable.
	ok(
		settleHolder(
			dir,
			{
				transactionId: "tx/1",
				holder: { id: "holder/canonical-body", version: "1" },
				status: "failed",
				receiptHash: HASH_A,
			},
			{ now: EXPIRED_AT },
		),
		"settle holder/canonical-body failed",
	);
	// Transactions events 3 + 4 — the retry settles, then the second Holder
	// completes coverage; every Holder settles independently.
	ok(
		settleHolder(
			dir,
			{
				transactionId: "tx/1",
				holder: { id: "holder/canonical-body", version: "1" },
				status: "settled",
				receiptHash: HASH_A,
			},
			{ now: SETTLE_AT },
		),
		"settle holder/canonical-body settled",
	);
	ok(
		settleHolder(
			dir,
			{
				transactionId: "tx/1",
				holder: { id: "holder/cache", version: "1" },
				status: "settled",
				receiptHash: HASH_B,
			},
			{ now: SETTLE_AT },
		),
		"settle holder/cache settled",
	);
	// The read-only Deletion Proof derives from full settled coverage — the
	// lifecycle's terminal read, appending nothing.
	const proof = deletionProof(dir, "tx/1");
	ok(proof, "derive deletion proof");
	assert.equal(proof.record.transactionId, "tx/1");
	assert.equal(proof.record.settledAt, SETTLE_AT.toISOString());
	assert.match(proof.record.proofFingerprint, /^sha256:[0-9a-f]{64}$/);
	return {
		classifications: classificationsPath(dir),
		holds: holdsPath(dir),
		holders: holdersPath(dir),
		candidates: candidatesPath(dir),
		transactions: transactionsPath(dir),
	};
}

test("the factory-assembled retention ledgers are byte-identical to the pre-migration recording", () => {
	const ledgers = runLifecycle(mkTarget("lifecycle"));
	// Sanity on the scenario itself before any byte talk: every event kind
	// each ledger owns, in the fixed append order.
	assert.deepEqual(
		readEvents(ledgers.classifications).map((event) => event.kind),
		["classification", "classification"],
	);
	assert.deepEqual(
		readEvents(ledgers.holds).map((event) => event.kind),
		["hold", "hold", "release"],
	);
	assert.deepEqual(
		readEvents(ledgers.holders).map((event) => event.kind),
		["holder", "holder"],
	);
	assert.deepEqual(
		readEvents(ledgers.candidates).map((event) => event.kind),
		["candidate", "authorized"],
	);
	assert.deepEqual(
		readEvents(ledgers.transactions).map((event) => event.kind),
		["execution", "settlement", "settlement", "settlement"],
	);
	assert.deepEqual(
		readEvents(ledgers.transactions)
			.filter((event) => event.kind === "settlement")
			.map((event) => event.status),
		["failed", "settled", "settled"],
	);
	if (process.env.AMBER_RECORD_RETENTION_GOLDEN === "1") {
		fs.mkdirSync(FIXTURES_DIR, { recursive: true });
		for (const name of Object.keys(GOLDEN)) {
			fs.writeFileSync(GOLDEN[name], fs.readFileSync(ledgers[name]));
		}
	}
	for (const name of Object.keys(GOLDEN)) {
		const actual = fs.readFileSync(ledgers[name]);
		const golden = fs.readFileSync(GOLDEN[name]);
		assert.equal(
			actual.equals(golden),
			true,
			`the migrated ${name} ledger ritual wrote different bytes than the pre-migration implementation recorded in tests/fixtures/retention/${name}-lifecycle.golden.jsonl`,
		);
	}
});
