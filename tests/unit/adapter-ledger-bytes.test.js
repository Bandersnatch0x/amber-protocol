"use strict";

// F061 follow-up (#309) — adapter family migration: ledger BYTE equivalence.
//
// The family migration's contract (ADR-0028 decision 2; F061 Testing
// Decisions) is byte compatibility: the ledger ritual assembled by
// `defineLedgerFamily` must write the exact bytes the hand-written ritual
// wrote — for every ledger the family owns. This test replays one
// deterministic full lifecycle across all four adapter ledgers —
// register → shadow-compare (one mapped item) → cutover → rollback —
// with injected clocks against a seeded fixture, and asserts each
// produced ledger under `.amber/adapters/` is byte-identical to its
// recorded golden:
//
//   registry.jsonl            — registered
//   read-receipts.jsonl       — read (from the comparison)
//   shadow-comparisons.jsonl  — shadow-comparison
//   cutovers.jsonl            — cutover, rollback
//
// Recording method (do not re-record against a factory-assembled
// implementation — the golden bytes are the migration's before/after
// evidence and are only ever valid when recorded from a PRE-migration,
// hand-written ritual): the golden fixtures
// `tests/fixtures/adapter/{registry,read-receipts,shadow-comparisons,cutovers}-lifecycle.golden.jsonl`
// were recorded in this worktree BEFORE the migration, against the
// hand-written implementation at commit 04f9ce7 ("refactor(core): assemble
// the evidence ledger through defineLedgerFamily (#308)"), by running
//
//   AMBER_RECORD_ADAPTER_GOLDEN=1 node --test tests/unit/adapter-ledger-bytes.test.js
//
// twice and verifying both recordings were byte-identical before
// committing. Every input is pinned (injected clocks, fixed ids, fixed
// source bytes), so the ledger bytes — including every chain hash — are
// fully deterministic; `.gitattributes` normalizes the fixtures to LF,
// matching the `\n` the ledger writer appends.

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
	registerAdapter,
	compareAdapterShadow,
	recordCutover,
	recordCutoverRollback,
	registryPath,
	receiptPath,
	comparisonPath,
	cutoverPath,
} = require("../../scripts/lib/core/adapter-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { recordEvidence } = require("../../scripts/lib/core/evidence-receipts");
const { mkLedgerTarget, readEvents } = require("../helpers/harness");

const mkTarget = mkLedgerTarget("amber-adapter-bytes");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "adapter");
const GOLDEN = Object.freeze({
	registry: path.join(FIXTURES_DIR, "registry-lifecycle.golden.jsonl"),
	receipts: path.join(FIXTURES_DIR, "read-receipts-lifecycle.golden.jsonl"),
	comparisons: path.join(FIXTURES_DIR, "shadow-comparisons-lifecycle.golden.jsonl"),
	cutovers: path.join(FIXTURES_DIR, "cutovers-lifecycle.golden.jsonl"),
});
const GOLDEN_SHA256 = Object.freeze({
	registry: "fc5eae3bc31cab200905275f377d082505ab271fd9bf2e0c95bf716330f89e6f",
	receipts: "cc5b1226da60ccaf6fc432e51be64e75d0915a6d7708bd3a3923f1af8e87a0aa",
	comparisons: "12e33eddce7c7a1ed59afb46419bdedcf09ccab8fb9c5a3e1b3b438ff4644cc3",
	cutovers: "4c484f2fbb4d3389ca2f8bcc8bc82ca737c1f08e05169294180a93fe05cd6b6c",
});
const GOLDEN_BYTES = Object.freeze({
	registry: 505,
	receipts: 756,
	comparisons: 1519,
	cutovers: 1296,
});

const NOW = new Date("2026-08-30T12:00:00.000Z");
const COMPARE_AT = new Date("2026-08-30T12:00:01.000Z");
const CUTOVER_AT = new Date("2026-08-30T12:00:02.000Z");
const ROLLBACK_AT = new Date("2026-08-30T12:00:03.000Z");

function ok(result, label) {
	assert.equal(result.ok, true, `${label}: ${(result.errors || []).join("; ")}`);
	return result;
}

function adapterInput() {
	return {
		id: "adapter/legacy",
		owner: "legacy-team",
		adapterVersion: "1",
		recordTypes: [{ type: "legacy-ticket", versions: ["v1"] }],
		scope: "F051",
		identityMapping: { strategy: "path" },
		freshness: { maxAgeMs: 86_400_000 },
		permissions: { readOnly: true, allowedPaths: ["legacy"] },
	};
}

function runLifecycle(dir) {
	const mappedBody = "# Mapped\n";
	fs.mkdirSync(path.join(dir, "legacy"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, "legacy", "mapped.json"),
		`${JSON.stringify({ id: "mapped", scope: "F051", artifact: { type: "intent", identity: "intent/mapped", body: mappedBody } })}\n`,
	);

	mock.timers.enable({ apis: ["Date"], now: NOW.getTime() });
	try {
		ok(registerAdapter(dir, adapterInput(), { now: NOW }), "register adapter/legacy");
		ok(
			admitArtifact(dir, {
				type: "intent",
				identity: "intent/mapped",
				body: mappedBody,
				scope: "F051",
			}),
			"admit intent/mapped",
		);
		ok(
			compareAdapterShadow(
				dir,
				{
					id: "adapter/legacy",
					fixtureId: "cutover-fixture",
					expectedTotal: 1,
					items: [
						{
							recordId: "mapped",
							source: "legacy/mapped.json",
							target: { type: "intent", identity: "intent/mapped", revision: 1 },
						},
					],
				},
				{ now: COMPARE_AT },
			),
			"shadow-compare mapped item",
		);

		ok(
			registerPrincipal(dir, { id: "alice@example.com", principalKind: "human" }),
			"register alice",
		);
		ok(
			registerPrincipal(dir, { id: "legacy-team", principalKind: "human" }),
			"register legacy-team",
		);
		ok(
			admitArtifact(dir, {
				type: "decision",
				identity: "decision/cutover-1",
				body: "# Decision decision/cutover-1\n",
				decisionKind: "approval",
				principal: "alice@example.com",
				scope: "F051",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/mapped" } }],
			}),
			"admit decision/cutover-1",
		);
		ok(
			admitArtifact(dir, {
				type: "decision",
				identity: "decision/rollback-1",
				body: "# Decision decision/rollback-1\n",
				decisionKind: "approval",
				principal: "alice@example.com",
				scope: "F051",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/mapped" } }],
			}),
			"admit decision/rollback-1",
		);
		ok(
			recordEvidence(dir, {
				id: "evidence/rollback-plan",
				producer: "legacy-team",
				assurance: "observed",
				scope: "F051",
				subject: "adapter/legacy ownership transfer",
				status: "pass",
			}),
			"record evidence/rollback-plan",
		);
		ok(
			recordEvidence(dir, {
				id: "evidence/rollback-run",
				producer: "legacy-team",
				assurance: "observed",
				scope: "F051",
				subject: "adapter/legacy ownership transfer",
				status: "pass",
			}),
			"record evidence/rollback-run",
		);

		ok(
			recordCutover(
				dir,
				{
					id: "adapter/legacy",
					cutoverId: "cutover/gen-1",
					artifactType: "intent",
					generation: "gen-1",
					comparisonIndex: 0,
					decision: { identity: "decision/cutover-1", revision: 1 },
					confirmedBy: "legacy-team",
					rollbackEvidence: "evidence/rollback-plan",
				},
				{ now: CUTOVER_AT },
			),
			"record cutover/gen-1",
		);
		ok(
			recordCutoverRollback(
				dir,
				{
					cutoverId: "cutover/gen-1",
					decision: { identity: "decision/rollback-1", revision: 1 },
					confirmedBy: "legacy-team",
					evidence: "evidence/rollback-run",
				},
				{ now: ROLLBACK_AT },
			),
			"rollback cutover/gen-1",
		);
	} finally {
		mock.timers.reset();
	}

	return {
		registry: registryPath(dir),
		receipts: receiptPath(dir),
		comparisons: comparisonPath(dir),
		cutovers: cutoverPath(dir),
	};
}

test("the factory-assembled adapter ledgers are byte-identical to the pre-migration recording", () => {
	const ledgers = runLifecycle(mkTarget("lifecycle"));
	assert.deepEqual(
		readEvents(ledgers.registry).map((event) => event.kind),
		["registered"],
	);
	assert.deepEqual(
		readEvents(ledgers.receipts).map((event) => event.kind),
		["read"],
	);
	assert.deepEqual(
		readEvents(ledgers.comparisons).map((event) => event.kind),
		["shadow-comparison"],
	);
	assert.deepEqual(
		readEvents(ledgers.cutovers).map((event) => event.kind),
		["cutover", "rollback"],
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
			`the migrated ${name} ledger ritual wrote different bytes than the pre-migration implementation recorded in tests/fixtures/adapter/${path.basename(GOLDEN[name])}`,
		);
	}
});
