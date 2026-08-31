"use strict";

// F061 follow-up (#303) — external family migration: ledger BYTE equivalence.
//
// The family migration's contract (ADR-0028 decision 2; F061 Testing
// Decisions) is byte compatibility: the ledger ritual assembled by
// `defineLedgerFamily` must write the exact bytes the hand-written ritual
// wrote — for every ledger the family owns. This test replays one
// deterministic full lifecycle across all three external ledgers —
// register (two contracts) → propose → authorize → execute → settle
// (unknown) → reconcile → compensate → authorize → execute → settle
// (committed) — with injected clocks against a seeded fixture, and asserts
// each produced ledger under `.amber/external/` is byte-identical to its
// recorded golden:
//
//   effects.jsonl    — effect, effect
//   proposals.jsonl  — proposal, authorized, proposal (compensates),
//                      authorized
//   executions.jsonl — execution, settlement (unknown), reconciliation,
//                      execution, settlement (committed)
//
// Recording method (do not re-record against a factory-assembled
// implementation — the golden bytes are the migration's before/after
// evidence and are only ever valid when recorded from a PRE-migration,
// hand-written ritual): the golden fixtures
// `tests/fixtures/external/{effects,proposals,executions}-lifecycle.golden.jsonl`
// were recorded in this worktree BEFORE the migration, against the
// hand-written implementation at commit cdc551a ("chore(features): accept
// F061 under the continued batch ruling (59/59 accepted)"), by running
//
//   AMBER_RECORD_EXTERNAL_GOLDEN=1 node --test tests/unit/external-ledger-bytes.test.js
//
// twice and verifying both recordings were byte-identical before
// committing. Every input is pinned (injected clocks, fixed ids, fixed
// digests), so the ledger bytes — including every chain hash and every
// canonical requestHash — are fully deterministic; `.gitattributes`
// normalizes the fixtures to LF, matching the `\n` the ledger writer
// appends.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
	registerExternalEffect,
	proposeExternalEffect,
	authorizeExternalEffect,
	executeExternalEffect,
	settleExternalExecution,
	reconcileExternalExecution,
	compensateExternalEffect,
	effectsPath,
	proposalsPath,
	executionsPath,
} = require("../../scripts/lib/core/external-registry");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { registerAdapter } = require("../../scripts/lib/core/adapter-registry");
const { grantApproval } = require("../../scripts/lib/core/approval-registry");
const { recordEvidence } = require("../../scripts/lib/core/evidence-receipts");
const { mkLedgerTarget, readEvents, seedDecisionFixture } = require("../helpers/harness");

const mkTarget = mkLedgerTarget("amber-external-bytes");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "external");
const GOLDEN = Object.freeze({
	effects: path.join(FIXTURES_DIR, "effects-lifecycle.golden.jsonl"),
	proposals: path.join(FIXTURES_DIR, "proposals-lifecycle.golden.jsonl"),
	executions: path.join(FIXTURES_DIR, "executions-lifecycle.golden.jsonl"),
});
const GOLDEN_SHA256 = Object.freeze({
	effects: "602b3dcd60a50718c69c8c2979eb5367e916cdf3238b9a2d248704efe02e7568",
	proposals: "8ab1ecb82515393b27ceb267fc1124f9b02258d3a6a7b11d291d21f46acafb51",
	executions: "da122483637da7abaadd30825d258b97eb197bd4f4cef69408291600cc7a7b43",
});
const GOLDEN_BYTES = Object.freeze({ effects: 1523, proposals: 2094, executions: 2472 });

const NOW = new Date("2026-08-29T00:00:00.000Z");
const HOUR_MS = 3_600_000;
const EXEC_AT = new Date(NOW.getTime() + 30 * 60_000);
const RECONCILE_AT = new Date(NOW.getTime() + 2 * HOUR_MS);

function effectInput(overrides = {}) {
	return {
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
		compensation: { kind: "effect", effect: "effect/ticket-comment-delete" },
		timeoutMs: 30_000,
		adapter: { id: "adapter/tracker", version: "1" },
		decision: { identity: "decision/effect-1", revision: 1 },
		...overrides,
	};
}

function boundary(at) {
	return {
		purpose: "comment.create",
		scope: "tracker/amber-protocol",
		expiresAt: new Date(at.getTime() + 30_000).toISOString(),
	};
}

/**
 * The fixed operation sequence (suite fixture conventions: injected
 * clocks, seedDecisionFixture anchors, the F056 pipeline verbs). Appends
 * exactly two effect events, four proposal events, and five execution
 * events across the three `.amber/external/` ledgers and returns their
 * paths keyed like GOLDEN.
 */
function runLifecycle(dir) {
	const ok = (result, label) =>
		assert.equal(result.ok, true, `${label}: ${(result.errors || []).join("; ")}`);
	seedDecisionFixture(dir, {
		principal: "legal@example.com",
		intent: "intent/external-bytes",
		body: "# X\n",
		identities: ["decision/effect-1", "decision/effect-2"],
	});
	assert.equal(registerPrincipal(dir, { id: "bob@example.com", principalKind: "human" }).ok, true);
	assert.equal(
		registerPrincipal(dir, { id: "auditor@example.com", principalKind: "service" }).ok,
		true,
	);
	ok(
		registerAdapter(dir, {
			id: "adapter/tracker",
			owner: "platform-team",
			adapterVersion: "1",
			recordTypes: [{ type: "ticket", versions: ["v1"] }],
			scope: "F056",
			identityMapping: { strategy: "path" },
			freshness: { maxAgeMs: 86_400_000 },
			permissions: { readOnly: true, allowedPaths: ["tracker"] },
		}),
		"registerAdapter",
	);
	// Effects event 1 — the primary contract; event 2 — its declared
	// compensating contract (irreversible itself).
	ok(registerExternalEffect(dir, effectInput(), { now: NOW }), "register effect");
	ok(
		registerExternalEffect(
			dir,
			effectInput({
				id: "effect/ticket-comment-delete",
				operation: "comment.delete",
				compensation: { kind: "irreversible" },
				decision: { identity: "decision/effect-2", revision: 1 },
			}),
			{ now: NOW },
		),
		"register compensating effect",
	);
	// Proposals event 1 — the plain request.
	const proposed = proposeExternalEffect(
		dir,
		{
			id: "request/1",
			effect: { id: "effect/ticket-comment", version: "1" },
			payloadHash: `sha256:${"a".repeat(64)}`,
		},
		{ now: NOW },
	);
	ok(proposed, "propose request/1");
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
		"grant approval 1",
	);
	// Proposals event 2 — the drift-checked single-use authorization.
	ok(
		authorizeExternalEffect(
			dir,
			{
				id: "request/1",
				approval: "approval/external-1",
				decisionIdentity: "decision/external-consume-1",
				body: "# Authorize external effect\n",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/external-bytes" } }],
			},
			{ now: NOW },
		),
		"authorize request/1",
	);
	// Executions event 1 — prepared from the reviewed contract snapshot.
	ok(
		executeExternalEffect(
			dir,
			{ id: "execution/1", request: "request/1", credential: boundary(EXEC_AT) },
			{ now: EXEC_AT },
		),
		"execute execution/1",
	);
	// Executions event 2 — an output-free receipt settles as unknown.
	ok(
		settleExternalExecution(
			dir,
			{
				id: "execution/1",
				externalRecordId: null,
				requestDigest: `sha256:${"d".repeat(64)}`,
				responseDigest: null,
				declared: "unknown",
			},
			{ now: EXEC_AT },
		),
		"settle execution/1 unknown",
	);
	ok(
		recordEvidence(dir, {
			id: "evidence/reconcile-1",
			producer: "auditor@example.com",
			assurance: "observed",
			scope: null,
			subject: "external/execution-1",
			inputs: null,
			tools: null,
			environment: null,
			outputs: null,
			status: "pass",
		}),
		"record reconciliation evidence",
	);
	// Executions event 3 — independent Evidence reconciles unknown to
	// committed.
	ok(
		reconcileExternalExecution(
			dir,
			{ id: "execution/1", evidence: "evidence/reconcile-1", externalRecordId: "TRACK-1234" },
			{ now: RECONCILE_AT },
		),
		"reconcile execution/1",
	);
	// Proposals event 3 — the compensation proposal linking the original.
	const compensated = compensateExternalEffect(
		dir,
		{ id: "request/undo-1", execution: "execution/1", payloadHash: `sha256:${"b".repeat(64)}` },
		{ now: RECONCILE_AT },
	);
	ok(compensated, "compensate execution/1");
	ok(
		grantApproval(
			dir,
			{
				id: "approval/external-2",
				approver: "bob@example.com",
				scope: null,
				subject: `external-effect:${compensated.record.requestHash}`,
				validUntil: "2036-01-01T00:00:00.000Z",
			},
			{ now: NOW },
		),
		"grant approval 2",
	);
	// Proposals event 4 — the compensation's own authorization.
	ok(
		authorizeExternalEffect(
			dir,
			{
				id: "request/undo-1",
				approval: "approval/external-2",
				decisionIdentity: "decision/external-consume-2",
				body: "# Authorize compensation\n",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/external-bytes" } }],
			},
			{ now: RECONCILE_AT },
		),
		"authorize request/undo-1",
	);
	// Executions event 4 — the compensation's own execution.
	ok(
		executeExternalEffect(
			dir,
			{
				id: "execution/undo-1",
				request: "request/undo-1",
				credential: boundary(RECONCILE_AT),
			},
			{ now: RECONCILE_AT },
		),
		"execute execution/undo-1",
	);
	// Executions event 5 — a committed receipt with the real record id.
	ok(
		settleExternalExecution(
			dir,
			{
				id: "execution/undo-1",
				externalRecordId: "TRACK-1234-DEL",
				requestDigest: `sha256:${"d".repeat(64)}`,
				responseDigest: `sha256:${"e".repeat(64)}`,
				declared: "committed",
			},
			{ now: RECONCILE_AT },
		),
		"settle execution/undo-1 committed",
	);
	return {
		effects: effectsPath(dir),
		proposals: proposalsPath(dir),
		executions: executionsPath(dir),
	};
}

test("the factory-assembled external ledgers are byte-identical to the pre-migration recording", () => {
	const ledgers = runLifecycle(mkTarget("lifecycle"));
	// Sanity on the scenario itself before any byte talk: every event kind
	// each ledger owns, in the fixed append order.
	assert.deepEqual(
		readEvents(ledgers.effects).map((event) => event.kind),
		["effect", "effect"],
	);
	assert.deepEqual(
		readEvents(ledgers.proposals).map((event) => event.kind),
		["proposal", "authorized", "proposal", "authorized"],
	);
	assert.deepEqual(
		readEvents(ledgers.proposals).map((event) => event.compensates ?? null),
		[null, null, "execution/1", null],
	);
	assert.deepEqual(
		readEvents(ledgers.executions).map((event) => event.kind),
		["execution", "settlement", "reconciliation", "execution", "settlement"],
	);
	assert.deepEqual(
		readEvents(ledgers.executions)
			.filter((event) => event.kind === "settlement")
			.map((event) => event.outcome),
		["unknown", "committed"],
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
			`the migrated ${name} ledger ritual wrote different bytes than the pre-migration implementation recorded in tests/fixtures/external/${name}-lifecycle.golden.jsonl`,
		);
	}
});
