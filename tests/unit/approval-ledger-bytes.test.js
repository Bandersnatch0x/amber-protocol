"use strict";

// F061 follow-up (#307) — approval family migration: ledger BYTE equivalence.
//
// The family migration's contract (ADR-0028 decision 2; F061 Testing
// Decisions) is byte compatibility: the ledger ritual assembled by
// `defineLedgerFamily` must write the exact bytes the hand-written ritual
// wrote. This test replays one deterministic full lifecycle over the
// approval registry — grant (every optional field bound) → grant (a
// second, minimal approval) → revoke (the second) → consume (the first,
// atomically settling its Decision) — under injected clocks, and asserts
// the produced ledger under `.amber/approvals/registry.jsonl` is
// byte-identical to the recorded golden:
//
//   registry.jsonl — granted, granted, revoked, consumed
//
// Every write seam is pinned through `{ now }` (clockSource "injected"),
// so every stored timestamp — and with it every chain hash — is a fixed
// function of the fixture. The ids are caller-supplied and fixed.
//
// Recording method (do not re-record against a factory-assembled
// implementation — the golden bytes are the migration's before/after
// evidence and are only ever valid when recorded from a PRE-migration,
// hand-written ritual): the golden fixture
// `tests/fixtures/approval/registry-lifecycle.golden.jsonl` was recorded
// in this worktree BEFORE the migration, against the hand-written
// implementation at commit f7f9096 ("refactor(core): assemble the
// principal registry through defineLedgerFamily (#306)"), by running
//
//   AMBER_RECORD_APPROVAL_GOLDEN=1 node --test tests/unit/approval-ledger-bytes.test.js
//
// twice and verifying both recordings were byte-identical before
// committing. `.gitattributes` normalizes the fixture to LF, matching the
// `\n` the ledger writer appends.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	grantApproval,
	revokeApproval,
	consumeApproval,
} = require("../../scripts/lib/core/approval-registry");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { mkLedgerTarget, readEvents } = require("../helpers/harness");

const mkTarget = mkLedgerTarget("amber-approval-bytes");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "approval");
const GOLDEN = path.join(FIXTURES_DIR, "registry-lifecycle.golden.jsonl");

// One distinct clock per write, so recordedAt/revokedAt/consumedAt
// discriminate the events and a wrong-clock regression cannot alias into
// a byte match.
const GRANT_LOGIN_AT = new Date("2026-08-30T12:00:00.000Z");
const GRANT_DEPLOY_AT = new Date("2026-08-30T12:00:01.000Z");
const REVOKE_DEPLOY_AT = new Date("2026-08-30T12:00:02.000Z");
const CONSUME_LOGIN_AT = new Date("2026-08-30T12:00:03.000Z");

function registryPathOf(dir) {
	return path.join(dir, ".amber", "approvals", "registry.jsonl");
}

function ok(result, label) {
	assert.equal(result.ok, true, `${label}: ${(result.errors || []).join("; ")}`);
	return result;
}

/**
 * The fixed operation sequence: register the two acting humans, grant a
 * fully-bound approval, grant a minimal second approval, revoke the
 * second, admit the consume-target intent, then consume the first —
 * atomically settling its Decision. Appends exactly four events to the
 * one `.amber/approvals/` ledger and returns its path.
 */
function runLifecycle(dir) {
	ok(
		registerPrincipal(dir, {
			id: "alice@example.com",
			principalKind: "human",
			role: "tech-lead",
		}),
		"register alice@example.com",
	);
	ok(registerPrincipal(dir, { id: "bob@example.com", principalKind: "human" }), "register bob");

	ok(
		grantApproval(
			dir,
			{
				id: "approval/login-42",
				approver: "alice@example.com",
				scope: "team-a",
				subject: "spec/login@2",
				validUntil: "2027-01-01T00:00:00.000Z",
			},
			{ now: GRANT_LOGIN_AT },
		),
		"grant approval/login-42",
	);
	ok(
		grantApproval(
			dir,
			{
				id: "approval/deploy-7",
				approver: "bob@example.com",
				subject: "spec/deploy@1",
				validUntil: "2027-06-01T00:00:00.000Z",
			},
			{ now: GRANT_DEPLOY_AT },
		),
		"grant approval/deploy-7",
	);
	ok(
		revokeApproval(
			dir,
			{ id: "approval/deploy-7", revoker: "alice@example.com" },
			{ now: REVOKE_DEPLOY_AT },
		),
		"revoke approval/deploy-7",
	);

	const intent = admitArtifact(dir, {
		type: "intent",
		identity: "intent/login",
		body: "# Intent: login",
		scope: "team-a",
	});
	assert.equal(intent.ok, true, (intent.errors || []).join("; "));

	ok(
		consumeApproval(
			dir,
			{
				id: "approval/login-42",
				decisionIdentity: "decision/login-approved",
				body: "# Decision: approved",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/login" } }],
			},
			{ now: CONSUME_LOGIN_AT },
		),
		"consume approval/login-42",
	);
	return registryPathOf(dir);
}

test("the factory-assembled approval registry is byte-identical to the pre-migration recording", () => {
	const ledgerPath = runLifecycle(mkTarget("lifecycle"));
	const events = readEvents(ledgerPath);
	assert.deepEqual(
		events.map((event) => event.kind),
		["granted", "granted", "revoked", "consumed"],
	);
	assert.deepEqual(
		events.map((event) => event.at),
		[
			GRANT_LOGIN_AT.toISOString(),
			GRANT_DEPLOY_AT.toISOString(),
			REVOKE_DEPLOY_AT.toISOString(),
			CONSUME_LOGIN_AT.toISOString(),
		],
		"the injected clock must pin every stored timestamp",
	);
	assert.equal(events[2].approvalId, "approval/deploy-7");
	assert.equal(events[3].approvalId, "approval/login-42");
	assert.equal(events[3].decisionIdentity, "decision/login-approved");
	if (process.env.AMBER_RECORD_APPROVAL_GOLDEN === "1") {
		fs.mkdirSync(FIXTURES_DIR, { recursive: true });
		fs.writeFileSync(GOLDEN, fs.readFileSync(ledgerPath));
	}
	const actual = fs.readFileSync(ledgerPath);
	const golden = fs.readFileSync(GOLDEN);
	assert.equal(
		actual.equals(golden),
		true,
		"the migrated approval registry ritual wrote different bytes than the pre-migration implementation recorded in tests/fixtures/approval/registry-lifecycle.golden.jsonl",
	);
});
