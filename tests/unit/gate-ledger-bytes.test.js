"use strict";

// F061 follow-up (#312) - gate outcome ledger BYTE equivalence.
//
// The migration contract (ADR-0028 decision 2; F061 Testing Decisions) is
// byte compatibility: the ritual assembled by `defineLedgerFamily` must
// write the exact bytes the hand-written outcome ritual wrote. This test
// records one deterministic pass/fail evaluation lifecycle against the
// PRE-migration implementation, then compares the migrated ledger with its
// checked-in golden.
//
// The golden was recorded twice against the hand-written implementation with
// the same inputs and clocks. The committed hash makes accidental fixture
// rewrites fail closed.

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { evaluateGate } = require("../../scripts/lib/core/gate-evaluation");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { recordEvidence } = require("../../scripts/lib/core/evidence-receipts");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { mkLedgerTarget, readEvents } = require("../helpers/harness");

const mkTarget = mkLedgerTarget("amber-gate-bytes");
const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "gate");
const GOLDEN = path.join(FIXTURES_DIR, "outcomes-lifecycle.golden.jsonl");
const GOLDEN_SHA256 = "56cedddc41bee0103d9c7e189c5a7a8041cfcf0b5147a09f7a9159938abe36c4";

const NOW = new Date("2026-08-31T00:00:00.000Z");
const PASS_AT = new Date("2026-08-31T00:01:00.000Z");
const FAIL_AT = new Date("2026-08-31T00:02:00.000Z");

function outcomeLedgerPath(dir) {
	return path.join(dir, ".amber", "gates", "outcomes.jsonl");
}

function ok(result, label) {
	assert.equal(result.ok, true, `${label}: ${(result.errors || []).join("; ")}`);
}

function seedDependencies(dir) {
	for (const [id, principalKind] of [
		["alice@example.com", "human"],
		["ci-bot", "service"],
	]) {
		ok(registerPrincipal(dir, { id, principalKind }), `register ${id}`);
	}
	ok(
		recordEvidence(dir, {
			id: "evidence/gate-run",
			producer: "ci-bot",
			assurance: "observed",
			scope: "F061",
			subject: "spec/login@2",
			inputs: null,
			tools: null,
			environment: null,
			outputs: ["87"],
			status: "pass",
		}),
		"record evidence",
	);
	ok(
		admitArtifact(dir, {
			type: "gate",
			identity: "gate/login-gate",
			body: "# Gate: login readiness\n",
			extensions: {
				gate: {
					require: [
						{
							evidenceType: "spec/login@2",
							assurance: "observed",
							threshold: { value: 80, comparator: "ge" },
						},
					],
				},
			},
		}),
		"admit gate",
	);
}

function runLifecycle(dir) {
	mock.timers.enable({ apis: ["Date"], now: NOW.getTime() });
	try {
		seedDependencies(dir);
		const pass = evaluateGate(dir, {
			gate: "gate/login-gate",
			subject: "spec/login@2",
			now: PASS_AT,
		});
		ok(pass, "evaluate pass");
		assert.equal(pass.outcome.verdict, "pass");
		const fail = evaluateGate(dir, {
			gate: "gate/login-gate",
			subject: "spec/missing@1",
			now: FAIL_AT,
		});
		ok(fail, "evaluate fail");
		assert.equal(fail.outcome.verdict, "fail");
	} finally {
		mock.timers.reset();
	}
	return outcomeLedgerPath(dir);
}

test("the factory-assembled gate outcome ledger matches the pre-migration recording", () => {
	const ledger = runLifecycle(mkTarget("lifecycle"));
	assert.deepEqual(
		readEvents(ledger).map((event) => event.kind),
		["evaluated", "evaluated"],
	);
	const actual = fs.readFileSync(ledger);
	const golden = fs.readFileSync(GOLDEN);
	assert.equal(
		crypto.createHash("sha256").update(golden).digest("hex"),
		GOLDEN_SHA256,
		"the recorded pre-migration gate outcome golden changed unexpectedly",
	);
	assert.equal(
		actual.equals(golden),
		true,
		"the migrated gate outcome ritual wrote different bytes than the pre-migration recording in tests/fixtures/gate/outcomes-lifecycle.golden.jsonl",
	);
});

test("gate outcome append failures retain the historical refusal wording", () => {
	const dir = mkTarget("append-error");
	seedDependencies(dir);
	const originalAppendFileSync = fs.appendFileSync;
	fs.appendFileSync = () => {
		throw new Error("disk full");
	};
	try {
		const result = evaluateGate(dir, {
			gate: "gate/login-gate",
			subject: "spec/login@2",
			now: PASS_AT,
		});
		assert.equal(result.ok, false);
		assert.equal(result.code, "AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT");
		assert.match(
			result.errors[0],
			/^failed to append the outcome for gate "gate\/login-gate" to the gate outcome ledger: disk full$/,
		);
		assert.equal(fs.existsSync(outcomeLedgerPath(dir)), false);
	} finally {
		fs.appendFileSync = originalAppendFileSync;
	}
});
