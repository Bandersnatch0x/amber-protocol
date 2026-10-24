"use strict";

// issues/0193 - a folded process-denial count rides the existing evidence
// receipt + gate threshold seam; producer independence is inherited from 0192.

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

const SUBJECT = "spec/process-compliance@1";
const NOW = new Date("2026-10-24T00:00:00.000Z");
const RECEIPT = require("../fixtures/evidence/process-denials.example.json");

function mkTarget(label) {
	return trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), `amber-denial-gate-${label}-`)));
}

function seedPrincipals(dir) {
	for (const principal of [
		{ id: "dev@example.com", principalKind: "human", role: "submitter" },
		{ id: "ci@example.com", principalKind: "service", principalKindIsFallback: true },
		{ id: "lead@example.com", principalKind: "human", role: "verifier" },
		{ id: "alice@example.com", principalKind: "human", role: "approver" },
	]) {
		const result = registerPrincipal(dir, principal);
		assert.equal(result.ok, true, (result.errors || []).join("; "));
	}
}

function recordDenialReceipt(dir, overrides = {}) {
	const { verify, producer, ...receiptOverrides } = overrides;
	const recorded = recordEvidence(
		dir,
		{
			...RECEIPT,
			...(producer ? { producer } : {}),
			...receiptOverrides,
			verifiedBy: undefined,
			effectiveAssurance: undefined,
		},
		{},
	);
	assert.equal(recorded.ok, true, (recorded.errors || []).join("; "));
	if (verify !== false) {
		const verified = verifyEvidence(dir, { id: RECEIPT.id, verifier: RECEIPT.verifiedBy[0] }, {});
		assert.equal(verified.ok, true, (verified.errors || []).join("; "));
	}
	return recorded.receipt;
}

function evaluateDenialGate(dir, gateIdentity = "gate/process-denials") {
	const admitted = admitArtifact(dir, {
		type: "gate",
		identity: gateIdentity,
		body: "# Gate: process-denial budget",
		extensions: {
			gate: {
				require: [
					{
						evidenceType: SUBJECT,
						subject: SUBJECT,
						assurance: "verified",
						threshold: { value: 3, comparator: "lt" },
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

function consumeApprovalFixture(dir, id = "approval/denial-42") {
	const intent = admitArtifact(dir, {
		type: "intent",
		identity: "intent/denial-gate",
		body: "# Intent: denial gate",
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
			decisionIdentity: "decision/denial-gate",
			body: "# Decision: approved",
			traces: [
				{ type: "decides", to: { type: "intent", identity: "intent/denial-gate", revision: 1 } },
			],
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
			approval: "approval/denial-42",
			gateOutcomeIndex: 0,
			now: NOW,
			policies: { org: "policy/org", tenant: "policy/tenant" },
		},
		{},
	);
}

test("a denial count of 2 passes the lt-3 gate and strict consumption", () => {
	const dir = mkTarget("pass");
	seedPrincipals(dir);
	recordDenialReceipt(dir);
	evaluateDenialGate(dir);
	consumeApprovalFixture(dir);
	admitMinimalPolicies(dir);

	const result = evaluateStrict(dir, "dev@example.com");
	assert.equal(result.ok, true, result.errors ? result.errors.join("; ") : result.message);
	assert.equal(result.outcome.verdict, "pass");
});

test("a denial count of 3 fails the lt-3 gate", () => {
	const dir = mkTarget("fail-3");
	seedPrincipals(dir);
	recordDenialReceipt(dir, { outputs: ["denials/window", "3"] });

	const outcome = evaluateDenialGate(dir);
	assert.equal(outcome.verdict, "fail");
	assert.equal(outcome.details.requirements[0].threshold.actual, 3);
});

test("strict consumption refuses when the denial producer is the submitter", () => {
	const dir = mkTarget("self-produced");
	seedPrincipals(dir);
	recordDenialReceipt(dir, { producer: "dev@example.com" });
	evaluateDenialGate(dir);
	consumeApprovalFixture(dir);
	admitMinimalPolicies(dir);

	const result = evaluateStrict(dir, "dev@example.com");
	assert.equal(result.ok, false);
	assert.equal(result.code, "AMBER_E_POLICY_SEPARATION_OF_DUTIES");
	assert.ok(result.outcome.reasons.some((reason) => reason.includes("evidence producer")));
});

test("a gate without any denial receipt fails closed as unsatisfied", () => {
	const dir = mkTarget("no-receipt");
	seedPrincipals(dir);

	const outcome = evaluateDenialGate(dir);
	assert.equal(outcome.verdict, "fail");
	const requirement = outcome.details.requirements[0];
	assert.equal(requirement.satisfied, false);
	assert.equal(requirement.receipt, undefined);
});
