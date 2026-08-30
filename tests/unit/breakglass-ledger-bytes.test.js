"use strict";

// F061 T3 (#300) — breakglass tracer migration: ledger BYTE equivalence.
//
// The tracer migration's contract (ADR-0028 decision 2; F061 Testing
// Decisions) is byte compatibility: the ledger ritual assembled by
// `defineLedgerFamily` must write the exact bytes the hand-written ritual
// wrote. This test replays one deterministic full lifecycle — grant →
// use → settlement → review on one grant, plus a second grant → revoke —
// with injected clocks against a seeded fixture, and asserts the produced
// `.amber/breakglass/grants.jsonl` is byte-identical to the recorded
// golden ledger.
//
// Recording method (do not re-record against a factory-assembled
// implementation — the golden bytes are the migration's before/after
// evidence and are only ever valid when recorded from a PRE-migration,
// hand-written ritual): the golden fixture
// `tests/fixtures/breakglass/grants-lifecycle.golden.jsonl` was recorded
// in this worktree BEFORE the migration, against the hand-written
// implementation at commit 14a2907 ("feat(core): add the
// defineLedgerFamily factory skeleton (#299)"), by running
//
//   AMBER_RECORD_BREAKGLASS_GOLDEN=1 node --test tests/unit/breakglass-ledger-bytes.test.js
//
// twice and verifying both recordings were byte-identical before
// committing. Every input is pinned (injected clocks, fixed ids, fixed
// digests), so the ledger bytes — including every chain hash — are fully
// deterministic; `.gitattributes` normalizes the fixture to LF, matching
// the `\n` the ledger writer appends.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	grantBreakGlass,
	revokeBreakGlass,
	useBreakGlass,
	settleBreakGlass,
	reviewBreakGlass,
	grantsPath,
} = require("../../scripts/lib/core/breakglass-registry");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { registerAdapter } = require("../../scripts/lib/core/adapter-registry");
const {
	registerExternalEffect,
	proposeExternalEffect,
	authorizeExternalEffect,
	executeExternalEffect,
	settleExternalExecution,
} = require("../../scripts/lib/core/external-registry");
const { grantApproval } = require("../../scripts/lib/core/approval-registry");
const { mkLedgerTarget, readEvents, seedDecisionFixture } = require("../helpers/harness");

const mkTarget = mkLedgerTarget("amber-breakglass-bytes");

const GOLDEN_PATH = path.join(
	__dirname,
	"..",
	"fixtures",
	"breakglass",
	"grants-lifecycle.golden.jsonl",
);

const NOW = new Date("2026-08-29T00:00:00.000Z");
const HOUR_MS = 3_600_000;
const USE_AT = new Date(NOW.getTime() + 30 * 60_000);
const REVIEW_AT = new Date(NOW.getTime() + 2 * HOUR_MS);

function grantInput(overrides = {}) {
	return {
		id: "breakglass/incident-42-restore",
		incident: "incident/42",
		purpose: "restore-login-service",
		capability: { kind: "external", id: "effect/ticket-comment", version: "1" },
		target: "tracker/amber-protocol",
		scope: "issues",
		environment: "production",
		risk: "high",
		credentials: "scoped",
		validFrom: NOW.toISOString(),
		validUntil: new Date(NOW.getTime() + HOUR_MS).toISOString(),
		reviewBy: new Date(NOW.getTime() + 72 * HOUR_MS).toISOString(),
		decision: { identity: "decision/breakglass-1", revision: 1 },
		...overrides,
	};
}

/**
 * The fixed operation sequence (suite fixture conventions: injected
 * clocks, the F056 external capability, seedDecisionFixture anchors).
 * Appends exactly six events — grant, grant, use, settlement, revoke,
 * review — to `.amber/breakglass/grants.jsonl` and returns its path.
 */
function runLifecycle(dir) {
	const ok = (result, label) =>
		assert.equal(result.ok, true, `${label}: ${(result.errors || []).join("; ")}`);
	seedDecisionFixture(dir, {
		principal: "legal@example.com",
		intent: "intent/breakglass",
		body: "# B\n",
		identities: [
			"decision/breakglass-1",
			"decision/breakglass-2",
			"decision/breakglass-revoke-1",
			"decision/breakglass-review-1",
			"decision/effect-1",
		],
	});
	assert.equal(registerPrincipal(dir, { id: "bob@example.com", principalKind: "human" }).ok, true);
	ok(
		registerAdapter(dir, {
			id: "adapter/tracker",
			owner: "platform-team",
			adapterVersion: "1",
			recordTypes: [{ type: "ticket", versions: ["v1"] }],
			scope: "F057",
			identityMapping: { strategy: "path" },
			freshness: { maxAgeMs: 86_400_000 },
			permissions: { readOnly: true, allowedPaths: ["tracker"] },
		}),
		"registerAdapter",
	);
	ok(
		registerExternalEffect(
			dir,
			{
				id: "effect/ticket-comment",
				version: "1",
				owner: "platform-team",
				system: "ticketing",
				operation: "comment.create",
				target: "tracker/amber-protocol",
				scope: "issues",
				inputSchema: { type: "object", required: ["body"] },
				idempotency: "idempotent",
				credentials: "scoped",
				receiptFields: ["commentId"],
				compensation: { kind: "irreversible" },
				timeoutMs: 30_000,
				adapter: { id: "adapter/tracker", version: "1" },
				decision: { identity: "decision/effect-1", revision: 1 },
			},
			{ now: NOW },
		),
		"registerExternalEffect",
	);
	// Event 1 — grant A; event 2 — grant B (revoked later).
	ok(grantBreakGlass(dir, grantInput(), { now: NOW }), "grant A");
	ok(
		grantBreakGlass(
			dir,
			grantInput({
				id: "breakglass/incident-42-followup",
				purpose: "post-restore-followup",
				decision: { identity: "decision/breakglass-2", revision: 1 },
			}),
			{ now: NOW },
		),
		"grant B",
	);
	// The authorized underlying F056 request grant A admits through.
	const proposed = proposeExternalEffect(
		dir,
		{
			id: "request/1",
			effect: { id: "effect/ticket-comment", version: "1" },
			payloadHash: `sha256:${"a".repeat(64)}`,
		},
		{ now: NOW },
	);
	ok(proposed, "proposeExternalEffect");
	ok(
		grantApproval(
			dir,
			{
				id: "approval/external-1",
				approver: "bob@example.com",
				scope: null,
				subject: `external-effect:${proposed.record.requestHash}`,
				validUntil: "2036-01-01T00:00:00.000Z",
			},
			{ now: NOW },
		),
		"grantApproval",
	);
	ok(
		authorizeExternalEffect(
			dir,
			{
				id: "request/1",
				approval: "approval/external-1",
				decisionIdentity: "decision/external-consume-1",
				body: "# Authorize external effect\n",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/breakglass" } }],
			},
			{ now: NOW },
		),
		"authorizeExternalEffect",
	);
	// Event 3 — use A inside its half-open window.
	ok(
		useBreakGlass(
			dir,
			{ id: "breakglass/incident-42-restore", reference: "request/1" },
			{ now: USE_AT },
		),
		"use A",
	);
	// The real underlying receipt the settlement links.
	ok(
		executeExternalEffect(
			dir,
			{
				id: "execution/1",
				request: "request/1",
				credential: {
					purpose: "comment.create",
					scope: "tracker/amber-protocol",
					expiresAt: new Date(USE_AT.getTime() + 30_000).toISOString(),
				},
			},
			{ now: USE_AT },
		),
		"executeExternalEffect",
	);
	ok(
		settleExternalExecution(
			dir,
			{
				id: "execution/1",
				externalRecordId: "TRACK-1234",
				requestDigest: `sha256:${"d".repeat(64)}`,
				responseDigest: `sha256:${"e".repeat(64)}`,
				declared: "committed",
			},
			{ now: USE_AT },
		),
		"settleExternalExecution",
	);
	// Event 4 — settlement A against execution/1.
	ok(
		settleBreakGlass(
			dir,
			{ id: "breakglass/incident-42-restore", receipt: "execution/1" },
			{ now: USE_AT },
		),
		"settle A",
	);
	// Event 5 — revoke B behind its own single-use Decision.
	ok(
		revokeBreakGlass(
			dir,
			{
				id: "breakglass/incident-42-followup",
				reason: "primary-restore-succeeded",
				decision: { identity: "decision/breakglass-revoke-1", revision: 1 },
			},
			{ now: USE_AT },
		),
		"revoke B",
	);
	// Event 6 — the mandatory post-review of the used grant A.
	ok(
		reviewBreakGlass(
			dir,
			{
				id: "breakglass/incident-42-restore",
				outcome: "login-restored",
				necessity: "no-standing-path-existed",
				impact: "one-ticket-comment",
				followUp: "add-standing-runbook",
				decision: { identity: "decision/breakglass-review-1", revision: 1 },
			},
			{ now: REVIEW_AT },
		),
		"review A",
	);
	return grantsPath(dir);
}

test("the factory-assembled grant ledger is byte-identical to the pre-migration recording", () => {
	const ledgerPath = runLifecycle(mkTarget("lifecycle"));
	const actual = fs.readFileSync(ledgerPath);
	// Sanity on the scenario itself before any byte talk: all five event
	// kinds, in the fixed append order.
	assert.deepEqual(
		readEvents(ledgerPath).map((event) => event.kind),
		["grant", "grant", "use", "settlement", "revoke", "review"],
	);
	if (process.env.AMBER_RECORD_BREAKGLASS_GOLDEN === "1") {
		fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
		fs.writeFileSync(GOLDEN_PATH, actual);
	}
	const golden = fs.readFileSync(GOLDEN_PATH);
	assert.equal(
		actual.equals(golden),
		true,
		"the migrated ledger ritual wrote different bytes than the pre-migration implementation recorded in tests/fixtures/breakglass/grants-lifecycle.golden.jsonl",
	);
});
