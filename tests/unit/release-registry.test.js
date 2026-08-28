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
} = require("../../scripts/lib/core/release-registry");
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
