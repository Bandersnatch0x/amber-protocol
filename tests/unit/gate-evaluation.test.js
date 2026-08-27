"use strict";

// F050 ticket 3 (#228) — Gate Contracts & deterministic evaluation (unit seam).
//
// Tests assert externally visible behavior of the gate core: the contract
// shape verdicts (the evaluator is the extensions carrier's first shape
// consumer), the deterministic allOf + bounded explicit anyOf evaluation,
// the Assurance ordering, the staleness boundary at the injected clock,
// the expiry boundary, every registered comparator at its boundary, the
// immutable hash-chained outcome ledger with its write lock and size
// ceiling, and fail-closed corruption handling — every failure mode
// carries a stable AMBER_E_* code.
//
// Fixtures use the REAL seams end to end: principal register → evidence
// record/verify → artifact admit (the gate with its extensions contract) →
// evaluateGate. The evidence writers stamp recordedAt with the system
// clock, so staleness boundary tests read the stamped recordedAt back and
// derive the exact boundary clocks from it (age == maxAgeMs is fresh,
// age == maxAgeMs + 1 is stale).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	GATE_EVALUATION_SCHEMA_VERSION,
	SUPPORTED_GATE_EVALUATION_SCHEMA_VERSIONS,
	COMPARATORS,
	FAIL_BEHAVIORS,
	SKEW_POLICY,
	CLOCK_SOURCES,
	DEFAULT_MAX_OUTCOME_BYTES,
	MAX_ANYOF_SETS,
	MAX_ANYOF_ENTRIES,
	GENESIS_HASH,
	chainHash,
	evaluateGate,
	showGateOutcome,
	listGateOutcomes,
} = require("../../scripts/lib/core/gate-evaluation");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { recordEvidence, verifyEvidence } = require("../../scripts/lib/core/evidence-receipts");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { writeJSONL } = require("../../scripts/lib/core/jsonl");

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-gate-${label}-`));
}

function outcomeLedgerPath(dir) {
	return path.join(dir, ".amber", "gates", "outcomes.jsonl");
}

function readLedger(dir) {
	return fs
		.readFileSync(outcomeLedgerPath(dir), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
}

/** The common seed: one human, one service principal, both registered. */
function seedPrincipals(dir) {
	const alice = registerPrincipal(dir, {
		id: "alice@example.com",
		principalKind: "human",
		role: "reviewer",
	});
	const bob = registerPrincipal(dir, {
		id: "bob@example.com",
		principalKind: "human",
	});
	const bot = registerPrincipal(dir, {
		id: "ci-bot",
		principalKind: "service",
		capability: "execute",
	});
	assert.equal(alice.ok, true, (alice.errors || []).join("; "));
	assert.equal(bob.ok, true, (bob.errors || []).join("; "));
	assert.equal(bot.ok, true, (bot.errors || []).join("; "));
}

/**
 * Record one evidence receipt through the real seam (system-clock
 * recordedAt); asserts success and returns the derived receipt so callers
 * can derive exact staleness boundary clocks from its recordedAt.
 */
function recordReceipt(dir, overrides = {}) {
	const result = recordEvidence(
		dir,
		{
			id: "evidence/run-1",
			producer: "ci-bot",
			assurance: "observed",
			subject: "spec/login@2",
			outputs: ["87"],
			status: "pass",
			...overrides,
		},
		{},
	);
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	return result.receipt;
}

/** Admit one committed gate artifact carrying the extensions contract. */
function admitGate(dir, contract, overrides = {}) {
	const admission = admitArtifact(dir, {
		type: "gate",
		identity: "gate/login-gate",
		body: "# Gate: login readiness",
		extensions: { gate: contract },
		...overrides,
	});
	assert.equal(admission.ok, true, (admission.errors || []).join("; "));
	return admission;
}

function evaluate(dir, overrides = {}, opts = {}) {
	return evaluateGate(
		dir,
		{ gate: "gate/login-gate", subject: "spec/login@2", ...overrides },
		opts,
	);
}

// ── Contract constants ──

test("gate evaluation constants pin the comparator, clock, and schema contracts", () => {
	assert.equal(GATE_EVALUATION_SCHEMA_VERSION, 1);
	assert.deepEqual(SUPPORTED_GATE_EVALUATION_SCHEMA_VERSIONS, [1]);
	assert.deepEqual(COMPARATORS.numeric, ["eq", "ne", "lt", "le", "gt", "ge"]);
	assert.deepEqual(COMPARATORS.string, ["eq", "ne", "contains"]);
	assert.deepEqual(COMPARATORS.version, ["eq", "lt", "le", "gt", "ge"]);
	assert.deepEqual(FAIL_BEHAVIORS, ["deny"]);
	assert.deepEqual(CLOCK_SOURCES, ["injected", "system"]);
	assert.equal(SKEW_POLICY, "no-tolerance");
	assert.equal(DEFAULT_MAX_OUTCOME_BYTES, 1024 * 1024);
	assert.equal(MAX_ANYOF_SETS, 8);
	assert.equal(MAX_ANYOF_ENTRIES, 8);
});

// ── allOf: pass / fail ──

test("allOf passes when every requirement is satisfied and appends one outcome", () => {
	const dir = mkTarget("allof-pass");
	seedPrincipals(dir);
	recordReceipt(dir);
	admitGate(dir, {
		require: [
			{ evidenceType: "spec/login@2", assurance: "observed" },
			{
				evidenceType: "spec/login@2",
				assurance: "observed",
				threshold: { value: 80, comparator: "ge" },
			},
		],
	});
	const result = evaluate(dir, {}, { now: new Date("2027-01-01T00:00:00.000Z") });

	assert.equal(result.ok, true, (result.errors || []).join("; "));
	assert.equal(result.code, null);
	assert.equal(result.outcome.verdict, "pass");
	assert.equal(result.outcome.gate, "gate/login-gate");
	assert.equal(result.outcome.gateRevision, 1);
	assert.equal(result.outcome.subject, "spec/login@2");
	assert.equal(result.outcome.clockSource, "injected");
	assert.equal(result.outcome.skewPolicy, SKEW_POLICY);
	assert.equal(result.outcome.index, 0);
	assert.equal(
		result.outcome.gateContentHash,
		admissionContentHash(dir),
		"the outcome binds the gate envelope's content hash",
	);
	const requirements = result.outcome.details.requirements;
	assert.equal(requirements.length, 2);
	for (const detail of requirements) {
		assert.equal(detail.satisfied, true);
		assert.equal(detail.evidenceId, "evidence/run-1");
		assert.equal(detail.effectiveAssurance, "observed");
		assert.equal(detail.stale, false);
	}
	assert.deepEqual(requirements[1].threshold, { value: 80, comparator: "ge", actual: 87 });

	const events = readLedger(dir);
	assert.equal(events.length, 1);
	assert.deepEqual(Object.keys(events[0]).sort(), [
		"at",
		"clockSource",
		"details",
		"gate",
		"gateContentHash",
		"gateRevision",
		"hash",
		"kind",
		"prevHash",
		"schemaVersion",
		"skewPolicy",
		"subject",
		"verdict",
	]);
	assert.equal(events[0].kind, "evaluated");
	assert.equal(events[0].prevHash, GENESIS_HASH);
	assert.equal(events[0].hash, chainHash({ ...events[0], prevHash: GENESIS_HASH }, GENESIS_HASH));
});

function admissionContentHash(dir) {
	const lines = readLedger(dir);
	return lines[lines.length - 1].gateContentHash;
}

test("allOf fails when one requirement is missing its evidence, and still appends the outcome", () => {
	const dir = mkTarget("allof-fail");
	seedPrincipals(dir);
	recordReceipt(dir);
	admitGate(dir, {
		require: [
			{ evidenceType: "spec/login@2", assurance: "observed" },
			{ evidenceType: "eval/login-e2e", assurance: "observed" },
		],
	});
	const result = evaluate(dir);

	// A FAIL verdict is a completed evaluation: ok true, the record appended.
	assert.equal(result.ok, true);
	assert.equal(result.outcome.verdict, "fail");
	assert.equal(result.outcome.details.requirements[0].satisfied, true);
	const missing = result.outcome.details.requirements[1];
	assert.equal(missing.satisfied, false);
	assert.equal(missing.evidenceId, null, "no candidate: the why-not is the null evidence");
	assert.equal(missing.effectiveAssurance, null);
	assert.equal(missing.recordedAt, null);
	assert.equal(missing.stale, false);
	assert.equal(readLedger(dir).length, 1, "the fail verdict is still recorded");
});

test("a receipt with failing status cannot satisfy a requirement", () => {
	const dir = mkTarget("failing-status");
	seedPrincipals(dir);
	recordReceipt(dir, { status: "fail" });
	admitGate(dir, { require: [{ evidenceType: "spec/login@2", assurance: "observed" }] });
	const result = evaluate(dir);

	assert.equal(result.ok, true);
	assert.equal(result.outcome.verdict, "fail");
	const detail = result.outcome.details.requirements[0];
	assert.equal(detail.satisfied, false);
	assert.equal(detail.evidenceId, "evidence/run-1", "the failing receipt is the why-not evidence");
	assert.equal(detail.effectiveAssurance, "observed");
});

// ── anyOf: bounded explicit alternatives ──

test("anyOf passes when at least one alternative set is fully satisfied", () => {
	const dir = mkTarget("anyof-pass");
	seedPrincipals(dir);
	recordReceipt(dir, { assurance: "replayable", replayOf: "eval/login-e2e" });
	admitGate(dir, {
		require: [{ evidenceType: "spec/login@2", assurance: "observed" }],
		anyOf: [
			[{ evidenceType: "eval/coverage", assurance: "observed" }],
			[
				{ evidenceType: "spec/login@2", assurance: "replayable" },
				{ evidenceType: "spec/login@2", assurance: "observed", maxAgeMs: 60_000 },
			],
		],
	});
	const result = evaluate(dir);

	assert.equal(result.ok, true);
	assert.equal(result.outcome.verdict, "pass");
	const sets = result.outcome.details.anyOf;
	assert.equal(sets.length, 2);
	assert.equal(sets[0].satisfied, false);
	assert.equal(sets[0].entries[0].satisfied, false);
	assert.equal(sets[1].satisfied, true);
	assert.equal(sets[1].entries[0].satisfied, true);
	assert.equal(sets[1].entries[0].effectiveAssurance, "replayable");
});

test("anyOf fails when every alternative set has an unsatisfied entry", () => {
	const dir = mkTarget("anyof-fail");
	seedPrincipals(dir);
	recordReceipt(dir);
	admitGate(dir, {
		require: [{ evidenceType: "spec/login@2", assurance: "observed" }],
		anyOf: [
			[{ evidenceType: "eval/coverage", assurance: "observed" }],
			[{ evidenceType: "spec/login@2", assurance: "verified" }],
		],
	});
	const result = evaluate(dir);

	assert.equal(result.ok, true);
	assert.equal(result.outcome.verdict, "fail");
	for (const set of result.outcome.details.anyOf) {
		assert.equal(set.satisfied, false);
	}
});

test("an empty anyOf set is vacuously satisfied (a spelled-out empty alternative)", () => {
	const dir = mkTarget("anyof-empty-set");
	seedPrincipals(dir);
	recordReceipt(dir);
	admitGate(dir, {
		require: [{ evidenceType: "spec/login@2", assurance: "observed" }],
		anyOf: [[], [{ evidenceType: "eval/coverage", assurance: "observed" }]],
	});
	const result = evaluate(dir);

	assert.equal(result.ok, true);
	assert.equal(result.outcome.verdict, "pass", "every entry of the empty set is satisfied");
});

// ── Assurance ordering boundaries ──

test("required observed is satisfied by observed, replayable, and verified — but not unavailable", () => {
	const dir = mkTarget("assurance-observed");
	seedPrincipals(dir);
	admitGate(dir, { require: [{ evidenceType: "spec/login@2", assurance: "observed" }] });

	const levels = [
		["unavailable", null],
		["observed", null],
		["replayable", "eval/login-e2e"],
	];
	for (const [index, [assurance, replayOf]] of levels.entries()) {
		recordReceipt(dir, { id: `evidence/level-${index}`, assurance, replayOf });
		const result = evaluate(dir);
		const detail = result.outcome.details.requirements[0];
		assert.equal(result.outcome.verdict, assurance === "unavailable" ? "fail" : "pass");
		// Levels arrive in ascending order, so the best candidate is always
		// the receipt this iteration just recorded.
		assert.equal(detail.effectiveAssurance, assurance);
	}
});

test("required verified is not satisfied by replayable, but is after an independent verification promotes it", () => {
	const dir = mkTarget("assurance-verified");
	seedPrincipals(dir);
	recordReceipt(dir, { assurance: "replayable", replayOf: "eval/login-e2e" });
	admitGate(dir, { require: [{ evidenceType: "spec/login@2", assurance: "verified" }] });

	const before = evaluate(dir);
	assert.equal(before.outcome.verdict, "fail");
	assert.equal(before.outcome.details.requirements[0].effectiveAssurance, "replayable");

	// An independent registered principal (verifier ≠ producer) promotes the
	// effective assurance to verified.
	const verified = verifyEvidence(dir, { id: "evidence/run-1", verifier: "bob@example.com" }, {});
	assert.equal(verified.ok, true, (verified.errors || []).join("; "));

	const after = evaluate(dir);
	assert.equal(after.outcome.verdict, "pass");
	assert.equal(after.outcome.details.requirements[0].effectiveAssurance, "verified");
	assert.equal(after.outcome.details.requirements[0].satisfied, true);
});

// ── Staleness boundary (injected clock, exact ages) ──

test("age == maxAgeMs is fresh and age == maxAgeMs + 1 is stale (requirement-level bound)", () => {
	const dir = mkTarget("staleness-boundary");
	seedPrincipals(dir);
	const receipt = recordReceipt(dir);
	const recordedAt = Date.parse(receipt.recordedAt);
	const MAX_AGE = 3_600_000;
	admitGate(dir, {
		require: [{ evidenceType: "spec/login@2", assurance: "observed", maxAgeMs: MAX_AGE }],
	});

	const fresh = evaluate(dir, {}, { now: new Date(recordedAt + MAX_AGE) });
	assert.equal(fresh.outcome.verdict, "pass");
	assert.equal(fresh.outcome.details.requirements[0].stale, false);

	const stale = evaluate(dir, {}, { now: new Date(recordedAt + MAX_AGE + 1) });
	assert.equal(stale.outcome.verdict, "fail");
	const detail = stale.outcome.details.requirements[0];
	assert.equal(detail.stale, true);
	assert.equal(detail.evidenceId, "evidence/run-1", "the stale receipt is the why-not evidence");
});

test("the requirement maxAgeMs overrides the gate maxEvidenceAgeMs; no bound means always fresh", () => {
	const dir = mkTarget("staleness-precedence");
	seedPrincipals(dir);
	const receipt = recordReceipt(dir);
	const recordedAt = Date.parse(receipt.recordedAt);

	// The gate-level bound (1 hour) would make the receipt stale; the
	// requirement's own tighter bound governs where declared, and its
	// absence inherits the gate bound.
	admitGate(dir, {
		require: [
			{ evidenceType: "spec/login@2", assurance: "observed", maxAgeMs: 60_000 },
			{ evidenceType: "spec/login@2", assurance: "observed" },
		],
		maxEvidenceAgeMs: 3_600_000,
	});
	const atTwoMinutes = evaluate(dir, {}, { now: new Date(recordedAt + 120_000) });
	assert.equal(atTwoMinutes.outcome.verdict, "fail");
	assert.equal(atTwoMinutes.outcome.details.requirements[0].stale, true);
	assert.equal(atTwoMinutes.outcome.details.requirements[1].stale, false);

	// No bound anywhere: a receipt from the far past is still fresh.
	const dir2 = mkTarget("staleness-unbounded");
	seedPrincipals(dir2);
	const receipt2 = recordReceipt(dir2);
	admitGate(dir2, { require: [{ evidenceType: "spec/login@2", assurance: "observed" }] });
	const ancient = evaluate(
		dir2,
		{},
		{
			now: new Date(Date.parse(receipt2.recordedAt) + 365 * 24 * 3_600_000),
		},
	);
	assert.equal(ancient.outcome.verdict, "pass");
	assert.equal(ancient.outcome.details.requirements[0].stale, false);
});

// ── Expiry boundary ──

test("a gate 1 ms before expiry evaluates; at expiry it refuses with no outcome appended", () => {
	const dir = mkTarget("expiry-boundary");
	seedPrincipals(dir);
	recordReceipt(dir);
	const expires = "2027-01-01T00:00:00.000Z";
	admitGate(dir, {
		require: [{ evidenceType: "spec/login@2", assurance: "observed" }],
		expires,
	});

	const before = evaluate(dir, {}, { now: new Date("2026-12-31T23:59:59.999Z") });
	assert.equal(before.ok, true);
	assert.equal(before.outcome.verdict, "pass");
	assert.equal(readLedger(dir).length, 1);

	const atExpiry = evaluate(dir, {}, { now: new Date("2027-01-01T00:00:00.000Z") });
	assert.equal(atExpiry.ok, false);
	assert.equal(atExpiry.code, "AMBER_E_GATE_EXPIRED");
	assert.equal(atExpiry.outcome, null);
	assert.equal(readLedger(dir).length, 1, "the expired gate appended nothing");
});

// ── Thresholds: every comparator at its boundary ──

let thresholdSeq = 0;

// Each case admits its OWN gate identity and evaluates its OWN subject, so
// re-admitting a changed contract never trips the artifact store's
// idempotency refusal (same Body, different Envelope) and one case's
// receipts never join another case's requirement.
function thresholdCase(dir, value, comparator, outputs, expected, expectedActual) {
	thresholdSeq += 1;
	const identity = `gate/threshold-${thresholdSeq}`;
	const subject = `spec/threshold-${thresholdSeq}`;
	recordReceipt(dir, { id: `evidence/threshold-${thresholdSeq}`, outputs, subject });
	admitGate(
		dir,
		{
			require: [{ evidenceType: subject, assurance: "observed", threshold: { value, comparator } }],
		},
		{ identity },
	);
	const result = evaluate(dir, { gate: identity, subject });
	assert.equal(
		result.outcome.verdict,
		expected,
		`${comparator} ${value} against output ${JSON.stringify(outputs[outputs.length - 1])}`,
	);
	assert.deepEqual(result.outcome.details.requirements[0].threshold, {
		value,
		comparator,
		actual: expectedActual,
	});
}

test("numeric comparators at exact equality", () => {
	const dir = mkTarget("threshold-numeric");
	seedPrincipals(dir);
	thresholdCase(dir, 87, "eq", ["87"], "pass", 87);
	thresholdCase(dir, 87, "ne", ["87"], "fail", 87);
	thresholdCase(dir, 87, "ne", ["88"], "pass", 88);
	thresholdCase(dir, 87, "lt", ["87"], "fail", 87);
	thresholdCase(dir, 87, "lt", ["86"], "pass", 86);
	thresholdCase(dir, 87, "le", ["87"], "pass", 87);
	thresholdCase(dir, 87, "le", ["88"], "fail", 88);
	thresholdCase(dir, 87, "gt", ["87"], "fail", 87);
	thresholdCase(dir, 87, "gt", ["88"], "pass", 88);
	thresholdCase(dir, 87, "ge", ["87"], "pass", 87);
	thresholdCase(dir, 87, "ge", ["86"], "fail", 86);
});

test("the compared value is the receipt's LAST output", () => {
	const dir = mkTarget("threshold-last-output");
	seedPrincipals(dir);
	recordReceipt(dir, { id: "evidence/last-output", outputs: ["ignored", "87"] });
	admitGate(dir, {
		require: [
			{
				evidenceType: "spec/login@2",
				assurance: "observed",
				threshold: { value: 80, comparator: "ge" },
			},
		],
	});
	const result = evaluate(dir);
	assert.equal(result.outcome.verdict, "pass");
	assert.equal(result.outcome.details.requirements[0].threshold.actual, 87);
});

test("a numeric parse failure leaves the requirement unsatisfied with actual null", () => {
	const dir = mkTarget("threshold-parse-failure");
	seedPrincipals(dir);
	recordReceipt(dir, { outputs: ["coverage: 87%"] });
	admitGate(dir, {
		require: [
			{
				evidenceType: "spec/login@2",
				assurance: "observed",
				threshold: { value: 80, comparator: "ge" },
			},
		],
	});
	const result = evaluate(dir);
	assert.equal(result.outcome.verdict, "fail");
	assert.deepEqual(result.outcome.details.requirements[0].threshold, {
		value: 80,
		comparator: "ge",
		actual: null,
	});
});

test("version comparators compare dot-numerically: 1.2 < 1.10", () => {
	const dir = mkTarget("threshold-version");
	seedPrincipals(dir);
	thresholdCase(dir, "1.2", "gt", ["1.10"], "pass", "1.10");
	thresholdCase(dir, "1.10", "gt", ["1.2"], "fail", "1.2");
	thresholdCase(dir, "1.10", "lt", ["1.2"], "pass", "1.2");
	thresholdCase(dir, "1.2.0", "le", ["1.2"], "pass", "1.2");
	thresholdCase(dir, "1.2", "eq", ["1.2"], "pass", "1.2");
	thresholdCase(dir, "2.0", "ge", ["2.0.1"], "pass", "2.0.1");
	thresholdCase(dir, "1.2", "le", ["1.10"], "fail", "1.10");

	// A non-dot-numeric output is a version parse failure.
	recordReceipt(dir, { id: "evidence/version-nonnumeric", outputs: ["v1.2"] });
	admitGate(dir, {
		require: [
			{
				evidenceType: "spec/login@2",
				assurance: "observed",
				threshold: { value: "1.2", comparator: "lt" },
			},
		],
	});
	const result = evaluate(dir);
	assert.equal(result.outcome.verdict, "fail");
	assert.equal(result.outcome.details.requirements[0].threshold.actual, null);
});

test("string comparators compare exactly, with contains as a substring test", () => {
	const dir = mkTarget("threshold-string");
	seedPrincipals(dir);
	thresholdCase(dir, "PASSED", "eq", ["PASSED"], "pass", "PASSED");
	thresholdCase(dir, "PASSED", "eq", ["passed"], "fail", "passed");
	thresholdCase(dir, "PASSED", "ne", ["FAILED"], "pass", "FAILED");
	thresholdCase(
		dir,
		"all tests passed",
		"contains",
		["suite: all tests passed in 3s"],
		"pass",
		"suite: all tests passed in 3s",
	);
	thresholdCase(
		dir,
		"all tests failed",
		"contains",
		["suite: all tests passed in 3s"],
		"fail",
		"suite: all tests passed in 3s",
	);
});

// ── Contract-invalid cases (fail closed before any outcome) ──

function contractInvalidCase(contract, expectedCode) {
	const dir = mkTarget("contract-invalid");
	seedPrincipals(dir);
	admitGate(dir, contract);
	const result = evaluate(dir);
	assert.equal(result.ok, false);
	assert.equal(result.code, expectedCode);
	assert.equal(result.outcome, null);
	assert.ok(fs.existsSync(outcomeLedgerPath(dir)) === false, "no outcome is appended");
}

test("a gate artifact without the gate extension contract is contract-invalid", () => {
	const dir = mkTarget("no-contract");
	seedPrincipals(dir);
	const admission = admitArtifact(dir, {
		type: "gate",
		identity: "gate/login-gate",
		body: "# Gate: no contract",
	});
	assert.equal(admission.ok, true);
	const result = evaluate(dir);
	assert.equal(result.ok, false);
	assert.equal(result.code, "AMBER_E_GATE_CONTRACT_INVALID");
});

test("gate.require is required and must be a non-empty array", () => {
	contractInvalidCase({}, "AMBER_E_GATE_CONTRACT_INVALID");
	contractInvalidCase({ require: [] }, "AMBER_E_GATE_CONTRACT_INVALID");
	contractInvalidCase({ require: "spec/login@2" }, "AMBER_E_GATE_CONTRACT_INVALID");
});

test("unknown gate.* keys, requirement keys, and threshold keys are invalid", () => {
	contractInvalidCase(
		{ require: [{ evidenceType: "spec/login@2" }], scoring: "weighted" },
		"AMBER_E_GATE_CONTRACT_INVALID",
	);
	contractInvalidCase(
		{ require: [{ evidenceType: "spec/login@2", weight: 3 }] },
		"AMBER_E_GATE_CONTRACT_INVALID",
	);
	contractInvalidCase(
		{
			require: [
				{
					evidenceType: "spec/login@2",
					threshold: { value: 80, comparator: "ge", tolerance: 5 },
				},
			],
		},
		"AMBER_E_GATE_CONTRACT_INVALID",
	);
});

test("an unregistered comparator and an unsupported fail behavior carry their own codes", () => {
	contractInvalidCase(
		{ require: [{ evidenceType: "s", threshold: { value: 80, comparator: "approx" } }] },
		"AMBER_E_GATE_UNSUPPORTED_COMPARATOR",
	);
	contractInvalidCase(
		{ require: [{ evidenceType: "s" }], failBehavior: "warn" },
		"AMBER_E_GATE_FAIL_BEHAVIOR_UNSUPPORTED",
	);
	// "deny" is the only supported behavior; anything else fails closed.
	contractInvalidCase(
		{ require: [{ evidenceType: "s" }], failBehavior: "DENY" },
		"AMBER_E_GATE_FAIL_BEHAVIOR_UNSUPPORTED",
	);
});

test("a value/comparator family mismatch and malformed scalars are invalid", () => {
	// A number with a string-only operator: no family takes it.
	contractInvalidCase(
		{ require: [{ evidenceType: "s", threshold: { value: 80, comparator: "contains" } }] },
		"AMBER_E_GATE_CONTRACT_INVALID",
	);
	// A non-dot-numeric version operand.
	contractInvalidCase(
		{ require: [{ evidenceType: "s", threshold: { value: "banana", comparator: "lt" } }] },
		"AMBER_E_GATE_CONTRACT_INVALID",
	);
	// String where an array is needed.
	contractInvalidCase(
		{ require: [{ evidenceType: "s" }], owners: "alice@example.com" },
		"AMBER_E_GATE_CONTRACT_INVALID",
	);
	contractInvalidCase(
		{ require: [{ evidenceType: "s" }], anyOf: [{ evidenceType: "s" }] },
		"AMBER_E_GATE_CONTRACT_INVALID",
	);
	// Unparseable expiry and non-positive age bounds.
	contractInvalidCase(
		{ require: [{ evidenceType: "s" }], expires: "tomorrow" },
		"AMBER_E_GATE_CONTRACT_INVALID",
	);
	contractInvalidCase(
		{ require: [{ evidenceType: "s" }], maxEvidenceAgeMs: 0 },
		"AMBER_E_GATE_CONTRACT_INVALID",
	);
	contractInvalidCase(
		{ require: [{ evidenceType: "s" }], maxEvidenceAgeMs: -5 },
		"AMBER_E_GATE_CONTRACT_INVALID",
	);
	// Non-string evidenceType.
	contractInvalidCase({ require: [{ evidenceType: 42 }] }, "AMBER_E_GATE_CONTRACT_INVALID");
	// Out-of-set assurance.
	contractInvalidCase(
		{ require: [{ evidenceType: "s", assurance: "probable" }] },
		"AMBER_E_GATE_CONTRACT_INVALID",
	);
});

test("anyOf beyond the bounded explicit limits is contract-invalid", () => {
	const nineSets = Array.from({ length: MAX_ANYOF_SETS + 1 }, () => [
		{ evidenceType: "spec/login@2" },
	]);
	contractInvalidCase(
		{ require: [{ evidenceType: "s" }], anyOf: nineSets },
		"AMBER_E_GATE_CONTRACT_INVALID",
	);
	const nineEntries = Array.from({ length: MAX_ANYOF_ENTRIES + 1 }, () => ({
		evidenceType: "spec/login@2",
	}));
	contractInvalidCase(
		{ require: [{ evidenceType: "s" }], anyOf: [nineEntries] },
		"AMBER_E_GATE_CONTRACT_INVALID",
	);
});

test("a gate artifact that does not exist fails closed with the gate not-found code", () => {
	const dir = mkTarget("gate-missing");
	const result = evaluateGate(dir, { gate: "gate/nope", subject: "spec/login@2" }, {});
	assert.equal(result.ok, false);
	assert.equal(result.code, "AMBER_E_GATE_NOT_FOUND");
});

test("evaluation arguments are validated before any state is touched", () => {
	const dir = mkTarget("evaluate-args");
	const cases = [
		[{ gate: "", subject: "s" }, "empty gate"],
		[{ gate: "gate/login-gate", subject: "" }, "empty subject"],
		[{ gate: "gate/login-gate", subject: "s", revision: 0 }, "zero revision"],
		[{ gate: "gate/login-gate", subject: "s", revision: 1.5 }, "fractional revision"],
	];
	for (const [input, label] of cases) {
		const result = evaluateGate(dir, input, {});
		assert.equal(result.ok, false, label);
		assert.equal(result.code, "AMBER_E_INVALID_ARG", label);
	}
});

// ── Revision selection ──

test("--revision selects the committed gate revision; the default is the head", () => {
	const dir = mkTarget("revision-select");
	seedPrincipals(dir);
	recordReceipt(dir);
	admitGate(dir, { require: [{ evidenceType: "spec/login@2", assurance: "observed" }] });
	// A second, stricter revision is now the head.
	admitGate(
		dir,
		{ require: [{ evidenceType: "spec/login@2", assurance: "verified" }] },
		{ expectedHead: 1 },
	);

	const head = evaluate(dir);
	assert.equal(head.outcome.gateRevision, 2);
	assert.equal(head.outcome.verdict, "fail", "the head requires verified assurance");

	const first = evaluate(dir, { revision: 1 });
	assert.equal(first.outcome.gateRevision, 1);
	assert.equal(first.outcome.verdict, "pass");

	const missing = evaluate(dir, { revision: 9 });
	assert.equal(missing.ok, false);
	assert.equal(missing.code, "AMBER_E_GATE_NOT_FOUND");
});

// ── Outcome immutability and the read seams ──

test("a second evaluation appends a new line; outcomes are immutable and indexed", () => {
	const dir = mkTarget("immutability");
	seedPrincipals(dir);
	recordReceipt(dir);
	admitGate(dir, { require: [{ evidenceType: "spec/login@2", assurance: "observed" }] });

	const first = evaluate(dir);
	const second = evaluate(dir);
	assert.equal(second.ok, true);
	const events = readLedger(dir);
	assert.equal(events.length, 2, "each evaluation appends one line");
	assert.equal(events[0].hash, first.outcome.hash);
	assert.equal(events[1].prevHash, events[0].hash, "the second outcome chains onto the first");
	assert.equal(second.outcome.index, 1);

	const listed = listGateOutcomes(dir);
	assert.equal(listed.length, 2);
	assert.equal(listed[0].index, 0);
	assert.equal(listed[1].index, 1);
	assert.equal(showGateOutcome(dir, { index: 1 }).hash, second.outcome.hash);
	assert.equal(showGateOutcome(dir, { gate: "gate/login-gate" }).index, 1, "latest matching");
	assert.equal(showGateOutcome(dir, { gate: "gate/login-gate", subject: "spec/login@2" }).index, 1);
	assert.equal(showGateOutcome(dir, { gate: "gate/other" }), null);
});

test("list filters by gate, subject, and verdict", () => {
	const dir = mkTarget("list-filters");
	seedPrincipals(dir);
	recordReceipt(dir);
	admitGate(dir, { require: [{ evidenceType: "spec/login@2", assurance: "observed" }] });
	evaluate(dir); // pass
	evaluate(dir, { subject: "spec/other@1" }); // fail (no evidence for that subject)

	assert.equal(listGateOutcomes(dir).length, 2);
	assert.equal(listGateOutcomes(dir, { verdict: "pass" }).length, 1);
	assert.equal(listGateOutcomes(dir, { verdict: "fail" }).length, 1);
	assert.equal(listGateOutcomes(dir, { subject: "spec/other@1" })[0].verdict, "fail");
	assert.equal(listGateOutcomes(dir, { gate: "gate/login-gate", verdict: "pass" }).length, 1);
});

test("the system clock source is recorded when no clock is injected", () => {
	const dir = mkTarget("system-clock");
	seedPrincipals(dir);
	recordReceipt(dir);
	admitGate(dir, { require: [{ evidenceType: "spec/login@2", assurance: "observed" }] });
	const result = evaluate(dir);
	assert.equal(result.outcome.clockSource, "system");
	assert.notEqual(result.outcome.at, "");
});

test("an in-place ledger edit fails every read closed as corruption", () => {
	const dir = mkTarget("tampered-ledger");
	seedPrincipals(dir);
	recordReceipt(dir);
	admitGate(dir, { require: [{ evidenceType: "spec/login@2", assurance: "observed" }] });
	evaluate(dir);

	const events = readLedger(dir);
	events[0].verdict = "pass-edited";
	writeJSONL(outcomeLedgerPath(dir), events);

	assert.throws(
		() => listGateOutcomes(dir),
		(err) => err.amberCode === "AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT",
	);
	assert.throws(
		() => showGateOutcome(dir, { index: 0 }),
		(err) => err.amberCode === "AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT",
	);
	const result = evaluate(dir);
	assert.equal(result.ok, false);
	assert.equal(result.code, "AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT");
});

test("a hand-built event outside the closed field set is corruption on read", () => {
	const dir = mkTarget("unknown-field");
	const event = {
		kind: "evaluated",
		schemaVersion: GATE_EVALUATION_SCHEMA_VERSION,
		at: "2026-08-01T00:00:00.000Z",
		clockSource: "injected",
		skewPolicy: SKEW_POLICY,
		gate: "gate/login-gate",
		gateRevision: 1,
		subject: "spec/login@2",
		verdict: "pass",
		gateContentHash: "sha256:" + "a".repeat(64),
		details: { requirements: [], anyOf: [] },
		scoring: 0.87,
		prevHash: GENESIS_HASH,
		hash: chainHash(
			{
				kind: "evaluated",
				schemaVersion: GATE_EVALUATION_SCHEMA_VERSION,
				at: "2026-08-01T00:00:00.000Z",
				clockSource: "injected",
				skewPolicy: SKEW_POLICY,
				gate: "gate/login-gate",
				gateRevision: 1,
				subject: "spec/login@2",
				verdict: "pass",
				gateContentHash: "sha256:" + "a".repeat(64),
				details: { requirements: [], anyOf: [] },
				scoring: 0.87,
			},
			GENESIS_HASH,
		),
	};
	writeJSONL(outcomeLedgerPath(dir), [event]);
	assert.throws(
		() => listGateOutcomes(dir),
		(err) => err.amberCode === "AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT",
	);
});

test("a hand-built event missing a closed-set field is corruption on read", () => {
	const dir = mkTarget("missing-field");
	const body = {
		kind: "evaluated",
		schemaVersion: GATE_EVALUATION_SCHEMA_VERSION,
		at: "2026-08-01T00:00:00.000Z",
		clockSource: "injected",
		skewPolicy: SKEW_POLICY,
		gate: "gate/login-gate",
		gateRevision: 1,
		subject: "spec/login@2",
		verdict: "pass",
		details: { requirements: [], anyOf: [] },
	};
	writeJSONL(outcomeLedgerPath(dir), [
		{ ...body, prevHash: GENESIS_HASH, hash: chainHash(body, GENESIS_HASH) },
	]);
	assert.throws(
		() => listGateOutcomes(dir),
		(err) => err.amberCode === "AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT",
	);
});

test("an outcome event with an unsupported schema version is corruption on read", () => {
	const dir = mkTarget("unsupported-version");
	const body = {
		kind: "evaluated",
		schemaVersion: 99,
		at: "2026-08-01T00:00:00.000Z",
		clockSource: "injected",
		skewPolicy: SKEW_POLICY,
		gate: "gate/login-gate",
		gateRevision: 1,
		subject: "spec/login@2",
		verdict: "pass",
		gateContentHash: "sha256:" + "a".repeat(64),
		details: { requirements: [], anyOf: [] },
	};
	writeJSONL(outcomeLedgerPath(dir), [
		{ ...body, prevHash: GENESIS_HASH, hash: chainHash(body, GENESIS_HASH) },
	]);
	assert.throws(
		() => listGateOutcomes(dir),
		(err) => err.amberCode === "AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT",
	);
});

// ── Size ceiling ──

test("the outcome size ceiling refuses the append before any durable state is touched", () => {
	const dir = mkTarget("size-ceiling");
	seedPrincipals(dir);
	recordReceipt(dir);
	admitGate(dir, { require: [{ evidenceType: "spec/login@2", assurance: "observed" }] });

	process.env.AMBER_GATE_MAX_OUTCOME_BYTES = "1";
	try {
		const result = evaluate(dir);
		assert.equal(result.ok, false);
		assert.equal(result.code, "AMBER_E_GATE_OUTCOME_SIZE_CEILING");
		assert.equal(
			fs.existsSync(outcomeLedgerPath(dir)),
			false,
			"the ledger is not created by a refused append",
		);
	} finally {
		delete process.env.AMBER_GATE_MAX_OUTCOME_BYTES;
	}
});

// ── The evidence join convention ──

test("a receipt joins only when its subject equals both the evidenceType and the effective subject", () => {
	const dir = mkTarget("join-convention");
	seedPrincipals(dir);
	recordReceipt(dir); // subject spec/login@2
	admitGate(dir, {
		require: [
			// The requirement's subject override redirects the join: this
			// requirement looks for evidenceType "spec/login@2" under subject
			// "spec/login@2" (both joins name the receipt subject).
			{ evidenceType: "spec/login@2", subject: "spec/login@2" },
		],
	});
	const pass = evaluate(dir);
	assert.equal(pass.outcome.verdict, "pass");

	// A requirement whose evidenceType differs from its effective subject
	// can match no receipt: both joins are equalities on the receipt's
	// single subject field, so it fails closed with empty candidates.
	const dir2 = mkTarget("join-convention-mismatch");
	seedPrincipals(dir2);
	recordReceipt(dir2);
	admitGate(dir2, {
		require: [{ evidenceType: "eval/login-e2e", subject: "spec/login@2" }],
	});
	const mismatch = evaluate(dir2);
	assert.equal(mismatch.outcome.verdict, "fail");
	const detail = mismatch.outcome.details.requirements[0];
	assert.equal(detail.evidenceId, null);
	assert.equal(detail.evidenceType, "eval/login-e2e");
	assert.equal(detail.subject, "spec/login@2");
});
