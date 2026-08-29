"use strict";

// F053 T1 (#274) — release candidate preparation (unit seam).
//
// Tests assert externally visible behavior: the closed candidate contract
// (per-axis Review findings that are structurally Evidence references,
// never approvals), fail-closed resolution of every bound reference, the
// canonical releaseHash, one immutable candidate per releaseId, and
// tamper-evident ledger reads — every failure mode carries a stable
// AMBER_E_RELEASE_* code.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	RELEASE_CANDIDATE_SCHEMA_VERSION,
	SUPPORTED_RELEASE_CANDIDATE_SCHEMA_VERSIONS,
	DEFAULT_MAX_RELEASE_CANDIDATES_BYTES,
	REVIEW_AXES,
	candidatesPath,
	prepareReleaseCandidate,
	showReleaseCandidate,
	listReleaseCandidates,
	RELEASE_AUTHORIZATION_SCHEMA_VERSION,
	SUPPORTED_RELEASE_AUTHORIZATION_SCHEMA_VERSIONS,
	RELEASE_DECISION_KINDS,
	authorizationsPath,
	authorizeRelease,
	showReleaseAuthorization,
	listReleaseAuthorizations,
	RELEASE_TRANSACTION_SCHEMA_VERSION,
	SUPPORTED_RELEASE_TRANSACTION_SCHEMA_VERSIONS,
	RELEASE_TX_OPERATIONS,
	transactionsPath,
	deployRelease,
	rollbackRelease,
	listReleaseTransactions,
	RELEASE_STATUSES,
	releaseStatus,
	releaseReceipt,
} = require("../../scripts/lib/core/release-registry");
const { grantApproval } = require("../../scripts/lib/core/approval-registry");
const { grantBreakGlass, useBreakGlass } = require("../../scripts/lib/core/breakglass-registry");
const { evaluateGate } = require("../../scripts/lib/core/gate-evaluation");
const {
	registerRunner,
	registerRunnerCapability,
	submitRunnerRequest,
	authorizeRunnerRequest,
	prepareRunnerExecution,
	settleRunnerExecution,
} = require("../../scripts/lib/core/runner-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { recordEvidence } = require("../../scripts/lib/core/evidence-receipts");
const { writeJSONL } = require("../../scripts/lib/core/jsonl");

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-release-${label}-`));
}

const DIGEST = `sha256:${"a".repeat(64)}`;
const COMMIT = "b".repeat(40);
const NOW = new Date("2026-08-29T00:00:00.000Z");

const EVIDENCE_IDS = Object.freeze([
	"evidence/test-run",
	"evidence/review-logic",
	"evidence/review-security",
	"evidence/review-spec",
	"evidence/rollback-plan",
]);

/** Everything a full candidate binds: principals, decisions, one committed
 *  spec artifact, one committed policy artifact, Evidence receipts for the
 *  set + all three review axes + the rollback plan, and a registered
 *  runner capability. */
function releaseFixture(dir) {
	assert.equal(
		registerPrincipal(dir, { id: "alice@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.equal(
		registerPrincipal(dir, { id: "carol@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, { type: "intent", identity: "intent/release", body: "# R\n" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, { type: "policy", identity: "policy/release", body: "# Policy\n" }).ok,
		true,
	);
	for (const identity of ["decision/runner-1", "decision/cap-1"]) {
		const decision = admitArtifact(dir, {
			type: "decision",
			identity,
			body: `# ${identity}\n`,
			decisionKind: "approval",
			principal: "alice@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/release" } }],
		});
		assert.equal(decision.ok, true, (decision.errors || []).join("; "));
	}
	for (const id of EVIDENCE_IDS) {
		const recorded = recordEvidence(dir, {
			id,
			producer: "carol@example.com",
			assurance: "observed",
			scope: "F053",
			subject: `release fixture ${id}`,
			inputs: null,
			tools: null,
			environment: null,
			outputs: null,
			status: "pass",
		});
		assert.equal(recorded.ok, true, (recorded.errors || []).join("; "));
	}
	assert.equal(
		registerRunner(dir, {
			id: "runner/ci",
			version: "1.0.0",
			integrityDigest: DIGEST,
			owner: "platform-team",
			decision: { identity: "decision/runner-1", revision: 1 },
		}).ok,
		true,
	);
	assert.equal(
		registerRunnerCapability(dir, {
			runnerId: "runner/ci",
			runnerVersion: "1.0.0",
			name: "deploy.staging-web",
			capabilityVersion: "1",
			effects: ["deploy"],
			pathPrefixes: ["deploy/staging"],
			timeoutMsMax: 600_000,
			credentialRequirement: "scoped",
			rollback: "runbook/staging-rollback",
			decision: { identity: "decision/cap-1", revision: 1 },
		}).ok,
		true,
	);
}

function candidateInput(overrides = {}) {
	return {
		releaseId: "release/web-42",
		change: {
			commit: COMMIT,
			artifacts: [{ type: "intent", identity: "intent/release", revision: 1 }],
		},
		evidence: ["evidence/test-run"],
		review: {
			logic: "evidence/review-logic",
			security: "evidence/review-security",
			specCompliance: "evidence/review-spec",
		},
		environment: "staging",
		policy: { identity: "policy/release", revision: 1 },
		capability: {
			runnerId: "runner/ci",
			runnerVersion: "1.0.0",
			name: "deploy.staging-web",
			capabilityVersion: "1",
		},
		credentialsClass: "scoped",
		rollbackPlan: "evidence/rollback-plan",
		...overrides,
	};
}

test("release constants pin the review axes and the schema contract", () => {
	assert.equal(RELEASE_CANDIDATE_SCHEMA_VERSION, 1);
	assert.deepEqual(SUPPORTED_RELEASE_CANDIDATE_SCHEMA_VERSIONS, [1]);
	assert.equal(DEFAULT_MAX_RELEASE_CANDIDATES_BYTES, 1024 * 1024);
	assert.deepEqual(REVIEW_AXES, ["logic", "security", "specCompliance"]);
});

test("preparation binds one exact change and refuses unresolved references", () => {
	const dir = mkTarget("prepare");
	releaseFixture(dir);

	const badCommit = prepareReleaseCandidate(
		dir,
		candidateInput({
			change: {
				commit: "abc",
				artifacts: [{ type: "intent", identity: "intent/release", revision: 1 }],
			},
		}),
	);
	assert.equal(badCommit.code, "AMBER_E_RELEASE_INVALID");
	assert.match(badCommit.errors[0], /40-hex git commit/);

	const ghostArtifact = prepareReleaseCandidate(
		dir,
		candidateInput({
			change: {
				commit: COMMIT,
				artifacts: [{ type: "intent", identity: "intent/ghost", revision: 1 }],
			},
		}),
	);
	assert.equal(ghostArtifact.code, "AMBER_E_RELEASE_INVALID");
	assert.match(ghostArtifact.errors[0], /not a committed artifact revision/);

	const ghostPolicy = prepareReleaseCandidate(
		dir,
		candidateInput({ policy: { identity: "policy/ghost", revision: 1 } }),
	);
	assert.equal(ghostPolicy.code, "AMBER_E_RELEASE_INVALID");
	assert.match(ghostPolicy.errors[0], /not a committed artifact revision/);

	const ghostEvidence = prepareReleaseCandidate(
		dir,
		candidateInput({ evidence: ["evidence/ghost"] }),
	);
	assert.equal(ghostEvidence.code, "AMBER_E_RELEASE_INVALID");
	assert.match(ghostEvidence.errors[0], /names no recorded Evidence receipt/);

	const ghostReview = prepareReleaseCandidate(
		dir,
		candidateInput({
			review: {
				logic: "evidence/ghost",
				security: "evidence/review-security",
				specCompliance: "evidence/review-spec",
			},
		}),
	);
	assert.equal(ghostReview.code, "AMBER_E_RELEASE_INVALID");
	assert.match(ghostReview.errors[0], /review\.logic/);

	const ghostCapability = prepareReleaseCandidate(
		dir,
		candidateInput({
			capability: {
				runnerId: "runner/ci",
				runnerVersion: "1.0.0",
				name: "deploy.ghost",
				capabilityVersion: "1",
			},
		}),
	);
	assert.equal(ghostCapability.code, "AMBER_E_RUNNER_CAPABILITY_NOT_FOUND");

	const prepared = prepareReleaseCandidate(dir, candidateInput(), { now: NOW });
	assert.equal(prepared.ok, true, (prepared.errors || []).join("; "));
	assert.equal(prepared.record.releaseId, "release/web-42");
	assert.match(prepared.record.releaseHash, /^sha256:[0-9a-f]{64}$/);
	assert.equal(prepared.record.change.commit, COMMIT);
	assert.equal(prepared.record.environment, "staging");

	const duplicate = prepareReleaseCandidate(dir, candidateInput(), { now: NOW });
	assert.equal(duplicate.code, "AMBER_E_RELEASE_EXISTS");

	assert.equal(
		showReleaseCandidate(dir, "release/web-42").releaseHash,
		prepared.record.releaseHash,
	);
	assert.equal(showReleaseCandidate(dir, "release/ghost"), null);
	assert.equal(listReleaseCandidates(dir, { environment: "staging" }).length, 1);
	assert.equal(listReleaseCandidates(dir, { environment: "production" }).length, 0);
});

test("review findings are structurally evidence references, never approvals", () => {
	const dir = mkTarget("review-axes");
	releaseFixture(dir);

	const smuggled = prepareReleaseCandidate(
		dir,
		candidateInput({
			review: {
				logic: "evidence/review-logic",
				security: "evidence/review-security",
				specCompliance: "evidence/review-spec",
				approval: "approval/self",
			},
		}),
	);
	assert.equal(smuggled.code, "AMBER_E_RELEASE_INVALID");
	assert.match(smuggled.errors[0], /unknown field/);
	assert.match(smuggled.errors[0], /"approval"/);

	const topLevel = prepareReleaseCandidate(dir, candidateInput({ approval: "approval/self" }));
	assert.equal(topLevel.code, "AMBER_E_RELEASE_INVALID");
	assert.match(topLevel.errors[0], /unknown field/);

	const missingAxis = prepareReleaseCandidate(
		dir,
		candidateInput({
			review: { logic: "evidence/review-logic", security: "evidence/review-security" },
		}),
	);
	assert.equal(missingAxis.code, "AMBER_E_RELEASE_INVALID");
	assert.match(missingAxis.errors[0], /missing field/);
});

test("tampered candidate ledger fails every read closed", () => {
	const dir = mkTarget("tamper");
	releaseFixture(dir);
	assert.equal(prepareReleaseCandidate(dir, candidateInput(), { now: NOW }).ok, true);
	const event = JSON.parse(fs.readFileSync(candidatesPath(dir), "utf8"));
	event.change.commit = "c".repeat(40);
	writeJSONL(candidatesPath(dir), [event]);
	assert.throws(
		() => listReleaseCandidates(dir),
		(err) => err.amberCode === "AMBER_E_RELEASE_CORRUPT",
	);
});

// ── F053 T2 (#275): staging & production release authorization ──

/** Grant one approval whose subject is the release binding; asserts ok. */
function approvalFixture(dir, id, subject, approver = "bob@example.com") {
	const granted = grantApproval(
		dir,
		{ id, approver, scope: null, subject, validUntil: "2027-01-01T00:00:00.000Z" },
		{ now: NOW },
	);
	assert.equal(granted.ok, true, (granted.errors || []).join("; "));
}

/** A prepared staging candidate plus bob (approver) and a rehearsal
 *  receipt produced by carol; returns the candidate record. */
function stagingFixture(dir) {
	releaseFixture(dir);
	assert.equal(registerPrincipal(dir, { id: "bob@example.com", principalKind: "human" }).ok, true);
	const recorded = recordEvidence(dir, {
		id: "evidence/rehearsal-run",
		producer: "carol@example.com",
		assurance: "observed",
		scope: "F053",
		subject: "staging rollback rehearsal run",
		inputs: null,
		tools: null,
		environment: null,
		outputs: null,
		status: "pass",
	});
	assert.equal(recorded.ok, true, (recorded.errors || []).join("; "));
	const prepared = prepareReleaseCandidate(dir, candidateInput(), { now: NOW });
	assert.equal(prepared.ok, true, (prepared.errors || []).join("; "));
	return prepared.record;
}

function stagingAuthorizeInput(overrides = {}) {
	return {
		releaseId: "release/web-42",
		approval: "approval/rel-1",
		decisionIdentity: "decision/rel-1",
		body: "# Authorize release\n",
		traces: [{ type: "decides", to: { type: "intent", identity: "intent/release" } }],
		scope: null,
		rehearsal: "evidence/rehearsal-run",
		...overrides,
	};
}

test("authorization constants pin the decision kinds and schema contract", () => {
	assert.equal(RELEASE_AUTHORIZATION_SCHEMA_VERSION, 1);
	assert.deepEqual(SUPPORTED_RELEASE_AUTHORIZATION_SCHEMA_VERSIONS, [1]);
	assert.deepEqual(RELEASE_DECISION_KINDS, ["acceptance", "approval"]);
});

test("staging authorization consumes one named approval with independent rehearsal", () => {
	const dir = mkTarget("auth-staging");
	const candidate = stagingFixture(dir);

	const ghost = authorizeRelease(dir, stagingAuthorizeInput({ releaseId: "release/ghost" }));
	assert.equal(ghost.code, "AMBER_E_RELEASE_NOT_FOUND");

	const noApproval = authorizeRelease(dir, stagingAuthorizeInput(), { now: NOW });
	assert.equal(noApproval.code, "AMBER_E_RELEASE_APPROVAL_MISMATCH");

	approvalFixture(dir, "approval/other", "spec/login@2");
	const mismatch = authorizeRelease(dir, stagingAuthorizeInput({ approval: "approval/other" }), {
		now: NOW,
	});
	assert.equal(mismatch.code, "AMBER_E_RELEASE_APPROVAL_MISMATCH");
	assert.match(mismatch.errors[0], /one authorization binds one release and environment/);

	approvalFixture(
		dir,
		"approval/self",
		`release:staging:${candidate.releaseHash}`,
		"carol@example.com",
	);
	const vouched = authorizeRelease(dir, stagingAuthorizeInput({ approval: "approval/self" }), {
		now: NOW,
	});
	assert.equal(vouched.code, "AMBER_E_RELEASE_SEPARATION");
	assert.match(vouched.errors[0], /cannot approve its own rehearsal/);

	approvalFixture(dir, "approval/rel-1", `release:staging:${candidate.releaseHash}`);
	const authorized = authorizeRelease(dir, stagingAuthorizeInput(), { now: NOW });
	assert.equal(authorized.ok, true, (authorized.errors || []).join("; "));
	assert.equal(authorized.record.environment, "staging");
	assert.equal(authorized.record.approvalId, "approval/rel-1");
	assert.equal(authorized.record.decision.revision, authorized.consumption.receipt.revision);
	assert.equal(authorized.record.branchProtection, null);

	const replay = authorizeRelease(
		dir,
		stagingAuthorizeInput({ decisionIdentity: "decision/rel-2" }),
		{ now: NOW },
	);
	assert.equal(replay.code, "AMBER_E_RELEASE_EXISTS");
	assert.equal(showReleaseAuthorization(dir, "release/web-42").releaseId, "release/web-42");
	assert.equal(listReleaseAuthorizations(dir, { environment: "staging" }).length, 1);

	// A second authorization exercises the fold's chain advance: two
	// chained events must both verify on read.
	const second = prepareReleaseCandidate(dir, candidateInput({ releaseId: "release/web-44" }), {
		now: NOW,
	});
	assert.equal(second.ok, true, (second.errors || []).join("; "));
	approvalFixture(dir, "approval/rel-2", `release:staging:${second.record.releaseHash}`);
	const chained = authorizeRelease(
		dir,
		stagingAuthorizeInput({
			releaseId: "release/web-44",
			approval: "approval/rel-2",
			decisionIdentity: "decision/rel-3",
		}),
		{ now: NOW },
	);
	assert.equal(chained.ok, true, (chained.errors || []).join("; "));
	assert.equal(listReleaseAuthorizations(dir, { environment: "staging" }).length, 2);
});

test("a newer release policy revision invalidates the stale candidate", () => {
	const dir = mkTarget("auth-drift");
	const candidate = stagingFixture(dir);
	const supersede = admitArtifact(dir, {
		type: "policy",
		identity: "policy/release",
		body: "# Policy v2\n",
		supersedes: 1,
	});
	assert.equal(supersede.ok, true, (supersede.errors || []).join("; "));
	approvalFixture(dir, "approval/rel-1", `release:staging:${candidate.releaseHash}`);
	const drifted = authorizeRelease(dir, stagingAuthorizeInput(), { now: NOW });
	assert.equal(drifted.ok, false);
	assert.equal(drifted.code, "AMBER_E_RELEASE_DRIFT");
	assert.match(drifted.errors[0], /newer revision/);
});

test("production authorization binds two humans, gates, and a runbook capability", () => {
	const dir = mkTarget("auth-production");
	releaseFixture(dir);
	assert.equal(registerPrincipal(dir, { id: "dave@example.com", principalKind: "human" }).ok, true);
	assert.equal(registerPrincipal(dir, { id: "erin@example.com", principalKind: "human" }).ok, true);
	// Runbook capability for production.
	const capDecision = admitArtifact(dir, {
		type: "decision",
		identity: "decision/cap-runbook",
		body: "# runbook cap\n",
		decisionKind: "approval",
		principal: "alice@example.com",
		traces: [{ type: "decides", to: { type: "intent", identity: "intent/release" } }],
	});
	assert.equal(capDecision.ok, true, (capDecision.errors || []).join("; "));
	assert.equal(
		registerRunnerCapability(dir, {
			runnerId: "runner/ci",
			runnerVersion: "1.0.0",
			name: "runbook.restart-web",
			capabilityVersion: "1",
			effects: ["deploy"],
			pathPrefixes: ["deploy/staging"],
			timeoutMsMax: 600_000,
			credentialRequirement: "scoped",
			rollback: "runbook/staging-rollback",
			decision: { identity: "decision/cap-runbook", revision: 1 },
		}).ok,
		true,
	);
	// Branch protection evidence + two human decisions from non-producers.
	const branch = recordEvidence(dir, {
		id: "evidence/branch-protection",
		producer: "carol@example.com",
		assurance: "observed",
		scope: "F053",
		subject: "branch protection audit",
		inputs: null,
		tools: null,
		environment: null,
		outputs: null,
		status: "pass",
	});
	assert.equal(branch.ok, true, (branch.errors || []).join("; "));
	for (const [identity, principal] of [
		["decision/code-owner", "dave@example.com"],
		["decision/release-manager", "erin@example.com"],
		["decision/by-producer", "carol@example.com"],
	]) {
		const decision = admitArtifact(dir, {
			type: "decision",
			identity,
			body: `# ${identity}\n`,
			decisionKind: "approval",
			principal,
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/release" } }],
		});
		assert.equal(decision.ok, true, (decision.errors || []).join("; "));
	}
	// Two passing gate outcomes.
	const gateEvidence = recordEvidence(dir, {
		id: "evidence/gate-run",
		producer: "carol@example.com",
		assurance: "observed",
		scope: null,
		subject: "release/web-42",
		inputs: null,
		tools: null,
		environment: null,
		outputs: ["ok"],
		status: "pass",
	});
	assert.equal(gateEvidence.ok, true, (gateEvidence.errors || []).join("; "));
	const gate = admitArtifact(dir, {
		type: "gate",
		identity: "gate/release",
		body: "# Gate\n",
		extensions: {
			gate: { require: [{ evidenceType: "release/web-42", assurance: "observed" }] },
		},
	});
	assert.equal(gate.ok, true, (gate.errors || []).join("; "));
	for (let i = 0; i < 2; i += 1) {
		const outcome = evaluateGate(
			dir,
			{ gate: "gate/release", subject: "release/web-42" },
			{ now: new Date("2026-08-29T01:00:00.000Z") },
		);
		assert.equal(outcome.ok, true, (outcome.errors || []).join("; "));
		assert.equal(outcome.outcome.verdict, "pass");
	}
	const prepared = prepareReleaseCandidate(
		dir,
		candidateInput({
			environment: "production",
			capability: {
				runnerId: "runner/ci",
				runnerVersion: "1.0.0",
				name: "runbook.restart-web",
				capabilityVersion: "1",
			},
		}),
		{ now: NOW },
	);
	assert.equal(prepared.ok, true, (prepared.errors || []).join("; "));

	const productionInput = {
		releaseId: "release/web-42",
		branchProtection: "evidence/branch-protection",
		codeOwner: { identity: "decision/code-owner", revision: 1 },
		releaseManager: { identity: "decision/release-manager", revision: 1 },
		releaseGateIndex: 0,
		environmentGateIndex: 1,
	};

	const sameHuman = authorizeRelease(dir, {
		...productionInput,
		releaseManager: { identity: "decision/code-owner", revision: 1 },
	});
	assert.equal(sameHuman.code, "AMBER_E_RELEASE_SEPARATION");
	assert.match(sameHuman.errors[0], /distinct humans/);

	const producerSlot = authorizeRelease(dir, {
		...productionInput,
		codeOwner: { identity: "decision/by-producer", revision: 1 },
	});
	assert.equal(producerSlot.code, "AMBER_E_RELEASE_SEPARATION");
	assert.match(producerSlot.errors[0], /produced Evidence this release binds/);

	const ghostGate = authorizeRelease(dir, { ...productionInput, releaseGateIndex: 9 });
	assert.equal(ghostGate.code, "AMBER_E_RELEASE_GATE");

	const sameGate = authorizeRelease(dir, { ...productionInput, environmentGateIndex: 0 });
	assert.equal(sameGate.code, "AMBER_E_RELEASE_GATE");
	assert.match(sameGate.errors[0], /separate controls/);

	// A fail verdict is a recorded outcome, not a command error (F050);
	// index 2 records a foreign subject, refused on the subject binding.
	const foreignGate = evaluateGate(
		dir,
		{ gate: "gate/release", subject: "release/other" },
		{ now: new Date("2026-08-29T01:00:00.000Z") },
	);
	assert.equal(foreignGate.ok, true, (foreignGate.errors || []).join("; "));
	const wrongSubject = authorizeRelease(dir, { ...productionInput, environmentGateIndex: 2 });
	assert.equal(wrongSubject.code, "AMBER_E_RELEASE_GATE");
	assert.match(wrongSubject.errors[0], /own subject/);

	const authorized = authorizeRelease(dir, productionInput);
	assert.equal(authorized.ok, true, (authorized.errors || []).join("; "));
	assert.equal(authorized.record.environment, "production");
	assert.equal(authorized.record.codeOwner.principal, "dave@example.com");
	assert.equal(authorized.record.releaseManager.principal, "erin@example.com");
	assert.equal(authorized.record.approvalId, null);

	// An authorization Decision is single-use across the ledger: the spent
	// code-owner Decision cannot authorize a second release.
	const second = prepareReleaseCandidate(
		dir,
		candidateInput({
			releaseId: "release/web-43",
			environment: "production",
			evidence: ["evidence/test-run", "evidence/gate-run"],
			capability: {
				runnerId: "runner/ci",
				runnerVersion: "1.0.0",
				name: "runbook.restart-web",
				capabilityVersion: "1",
			},
		}),
		{ now: NOW },
	);
	assert.equal(second.ok, true, (second.errors || []).join("; "));
	const gateEvidence43 = recordEvidence(dir, {
		id: "evidence/gate-run-43",
		producer: "carol@example.com",
		assurance: "observed",
		scope: null,
		subject: "release/web-43",
		inputs: null,
		tools: null,
		environment: null,
		outputs: ["ok"],
		status: "pass",
	});
	assert.equal(gateEvidence43.ok, true, (gateEvidence43.errors || []).join("; "));
	const gate43 = admitArtifact(dir, {
		type: "gate",
		identity: "gate/release-43",
		body: "# Gate 43\n",
		extensions: {
			gate: { require: [{ evidenceType: "release/web-43", assurance: "observed" }] },
		},
	});
	assert.equal(gate43.ok, true, (gate43.errors || []).join("; "));
	for (let i = 0; i < 2; i += 1) {
		const replayGate = evaluateGate(
			dir,
			{ gate: "gate/release-43", subject: "release/web-43" },
			{ now: new Date("2026-08-29T02:00:00.000Z") },
		);
		assert.equal(replayGate.ok, true, (replayGate.errors || []).join("; "));
		assert.equal(replayGate.outcome.verdict, "pass");
	}
	const spent = authorizeRelease(dir, {
		...productionInput,
		releaseId: "release/web-43",
		releaseGateIndex: 3,
		environmentGateIndex: 4,
	});
	assert.equal(spent.ok, false);
	assert.equal(spent.code, "AMBER_E_RELEASE_INVALID", (spent.errors || []).join("; "));
	assert.match(spent.errors[0], /single-use/);
});

test("tampered authorization ledger fails every read closed", () => {
	const dir = mkTarget("auth-tamper");
	const candidate = stagingFixture(dir);
	approvalFixture(dir, "approval/rel-1", `release:staging:${candidate.releaseHash}`);
	assert.equal(authorizeRelease(dir, stagingAuthorizeInput(), { now: NOW }).ok, true);
	const event = JSON.parse(fs.readFileSync(authorizationsPath(dir), "utf8"));
	event.approvalId = "approval/edited";
	writeJSONL(authorizationsPath(dir), [event]);
	assert.throws(
		() => listReleaseAuthorizations(dir),
		(err) => err.amberCode === "AMBER_E_RELEASE_AUTH_CORRUPT",
	);
});

// ── F053 T3 (#276): deployment & rollback execution binding ──

const CREDENTIAL_HANDLE = Object.freeze({
	handle: "cred-9b2c",
	purpose: "staging-deploy",
	scope: "deploy/staging",
	expiresAt: "2026-08-29T12:00:00.000Z",
});

/** Submit + authorize one F052 request matching the fixture candidate;
 *  returns its requestHash. inputHashes vary per call so every request
 *  derives a distinct hash. */
function authorizedRequestFixture(dir, salt, overrides = {}) {
	const submitted = submitRunnerRequest(
		dir,
		{
			capability: {
				runnerId: "runner/ci",
				runnerVersion: "1.0.0",
				name: "deploy.staging-web",
				capabilityVersion: "1",
			},
			target: { repository: "repo/main", paths: ["deploy/staging/web"] },
			scope: null,
			environment: "staging",
			inputHashes: [`sha256:${salt.repeat(64).slice(0, 64)}`],
			timeoutMs: 300_000,
			effects: ["deploy"],
			credentialRequirement: "scoped",
			credential: { ...CREDENTIAL_HANDLE },
			rehearsal: "evidence/rehearsal-run",
			rollback: "runbook/staging-rollback",
			...overrides,
		},
		{ now: NOW },
	);
	assert.equal(submitted.ok, true, (submitted.errors || []).join("; "));
	const hash = submitted.record.requestHash;
	approvalFixture(dir, `approval/req-${salt}`, submitted.record.approvalBinding);
	const authorized = authorizeRunnerRequest(
		dir,
		{
			requestHash: hash,
			approval: `approval/req-${salt}`,
			decisionIdentity: `decision/req-${salt}`,
			body: "# Authorize request\n",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/release" } }],
			scope: null,
		},
		{ now: NOW },
	);
	assert.equal(authorized.ok, true, (authorized.errors || []).join("; "));
	return hash;
}

/** Authorized staging release + one authorized matching request. */
function transactionFixture(dir) {
	const candidate = stagingFixture(dir);
	approvalFixture(dir, "approval/rel-1", `release:staging:${candidate.releaseHash}`);
	const authorized = authorizeRelease(dir, stagingAuthorizeInput(), { now: NOW });
	assert.equal(authorized.ok, true, (authorized.errors || []).join("; "));
	const requestHash = authorizedRequestFixture(dir, "a");
	return { candidate, requestHash };
}

test("an emergency grant admits the release-bound request and ledgers join on requestHash", () => {
	// F057: "underlying target-write behavior still uses the registered
	// F052/F053/F056 capability". The emergency linkage to a release is
	// derivable, not duplicated: the break-glass use, the F052 runner
	// request, and the F053 release transaction all carry the same
	// requestHash.
	const dir = mkTarget("breakglass-join");
	const candidate = stagingFixture(dir);
	approvalFixture(dir, "approval/rel-1", `release:staging:${candidate.releaseHash}`);
	assert.equal(authorizeRelease(dir, stagingAuthorizeInput(), { now: NOW }).ok, true);
	const requestHash = authorizedRequestFixture(dir, "e", { scope: "deploy" });
	const bgDecision = admitArtifact(dir, {
		type: "decision",
		identity: "decision/bg-1",
		body: "# decision/bg-1\n",
		decisionKind: "approval",
		principal: "alice@example.com",
		traces: [{ type: "decides", to: { type: "intent", identity: "intent/release" } }],
	});
	assert.equal(bgDecision.ok, true, (bgDecision.errors || []).join("; "));
	const granted = grantBreakGlass(
		dir,
		{
			id: "breakglass/incident-9",
			incident: "incident/9",
			purpose: "emergency-staging-deploy",
			capability: {
				kind: "runner",
				runnerId: "runner/ci",
				runnerVersion: "1.0.0",
				name: "deploy.staging-web",
				capabilityVersion: "1",
			},
			target: "repo/main",
			scope: "deploy",
			environment: "staging",
			risk: "high",
			credentials: "scoped",
			validFrom: NOW.toISOString(),
			validUntil: new Date(NOW.getTime() + 3_600_000).toISOString(),
			reviewBy: new Date(NOW.getTime() + 72 * 3_600_000).toISOString(),
			decision: { identity: "decision/bg-1", revision: 1 },
		},
		{ now: NOW },
	);
	assert.equal(granted.ok, true, (granted.errors || []).join("; "));
	const used = useBreakGlass(
		dir,
		{ id: "breakglass/incident-9", reference: requestHash },
		{ now: NOW },
	);
	assert.equal(used.ok, true, (used.errors || []).join("; "));
	assert.equal(used.record.use.requestHash, requestHash);
	// The release deploy rides the very same authorized request.
	const deployed = deployRelease(dir, { releaseId: "release/web-42", requestHash }, { now: NOW });
	assert.equal(deployed.ok, true, (deployed.errors || []).join("; "));
	// Join proven: break-glass use.reference.id === release
	// transaction.requestHash === F052 requestHash.
	assert.equal(used.record.use.reference.kind, "runner");
	assert.equal(used.record.use.reference.id, deployed.record.requestHash);
});

test("transaction constants pin the operations and schema contract", () => {
	assert.equal(RELEASE_TRANSACTION_SCHEMA_VERSION, 1);
	assert.deepEqual(SUPPORTED_RELEASE_TRANSACTION_SCHEMA_VERSIONS, [1]);
	assert.deepEqual(RELEASE_TX_OPERATIONS, ["deploy", "rollback"]);
});

test("deploy binds one authorized release to one matching authorized request", () => {
	const dir = mkTarget("tx-deploy");
	const candidate = stagingFixture(dir);
	approvalFixture(dir, "approval/rel-1", `release:staging:${candidate.releaseHash}`);

	const unauthorized = deployRelease(dir, {
		releaseId: "release/web-42",
		requestHash: `sha256:${"f".repeat(64)}`,
	});
	assert.equal(unauthorized.code, "AMBER_E_RELEASE_TX_STATE");
	assert.match(unauthorized.errors[0], /not authorized/);

	const authorized = authorizeRelease(dir, stagingAuthorizeInput(), { now: NOW });
	assert.equal(authorized.ok, true, (authorized.errors || []).join("; "));

	const ghostRequest = deployRelease(dir, {
		releaseId: "release/web-42",
		requestHash: `sha256:${"f".repeat(64)}`,
	});
	assert.equal(ghostRequest.code, "AMBER_E_RELEASE_TX_STATE");
	assert.match(ghostRequest.errors[0], /not recorded/);

	const capOther = admitArtifact(dir, {
		type: "decision",
		identity: "decision/cap-other",
		body: "# cap other\n",
		decisionKind: "approval",
		principal: "alice@example.com",
		traces: [{ type: "decides", to: { type: "intent", identity: "intent/release" } }],
	});
	assert.equal(capOther.ok, true, (capOther.errors || []).join("; "));
	assert.equal(
		registerRunnerCapability(dir, {
			runnerId: "runner/ci",
			runnerVersion: "1.0.0",
			name: "deploy.other",
			capabilityVersion: "1",
			effects: ["deploy"],
			pathPrefixes: ["deploy/staging"],
			timeoutMsMax: 600_000,
			credentialRequirement: "scoped",
			rollback: "runbook/staging-rollback",
			decision: { identity: "decision/cap-other", revision: 1 },
		}).ok,
		true,
	);
	const foreignHash = authorizedRequestFixture(dir, "b", {
		capability: {
			runnerId: "runner/ci",
			runnerVersion: "1.0.0",
			name: "deploy.other",
			capabilityVersion: "1",
		},
	});
	const mismatch = deployRelease(dir, {
		releaseId: "release/web-42",
		requestHash: foreignHash,
	});
	assert.equal(mismatch.code, "AMBER_E_RELEASE_TX_MISMATCH");
	assert.match(mismatch.errors[0], /pins capability/);

	const matching = authorizedRequestFixture(dir, "c");
	const deployed = deployRelease(dir, { releaseId: "release/web-42", requestHash: matching });
	assert.equal(deployed.ok, true, (deployed.errors || []).join("; "));
	assert.equal(deployed.record.operation, "deploy");
	assert.equal(deployed.record.releaseHash, candidate.releaseHash);

	const again = deployRelease(dir, { releaseId: "release/web-42", requestHash: matching });
	assert.equal(again.code, "AMBER_E_RELEASE_EXISTS");

	// Credential values never ride a transaction record.
	assert.equal(JSON.stringify(deployed.record).includes(CREDENTIAL_HANDLE.handle), false);
});

test("rollback follows deployment on its own request, and outcomes project from F052", () => {
	const dir = mkTarget("tx-rollback");
	const { requestHash } = transactionFixture(dir);

	const premature = rollbackRelease(dir, {
		releaseId: "release/web-42",
		requestHash,
	});
	assert.equal(premature.code, "AMBER_E_RELEASE_TX_STATE");
	assert.match(premature.errors[0], /never deployed/);

	assert.equal(deployRelease(dir, { releaseId: "release/web-42", requestHash }).ok, true);

	const reused = rollbackRelease(dir, { releaseId: "release/web-42", requestHash });
	assert.equal(reused.code, "AMBER_E_RELEASE_TX_MISMATCH");
	assert.match(reused.errors[0], /its own authorized request/);

	const rollbackHash = authorizedRequestFixture(dir, "d");
	const rolled = rollbackRelease(dir, { releaseId: "release/web-42", requestHash: rollbackHash });
	assert.equal(rolled.ok, true, (rolled.errors || []).join("; "));
	assert.equal(rolled.record.operation, "rollback");

	// Outcomes project from the F052 settlement journal at read time.
	const pending = listReleaseTransactions(dir, { releaseId: "release/web-42" });
	assert.deepEqual(
		pending.map((entry) => entry.outcome),
		["pending", "pending"],
	);
	assert.equal(
		prepareRunnerExecution(dir, {
			requestHash,
			runner: { id: "runner/ci", version: "1.0.0", integrityDigest: DIGEST },
		}).ok,
		true,
	);
	const settled = settleRunnerExecution(dir, {
		requestHash,
		receipt: {
			runner: { id: "runner/ci", version: "1.0.0", integrityDigest: DIGEST },
			exitCode: 0,
			signal: null,
			timedOut: false,
			startedAt: "2026-08-29T01:00:00.000Z",
			finishedAt: "2026-08-29T01:02:00.000Z",
			durationMs: 120_000,
			outputsDigest: DIGEST,
			scope: { repository: "repo/main", paths: ["deploy/staging/web"] },
			sandboxAssurance: "observed",
			credentialAssurance: "observed",
		},
	});
	assert.equal(settled.ok, true, (settled.errors || []).join("; "));
	const projected = listReleaseTransactions(dir, { releaseId: "release/web-42" });
	assert.equal(projected[0].outcome, "committed");
	assert.equal(projected[1].outcome, "pending");
});

test("tampered transaction ledger fails every read closed", () => {
	const dir = mkTarget("tx-tamper");
	const { requestHash } = transactionFixture(dir);
	assert.equal(deployRelease(dir, { releaseId: "release/web-42", requestHash }).ok, true);
	const event = JSON.parse(fs.readFileSync(transactionsPath(dir), "utf8"));
	event.requestHash = `sha256:${"e".repeat(64)}`;
	writeJSONL(transactionsPath(dir), [event]);
	assert.throws(
		() => listReleaseTransactions(dir),
		(err) => err.amberCode === "AMBER_E_RELEASE_TX_CORRUPT",
	);
});

// ── F053 T4 (#277): release receipts, status & audit projection ──

function settleReceiptFor(dir, requestHash, overrides = {}) {
	assert.equal(
		prepareRunnerExecution(dir, {
			requestHash,
			runner: { id: "runner/ci", version: "1.0.0", integrityDigest: DIGEST },
		}).ok,
		true,
	);
	return settleRunnerExecution(dir, {
		requestHash,
		receipt: {
			runner: { id: "runner/ci", version: "1.0.0", integrityDigest: DIGEST },
			exitCode: 0,
			signal: null,
			timedOut: false,
			startedAt: "2026-08-29T01:00:00.000Z",
			finishedAt: "2026-08-29T01:02:00.000Z",
			durationMs: 120_000,
			outputsDigest: DIGEST,
			scope: { repository: "repo/main", paths: ["deploy/staging/web"] },
			sandboxAssurance: "observed",
			credentialAssurance: "observed",
			...overrides,
		},
	});
}

test("release status derives one lifecycle state across every ledger", () => {
	assert.deepEqual(RELEASE_STATUSES, [
		"prepared",
		"authorized",
		"deploying",
		"deployed",
		"aborted",
		"rolled-back",
	]);
	const dir = mkTarget("status");
	assert.equal(releaseStatus(dir, "release/ghost"), null);
	const candidate = stagingFixture(dir);
	assert.equal(releaseStatus(dir, "release/web-42"), "prepared");
	approvalFixture(dir, "approval/rel-1", `release:staging:${candidate.releaseHash}`);
	assert.equal(authorizeRelease(dir, stagingAuthorizeInput(), { now: NOW }).ok, true);
	assert.equal(releaseStatus(dir, "release/web-42"), "authorized");
	const deployHash = authorizedRequestFixture(dir, "a");
	assert.equal(
		deployRelease(dir, { releaseId: "release/web-42", requestHash: deployHash }).ok,
		true,
	);
	assert.equal(releaseStatus(dir, "release/web-42"), "deploying");
	assert.equal(settleReceiptFor(dir, deployHash).ok, true);
	assert.equal(releaseStatus(dir, "release/web-42"), "deployed");
	const rollbackHash = authorizedRequestFixture(dir, "b");
	assert.equal(
		rollbackRelease(dir, { releaseId: "release/web-42", requestHash: rollbackHash }).ok,
		true,
	);
	assert.equal(releaseStatus(dir, "release/web-42"), "deployed");
	assert.equal(settleReceiptFor(dir, rollbackHash).ok, true);
	assert.equal(releaseStatus(dir, "release/web-42"), "rolled-back");
});

test("a failed deployment reads as aborted, never as success", () => {
	const dir = mkTarget("status-aborted");
	const { requestHash } = transactionFixture(dir);
	assert.equal(deployRelease(dir, { releaseId: "release/web-42", requestHash }).ok, true);
	const failed = settleReceiptFor(dir, requestHash, { exitCode: 3 });
	assert.equal(failed.ok, false);
	assert.equal(releaseStatus(dir, "release/web-42"), "aborted");
});

test("the release receipt binds executor, boundary, and settlement without values", () => {
	const dir = mkTarget("receipt");
	const { requestHash } = transactionFixture(dir);
	assert.equal(deployRelease(dir, { releaseId: "release/web-42", requestHash }).ok, true);
	assert.equal(settleReceiptFor(dir, requestHash).ok, true);

	const missing = releaseReceipt(dir, "release/ghost");
	assert.equal(missing.code, "AMBER_E_RELEASE_NOT_FOUND");

	const projected = releaseReceipt(dir, "release/web-42");
	assert.equal(projected.ok, true, (projected.errors || []).join("; "));
	const receipt = projected.receipt;
	assert.equal(receipt.status, "deployed");
	assert.equal(receipt.inputs.commit, COMMIT);
	assert.equal(receipt.authorization.approvalId, "approval/rel-1");
	assert.equal(receipt.operations.length, 1);
	const operation = receipt.operations[0];
	assert.equal(operation.operation, "deploy");
	assert.deepEqual(operation.executor, {
		id: "runner/ci",
		version: "1.0.0",
		integrityDigest: DIGEST,
	});
	assert.equal(operation.settlement.outcome, "committed");
	assert.equal(operation.settlement.resultIntegrity, "receipt-bound");
	assert.deepEqual(operation.credentialBoundary, {
		purpose: "staging-deploy",
		scope: "deploy/staging",
		expiresAt: "2026-08-29T12:00:00.000Z",
	});
	// The boundary carries no handle and no value.
	assert.equal(JSON.stringify(receipt).includes(CREDENTIAL_HANDLE.handle), false);

	// A vanished cross-link fails the receipt closed: the transaction rides
	// a request that is no longer recorded.
	const requestsLedger = path.join(dir, ".amber", "runner", "requests.jsonl");
	const preserved = fs.readFileSync(requestsLedger, "utf8");
	fs.rmSync(requestsLedger);
	const vanished = releaseReceipt(dir, "release/web-42");
	assert.equal(vanished.ok, false);
	assert.equal(vanished.code, "AMBER_E_RELEASE_TX_CORRUPT");
	assert.match(vanished.errors[0], /no longer recorded/);
	fs.writeFileSync(requestsLedger, preserved);

	// A tampered transaction ledger fails the receipt closed.
	const event = JSON.parse(fs.readFileSync(transactionsPath(dir), "utf8"));
	event.releaseHash = `sha256:${"d".repeat(64)}`;
	writeJSONL(transactionsPath(dir), [event]);
	const tampered = releaseReceipt(dir, "release/web-42");
	assert.equal(tampered.ok, false);
	assert.equal(tampered.code, "AMBER_E_RELEASE_TX_CORRUPT");
});

test("the MCP seam exposes no release execution surface", () => {
	const { COMMAND_CAPABILITIES } = require("../../scripts/lib/mcp-action-contracts");
	// Deploy and rollback stay approval-required-only submissions: the MCP
	// capability registry carries no release verb at all, so no
	// registry-proven read-only variant can ever auto-execute one.
	const releaseCapabilities = Object.keys(COMMAND_CAPABILITIES).filter((key) =>
		key.split(/[\s.:/-]/).includes("release"),
	);
	assert.deepEqual(releaseCapabilities, []);
});
