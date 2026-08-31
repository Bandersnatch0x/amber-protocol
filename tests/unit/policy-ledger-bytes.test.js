"use strict";

// F061 follow-up (#313) - policy outcome ledger BYTE equivalence.
//
// The migration contract (ADR-0028 decision 2; F061 Testing Decisions) is
// byte compatibility: the ritual assembled by `defineLedgerFamily` must
// write the exact bytes the hand-written outcome ritual wrote. The checked-in
// golden was recorded twice against the PRE-migration implementation with the
// same inputs and clock before factory assembly. This test replays the
// lifecycle through the migrated ledger and compares it with that fixed
// golden. The committed hash makes accidental fixture rewrites fail closed.

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { recordEvidence } = require("../../scripts/lib/core/evidence-receipts");
const { grantApproval, consumeApproval } = require("../../scripts/lib/core/approval-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { evaluateGate } = require("../../scripts/lib/core/gate-evaluation");
const {
	POLICY_SCHEMA_VERSION,
	evaluatePolicy,
} = require("../../scripts/lib/core/policy-evaluation");
const { mkLedgerTarget, readEvents } = require("../helpers/harness");

const mkTarget = mkLedgerTarget("amber-policy-bytes");
const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "policy");
const GOLDEN = path.join(FIXTURES_DIR, "outcomes-lifecycle.golden.jsonl");
const GOLDEN_PROVENANCE = path.join(FIXTURES_DIR, "outcomes-lifecycle.golden.provenance.json");
const GOLDEN_SHA256 = "ec779a104a55adc7b0863fa4f33667bb3de3d0e9f7c53ea01180ae265a3c37dd";
const PRE_MIGRATION_COMMIT = "1204602430bc2c6d8b05624039fc0702852588f7";
const PRE_MIGRATION_SOURCE = "scripts/lib/core/policy-evaluation.js";
const PRE_MIGRATION_SOURCE_BLOB = "a930a7bb5819456b138ef0932a35ed6a279fe90b";
const OUTCOME_LOCK = path.join(".amber", "policies", "outcomes.lock");

const SUBJECT = "spec/login@2";
const NOW = new Date("2026-08-10T00:00:00.000Z");

function outcomeLedgerPath(dir) {
	return path.join(dir, ".amber", "policies", "outcomes.jsonl");
}

function assertSuccess(result, label) {
	assert.equal(result.ok, true, `${label}: ${(result.errors || []).join("; ")}`);
	return result;
}

function admitActivePolicy(dir, layer, overrides = {}, identity = `policy/${layer}`) {
	const contract = {
		policyVersion: POLICY_SCHEMA_VERSION,
		layer,
		...(Object.prototype.hasOwnProperty.call(overrides, "rules") ? { rules: overrides.rules } : {}),
	};
	assertSuccess(
		admitArtifact(dir, {
			type: "policy",
			identity,
			body: `# Policy: ${layer}`,
			extensions: { policy: contract },
		}),
		`admit ${identity}`,
	);
	assertSuccess(
		admitArtifact(dir, {
			type: "policy",
			identity,
			body: `# Policy: ${layer}`,
			extensions: { policy: contract },
			expectedHead: 1,
			transition: "activate",
		}),
		`activate ${identity}`,
	);
}

function seedPolicyPrincipals(dir) {
	for (const [id, principalKind] of [
		["alice@example.com", "human"],
		["dev@example.com", "human"],
		["ci-bot", "service"],
	]) {
		assertSuccess(registerPrincipal(dir, { id, principalKind }), `register ${id}`);
	}
}

function seedPolicyEvidenceAndGate(dir) {
	assertSuccess(
		recordEvidence(dir, {
			id: "evidence/policy-run",
			producer: "ci-bot",
			assurance: "observed",
			scope: "F061",
			subject: SUBJECT,
			inputs: null,
			tools: null,
			environment: null,
			outputs: ["ok"],
			status: "pass",
		}),
		"record evidence",
	);
	assertSuccess(
		admitArtifact(dir, {
			type: "gate",
			identity: "gate/policy-gate",
			body: "# Gate: policy readiness",
			extensions: {
				gate: {
					require: [{ evidenceType: SUBJECT, assurance: "observed" }],
				},
			},
		}),
		"admit gate",
	);
	const gate = assertSuccess(
		evaluateGate(dir, { gate: "gate/policy-gate", subject: SUBJECT, now: NOW }),
		"evaluate gate",
	);
	assert.equal(gate.outcome.verdict, "pass");
}

function seedPolicyApproval(dir) {
	assertSuccess(
		admitArtifact(dir, {
			type: "intent",
			identity: "intent/policy",
			body: "# Intent: policy",
		}),
		"admit intent",
	);
	assertSuccess(
		grantApproval(
			dir,
			{
				id: "approval/policy",
				approver: "alice@example.com",
				subject: SUBJECT,
				validUntil: "2027-01-01T00:00:00.000Z",
			},
			{ now: NOW },
		),
		"grant approval",
	);
	assertSuccess(
		consumeApproval(
			dir,
			{
				id: "approval/policy",
				decisionIdentity: "decision/policy",
				body: "# Decision: policy",
				traces: [
					{ type: "decides", to: { type: "intent", identity: "intent/policy", revision: 1 } },
				],
			},
			{ now: NOW },
		),
		"consume approval",
	);
}

function seedContext(dir) {
	seedPolicyPrincipals(dir);
	seedPolicyEvidenceAndGate(dir);
	seedPolicyApproval(dir);
	admitActivePolicy(dir, "org");
	admitActivePolicy(dir, "tenant");
}

function policyInput(overrides = {}) {
	return {
		subject: SUBJECT,
		submitter: "dev@example.com",
		capability: "release",
		approval: "approval/policy",
		gateOutcomeIndex: 0,
		now: NOW,
		...overrides,
		policies: {
			org: "policy/org",
			tenant: "policy/tenant",
			...(overrides.policies || {}),
		},
	};
}

function runLifecycle(dir) {
	mock.timers.enable({ apis: ["Date"], now: NOW.getTime() });
	try {
		seedContext(dir);
		const pass = evaluatePolicy(dir, policyInput());
		assert.equal(pass.ok, true, `${(pass.errors || []).join("; ")}`);
		assert.equal(pass.outcome.verdict, "pass");

		admitActivePolicy(dir, "repo", { rules: { denyCapabilities: ["release"] } }, "policy/repo");
		const deny = evaluatePolicy(dir, policyInput({ policies: { repo: "policy/repo" } }));
		assert.equal(deny.ok, false);
		assert.equal(deny.code, "AMBER_E_POLICY_DENIED");
		assert.equal(deny.outcome.verdict, "deny");
	} finally {
		mock.timers.reset();
	}
	return outcomeLedgerPath(dir);
}

test("the policy outcome ledger matches the pre-migration recording", () => {
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
		"the recorded pre-migration policy outcome golden changed unexpectedly",
	);
	assert.equal(
		actual.equals(golden),
		true,
		"the migrated policy outcome ritual wrote different bytes than the pre-migration recording in tests/fixtures/policy/outcomes-lifecycle.golden.jsonl",
	);
});

test("the policy golden carries immutable pre-migration provenance", () => {
	const provenance = JSON.parse(fs.readFileSync(GOLDEN_PROVENANCE, "utf8"));
	assert.equal(provenance.schemaVersion, 1);
	assert.equal(provenance.fixture, path.basename(GOLDEN));
	assert.equal(provenance.recordedBeforeFactoryAssembly, true);
	assert.deepEqual(provenance.recordedAgainst, {
		commit: PRE_MIGRATION_COMMIT,
		source: PRE_MIGRATION_SOURCE,
		sourceBlob: PRE_MIGRATION_SOURCE_BLOB,
		implementation: "hand-written policy outcome ledger",
	});
	assert.equal(
		execFileSync("git", ["rev-parse", `${PRE_MIGRATION_COMMIT}:${PRE_MIGRATION_SOURCE}`], {
			encoding: "utf8",
		}).trim(),
		PRE_MIGRATION_SOURCE_BLOB,
	);
	const preMigrationSource = execFileSync(
		"git",
		["show", `${PRE_MIGRATION_COMMIT}:${PRE_MIGRATION_SOURCE}`],
		{ encoding: "utf8" },
	);
	assert.match(preMigrationSource, /function appendPolicyOutcome/);
	assert.doesNotMatch(preMigrationSource, /defineLedgerFamily\(/);
	assert.deepEqual(provenance.recordings, [
		{ bytes: 2062, sha256: GOLDEN_SHA256 },
		{ bytes: 2062, sha256: GOLDEN_SHA256 },
	]);
	assert.equal(provenance.reRecordAfterAssembly, false);
});

test("policy outcome append failures retain the historical refusal wording", () => {
	const dir = mkTarget("append-error");
	seedContext(dir);
	const originalAppendFileSync = fs.appendFileSync;
	fs.appendFileSync = () => {
		throw new Error("disk full");
	};
	try {
		const result = evaluatePolicy(dir, policyInput());
		assert.equal(result.ok, false);
		assert.equal(result.code, "AMBER_E_POLICY_OUTCOME_REGISTRY_CORRUPT");
		assert.match(
			result.errors[0],
			/^failed to append the policy outcome for subject "spec\/login@2" to the policy outcome ledger: disk full$/,
		);
		assert.equal(fs.existsSync(outcomeLedgerPath(dir)), false);
	} finally {
		fs.appendFileSync = originalAppendFileSync;
	}
});

test("invalid policy outcome ceiling overrides retain the historical typed throw", () => {
	const dir = mkTarget("invalid-ceiling");
	seedContext(dir);
	const envName = "AMBER_POLICY_MAX_OUTCOME_BYTES";
	const previous = process.env[envName];
	process.env[envName] = "not-a-positive-integer";
	try {
		assert.throws(
			() => evaluatePolicy(dir, policyInput()),
			(error) => {
				assert.equal(error.amberCode, "AMBER_E_INVALID_ARG");
				assert.match(error.message, /AMBER_POLICY_MAX_OUTCOME_BYTES/);
				assert.match(error.message, /must be a positive integer when set/);
				return true;
			},
		);
	} finally {
		if (previous === undefined) delete process.env[envName];
		else process.env[envName] = previous;
	}
	assert.equal(fs.existsSync(path.join(dir, OUTCOME_LOCK)), false);
});
