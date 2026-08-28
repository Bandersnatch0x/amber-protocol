"use strict";

// F052 T1 (#255) — controlled Runner & capability registry (unit seam).
//
// Tests assert externally visible behavior: governed registration binding a
// single-use committed human Decision, the closed capability contract (no
// command text anywhere), fail-closed runner resolution (unknown / version
// drift / integrity mismatch), and tamper-evident ledger reads — every
// failure mode carries a stable AMBER_E_RUNNER_* code.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	RUNNER_REGISTRY_SCHEMA_VERSION,
	SUPPORTED_RUNNER_REGISTRY_SCHEMA_VERSIONS,
	DEFAULT_MAX_RUNNER_REGISTRY_BYTES,
	EFFECT_KINDS,
	CREDENTIAL_REQUIREMENTS,
	RUNNER_DECISION_KINDS,
	GENESIS_HASH,
	chainHash,
	registryPath,
	registerRunner,
	registerRunnerCapability,
	resolveRunner,
	showRunner,
	listRunners,
	listRunnerCapabilities,
	RUNNER_REQUEST_SCHEMA_VERSION,
	SUPPORTED_RUNNER_REQUEST_SCHEMA_VERSIONS,
	ENVIRONMENTS,
	REQUEST_STATUSES,
	RISK_LEVELS,
	RISK_POLICY_VERSION,
	EFFECT_RISK,
	requestsPath,
	submitRunnerRequest,
	authorizeRunnerRequest,
	showRunnerRequest,
	listRunnerRequests,
} = require("../../scripts/lib/core/runner-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { grantApproval } = require("../../scripts/lib/core/approval-registry");
const { writeJSONL } = require("../../scripts/lib/core/jsonl");

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-runner-${label}-`));
}

const DIGEST = `sha256:${"a".repeat(64)}`;

/** Admit one unscoped human Decision for registry authority; asserts success. */
function decisionFixture(dir, identity, opts = {}) {
	const { kind = "approval", scope = null } = opts;
	const decision = admitArtifact(dir, {
		type: "decision",
		identity,
		body: `# Decision ${identity}\n`,
		decisionKind: kind,
		principal: "alice@example.com",
		scope,
		traces: [
			{
				type: "decides",
				to: { type: "intent", identity: scope === null ? "intent/runner" : "intent/scoped" },
			},
		],
	});
	assert.equal(decision.ok, true, (decision.errors || []).join("; "));
}

/** Principals + decision anchors every registration test needs. */
function registryFixture(dir) {
	assert.equal(
		registerPrincipal(dir, { id: "alice@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, { type: "intent", identity: "intent/runner", body: "# Runner\n" }).ok,
		true,
	);
	decisionFixture(dir, "decision/runner-1");
}

function runnerInput(overrides = {}) {
	return {
		id: "runner/ci",
		version: "1.0.0",
		integrityDigest: DIGEST,
		owner: "platform-team",
		decision: { identity: "decision/runner-1", revision: 1 },
		...overrides,
	};
}

function capabilityInput(overrides = {}) {
	return {
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
		...overrides,
	};
}

test("runner constants pin the closed vocabulary and the schema contract", () => {
	assert.equal(RUNNER_REGISTRY_SCHEMA_VERSION, 1);
	assert.deepEqual(SUPPORTED_RUNNER_REGISTRY_SCHEMA_VERSIONS, [1]);
	assert.equal(DEFAULT_MAX_RUNNER_REGISTRY_BYTES, 1024 * 1024);
	assert.deepEqual(EFFECT_KINDS, [
		"read",
		"prepare",
		"diagnose",
		"write-target",
		"deploy",
		"rollback",
	]);
	assert.deepEqual(CREDENTIAL_REQUIREMENTS, ["none", "scoped"]);
	assert.deepEqual(RUNNER_DECISION_KINDS, ["acceptance", "approval"]);
});

test("runner registration is a governed, single-use-decision mutation", () => {
	const dir = mkTarget("register");
	registryFixture(dir);

	const badDigest = registerRunner(dir, runnerInput({ integrityDigest: "not-a-digest" }));
	assert.equal(badDigest.ok, false);
	assert.equal(badDigest.code, "AMBER_E_RUNNER_INVALID");

	const ghostDecision = registerRunner(
		dir,
		runnerInput({ decision: { identity: "decision/ghost", revision: 1 } }),
	);
	assert.equal(ghostDecision.code, "AMBER_E_RUNNER_INVALID");
	assert.match(ghostDecision.errors[0], /not a committed Decision/);

	decisionFixture(dir, "decision/review-only", { kind: "review" });
	const reviewOnly = registerRunner(
		dir,
		runnerInput({ decision: { identity: "decision/review-only", revision: 1 } }),
	);
	assert.equal(reviewOnly.code, "AMBER_E_RUNNER_INVALID");
	assert.match(reviewOnly.errors[0], /acceptance or approval/);

	assert.equal(
		admitArtifact(dir, {
			type: "intent",
			identity: "intent/scoped",
			body: "# S\n",
			scope: "F052",
		}).ok,
		true,
	);
	decisionFixture(dir, "decision/scoped", { scope: "F052" });
	const scoped = registerRunner(
		dir,
		runnerInput({ decision: { identity: "decision/scoped", revision: 1 } }),
	);
	assert.equal(scoped.code, "AMBER_E_RUNNER_INVALID");
	assert.match(scoped.errors[0], /repository-global/);

	const registered = registerRunner(dir, runnerInput());
	assert.equal(registered.ok, true, (registered.errors || []).join("; "));
	assert.equal(registered.record.kind, "runner");
	assert.equal(registered.record.decision.principal, "alice@example.com");

	decisionFixture(dir, "decision/runner-dup");
	const duplicate = registerRunner(
		dir,
		runnerInput({ decision: { identity: "decision/runner-dup", revision: 1 } }),
	);
	assert.equal(duplicate.code, "AMBER_E_RUNNER_EXISTS");

	const spent = registerRunner(dir, runnerInput({ version: "1.1.0" }));
	assert.equal(spent.code, "AMBER_E_RUNNER_INVALID");
	assert.match(spent.errors[0], /single-use/);

	const newVersion = registerRunner(
		dir,
		runnerInput({
			version: "1.1.0",
			integrityDigest: `sha256:${"b".repeat(64)}`,
			decision: { identity: "decision/runner-dup", revision: 1 },
		}),
	);
	assert.equal(newVersion.ok, true, (newVersion.errors || []).join("; "));
	assert.equal(listRunners(dir).length, 2);
});

test("capabilities are closed records, never command text", () => {
	const dir = mkTarget("capability");
	registryFixture(dir);
	assert.equal(registerRunner(dir, runnerInput()).ok, true);
	decisionFixture(dir, "decision/cap-1");

	const ghostRunner = registerRunnerCapability(dir, capabilityInput({ runnerId: "runner/ghost" }));
	assert.equal(ghostRunner.code, "AMBER_E_RUNNER_NOT_FOUND");

	const driftedRunner = registerRunnerCapability(dir, capabilityInput({ runnerVersion: "9.9.9" }));
	assert.equal(driftedRunner.code, "AMBER_E_RUNNER_VERSION_DRIFT");

	const commandText = registerRunnerCapability(dir, capabilityInput({ name: "rm -rf /" }));
	assert.equal(commandText.code, "AMBER_E_RUNNER_INVALID");
	assert.match(commandText.errors[0], /never command text/);

	const freeEffect = registerRunnerCapability(dir, capabilityInput({ effects: ["format-disk"] }));
	assert.equal(freeEffect.code, "AMBER_E_RUNNER_INVALID");
	assert.match(freeEffect.errors[0], /unregistered effect/);

	const repeatedEffect = registerRunnerCapability(
		dir,
		capabilityInput({ effects: ["deploy", "deploy"] }),
	);
	assert.equal(repeatedEffect.code, "AMBER_E_RUNNER_INVALID");

	const badCredential = registerRunnerCapability(
		dir,
		capabilityInput({ credentialRequirement: "standing" }),
	);
	assert.equal(badCredential.code, "AMBER_E_RUNNER_INVALID");

	const badTimeout = registerRunnerCapability(dir, capabilityInput({ timeoutMsMax: 0 }));
	assert.equal(badTimeout.code, "AMBER_E_RUNNER_INVALID");

	const registered = registerRunnerCapability(dir, capabilityInput());
	assert.equal(registered.ok, true, (registered.errors || []).join("; "));
	assert.equal(registered.record.kind, "capability");

	decisionFixture(dir, "decision/cap-dup");
	const duplicate = registerRunnerCapability(
		dir,
		capabilityInput({ decision: { identity: "decision/cap-dup", revision: 1 } }),
	);
	assert.equal(duplicate.code, "AMBER_E_RUNNER_CAPABILITY_EXISTS");

	decisionFixture(dir, "decision/runner-2");
	assert.equal(
		registerRunner(
			dir,
			runnerInput({
				version: "2.0.0",
				decision: { identity: "decision/runner-2", revision: 1 },
			}),
		).ok,
		true,
	);
	decisionFixture(dir, "decision/cap-v2");
	const perVersionSet = registerRunnerCapability(
		dir,
		capabilityInput({
			runnerVersion: "2.0.0",
			decision: { identity: "decision/cap-v2", revision: 1 },
		}),
	);
	assert.equal(perVersionSet.ok, true, (perVersionSet.errors || []).join("; "));

	const spentAcrossKinds = registerRunner(
		dir,
		runnerInput({ version: "3.0.0", decision: { identity: "decision/cap-1", revision: 1 } }),
	);
	assert.equal(spentAcrossKinds.code, "AMBER_E_RUNNER_INVALID");
	assert.match(spentAcrossKinds.errors[0], /single-use/);

	assert.equal(listRunnerCapabilities(dir, { runnerId: "runner/ci" }).length, 2);
	assert.equal(listRunnerCapabilities(dir, { runnerId: "runner/other" }).length, 0);
});

test("runner resolution fails closed on unknown identity, drift, and integrity", () => {
	const dir = mkTarget("resolve");
	registryFixture(dir);
	assert.equal(registerRunner(dir, runnerInput()).ok, true);

	const resolved = resolveRunner(dir, {
		id: "runner/ci",
		version: "1.0.0",
		integrityDigest: DIGEST,
	});
	assert.equal(resolved.ok, true, (resolved.errors || []).join("; "));
	assert.equal(resolved.runner.owner, "platform-team");

	const unknown = resolveRunner(dir, {
		id: "runner/ghost",
		version: "1.0.0",
		integrityDigest: DIGEST,
	});
	assert.equal(unknown.code, "AMBER_E_RUNNER_NOT_FOUND");

	const drift = resolveRunner(dir, {
		id: "runner/ci",
		version: "9.9.9",
		integrityDigest: DIGEST,
	});
	assert.equal(drift.code, "AMBER_E_RUNNER_VERSION_DRIFT");

	const integrity = resolveRunner(dir, {
		id: "runner/ci",
		version: "1.0.0",
		integrityDigest: `sha256:${"c".repeat(64)}`,
	});
	assert.equal(integrity.code, "AMBER_E_RUNNER_INTEGRITY_MISMATCH");

	const invalid = resolveRunner(dir, { id: "runner/ci" });
	assert.equal(invalid.code, "AMBER_E_RUNNER_INVALID");

	const shown = showRunner(dir, "runner/ci");
	assert.deepEqual(shown.versions, ["1.0.0"]);
	assert.equal(showRunner(dir, "runner/ghost"), null);
});

test("tampered runner registry fails every read closed", () => {
	const dir = mkTarget("tamper");
	registryFixture(dir);
	assert.equal(registerRunner(dir, runnerInput()).ok, true);
	const event = JSON.parse(fs.readFileSync(registryPath(dir), "utf8"));
	event.owner = "edited-team";
	writeJSONL(registryPath(dir), [event]);
	assert.throws(
		() => listRunners(dir),
		(err) => err.amberCode === "AMBER_E_RUNNER_REGISTRY_CORRUPT",
	);

	const orphanDir = mkTarget("tamper-orphan");
	const body = {
		kind: "capability",
		schemaVersion: RUNNER_REGISTRY_SCHEMA_VERSION,
		at: "2026-08-28T00:00:00.000Z",
		runnerId: "runner/ghost",
		runnerVersion: "1.0.0",
		name: "deploy.web",
		capabilityVersion: "1",
		effects: ["deploy"],
		pathPrefixes: null,
		timeoutMsMax: 1000,
		credentialRequirement: "none",
		rollback: "none",
		decision: {
			identity: "decision/x",
			revision: 1,
			decisionKind: "approval",
			principal: "alice@example.com",
		},
	};
	writeJSONL(registryPath(orphanDir), [
		{ ...body, prevHash: GENESIS_HASH, hash: chainHash(body, GENESIS_HASH) },
	]);
	assert.throws(
		() => listRunners(orphanDir),
		(err) =>
			err.amberCode === "AMBER_E_RUNNER_REGISTRY_CORRUPT" && /unknown runner/.test(err.message),
	);
});

// ── F052 T2 (#256): execution requests & policy-derived risk ──

const NOW = new Date("2026-08-28T00:00:00.000Z");

/** Registered runner + capability + a second principal for approvals. */
function requestFixture(dir) {
	registryFixture(dir);
	assert.equal(registerPrincipal(dir, { id: "bob@example.com", principalKind: "human" }).ok, true);
	assert.equal(registerRunner(dir, runnerInput()).ok, true);
	decisionFixture(dir, "decision/cap-1");
	assert.equal(registerRunnerCapability(dir, capabilityInput()).ok, true);
}

function requestInput(overrides = {}) {
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
		inputHashes: [DIGEST],
		timeoutMs: 300_000,
		effects: ["deploy"],
		credentialRequirement: "scoped",
		rollback: "runbook/staging-rollback",
		...overrides,
	};
}

/** Grant one approval whose subject is the request's binding; asserts ok. */
function approvalFixture(dir, id, subject) {
	const granted = grantApproval(
		dir,
		{
			id,
			approver: "bob@example.com",
			scope: null,
			subject,
			validUntil: "2027-01-01T00:00:00.000Z",
		},
		{ now: NOW },
	);
	assert.equal(granted.ok, true, (granted.errors || []).join("; "));
}

function authorizeInput(requestHash, overrides = {}) {
	return {
		requestHash,
		approval: "approval/req-1",
		decisionIdentity: "decision/req-1",
		body: "# Authorize request\n",
		traces: [{ type: "decides", to: { type: "intent", identity: "intent/runner" } }],
		scope: null,
		...overrides,
	};
}

test("request constants pin the environments and the risk policy", () => {
	assert.equal(RUNNER_REQUEST_SCHEMA_VERSION, 1);
	assert.deepEqual(SUPPORTED_RUNNER_REQUEST_SCHEMA_VERSIONS, [1]);
	assert.deepEqual(ENVIRONMENTS, ["development", "staging", "production"]);
	assert.deepEqual(REQUEST_STATUSES, ["requested", "authorized", "denied"]);
	assert.deepEqual(RISK_LEVELS, ["low", "medium", "high"]);
	assert.equal(RISK_POLICY_VERSION, 1);
	assert.deepEqual(EFFECT_RISK, {
		read: "low",
		prepare: "low",
		diagnose: "low",
		"write-target": "medium",
		deploy: "high",
		rollback: "high",
	});
});

test("a request derives its risk from capability facts, never from the caller", () => {
	const dir = mkTarget("request");
	requestFixture(dir);

	const withRisk = submitRunnerRequest(dir, requestInput({ risk: "low" }));
	assert.equal(withRisk.ok, false);
	assert.equal(withRisk.code, "AMBER_E_RUNNER_REQUEST_INVALID");
	assert.match(withRisk.errors[0], /unknown field/);

	const submitted = submitRunnerRequest(dir, requestInput(), { now: NOW });
	assert.equal(submitted.ok, true, (submitted.errors || []).join("; "));
	assert.equal(submitted.record.status, "requested");
	assert.equal(submitted.record.risk, "high");
	assert.equal(submitted.record.riskPolicyVersion, RISK_POLICY_VERSION);
	assert.match(submitted.record.requestHash, /^sha256:[0-9a-f]{64}$/);
	assert.equal(
		submitted.record.approvalBinding,
		`runner-request:staging:${submitted.record.requestHash}`,
	);

	const duplicate = submitRunnerRequest(dir, requestInput(), { now: NOW });
	assert.equal(duplicate.code, "AMBER_E_RUNNER_REQUEST_EXISTS");

	const ghostCapability = submitRunnerRequest(
		dir,
		requestInput({
			capability: {
				runnerId: "runner/ci",
				runnerVersion: "1.0.0",
				name: "deploy.ghost",
				capabilityVersion: "1",
			},
		}),
	);
	assert.equal(ghostCapability.code, "AMBER_E_RUNNER_CAPABILITY_NOT_FOUND");
	assert.equal(ghostCapability.record.status, "denied");
	assert.match(ghostCapability.record.reason, /not registered/);

	// Requesting a SUBSET of a capability's effects never lowers the risk
	// class: the registered effect set is the authority the request draws
	// on. deploy.staging-probe declares read+deploy; a read-only request
	// against it is still deploy-class.
	decisionFixture(dir, "decision/cap-probe");
	assert.equal(
		registerRunnerCapability(
			dir,
			capabilityInput({
				name: "deploy.staging-probe",
				effects: ["read", "deploy"],
				decision: { identity: "decision/cap-probe", revision: 1 },
			}),
		).ok,
		true,
	);
	const subset = submitRunnerRequest(
		dir,
		requestInput({
			capability: {
				runnerId: "runner/ci",
				runnerVersion: "1.0.0",
				name: "deploy.staging-probe",
				capabilityVersion: "1",
			},
			effects: ["read"],
		}),
		{ now: NOW },
	);
	assert.equal(subset.ok, true, (subset.errors || []).join("; "));
	assert.equal(subset.record.risk, "high");

	assert.equal(showRunnerRequest(dir, submitted.record.requestHash).status, "requested");
	assert.equal(showRunnerRequest(dir, `sha256:${"f".repeat(64)}`), null);
	assert.equal(listRunnerRequests(dir, { status: "denied" }).length, 1);
});

test("widening the registered capability is a recorded denial, not silence", () => {
	const dir = mkTarget("request-denied");
	requestFixture(dir);

	const widened = submitRunnerRequest(dir, requestInput({ effects: ["deploy", "write-target"] }));
	assert.equal(widened.ok, false);
	assert.equal(widened.code, "AMBER_E_RUNNER_REQUEST_DENIED");
	assert.equal(widened.record.status, "denied");
	assert.match(widened.record.reason, /does not declare/);

	const slower = submitRunnerRequest(dir, requestInput({ timeoutMs: 600_001 }));
	assert.equal(slower.code, "AMBER_E_RUNNER_REQUEST_DENIED");
	assert.match(slower.record.reason, /exceeds the registered capability bound/);

	const credential = submitRunnerRequest(dir, requestInput({ credentialRequirement: "none" }));
	assert.equal(credential.code, "AMBER_E_RUNNER_REQUEST_DENIED");
	assert.match(credential.record.reason, /does not match/);

	const escape = submitRunnerRequest(
		dir,
		requestInput({ target: { repository: "repo/main", paths: ["deploy/staging/../../etc"] } }),
	);
	assert.equal(escape.code, "AMBER_E_RUNNER_REQUEST_DENIED");
	assert.match(escape.record.reason, /outside the registered path prefixes/);

	const denials = listRunnerRequests(dir, { status: "denied" });
	assert.equal(denials.length, 4);
	assert.equal(listRunnerRequests(dir).length, 4);
});

test("authorization consumes a single-use approval bound to hash and environment", () => {
	const dir = mkTarget("authorize");
	requestFixture(dir);
	const submitted = submitRunnerRequest(dir, requestInput(), { now: NOW });
	assert.equal(submitted.ok, true, (submitted.errors || []).join("; "));
	const hash = submitted.record.requestHash;

	const ghost = authorizeRunnerRequest(dir, authorizeInput(`sha256:${"f".repeat(64)}`), {
		now: NOW,
	});
	assert.equal(ghost.code, "AMBER_E_RUNNER_REQUEST_NOT_FOUND");

	const noApproval = authorizeRunnerRequest(dir, authorizeInput(hash), { now: NOW });
	assert.equal(noApproval.code, "AMBER_E_RUNNER_REQUEST_APPROVAL_MISMATCH");

	approvalFixture(dir, "approval/other", "spec/login@2");
	const mismatch = authorizeRunnerRequest(
		dir,
		authorizeInput(hash, { approval: "approval/other" }),
		{ now: NOW },
	);
	assert.equal(mismatch.code, "AMBER_E_RUNNER_REQUEST_APPROVAL_MISMATCH");
	assert.match(mismatch.errors[0], /one authorization binds one request hash and environment/);

	approvalFixture(dir, "approval/req-1", submitted.record.approvalBinding);
	const authorized = authorizeRunnerRequest(dir, authorizeInput(hash), { now: NOW });
	assert.equal(authorized.ok, true, (authorized.errors || []).join("; "));
	assert.equal(authorized.record.status, "authorized");
	assert.equal(authorized.record.authorization.approvalId, "approval/req-1");
	assert.equal(authorized.record.authorization.decision.identity, "decision/req-1");
	assert.equal(
		authorized.record.authorization.decision.revision,
		authorized.consumption.receipt.revision,
	);

	const replay = authorizeRunnerRequest(
		dir,
		authorizeInput(hash, { decisionIdentity: "decision/req-2" }),
		{ now: NOW },
	);
	assert.equal(replay.code, "AMBER_E_RUNNER_REQUEST_EXISTS");
	assert.match(replay.errors[0], /single-use/);
});

test("a stale risk policy version fails authorization closed", () => {
	const dir = mkTarget("request-drift");
	requestFixture(dir);
	const submitted = submitRunnerRequest(dir, requestInput(), { now: NOW });
	assert.equal(submitted.ok, true);
	const hash = submitted.record.requestHash;

	// Rebuild the single requested event as if a different policy version
	// had classified it: authorization must refuse stale authority.
	const event = JSON.parse(fs.readFileSync(requestsPath(dir), "utf8"));
	const { prevHash: _prev, hash: _hash, ...body } = event;
	const stale = { ...body, riskPolicyVersion: RISK_POLICY_VERSION + 1 };
	writeJSONL(requestsPath(dir), [
		{ ...stale, prevHash: GENESIS_HASH, hash: chainHash(stale, GENESIS_HASH) },
	]);

	approvalFixture(dir, "approval/req-1", submitted.record.approvalBinding);
	const drifted = authorizeRunnerRequest(dir, authorizeInput(hash), { now: NOW });
	assert.equal(drifted.ok, false);
	assert.equal(drifted.code, "AMBER_E_RUNNER_REQUEST_DRIFT");
	assert.match(drifted.errors[0], /policy version/);
});

test("tampered request ledger fails every read closed", () => {
	const dir = mkTarget("request-tamper");
	requestFixture(dir);
	assert.equal(submitRunnerRequest(dir, requestInput(), { now: NOW }).ok, true);
	const event = JSON.parse(fs.readFileSync(requestsPath(dir), "utf8"));
	event.risk = "low";
	writeJSONL(requestsPath(dir), [event]);
	assert.throws(
		() => listRunnerRequests(dir),
		(err) => err.amberCode === "AMBER_E_RUNNER_REQUEST_CORRUPT",
	);
});
