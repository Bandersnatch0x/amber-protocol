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
} = require("../../scripts/lib/core/release-registry");
const { grantApproval } = require("../../scripts/lib/core/approval-registry");
const { evaluateGate } = require("../../scripts/lib/core/gate-evaluation");
const {
	registerRunner,
	registerRunnerCapability,
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
