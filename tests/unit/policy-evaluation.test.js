"use strict";

// F050 ticket 5 (#230) — Policy ceiling and separation of duties (unit seam).
// Fixtures use the real governed seams end to end: principal registry,
// evidence receipts, Gate evaluation, Approval consumption, canonical policy
// artifacts, and the policy outcome ledger.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { recordEvidence, verifyEvidence } = require("../../scripts/lib/core/evidence-receipts");
const { grantApproval, consumeApproval } = require("../../scripts/lib/core/approval-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { evaluateGate } = require("../../scripts/lib/core/gate-evaluation");
const {
	POLICY_EVALUATION_SCHEMA_VERSION,
	SUPPORTED_POLICY_EVALUATION_SCHEMA_VERSIONS,
	POLICY_SCHEMA_VERSION,
	POLICY_LAYERS,
	SKEW_POLICY,
	CLOCK_SOURCES,
	DEFAULT_MAX_OUTCOME_BYTES,
	MAX_OUTCOME_ENV,
	GENESIS_HASH,
	chainHash,
	evaluatePolicy,
	showPolicyOutcome,
	listPolicyOutcomes,
} = require("../../scripts/lib/core/policy-evaluation");
const { writeJSONL } = require("../../scripts/lib/core/jsonl");

const SUBJECT = "spec/login@2";
const EVAL_NOW = new Date("2026-08-10T00:00:00.000Z");

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-policy-${label}-`));
}

function outcomeLedgerPath(dir) {
	return path.join(dir, ".amber", "policies", "outcomes.jsonl");
}

function readLedger(dir) {
	return fs
		.readFileSync(outcomeLedgerPath(dir), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
}

function seedPrincipals(dir) {
	for (const principal of [
		{ id: "alice@example.com", principalKind: "human", role: "approver" },
		{ id: "bob@example.com", principalKind: "human", role: "verifier" },
		{ id: "dev@example.com", principalKind: "human", role: "submitter" },
		{
			id: "manager@example.com",
			principalKind: "human",
			role: "manager",
			capability: "release",
			scope: SUBJECT,
		},
		{ id: "observer@example.com", principalKind: "human", role: "observer" },
		{ id: "lead@example.com", principalKind: "human", role: "lead" },
		{ id: "ci-bot", principalKind: "service", capability: "execute" },
	]) {
		const result = registerPrincipal(dir, principal);
		assert.equal(result.ok, true, (result.errors || []).join("; "));
	}
}

function admitActivePolicy(dir, layer, overrides = {}, identity = `policy/${layer}`) {
	const contract = {
		policyVersion: Object.prototype.hasOwnProperty.call(overrides, "policyVersion")
			? overrides.policyVersion
			: POLICY_SCHEMA_VERSION,
		layer,
		...(Object.prototype.hasOwnProperty.call(overrides, "rules") ? { rules: overrides.rules } : {}),
		...(Object.prototype.hasOwnProperty.call(overrides, "delegations")
			? { delegations: overrides.delegations }
			: {}),
		...(Object.prototype.hasOwnProperty.call(overrides, "validUntil")
			? { validUntil: overrides.validUntil }
			: {}),
		...(Object.prototype.hasOwnProperty.call(overrides, "maxPolicyAgeMs")
			? { maxPolicyAgeMs: overrides.maxPolicyAgeMs }
			: {}),
	};
	const draft = admitArtifact(dir, {
		type: "policy",
		identity,
		body: `# Policy: ${layer}`,
		extensions: { policy: contract },
	});
	assert.equal(draft.ok, true, (draft.errors || []).join("; "));
	const active = admitArtifact(dir, {
		type: "policy",
		identity,
		body: `# Policy: ${layer}`,
		extensions: { policy: contract },
		expectedHead: 1,
		transition: "activate",
	});
	assert.equal(active.ok, true, (active.errors || []).join("; "));
	return active.receipt;
}

function admitGateArtifact(
	dir,
	contract = { require: [{ evidenceType: SUBJECT, assurance: "verified" }] },
) {
	const admitted = admitArtifact(dir, {
		type: "gate",
		identity: "gate/login-gate",
		body: "# Gate: login readiness",
		extensions: { gate: contract },
	});
	assert.equal(admitted.ok, true, (admitted.errors || []).join("; "));
	return admitted.receipt;
}

function admitIntent(dir) {
	const admitted = admitArtifact(dir, {
		type: "intent",
		identity: "intent/login",
		body: "# Intent: login",
	});
	assert.equal(admitted.ok, true, (admitted.errors || []).join("; "));
}

function recordAndVerifyEvidence(dir, overrides = {}) {
	const recorded = recordEvidence(
		dir,
		{
			id: overrides.id || "evidence/login-run",
			producer: overrides.producer || "ci-bot",
			assurance: "observed",
			subject: overrides.subject || SUBJECT,
			status: overrides.status || "pass",
			outputs: ["ok"],
		},
		{},
	);
	assert.equal(recorded.ok, true, (recorded.errors || []).join("; "));
	if (overrides.verify !== false) {
		const verified = verifyEvidence(
			dir,
			{
				id: overrides.id || "evidence/login-run",
				verifier: overrides.verifier || "bob@example.com",
			},
			{},
		);
		assert.equal(verified.ok, true, (verified.errors || []).join("; "));
	}
	return recorded.receipt;
}

function createGateOutcome(dir, gateContract) {
	admitGateArtifact(dir, gateContract);
	const gate = evaluateGate(dir, { gate: "gate/login-gate", subject: SUBJECT, now: EVAL_NOW }, {});
	assert.equal(gate.ok, true, (gate.errors || []).join("; "));
	return gate.outcome;
}

function consumeApprovalFixture(
	dir,
	{ approver = "alice@example.com", id = "approval/login-42" } = {},
) {
	admitIntent(dir);
	const granted = grantApproval(
		dir,
		{ id, approver, subject: SUBJECT, validUntil: "2027-01-01T00:00:00.000Z" },
		{ now: new Date("2026-08-01T00:00:00.000Z") },
	);
	assert.equal(granted.ok, true, (granted.errors || []).join("; "));
	const consumed = consumeApproval(
		dir,
		{
			id,
			decisionIdentity: `decision/${id.replace("approval/", "")}`,
			body: "# Decision: approved",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/login", revision: 1 } }],
		},
		{ now: EVAL_NOW },
	);
	assert.equal(consumed.ok, true, (consumed.errors || []).join("; "));
	return consumed.approval;
}

function setupStrictContext(dir, options = {}) {
	seedPrincipals(dir);
	recordAndVerifyEvidence(dir, options.evidence || {});
	const gateOutcome = createGateOutcome(dir, options.gateContract);
	consumeApprovalFixture(dir, options.approval || {});
	admitActivePolicy(dir, "org", options.org || {});
	admitActivePolicy(dir, "tenant", options.tenant || {});
	if (options.repo) admitActivePolicy(dir, "repo", options.repo, "policy/repo");
	if (options.play) admitActivePolicy(dir, "play", options.play, "policy/play");
	if (options.gate) admitActivePolicy(dir, "gate", options.gate, "policy/gate");
	return gateOutcome;
}

function baseInput(overrides = {}) {
	return {
		subject: SUBJECT,
		submitter: "dev@example.com",
		capability: "release",
		approval: "approval/login-42",
		gateOutcomeIndex: 0,
		now: EVAL_NOW,
		...overrides,
		policies: { org: "policy/org", tenant: "policy/tenant", ...(overrides.policies || {}) },
	};
}

test("policy constants pin the version, layer, clock, and ceiling contracts", () => {
	assert.equal(POLICY_EVALUATION_SCHEMA_VERSION, 1);
	assert.deepEqual(SUPPORTED_POLICY_EVALUATION_SCHEMA_VERSIONS, [1]);
	assert.equal(POLICY_SCHEMA_VERSION, 1);
	assert.deepEqual(POLICY_LAYERS, ["org", "tenant", "repo", "play", "gate"]);
	assert.deepEqual(CLOCK_SOURCES, ["injected", "system"]);
	assert.equal(SKEW_POLICY, "no-tolerance");
	assert.equal(DEFAULT_MAX_OUTCOME_BYTES, 1024 * 1024);
	assert.equal(MAX_OUTCOME_ENV, "AMBER_POLICY_MAX_OUTCOME_BYTES");
});

test("a complete strict context passes and show/list round-trip the policy outcome", () => {
	const dir = mkTarget("pass");
	setupStrictContext(dir);
	const result = evaluatePolicy(dir, baseInput(), {});

	assert.equal(result.ok, true, (result.errors || []).join("; "));
	assert.equal(result.code, null);
	assert.equal(result.outcome.verdict, "pass");
	assert.equal(result.outcome.index, 0);
	assert.equal(result.outcome.clockSource, "injected");
	assert.deepEqual(result.outcome.reasons, []);
	assert.equal(result.outcome.policies.org.identity, "policy/org");
	assert.equal(result.outcome.policies.tenant.identity, "policy/tenant");
	assert.equal(result.outcome.approval.status, "consumed");
	assert.equal(result.outcome.approval.approver, "alice@example.com");
	assert.equal(result.outcome.gateOutcome.index, 0);
	assert.equal(result.outcome.gateOutcome.verdict, "pass");
	assert.equal(result.outcome.delegation, null);

	assert.equal(showPolicyOutcome(dir, { index: 0 }).hash, result.outcome.hash);
	assert.equal(listPolicyOutcomes(dir).length, 1);
	assert.equal(listPolicyOutcomes(dir, { verdict: "pass" }).length, 1);
	assert.equal(listPolicyOutcomes(dir, { submitter: "nobody" }).length, 0);
});

test("deny-wins policy rules append a deny outcome", () => {
	const dir = mkTarget("deny-wins");
	setupStrictContext(dir, { repo: { rules: { denyCapabilities: ["release"] } } });
	const result = evaluatePolicy(dir, baseInput({ policies: { repo: "policy/repo" } }), {});

	assert.equal(result.ok, false);
	assert.equal(result.code, "AMBER_E_POLICY_DENIED");
	assert.equal(result.outcome.verdict, "deny");
	assert.ok(result.outcome.reasons.some((reason) => reason.includes("denies capability")));
	assert.equal(readLedger(dir).length, 1);
});

test("separation of duties denies self-approval and self-production", () => {
	const selfApproval = mkTarget("self-approval");
	setupStrictContext(selfApproval);
	const approvalResult = evaluatePolicy(
		selfApproval,
		baseInput({ submitter: "alice@example.com" }),
		{},
	);
	assert.equal(approvalResult.ok, false);
	assert.equal(approvalResult.code, "AMBER_E_POLICY_SEPARATION_OF_DUTIES");
	assert.ok(approvalResult.outcome.reasons.some((reason) => reason.includes("approval approver")));

	const selfProduction = mkTarget("self-production");
	setupStrictContext(selfProduction);
	const producerResult = evaluatePolicy(selfProduction, baseInput({ submitter: "ci-bot" }), {});
	assert.equal(producerResult.ok, false);
	assert.equal(producerResult.code, "AMBER_E_POLICY_SEPARATION_OF_DUTIES");
	assert.ok(producerResult.outcome.reasons.some((reason) => reason.includes("evidence producer")));
});

test("separation of duties allows repeated same-role evidence actors across receipts", () => {
	const dir = mkTarget("same-role-evidence");
	seedPrincipals(dir);
	recordAndVerifyEvidence(dir, { id: "evidence/a", subject: "eval/a" });
	recordAndVerifyEvidence(dir, { id: "evidence/b", subject: "eval/b" });
	createGateOutcome(dir, {
		require: [
			{ evidenceType: "eval/a", subject: "eval/a", assurance: "verified" },
			{ evidenceType: "eval/b", subject: "eval/b", assurance: "verified" },
		],
	});
	consumeApprovalFixture(dir);
	admitActivePolicy(dir, "org");
	admitActivePolicy(dir, "tenant");

	const result = evaluatePolicy(dir, baseInput(), {});
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	assert.equal(result.outcome.verdict, "pass");
});

test("missing, stale, unsupported, and relaxing policy contracts refuse before appending", () => {
	const missing = mkTarget("missing");
	seedPrincipals(missing);
	const missingResult = evaluatePolicy(missing, baseInput(), {});
	assert.equal(missingResult.ok, false);
	assert.equal(missingResult.code, "AMBER_E_POLICY_MISSING");
	assert.equal(fs.existsSync(outcomeLedgerPath(missing)), false);

	const stale = mkTarget("stale");
	setupStrictContext(stale, { org: { validUntil: "2026-01-01T00:00:00.000Z" } });
	const staleResult = evaluatePolicy(stale, baseInput(), {});
	assert.equal(staleResult.ok, false);
	assert.equal(staleResult.code, "AMBER_E_POLICY_STALE");
	assert.equal(fs.existsSync(outcomeLedgerPath(stale)), false);

	const unsupported = mkTarget("unsupported");
	setupStrictContext(unsupported, { org: { policyVersion: 2 } });
	const unsupportedResult = evaluatePolicy(unsupported, baseInput(), {});
	assert.equal(unsupportedResult.ok, false);
	assert.equal(unsupportedResult.code, "AMBER_E_POLICY_UNSUPPORTED_VERSION");
	assert.equal(fs.existsSync(outcomeLedgerPath(unsupported)), false);

	const relaxing = mkTarget("relaxing");
	setupStrictContext(relaxing, { repo: { rules: { requireSeparationOfDuties: false } } });
	const relaxingResult = evaluatePolicy(
		relaxing,
		baseInput({ policies: { repo: "policy/repo" } }),
		{},
	);
	assert.equal(relaxingResult.ok, false);
	assert.equal(relaxingResult.code, "AMBER_E_POLICY_CONFLICT");
	assert.equal(fs.existsSync(outcomeLedgerPath(relaxing)), false);

	const lowerDelegation = mkTarget("lower-delegation");
	setupStrictContext(lowerDelegation, {
		repo: {
			delegations: [
				{
					delegator: "manager@example.com",
					delegate: "dev@example.com",
					capability: "release",
					scope: SUBJECT,
					validFrom: "2026-01-01T00:00:00.000Z",
					validUntil: "2027-01-01T00:00:00.000Z",
				},
			],
		},
	});
	const lowerDelegationResult = evaluatePolicy(
		lowerDelegation,
		baseInput({ policies: { repo: "policy/repo" }, delegator: "manager@example.com" }),
		{},
	);
	assert.equal(lowerDelegationResult.ok, false);
	assert.equal(lowerDelegationResult.code, "AMBER_E_POLICY_CONFLICT");
	assert.equal(fs.existsSync(outcomeLedgerPath(lowerDelegation)), false);
});

test("delegation is direct, scoped, capability-limited, and time-limited", () => {
	const valid = mkTarget("delegation-valid");
	setupStrictContext(valid, {
		org: {
			delegations: [
				{
					delegator: "manager@example.com",
					delegate: "dev@example.com",
					capability: "release",
					scope: SUBJECT,
					validFrom: "2026-01-01T00:00:00.000Z",
					validUntil: "2027-01-01T00:00:00.000Z",
				},
			],
		},
	});
	const pass = evaluatePolicy(valid, baseInput({ delegator: "manager@example.com" }), {});
	assert.equal(pass.ok, true, (pass.errors || []).join("; "));
	assert.equal(pass.outcome.delegation.delegator, "manager@example.com");
	assert.equal(showPolicyOutcome(valid, { index: pass.outcome.index }).hash, pass.outcome.hash);
	assert.equal(listPolicyOutcomes(valid).length, 1);

	const missing = mkTarget("delegation-missing");
	setupStrictContext(missing);
	const denied = evaluatePolicy(missing, baseInput({ delegator: "manager@example.com" }), {});
	assert.equal(denied.ok, false);
	assert.equal(denied.code, "AMBER_E_POLICY_DELEGATION_REQUIRED");
	assert.equal(denied.outcome.verdict, "deny");

	const chained = mkTarget("delegation-chained");
	setupStrictContext(chained, {
		org: {
			delegations: [
				{
					delegator: "manager@example.com",
					delegate: "lead@example.com",
					capability: "release",
					scope: SUBJECT,
					validFrom: "2026-01-01T00:00:00.000Z",
					validUntil: "2027-01-01T00:00:00.000Z",
				},
				{
					delegator: "lead@example.com",
					delegate: "dev@example.com",
					capability: "release",
					scope: SUBJECT,
					validFrom: "2026-01-01T00:00:00.000Z",
					validUntil: "2027-01-01T00:00:00.000Z",
				},
			],
		},
	});
	const noTransitive = evaluatePolicy(chained, baseInput({ delegator: "manager@example.com" }), {});
	assert.equal(noTransitive.ok, false);
	assert.equal(noTransitive.code, "AMBER_E_POLICY_DELEGATION_REQUIRED");

	const wrongShape = mkTarget("delegation-wrong-shape");
	setupStrictContext(wrongShape, {
		org: {
			delegations: [
				{
					delegator: "manager@example.com",
					delegate: "dev@example.com",
					capability: "deploy",
					scope: "spec/other@1",
					validFrom: "2026-01-01T00:00:00.000Z",
					validUntil: "2026-08-01T00:00:00.000Z",
				},
			],
		},
	});
	const wrongShapeDenied = evaluatePolicy(
		wrongShape,
		baseInput({ delegator: "manager@example.com" }),
		{},
	);
	assert.equal(wrongShapeDenied.ok, false);
	assert.equal(wrongShapeDenied.code, "AMBER_E_POLICY_DELEGATION_REQUIRED");

	const unauthorizedDelegator = mkTarget("delegation-unauthorized-delegator");
	setupStrictContext(unauthorizedDelegator, {
		org: {
			delegations: [
				{
					delegator: "observer@example.com",
					delegate: "dev@example.com",
					capability: "release",
					scope: SUBJECT,
					validFrom: "2026-01-01T00:00:00.000Z",
					validUntil: "2027-01-01T00:00:00.000Z",
				},
			],
		},
	});
	const unauthorized = evaluatePolicy(
		unauthorizedDelegator,
		baseInput({ delegator: "observer@example.com" }),
		{},
	);
	assert.equal(unauthorized.ok, false);
	assert.equal(unauthorized.code, "AMBER_E_POLICY_DELEGATION_REQUIRED");
	assert.ok(
		unauthorized.outcome.reasons.some((reason) => reason.startsWith("delegation invalid:")),
	);

	const deniedDelegator = mkTarget("delegation-denied-delegator");
	setupStrictContext(deniedDelegator, {
		org: {
			delegations: [
				{
					delegator: "manager@example.com",
					delegate: "dev@example.com",
					capability: "release",
					scope: SUBJECT,
					validFrom: "2026-01-01T00:00:00.000Z",
					validUntil: "2027-01-01T00:00:00.000Z",
				},
			],
		},
		repo: { rules: { denyPrincipals: ["manager@example.com"] } },
	});
	const deniedByPolicy = evaluatePolicy(
		deniedDelegator,
		baseInput({ policies: { repo: "policy/repo" }, delegator: "manager@example.com" }),
		{},
	);
	assert.equal(deniedByPolicy.ok, false);
	assert.equal(deniedByPolicy.code, "AMBER_E_POLICY_DENIED");
	assert.ok(deniedByPolicy.outcome.reasons.some((reason) => reason.includes("denies principal")));
});

test("changed policy stack hashes produce new immutable outcomes", () => {
	const dir = mkTarget("policy-hashes");
	setupStrictContext(dir);
	const first = evaluatePolicy(dir, baseInput(), {});
	assert.equal(first.ok, true, (first.errors || []).join("; "));

	admitActivePolicy(dir, "repo", { rules: { denyScopes: ["not-this-subject"] } }, "policy/repo");
	const second = evaluatePolicy(dir, baseInput({ policies: { repo: "policy/repo" } }), {});
	assert.equal(second.ok, true, (second.errors || []).join("; "));
	assert.equal(second.outcome.index, 1);
	assert.notDeepEqual(second.outcome.policies, first.outcome.policies);
	assert.equal(showPolicyOutcome(dir, { index: 0 }).hash, first.outcome.hash);
});

test("the outcome ledger fails closed on tamper and honors lock and ceiling", () => {
	const tamper = mkTarget("tamper");
	setupStrictContext(tamper);
	evaluatePolicy(tamper, baseInput(), {});
	const events = readLedger(tamper);
	events[0].verdict = "pass-edited";
	writeJSONL(outcomeLedgerPath(tamper), events);
	assert.throws(
		() => listPolicyOutcomes(tamper),
		(err) => err.amberCode === "AMBER_E_POLICY_OUTCOME_REGISTRY_CORRUPT",
	);

	const lock = mkTarget("lock");
	setupStrictContext(lock);
	const lockPath = path.join(lock, ".amber", "policies", "outcomes.lock");
	fs.mkdirSync(path.dirname(lockPath), { recursive: true });
	fs.writeFileSync(lockPath, "holder-token-1");
	const refused = evaluatePolicy(lock, baseInput(), {});
	assert.equal(refused.ok, false);
	assert.equal(refused.code, "AMBER_E_POLICY_OUTCOME_REGISTRY_LOCK");
	const stale = new Date(Date.now() - 60_000);
	fs.utimesSync(lockPath, stale, stale);
	const reclaimed = evaluatePolicy(lock, baseInput(), {});
	assert.equal(reclaimed.ok, true, (reclaimed.errors || []).join("; "));
	assert.equal(fs.existsSync(lockPath), false);

	const ceiling = mkTarget("ceiling");
	setupStrictContext(ceiling);
	process.env.AMBER_POLICY_MAX_OUTCOME_BYTES = "1";
	try {
		const oversized = evaluatePolicy(ceiling, baseInput(), {});
		assert.equal(oversized.ok, false);
		assert.equal(oversized.code, "AMBER_E_POLICY_OUTCOME_SIZE_CEILING");
		assert.equal(fs.existsSync(outcomeLedgerPath(ceiling)), false);
	} finally {
		delete process.env.AMBER_POLICY_MAX_OUTCOME_BYTES;
	}
});
