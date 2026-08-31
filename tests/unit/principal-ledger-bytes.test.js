"use strict";

// F061 follow-up (#306) — principal family migration: ledger BYTE equivalence.
//
// The family migration's contract (ADR-0028 decision 2; F061 Testing
// Decisions) is byte compatibility: the ledger ritual assembled by
// `defineLedgerFamily` must write the exact bytes the hand-written ritual
// wrote. This test replays one deterministic full lifecycle over the
// principal registry — register (every optional field bound) → register
// (a second, minimal service principal) → revoke (the terminal state, with
// a reason) — under a mocked ambient clock, and asserts the produced
// ledger under `.amber/principals/registry.jsonl` is byte-identical to
// the recorded golden:
//
//   registry.jsonl — registered, registered, revoked
//
// The write seams stamp `at` from the ambient clock (registerPrincipal /
// revokePrincipal take no injected-clock option), so the suite pins the
// clock through `mock.timers` (Date API): every stored timestamp — and
// with it every chain hash — is a fixed function of the fixture. The ids
// are caller-supplied and fixed.
//
// Recording method (do not re-record against a factory-assembled
// implementation — the golden bytes are the migration's before/after
// evidence and are only ever valid when recorded from a PRE-migration,
// hand-written ritual): the golden fixture
// `tests/fixtures/principal/registry-lifecycle.golden.jsonl` was recorded
// in this worktree BEFORE the migration, against the hand-written
// implementation at commit 92c6805 ("docs(adr): ADR-0028 amendment —
// preLink hook and ceiling wording as closed extensions (#306 re-open
// ruling)"), by running
//
//   AMBER_RECORD_PRINCIPAL_GOLDEN=1 node --test tests/unit/principal-ledger-bytes.test.js
//
// twice and verifying both recordings were byte-identical before
// committing. `.gitattributes` normalizes the fixture to LF, matching the
// `\n` the ledger writer appends.

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { registerPrincipal, revokePrincipal } = require("../../scripts/lib/core/principal-registry");
const { mkLedgerTarget, readEvents } = require("../helpers/harness");

const mkTarget = mkLedgerTarget("amber-principal-bytes");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "principal");
const GOLDEN = path.join(FIXTURES_DIR, "registry-lifecycle.golden.jsonl");
const GOLDEN_BYTES = 1106;
const GOLDEN_SHA256 = "941944aaa6df92ddb97908676ec59e934a53f066911837ed0cdb1f43b314d5c1";

// One distinct clock per write, so registeredAt/revokedAt discriminate the
// events and a wrong-clock regression cannot alias into a byte match.
const REGISTER_ALICE_AT = new Date("2026-08-30T12:00:00.000Z");
const REGISTER_SVC_AT = new Date("2026-08-30T12:00:01.000Z");
const REVOKE_ALICE_AT = new Date("2026-08-30T12:00:02.000Z");

function registryPathOf(dir) {
	return path.join(dir, ".amber", "principals", "registry.jsonl");
}

/**
 * The fixed operation sequence: register a human principal binding every
 * optional field, register a minimal service principal (optional fields
 * defaulting to null), then revoke the first — the terminal state.
 * Appends exactly three events to the one `.amber/principals/` ledger and
 * returns its path.
 */
function runLifecycle(dir) {
	const ok = (result, label) =>
		assert.equal(result.ok, true, `${label}: ${(result.errors || []).join("; ")}`);
	mock.timers.enable({ apis: ["Date"], now: REGISTER_ALICE_AT.getTime() });
	try {
		ok(
			registerPrincipal(dir, {
				id: "alice@example.com",
				principalKind: "human",
				role: "tech-lead",
				membership: "acme",
				capability: "approve-deployments",
				scope: "team-a",
				validFrom: "2026-01-01",
				validTo: "2027-01-01",
				issuer: "acme-it",
			}),
			"register alice@example.com",
		);
		mock.timers.setTime(REGISTER_SVC_AT.getTime());
		ok(
			registerPrincipal(dir, { id: "svc/deploy-bot", principalKind: "service" }),
			"register svc/deploy-bot",
		);
		mock.timers.setTime(REVOKE_ALICE_AT.getTime());
		ok(
			revokePrincipal(dir, { id: "alice@example.com", reason: "offboarded" }),
			"revoke alice@example.com",
		);
	} finally {
		mock.timers.reset();
	}
	return registryPathOf(dir);
}

test("the factory-assembled principal registry is byte-identical to the pre-migration recording", () => {
	const ledgerPath = runLifecycle(mkTarget("lifecycle"));
	// Sanity on the scenario itself before any byte talk: the event kinds in
	// the fixed append order, and the mocked clocks that pin every hash.
	const events = readEvents(ledgerPath);
	assert.deepEqual(
		events.map((event) => event.kind),
		["registered", "registered", "revoked"],
	);
	assert.deepEqual(
		events.map((event) => event.at),
		[REGISTER_ALICE_AT.toISOString(), REGISTER_SVC_AT.toISOString(), REVOKE_ALICE_AT.toISOString()],
		"the mocked ambient clock must pin every stored timestamp",
	);
	assert.equal(events[2].id, "alice@example.com");
	assert.equal(events[2].reason, "offboarded");
	const actual = fs.readFileSync(ledgerPath);
	const golden = fs.readFileSync(GOLDEN);
	assert.equal(
		golden.byteLength,
		GOLDEN_BYTES,
		"the recorded pre-migration principal golden size changed unexpectedly",
	);
	assert.equal(
		crypto.createHash("sha256").update(golden).digest("hex"),
		GOLDEN_SHA256,
		"the recorded pre-migration principal golden changed unexpectedly",
	);
	assert.equal(
		actual.equals(golden),
		true,
		"the migrated principal registry ritual wrote different bytes than the pre-migration implementation recorded in tests/fixtures/principal/registry-lifecycle.golden.jsonl",
	);
});
