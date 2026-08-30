"use strict";

// F061 T1 (#298) — the Decision primitives single-sourced into the
// registry-ledger primitive layer (ADR-0028): the kinds-parameterized
// decision snapshot validator, the canonical content hash, and the
// spend-scan kernel. The byte-equivalence tests pin outputs to values
// recorded from the removed per-family copies before deletion, so a
// drift in the single source fails against the old bytes, never
// against itself.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	DECISION_SNAPSHOT_FIELDS,
	decisionSnapshotProblem,
	canonicalHashOf,
	findDecisionSpend,
} = require("../../scripts/lib/core/registry-ledger");

const KINDS = Object.freeze(["acceptance", "approval"]);

// ── findDecisionSpend: the spend-scan kernel ─────────────────────────────

test("single slot: the first record carrying the pin names the spend", () => {
	const records = [
		{ id: "effect-1", version: "1", decision: { identity: "d-other", revision: 1 } },
		{ id: "effect-2", version: "1", decision: { identity: "d-1", revision: 2 } },
		{ id: "effect-3", version: "1", decision: { identity: "d-1", revision: 2 } },
	];
	const spent = findDecisionSpend(records, { identity: "d-1", revision: 2 }, ["decision"]);
	assert.equal(spent.record, records[1]);
	assert.equal(spent.slot, "decision");
});

test("an unspent Decision passes: no record and no slot carries the pin", () => {
	const records = [
		{ id: "g-1", decision: { identity: "d-1", revision: 1 }, revocation: null, review: null },
	];
	assert.equal(findDecisionSpend([], { identity: "d-1", revision: 1 }, ["decision"]), null);
	assert.equal(findDecisionSpend(records, { identity: "d-1", revision: 2 }, ["decision"]), null);
	assert.equal(
		findDecisionSpend(records, { identity: "d-9", revision: 1 }, [
			"decision",
			"revocation.decision",
			"review.decision",
		]),
		null,
	);
});

test("multi slot: slot paths resolve in declaration order and name the hit", () => {
	const grants = [
		{
			id: "g-1",
			decision: { identity: "d-grant", revision: 1 },
			revocation: { decision: { identity: "d-revoke", revision: 1 } },
			review: { decision: { identity: "d-review", revision: 1 } },
		},
	];
	const slots = ["decision", "revocation.decision", "review.decision"];
	const grant = findDecisionSpend(grants, { identity: "d-grant", revision: 1 }, slots);
	assert.equal(grant.record, grants[0]);
	assert.equal(grant.slot, "decision");
	assert.equal(
		findDecisionSpend(grants, { identity: "d-revoke", revision: 1 }, slots).slot,
		"revocation.decision",
	);
	assert.equal(
		findDecisionSpend(grants, { identity: "d-review", revision: 1 }, slots).slot,
		"review.decision",
	);
});

test("record order outranks slot order: records walk outer, slots inner", () => {
	const decision = { identity: "d-1", revision: 1 };
	const grants = [
		{ id: "g-1", decision: { identity: "d-other", revision: 1 }, review: { decision } },
		{ id: "g-2", decision, review: null },
	];
	const spent = findDecisionSpend(grants, decision, ["decision", "review.decision"]);
	assert.equal(spent.record, grants[0]);
	assert.equal(spent.slot, "review.decision");
});

test("the issuer slot name resolves like any declared path", () => {
	const holds = [
		{ id: "hold-1", issuer: { identity: "d-hold", revision: 3 }, release: null },
		{
			id: "hold-2",
			issuer: { identity: "d-other", revision: 1 },
			release: { decision: { identity: "d-release", revision: 1 } },
		},
	];
	const slots = ["issuer", "release.decision"];
	const issued = findDecisionSpend(holds, { identity: "d-hold", revision: 3 }, slots);
	assert.equal(issued.record, holds[0]);
	assert.equal(issued.slot, "issuer");
	const released = findDecisionSpend(holds, { identity: "d-release", revision: 1 }, slots);
	assert.equal(released.record, holds[1]);
	assert.equal(released.slot, "release.decision");
});

test("a null or missing slot step reads as unspent instead of throwing", () => {
	const records = [
		{ id: "r-1", release: null },
		{ id: "r-2" },
		{ id: "r-3", release: "not-an-object" },
		{ id: "r-4", release: { decision: null } },
	];
	assert.equal(
		findDecisionSpend(records, { identity: "d-1", revision: 1 }, ["release.decision", "issuer"]),
		null,
	);
});

test("spent is terminal: appended records never revise an earlier spend", () => {
	const decision = { identity: "d-1", revision: 1 };
	const grants = [{ id: "g-1", decision, revocation: null, review: null }];
	const before = findDecisionSpend(grants, decision, ["decision"]);
	grants.push({
		id: "g-2",
		decision: { identity: "d-2", revision: 1 },
		revocation: null,
		review: null,
	});
	const after = findDecisionSpend(grants, decision, ["decision"]);
	assert.equal(before.record, grants[0]);
	assert.equal(after.record, grants[0]);
	// A record in a terminal state still spends both of its Decisions.
	const released = [
		{
			id: "hold-1",
			status: "released",
			issuer: { identity: "d-issue", revision: 1 },
			release: { decision: { identity: "d-close", revision: 1 } },
		},
	];
	const slots = ["issuer", "release.decision"];
	assert.equal(
		findDecisionSpend(released, { identity: "d-issue", revision: 1 }, slots).slot,
		"issuer",
	);
	assert.equal(
		findDecisionSpend(released, { identity: "d-close", revision: 1 }, slots).slot,
		"release.decision",
	);
});

test("cross-ledger hook: one kernel scans two ledgers in both directions", () => {
	// maintain's two-direction check composes the kernel over two folds: a
	// Decision spent by a registration can never also triage a proposal,
	// and vice versa — each direction is one kernel scan over the other
	// ledger's records.
	const registration = { identity: "d-cross", revision: 1 };
	const triaged = { identity: "d-triage", revision: 1 };
	const detectors = [{ id: "det-1", version: "1", decision: registration }];
	const proposals = [
		{ fingerprint: "fp-1", triage: null },
		{ fingerprint: "fp-2", triage: { decision: triaged } },
	];
	assert.equal(findDecisionSpend(detectors, registration, ["decision"]).record, detectors[0]);
	assert.equal(findDecisionSpend(proposals, registration, ["triage.decision"]), null);
	assert.equal(findDecisionSpend(detectors, triaged, ["decision"]), null);
	assert.equal(
		findDecisionSpend(proposals, triaged, ["triage.decision"]).record.fingerprint,
		"fp-2",
	);
});

// ── decisionSnapshotProblem: byte-equivalence to the removed copies ──────

test("a valid snapshot passes for every kind in the caller's closed set", () => {
	for (const decisionKind of KINDS) {
		assert.equal(
			decisionSnapshotProblem(
				{ identity: "d-1", revision: 1, decisionKind, principal: "alice" },
				KINDS,
				"event.decision",
			),
			null,
		);
	}
});

test("snapshot refusals are byte-identical to the removed family copies", () => {
	// Expected texts recorded from the breakglass/external/retention copies
	// before deletion; their kind constants all read ["acceptance", "approval"].
	const label = "break-glass event 1.decision";
	assert.equal(decisionSnapshotProblem(null, KINDS, label), `${label} must be an object`);
	assert.equal(decisionSnapshotProblem([], KINDS, label), `${label} must be an object`);
	assert.equal(
		decisionSnapshotProblem(
			{ identity: "d", revision: 1, decisionKind: "acceptance", principal: "p", extra: 1 },
			KINDS,
			label,
		),
		'break-glass event 1.decision carries unknown field "extra"; the closed field set is identity, revision, decisionKind, principal',
	);
	assert.equal(
		decisionSnapshotProblem(
			{ identity: "d", revision: 1, decisionKind: "acceptance" },
			KINDS,
			label,
		),
		'break-glass event 1.decision is missing field "principal"; the closed field set is identity, revision, decisionKind, principal',
	);
	assert.equal(
		decisionSnapshotProblem(
			{ identity: " ", revision: 1, decisionKind: "acceptance", principal: "p" },
			KINDS,
			label,
		),
		"break-glass event 1.decision.identity must be a non-empty string",
	);
	assert.equal(
		decisionSnapshotProblem(
			{ identity: "d", revision: 0, decisionKind: "acceptance", principal: "p" },
			KINDS,
			label,
		),
		"break-glass event 1.decision.revision must be a positive integer",
	);
	assert.equal(
		decisionSnapshotProblem(
			{ identity: "d", revision: 1, decisionKind: "review", principal: "p" },
			KINDS,
			label,
		),
		"break-glass event 1.decision.decisionKind must be one of acceptance, approval",
	);
	assert.equal(
		decisionSnapshotProblem(
			{ identity: "d", revision: 1, decisionKind: "acceptance", principal: "" },
			KINDS,
			label,
		),
		"break-glass event 1.decision.principal must be a non-empty string",
	);
});

test("the closed snapshot field set matches the removed copies' constant", () => {
	assert.deepEqual(DECISION_SNAPSHOT_FIELDS, ["identity", "revision", "decisionKind", "principal"]);
	assert.ok(Object.isFrozen(DECISION_SNAPSHOT_FIELDS));
});

// ── canonicalHashOf: byte-equivalence to the removed copies ──────────────

test("canonical hashes are byte-identical to the removed copies on recorded fixtures", () => {
	// Expected values recorded by running the removed implementation
	// (`sha256:` + hex sha256 of Buffer.from(canonicalJson(JSON.stringify(v))))
	// before deletion; external/maintain/release/retention carried those
	// exact bytes and runner's sha256Bytes wrapper produced the same output.
	assert.equal(
		canonicalHashOf({ b: 1, a: "x" }),
		"sha256:cdab067e9f3beb32d1252cfd63e492592fecbf591b0d08cadb24bb17f3864246",
	);
	assert.equal(
		canonicalHashOf({
			id: "effect-1",
			version: "1.0.0",
			nested: { z: [3, 2, { y: null }], "\u00e9": "\u00fcn\u00efcode" },
			flag: true,
		}),
		"sha256:29acee035fa7ca9b491da984f60cc8a5c53aebc4d89cbd6da76cf1559bcc1c68",
	);
	assert.equal(
		canonicalHashOf("plain-string"),
		"sha256:69a35681d46c434bb666f849e810ab79aece20eb130665d6fdf0d9b433c8b842",
	);
	assert.equal(
		canonicalHashOf({
			releaseId: "rel-7",
			change: { commit: "a".repeat(40) },
			environment: "staging",
			rollback: null,
		}),
		"sha256:f03bfa1ea1765e1c09dcfb1973d830aa60c3ce9bfe224301d38837e3827f6e92",
	);
	// Key order never leaks into the canonical hash.
	assert.equal(canonicalHashOf({ a: "x", b: 1 }), canonicalHashOf({ b: 1, a: "x" }));
});
