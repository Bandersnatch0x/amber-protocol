"use strict";

// issues/0192 — a REVIEW VERDICT receipt must be produced independently of
// the submitter and independently verified before its finding count can gate.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { trackTempDir } = require("../helpers/harness");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { recordEvidence, verifyEvidence } = require("../../scripts/lib/core/evidence-receipts");
const { grantApproval, consumeApproval } = require("../../scripts/lib/core/approval-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { evaluateGate } = require("../../scripts/lib/core/gate-evaluation");
const { evaluatePolicy } = require("../../scripts/lib/core/policy-evaluation");

const SUBJECT = "spec/review-verdict@1";
const NOW = new Date("2026-10-24T00:00:00.000Z");
const REVIEW_VERDICT_EXAMPLE = require("../fixtures/evidence/review-verdict.example.json");

function mkTarget(label) {
	return trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), `amber-review-gate-${label}-`)));
}

function seedPrincipals(dir) {
	for (const principal of [
		{ id: "dev@example.com", principalKind: "human", role: "submitter" },
		{ id: "reviewer@example.com", principalKind: "human", role: "reviewer" },
		{ id: "lead@example.com", principalKind: "human", role: "verifier" },
		{ id: "alice@example.com", principalKind: "human", role: "approver" },
	]) {
		const result = registerPrincipal(dir, principal);
		assert.equal(result.ok, true, (result.errors || []).join("; "));
	}
}

function recordReviewVerdict(dir, overrides = {}) {
	// `verify` is destructured to strip it from receiptOverrides; the verify
	// decision itself is read back from `overrides.verify` below.
	const { verify: _verify, producer, ...receiptOverrides } = overrides;
	const recorded = recordEvidence(
		dir,
		{
			...REVIEW_VERDICT_EXAMPLE,
			...(producer ? { producer } : {}),
			...receiptOverrides,
			verifiedBy: undefined,
			effectiveAssurance: undefined,
		},
		{},
	);
	assert.equal(recorded.ok, true, (recorded.errors || []).join("; "));
	if (overrides.verify !== false) {
		const verified = verifyEvidence(
			dir,
			{
				id: REVIEW_VERDICT_EXAMPLE.id,
				verifier: REVIEW_VERDICT_EXAMPLE.verifiedBy[0],
			},
			{},
		);
		assert.equal(verified.ok, true, (verified.errors || []).join("; "));
	}
	return recorded.receipt;
}

function createGateOutcome(dir, gateIdentity = "gate/review-verdict") {
	const admitted = admitArtifact(dir, {
		type: "gate",
		identity: gateIdentity,
		body: "# Gate: review verdict readiness",
		extensions: {
			gate: {
				require: [
					{
						evidenceType: SUBJECT,
						subject: SUBJECT,
						assurance: "verified",
						threshold: { value: 0, comparator: "eq" },
					},
				],
			},
		},
	});
	assert.equal(admitted.ok, true, (admitted.errors || []).join("; "));
	const gate = evaluateGate(dir, { gate: gateIdentity, subject: SUBJECT, now: NOW }, {});
	assert.equal(gate.ok, true, (gate.errors || []).join("; "));
	return gate.outcome;
}

function consumeApprovalFixture(dir, id = "approval/review-42") {
	const intent = admitArtifact(dir, {
		type: "intent",
		identity: "intent/review",
		body: "# Intent: review",
	});
	assert.equal(intent.ok, true, (intent.errors || []).join("; "));
	const granted = grantApproval(
		dir,
		{ id, approver: "alice@example.com", subject: SUBJECT, validUntil: "2027-01-01T00:00:00.000Z" },
		{ now: new Date("2026-10-01T00:00:00.000Z") },
	);
	assert.equal(granted.ok, true, (granted.errors || []).join("; "));
	const consumed = consumeApproval(
		dir,
		{
			id,
			decisionIdentity: "decision/review",
			body: "# Decision: approved",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/review", revision: 1 } }],
		},
		{ now: NOW },
	);
	assert.equal(consumed.ok, true, (consumed.errors || []).join("; "));
	return consumed.approval;
}

function admitMinimalPolicies(dir) {
	for (const [layer, identity] of [
		["org", "policy/org"],
		["tenant", "policy/tenant"],
	]) {
		const extensions = { policy: { policyVersion: 1, layer } };
		for (const transition of [null, "activate"]) {
			const admitted = admitArtifact(dir, {
				type: "policy",
				identity,
				body: `# Policy: ${layer}`,
				extensions,
				...(transition ? { expectedHead: 1, transition } : {}),
			});
			assert.equal(admitted.ok, true, (admitted.errors || []).join("; "));
		}
	}
}

function evaluateStrict(dir, submitter) {
	return evaluatePolicy(
		dir,
		{
			subject: SUBJECT,
			submitter,
			capability: "release",
			approval: "approval/review-42",
			gateOutcomeIndex: 0,
			now: NOW,
			policies: { org: "policy/org", tenant: "policy/tenant" },
		},
		{},
	);
}

test("gate passes when the verdict says 0, the producer is independent, and a verifier exists", () => {
	const dir = mkTarget("pass");
	seedPrincipals(dir);
	recordReviewVerdict(dir);
	createGateOutcome(dir);
	consumeApprovalFixture(dir);
	admitMinimalPolicies(dir);

	const result = evaluateStrict(dir, "dev@example.com");
	assert.equal(result.ok, true, result.errors ? result.errors.join("; ") : result.message);
	assert.equal(result.outcome.verdict, "pass");
});

test("strict consumption refuses when the verdict producer is the submitter", () => {
	const dir = mkTarget("self-produced");
	seedPrincipals(dir);
	recordReviewVerdict(dir, { producer: "dev@example.com" });
	createGateOutcome(dir);
	consumeApprovalFixture(dir);
	admitMinimalPolicies(dir);

	const result = evaluateStrict(dir, "dev@example.com");
	assert.equal(result.ok, false);
	assert.equal(result.code, "AMBER_E_POLICY_SEPARATION_OF_DUTIES");
	assert.ok(result.outcome.reasons.some((reason) => reason.includes("evidence producer")));
});

test("a verdict without verifiedBy does not satisfy the assurance floor", () => {
	const dir = mkTarget("unverified");
	seedPrincipals(dir);
	recordReviewVerdict(dir, { verify: false });
	const gateOutcome = createGateOutcome(dir);
	consumeApprovalFixture(dir);
	admitMinimalPolicies(dir);

	// Fail closed at the requirement seam: the receipt exists but its effective
	// assurance stays below the verified floor, so the gate never passes.
	assert.equal(gateOutcome.verdict, "fail");
	assert.equal(gateOutcome.details.requirements[0].effectiveAssurance, "replayable");

	const result = evaluateStrict(dir, "dev@example.com");
	assert.equal(result.ok, false);
	assert.equal(result.code, "AMBER_E_POLICY_DENIED");
});

test("a verdict saying 1 fails the gate", () => {
	const dir = mkTarget("critical-1");
	seedPrincipals(dir);
	recordReviewVerdict(dir, { outputs: ["review/findings", "1"] });
	createGateOutcome(dir);
	consumeApprovalFixture(dir);
	admitMinimalPolicies(dir);

	const gate = evaluateGate(dir, { gate: "gate/review-verdict", subject: SUBJECT, now: NOW }, {});
	assert.equal(gate.outcome.verdict, "fail");
	assert.equal(gate.outcome.details.requirements[0].threshold.actual, 1);
});
