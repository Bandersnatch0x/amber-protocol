"use strict";

// F061 follow-up (#311) — release family migration: ledger BYTE equivalence.
//
// The migration contract (ADR-0028 decision 2; F061 Testing Decisions) is
// byte compatibility: the ritual assembled by `defineLedgerFamily` must
// write the exact bytes the hand-written ritual wrote for every release
// ledger. This test records one deterministic staging lifecycle against the
// PRE-migration implementation — candidate preparation, authorization, and
// deployment followed by rollback — then compares all three release ledgers
// with their checked-in goldens after the migration.
//
// Recording provenance (do not re-record against a factory-assembled
// implementation): these files were recorded twice against the pre-migration
// hand-written implementation before factory assembly, with identical hashes.
// Inputs, clocks, ids, and digests are pinned, so every ledger byte is
// deterministic. The committed comparison cannot rewrite goldens.

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
	prepareReleaseCandidate,
	authorizeRelease,
	candidatesPath,
	authorizationsPath,
	transactionsPath,
	deployRelease,
	rollbackRelease,
} = require("../../scripts/lib/core/release-registry");
const { defineLedgerFamily } = require("../../scripts/lib/core/ledger-family");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { recordEvidence } = require("../../scripts/lib/core/evidence-receipts");
const { grantApproval } = require("../../scripts/lib/core/approval-registry");
const {
	registerRunner,
	registerRunnerCapability,
	submitRunnerRequest,
	authorizeRunnerRequest,
} = require("../../scripts/lib/core/runner-registry");
const { mkLedgerTarget, readEvents } = require("../helpers/harness");

const mkTarget = mkLedgerTarget("amber-release-bytes");
const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "release");
const GOLDEN = Object.freeze({
	candidates: path.join(FIXTURES_DIR, "candidates-lifecycle.golden.jsonl"),
	authorizations: path.join(FIXTURES_DIR, "authorizations-lifecycle.golden.jsonl"),
	transactions: path.join(FIXTURES_DIR, "transactions-lifecycle.golden.jsonl"),
});
const GOLDEN_SHA256 = Object.freeze({
	candidates: "c64810466c23b81d8a63496d28f6edfdc1d695701de9ba5671cc46d132d09bb2",
	authorizations: "880618fa15577e3ebc809d75b4290d5e38a4208e3ccd75f002fb1da4fb9e2d9c",
	transactions: "65f02a560a202c6084701265aad73a27aee4d148d0c3b8a0e7f65a2e75210be4",
});

const DIGEST = `sha256:${"a".repeat(64)}`;
const COMMIT = "b".repeat(40);
const NOW = new Date("2026-08-31T00:00:00.000Z");
const DEPLOY_AT = new Date("2026-08-31T00:01:00.000Z");
const ROLLBACK_AT = new Date("2026-08-31T00:02:00.000Z");
const CREDENTIAL = Object.freeze({
	handle: "cred-release-7f3a",
	purpose: "staging-deploy",
	scope: "deploy/staging",
	expiresAt: "2026-08-31T12:00:00.000Z",
});

function ok(result, label) {
	assert.equal(result.ok, true, `${label}: ${(result.errors || []).join("; ")}`);
	return result;
}

function recordFixtureEvidence(dir, ids) {
	for (const id of ids) {
		ok(
			recordEvidence(dir, {
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
			}),
			`record ${id}`,
		);
	}
}

function seedReleaseDependencies(dir) {
	for (const id of ["alice@example.com", "bob@example.com", "carol@example.com"])
		ok(registerPrincipal(dir, { id, principalKind: "human" }), `register ${id}`);
	ok(
		admitArtifact(dir, { type: "intent", identity: "intent/release", body: "# Release\n" }),
		"admit intent/release",
	);
	ok(
		admitArtifact(dir, { type: "policy", identity: "policy/release", body: "# Policy\n" }),
		"admit policy/release",
	);
	recordFixtureEvidence(dir, [
		"evidence/test-run",
		"evidence/review-logic",
		"evidence/review-security",
		"evidence/review-spec",
		"evidence/rollback-plan",
		"evidence/rehearsal-run",
	]);
	for (const [identity, principal] of [
		["decision/runner-1", "alice@example.com"],
		["decision/cap-1", "alice@example.com"],
	])
		ok(
			admitArtifact(dir, {
				type: "decision",
				identity,
				body: `# ${identity}\n`,
				decisionKind: "approval",
				principal,
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/release" } }],
			}),
			`admit ${identity}`,
		);
	ok(
		registerRunner(
			dir,
			{
				id: "runner/ci",
				version: "1.0.0",
				integrityDigest: DIGEST,
				owner: "platform-team",
				decision: { identity: "decision/runner-1", revision: 1 },
			},
			{ now: NOW },
		),
		"register runner/ci",
	);
	ok(
		registerRunnerCapability(
			dir,
			{
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
			},
			{ now: NOW },
		),
		"register deploy.staging-web",
	);
}

function candidateInput() {
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
	};
}

function requestInput(salt) {
	return {
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
		credential: { ...CREDENTIAL },
		rehearsal: "evidence/rehearsal-run",
		rollback: "runbook/staging-rollback",
	};
}

function authorizeRequest(dir, salt) {
	const submitted = ok(
		submitRunnerRequest(dir, requestInput(salt), { now: NOW }),
		`submit ${salt}`,
	);
	ok(
		grantApproval(
			dir,
			{
				id: `approval/request-${salt}`,
				approver: "bob@example.com",
				scope: null,
				subject: submitted.record.approvalBinding,
				validUntil: "2027-01-01T00:00:00.000Z",
			},
			{ now: NOW },
		),
		`grant request ${salt}`,
	);
	ok(
		authorizeRunnerRequest(
			dir,
			{
				requestHash: submitted.record.requestHash,
				approval: `approval/request-${salt}`,
				decisionIdentity: `decision/request-${salt}`,
				body: "# Authorize request\n",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/release" } }],
				scope: null,
			},
			{ now: NOW },
		),
		`authorize request ${salt}`,
	);
	return submitted.record.requestHash;
}

function runLifecycle(dir) {
	mock.timers.enable({ apis: ["Date"], now: NOW.getTime() });
	try {
		seedReleaseDependencies(dir);
		const candidate = ok(
			prepareReleaseCandidate(dir, candidateInput(), { now: NOW }),
			"prepare candidate",
		);
		ok(
			grantApproval(
				dir,
				{
					id: "approval/release-1",
					approver: "bob@example.com",
					scope: null,
					subject: `release:staging:${candidate.record.releaseHash}`,
					validUntil: "2027-01-01T00:00:00.000Z",
				},
				{ now: NOW },
			),
			"grant release approval",
		);
		ok(
			authorizeRelease(
				dir,
				{
					releaseId: "release/web-42",
					approval: "approval/release-1",
					decisionIdentity: "decision/release-1",
					body: "# Authorize release\n",
					traces: [{ type: "decides", to: { type: "intent", identity: "intent/release" } }],
					scope: null,
					rehearsal: "evidence/rehearsal-run",
				},
				{ now: NOW },
			),
			"authorize release",
		);
		const deployRequest = authorizeRequest(dir, "a");
		ok(
			deployRelease(
				dir,
				{ releaseId: "release/web-42", requestHash: deployRequest },
				{ now: DEPLOY_AT },
			),
			"deploy release",
		);
		const rollbackRequest = authorizeRequest(dir, "b");
		ok(
			rollbackRelease(
				dir,
				{ releaseId: "release/web-42", requestHash: rollbackRequest },
				{ now: ROLLBACK_AT },
			),
			"rollback release",
		);
	} finally {
		mock.timers.reset();
	}
	return {
		candidates: candidatesPath(dir),
		authorizations: authorizationsPath(dir),
		transactions: transactionsPath(dir),
	};
}

test("the factory-assembled release ledgers match the pre-migration recording", () => {
	const ledgers = runLifecycle(mkTarget("lifecycle"));
	assert.deepEqual(
		readEvents(ledgers.candidates).map((event) => event.kind),
		["prepared"],
	);
	assert.deepEqual(
		readEvents(ledgers.authorizations).map((event) => event.kind),
		["authorized"],
	);
	assert.deepEqual(
		readEvents(ledgers.transactions).map((event) => event.kind),
		["deploy", "rollback"],
	);
	for (const name of Object.keys(GOLDEN)) {
		const actual = fs.readFileSync(ledgers[name]);
		const golden = fs.readFileSync(GOLDEN[name]);
		assert.equal(
			crypto.createHash("sha256").update(golden).digest("hex"),
			GOLDEN_SHA256[name],
			`the recorded pre-migration ${name} golden changed unexpectedly`,
		);
		assert.equal(
			actual.equals(golden),
			true,
			`the migrated ${name} ledger ritual wrote different bytes than the pre-migration recording in tests/fixtures/release/${path.basename(GOLDEN[name])}`,
		);
	}
});

test("a family-specific chain-head label preserves release append failures", () => {
	const corruptCode = "AMBER_E_RELEASE_LABEL_TEST_CORRUPT";
	const family = defineLedgerFamily({
		dir: "release-label-test",
		label: "release registry",
		ledgers: [
			{
				name: "candidates",
				fileName: "candidates.jsonl",
				lockName: "candidates.lock",
				conflictCode: "AMBER_E_RELEASE_LABEL_TEST_LOCK",
				corruptCode,
				sizeCeilingCode: "AMBER_E_RELEASE_LABEL_TEST_SIZE",
				ceiling: { envName: "AMBER_RELEASE_LABEL_TEST_BYTES", defaultBytes: 1024 * 1024 },
				label: "release candidate ledger",
				chainHeadLabel: "release candidates",
				eventLabel: "release candidate",
				fold: {
					init: () => [],
					apply: () => {},
					result: (events) => events,
				},
			},
		],
	});
	const ledger = family.ledgers.candidates;
	const dir = mkTarget("chain-head-label");
	const refused = ledger.append(
		dir,
		{ kind: "prepared", schemaVersion: 1, at: NOW.toISOString() },
		() => {
			fs.writeFileSync(ledger.path(dir), "not-json\n", "utf8");
			return null;
		},
		() => null,
	);
	assert.equal(refused.ok, false);
	assert.equal(refused.code, corruptCode);
	assert.match(refused.errors[0], /release candidates ledger corrupt or unreadable/);
	assert.throws(
		() => ledger.chainHead(dir),
		(err) =>
			err.amberCode === corruptCode &&
			/release candidates ledger corrupt or unreadable/.test(err.message),
	);
});
