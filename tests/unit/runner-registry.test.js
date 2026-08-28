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
} = require("../../scripts/lib/core/runner-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
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
