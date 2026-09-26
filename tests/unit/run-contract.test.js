"use strict";

// Trusted-control run contract (docs/specs/trusted-control-run-contract.md) —
// the spec §10 testing decisions exercised at the public seams (ledger folds
// and the session run/grant outcomes), per the implementation plan's slices.
// Red-first fixtures: every governed execution below is a real named-command
// run in a real git worktree against a real rules.json — no in-memory claims.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");

const stageRunner = require("../../scripts/lib/session-stage-runner");
const { runSessionStage, grantSessionExecution, attemptStatusOf } = stageRunner;
const { runGovernedCommand } = require("../../scripts/lib/core/governed-runner");
const { appendLedgerRecord, readLedger } = require("../../scripts/lib/core/loop-ledger");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const {
	registerRunner,
	registerRunnerCapability,
	resolveRequestCapability,
} = require("../../scripts/lib/core/runner-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { loadPolicyRules } = require("../../scripts/lib/core/loop-policy");
const handoffBundle = require("../../scripts/lib/core/handoff-bundle");
const {
	attemptMetricsOf,
	capabilityHashOf,
	inputDigestOf,
	parseCapabilityPin,
	policyHashOf,
	runIdOf,
	scopeHashOf,
} = require("../../scripts/lib/core/run-freeze");

const PIN = "runner/ci@1.0.0#diagnose.check@1";
const COMMAND_ID = "diagnose.check";
const RUNNER_DIGEST = `sha256:${"a".repeat(64)}`;
const TOKEN_HASH = crypto.createHash("sha256").update("opaque-token").digest("hex");

function rulesObject(rule) {
	return {
		schemaVersion: 1,
		defaultAction: "deny",
		confidence_gating: {
			enabled: true,
			byRule: { [rule.id]: "high" },
			defaultConfidence: "low",
		},
		rules: [rule],
	};
}

const ALLOW_RULE = {
	id: COMMAND_ID,
	action: "allow",
	match: "exact",
	pattern: "node --version",
};

function makeGitTarget({ rule = ALLOW_RULE } = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-run-contract-"));
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
	execFileSync("git", ["config", "user.name", "Amber test"], { cwd: root });
	fs.writeFileSync(path.join(root, ".gitignore"), ".amber/\n");
	fs.writeFileSync(path.join(root, "fixture.txt"), "fixture\n");
	execFileSync("git", ["add", "."], { cwd: root });
	execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
	fs.mkdirSync(path.join(root, ".amber", "governance"), { recursive: true });
	fs.writeFileSync(
		path.join(root, ".amber", "governance", "rules.json"),
		JSON.stringify(rulesObject(rule)),
	);

	registerPrincipal(root, { id: "alice@example.com", principalKind: "human" });
	registerPrincipal(root, { id: "agent-a", principalKind: "service" });
	admitArtifact(root, { type: "intent", identity: "intent/runner", body: "# Runner\n" });
	const decide = (identity) =>
		admitArtifact(root, {
			type: "decision",
			identity,
			body: `# ${identity}\n`,
			decisionKind: "approval",
			principal: "alice@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/runner" } }],
		});
	decide("decision/runner");
	registerRunner(root, {
		id: "runner/ci",
		version: "1.0.0",
		integrityDigest: RUNNER_DIGEST,
		owner: "platform-team",
		decision: { identity: "decision/runner", revision: 1 },
	});
	decide("decision/capability");
	registerRunnerCapability(root, {
		runnerId: "runner/ci",
		runnerVersion: "1.0.0",
		name: COMMAND_ID,
		capabilityVersion: "1",
		effects: ["diagnose"],
		pathPrefixes: null,
		timeoutMsMax: 1000,
		credentialRequirement: "none",
		rollback: "none",
		decision: { identity: "decision/capability", revision: 1 },
	});

	const routesDir = path.join(root, "routes");
	fs.mkdirSync(routesDir, { recursive: true });
	fs.writeFileSync(
		path.join(routesDir, "probe.route.json"),
		JSON.stringify({
			schemaVersion: "1.0.0",
			routeId: "probe",
			version: "1.0.0",
			description: "probe route",
			stages: [{ name: "check", type: "verb", target: PIN }],
		}),
	);

	const sessionDir = path.join(root, ".amber", "sessions", "s1");
	fs.mkdirSync(sessionDir, { recursive: true });
	fs.writeFileSync(
		path.join(sessionDir, "manifest.json"),
		JSON.stringify({
			sessionId: "s1",
			schemaVersion: "1.0.0-rc.1",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			route: { id: "probe", version: "1.0.0" },
			goal: "probe",
			status: "executing",
			completedStages: [],
			lease: {
				ownerId: "agent-a",
				tokenHash: TOKEN_HASH,
				acquiredAt: new Date().toISOString(),
				expiresAt: new Date(Date.now() + 120000).toISOString(),
				ttlMs: 120000,
				fence: 1,
			},
		}),
	);
	return { root, sessionDir };
}

const CLAIM = { ownerId: "agent-a", tokenHash: TOKEN_HASH, leaseFence: 1 };
const BOUNDED = {
	capabilityPin: PIN,
	providerClass: "bounded-command",
	adapterId: "governed-runner",
	adapterVersion: "1",
};

function ledgerRecords(sessionDir) {
	return readLedger(path.join(sessionDir, "ledger.jsonl"));
}

function recordsOfKind(sessionDir, kind) {
	return ledgerRecords(sessionDir).filter((record) => record.kind === kind);
}

// The REAL frozen binding values for the fixture target — recomputed from the
// same sources capture uses, so each drift test tampers exactly one field.
function realFrozen(target, { stageName = "check", attemptNumber = 1, fence = 1 } = {}) {
	const rules = loadPolicyRules(target);
	const resolution = resolveRequestCapability(target, parseCapabilityPin(PIN));
	if (!resolution.ok) throw new Error(resolution.errors.join("; "));
	return {
		scopeHash: "0".repeat(64),
		policyHash: policyHashOf(rules),
		capabilityHash: capabilityHashOf([resolution.capability]),
		attemptIdentity: {
			capabilityPin: PIN,
			routeHash: "route-hash",
			stageName,
			attemptNumber,
			fence,
		},
		resolvedCommand: "node --version",
	};
}

function frozenBinding(real, overrides = {}) {
	const attemptIdentity = { ...real.attemptIdentity, ...(overrides.attemptIdentity ?? {}) };
	const resolvedCommand = overrides.resolvedCommand ?? real.resolvedCommand;
	return {
		scopeHash: overrides.scopeHash ?? real.scopeHash,
		policyHash: overrides.policyHash ?? real.policyHash,
		capabilityHash: overrides.capabilityHash ?? real.capabilityHash,
		inputDigest:
			overrides.inputDigest ??
			inputDigestOf({
				resolvedCommand,
				argv: resolvedCommand === null ? null : [],
				...attemptIdentity,
			}),
		attemptIdentity,
	};
}

// ── spec §10 test 1: identity ──

describe("run contract — identity (spec §10.1)", () => {
	it("runId derives losslessly from the full (sessionId, attemptId) tuple", async () => {
		const sessionId = "a".repeat(8) + "-1111-2222-3333-444444444444";
		const attemptOne = "b".repeat(8) + "-aaaa-bbbb-cccc-dddddddddddd";
		const attemptTwo = "b".repeat(8) + "-aaaa-bbbb-cccc-ddddddddddde";
		const one = runIdOf(sessionId, attemptOne);
		const two = runIdOf(sessionId, attemptTwo);
		assert.notStrictEqual(one, two, "same-prefix UUIDs never collide");
		assert.strictEqual(one, `run-${sessionId}-${attemptOne}`, "recomputable offline");
	});
});

// ── spec §10 tests 2 + 5 + 9: frozen capture, order sensitivity, binding ──

describe("run contract — frozen admission record (spec §10.2, §10.5, §10.9)", () => {
	it("capture freezes values + hashes and survives source-object mutation", async () => {
		stageRunner._setAdapterTableForTest([BOUNDED]);
		try {
			const { root, sessionDir } = makeGitTarget();
			const outcome = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			assert.strictEqual(outcome.awaitingAuthorization, true);
			const stored = recordsOfKind(sessionDir, "stage_attempt_requested")[0];

			// The frozen record is complete: closed six-field scopeInputs, the
			// evaluated request, the full rules object, the pinned capability
			// record, and the layered hashes with the native inputDigest filled.
			assert.ok(stored.frozen, "the attempt froze its admission inputs");
			assert.deepStrictEqual(Object.keys(stored.frozen.scopeInputs).sort(), [
				"capabilities",
				"constraints",
				"context_scope",
				"expiration",
				"side_effect_policy",
				"targets",
			]);
			assert.strictEqual(stored.frozen.scopeInputs.constraints, null);
			assert.strictEqual(stored.frozen.scopeInputs.context_scope, null);
			assert.strictEqual(stored.frozen.evaluatedRequest.resolvedCommand, "node --version");
			assert.deepStrictEqual(stored.frozen.evaluatedRequest.argv, []);
			assert.strictEqual(stored.frozen.policy.rules[0].id, COMMAND_ID);
			assert.strictEqual(stored.frozen.capabilityRecords[0].name, COMMAND_ID);
			assert.strictEqual(stored.frozen.capabilityRecords[0].timeoutMsMax, 1000);
			assert.match(stored.inputDigest, /^[0-9a-f]{64}$/);
			// contextHash is the referenced Loadout hash — no Loadout is wired to
			// sessions yet, so capture records the honest null (R-FR-4).
			assert.strictEqual(stored.frozen.hashes.contextHash, null);
			for (const hash of [
				"scopeHash",
				"policyHash",
				"capabilityHash",
				"executionProfileHash",
				"contractHash",
			]) {
				assert.match(stored.frozen.hashes[hash], /^[0-9a-f]{64}$/);
			}
			// Layer-0 value-hash consistency: the stored hashes recompute from
			// the stored values (R-RP-1's verification, pre-proved at capture).
			assert.strictEqual(scopeHashOf(stored.frozen.scopeInputs), stored.frozen.hashes.scopeHash);
			assert.strictEqual(policyHashOf(stored.frozen.policy), stored.frozen.hashes.policyHash);

			// R-FR-2: later mutation of caller/source objects cannot change the
			// captured snapshot — the ledger is the only authority (R-FR-1).
			stored.frozen.scopeInputs.capabilities.push("runner/evil@9.9.9#x@9");
			stored.frozen.policy.defaultAction = "allow";
			const reread = recordsOfKind(sessionDir, "stage_attempt_requested")[0];
			assert.deepStrictEqual(reread.frozen.scopeInputs.capabilities, [PIN]);
			assert.strictEqual(reread.frozen.policy.defaultAction, "deny");
		} finally {
			stageRunner._restoreAdapterTableForTest();
		}
	});

	it("sequence-sensitive arrays change the hash; set-like fields do not (§10.5)", async () => {
		const ruleOne = { id: "a", action: "allow", match: "exact", pattern: "node --version" };
		const ruleTwo = { id: "b", action: "deny", match: "exact", pattern: "rm -rf /" };
		const ordered = { defaultAction: "deny", rules: [ruleOne, ruleTwo] };
		const reordered = { defaultAction: "deny", rules: [ruleTwo, ruleOne] };
		assert.notStrictEqual(
			policyHashOf(ordered),
			policyHashOf(reordered),
			"reordering a sequence-sensitive array changes the hash",
		);
		const scopeInputs = {
			capabilities: [PIN, "runner/other@1.0.0#x@1"],
			targets: ["docs/", "src/"],
		};
		const flipped = {
			capabilities: ["runner/other@1.0.0#x@1", PIN],
			targets: ["src/", "docs/"],
		};
		assert.strictEqual(
			scopeHashOf(scopeInputs),
			scopeHashOf(flipped),
			"reordering a set-like field never changes the hash",
		);
	});

	it("two different requests under the same rules produce different inputDigests (§10.9)", async () => {
		const identity = {
			capabilityPin: PIN,
			routeHash: "route-hash",
			stageName: "check",
			attemptNumber: 1,
			fence: 1,
		};
		const one = inputDigestOf({ resolvedCommand: "node --version", argv: [], ...identity });
		const two = inputDigestOf({ resolvedCommand: "node -v", argv: [], ...identity });
		assert.notStrictEqual(one, two, "different commands never share a digest");
		assert.strictEqual(
			one,
			inputDigestOf({ resolvedCommand: "node --version", argv: [], ...identity }),
			"an identical request reproduces the digest",
		);
		assert.notStrictEqual(
			inputDigestOf({ resolvedCommand: "cmd", argv: ["-a", "-b"], ...identity }),
			inputDigestOf({ resolvedCommand: "cmd", argv: ["-b", "-a"], ...identity }),
			"argv order is sequence-sensitive (R-HA-2)",
		);
	});
});

// ── spec §10 tests 7 + 10: capture-first, grant binding, in-band execution ──

describe("run contract — capture → grant → execute (spec §10.7, §10.10)", () => {
	it("a captured attempt with no eligible grant awaits authorization and executes nothing", async () => {
		stageRunner._setAdapterTableForTest([BOUNDED]);
		try {
			const { root, sessionDir } = makeGitTarget();
			const outcome = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			assert.strictEqual(outcome.awaitingAuthorization, true);
			assert.strictEqual(recordsOfKind(sessionDir, "attempt_admitted").length, 0);
			assert.strictEqual(recordsOfKind(sessionDir, "attempt_denied").length, 0);
			assert.strictEqual(recordsOfKind(sessionDir, "stage_attempt_settled").length, 0);
			assert.strictEqual(recordsOfKind(sessionDir, "executed").length, 0);

			// Re-running does not fork: the same open capture is projected again
			// (R-ID-5 duplicate key / R-ID-6 resume of the same attempt window).
			const again = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			assert.strictEqual(again.awaitingAuthorization, true);
			assert.strictEqual(again.request.attemptId, outcome.request.attemptId);
			assert.strictEqual(recordsOfKind(sessionDir, "stage_attempt_requested").length, 1);
			assert.strictEqual(attemptStatusOf(ledgerRecords(sessionDir), outcome.request), "requested");
		} finally {
			stageRunner._restoreAdapterTableForTest();
		}
	});

	it("a grant naming a non-existent attemptId is refused (§10.10)", async () => {
		const { root } = makeGitTarget();
		const refused = grantSessionExecution(root, "s1", {
			attemptId: "00000000-0000-4000-8000-000000000000",
		});
		assert.strictEqual(refused.success, false);
		assert.match(refused.message, /binds an attempt the ledger already captured/);
	});

	it("after a bound grant the SAME attempt passes gates, executes, and settles (§10.10)", async () => {
		stageRunner._setAdapterTableForTest([BOUNDED]);
		try {
			const { root, sessionDir } = makeGitTarget();
			const capture = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			assert.strictEqual(capture.awaitingAuthorization, true);

			const granted = grantSessionExecution(root, "s1", {
				attemptId: capture.request.attemptId,
				grantedBy: "alice@example.com",
			});
			assert.strictEqual(granted.success, true, JSON.stringify(granted));
			assert.strictEqual(granted.grant.boundAttemptId, capture.request.attemptId);
			assert.strictEqual(granted.grant.scopeHash, capture.request.frozen.hashes.scopeHash);
			assert.strictEqual(granted.grant.policyVersion, capture.request.frozen.hashes.policyHash);
			assert.strictEqual(
				granted.grant.capabilityHash,
				capture.request.frozen.hashes.capabilityHash,
			);

			const executed = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			assert.strictEqual(executed.success, true, JSON.stringify(executed));
			assert.strictEqual(
				executed.request.attemptId,
				capture.request.attemptId,
				"the granted attempt executes, not a fork",
			);
			assert.strictEqual(executed.settled, true);
			assert.strictEqual(executed.settlement.status, "succeeded");

			// The ledger tells the whole story: requested → approved →
			// policy.evaluated (the §6.5 assertive-redundancy fact, whose
			// policyHash equals the frozen value by construction) → executed →
			// attempt_admitted (the admission outcome event, recording that
			// verdict) → settled → completed. The admission event always
			// precedes the settlement, so "only an admitted attempt settles"
			// holds by fold (R-AD-2).
			const kinds = ledgerRecords(sessionDir).map((record) => record.kind);
			assert.deepStrictEqual(kinds, [
				"stage_attempt_requested",
				"approved",
				"policy.evaluated",
				"executed",
				"attempt_admitted",
				"stage_attempt_settled",
				"stage_completed",
			]);
			// R-AD-4: the recorded policyHash equals the attempt's frozen value.
			const evaluated = ledgerRecords(sessionDir).find(
				(record) => record.kind === "policy.evaluated",
			);
			assert.strictEqual(evaluated.policyHash, capture.request.frozen.hashes.policyHash);
			assert.strictEqual(evaluated.scopeHash, capture.request.frozen.hashes.scopeHash);
			const admitted = recordsOfKind(sessionDir, "attempt_admitted")[0];
			assert.strictEqual(admitted.requestId, capture.request.requestId);
			assert.strictEqual(admitted.policyVerdict.matchedRule, COMMAND_ID);
			assert.strictEqual(attemptStatusOf(ledgerRecords(sessionDir), capture.request), "settled");
		} finally {
			stageRunner._restoreAdapterTableForTest();
		}
	});
});

// ── spec §10 tests 3 + 6: gate-time drift refuses pre-effect ──

describe("run contract — pre-effect gate verification (spec §10.3, §10.6)", () => {
	function grantedLedger(target, grant = {}) {
		const ledgerPath = path.join(target, ".amber", "sessions", "s1", "ledger.jsonl");
		appendLedgerRecord(ledgerPath, {
			kind: "approved",
			approvalKey: "s1:approval",
			...grant,
		});
		return ledgerPath;
	}

	async function runAgainst(target, frozen, ledgerPath) {
		return await runGovernedCommand({
			target,
			commandId: COMMAND_ID,
			capabilityPin: PIN,
			attemptId: "att-1",
			producer: "agent-a",
			evidenceId: "evidence/s1/att-1",
			ledgerPath,
			label: "s1:check",
			frozen,
			// The session capture supplies the join keys as subject context
			// (Slice 4); the direct governed call passes the same shape.
			subject: { runId: runIdOf("s1", "att-1"), scopeHash: frozen.scopeHash },
		});
	}

	function denialRecords(ledgerPath) {
		return readLedger(ledgerPath).filter((record) => record.kind === "denied");
	}

	it("gate-time policy drift refuses before evaluation and leaves the approval unconsumed (§10.6)", async () => {
		const { root: target } = makeGitTarget();
		// The capture froze the fixture rules; the rules have since changed.
		fs.writeFileSync(
			path.join(target, ".amber", "governance", "rules.json"),
			JSON.stringify({ ...rulesObject(ALLOW_RULE), defaultAction: "allow" }),
		);
		const real = realFrozen(target);
		const frozen = frozenBinding({ ...real, policyHash: policyHashOf(rulesObject(ALLOW_RULE)) });
		const ledgerPath = grantedLedger(target);
		const outcome = await runAgainst(target, frozen, ledgerPath);
		assert.strictEqual(outcome.refusal, "policy-drift");
		assert.strictEqual(outcome.executed, undefined);
		assert.strictEqual(denialRecords(ledgerPath)[0].refusal, "policy-drift");
		assert.strictEqual(
			readLedger(ledgerPath).filter((record) => record.kind === "executed").length,
			0,
			"nothing executed",
		);
		fs.rmSync(target, { recursive: true, force: true });
	});

	it("a capability-drift grant is refused at the gate (§10.3)", async () => {
		const { root: target } = makeGitTarget();
		const real = realFrozen(target);
		const frozen = frozenBinding(real, { capabilityHash: "f".repeat(64) });
		const ledgerPath = grantedLedger(target, {
			scopeHash: frozen.scopeHash,
			policyVersion: frozen.policyHash,
			capabilityHash: frozen.capabilityHash,
			boundAttemptId: "att-1",
		});
		const outcome = await runAgainst(target, frozen, ledgerPath);
		assert.strictEqual(outcome.refusal, "capability-drift");
		assert.strictEqual(denialRecords(ledgerPath)[0].refusal, "capability-drift");
		fs.rmSync(target, { recursive: true, force: true });
	});

	it("an attempt never executes on a grant bound to a different attempt (§10.3, R-AU-3.5)", async () => {
		const { root: target } = makeGitTarget();
		const real = realFrozen(target);
		const frozen = frozenBinding(real);
		const ledgerPath = grantedLedger(target, {
			scopeHash: frozen.scopeHash,
			policyVersion: frozen.policyHash,
			capabilityHash: frozen.capabilityHash,
			boundAttemptId: "att-other",
		});
		const outcome = await runAgainst(target, frozen, ledgerPath);
		// The mutual binding is enforced by selection: the grant bound to
		// att-other is not this attempt's grant, so the gate finds no eligible
		// approval and refuses — the foreign grant is never consumed and the
		// two attempts never silently share it.
		assert.strictEqual(outcome.executed, undefined);
		assert.match(outcome.errors.join(" "), /No unconsumed approval/);
		assert.strictEqual(readLedger(ledgerPath).filter((r) => r.kind === "executed").length, 0);
		fs.rmSync(target, { recursive: true, force: true });
	});

	it("a scope-drifted grant refuses before consumption (R-AU-3.2)", async () => {
		const { root: target } = makeGitTarget();
		const real = realFrozen(target);
		const frozen = frozenBinding(real, { scopeHash: "1".repeat(64) });
		const ledgerPath = grantedLedger(target, {
			scopeHash: "2".repeat(64),
			policyVersion: frozen.policyHash,
			capabilityHash: frozen.capabilityHash,
			boundAttemptId: "att-1",
		});
		const outcome = await runAgainst(target, frozen, ledgerPath);
		assert.strictEqual(outcome.refusal, "scope-drift");
		fs.rmSync(target, { recursive: true, force: true });
	});

	it("a request whose resolved command no longer hashes to the frozen inputDigest refuses (§10.9)", async () => {
		const { root: target } = makeGitTarget();
		const real = realFrozen(target);
		const frozen = frozenBinding(real, { resolvedCommand: "node -v" });
		const ledgerPath = grantedLedger(target);
		const outcome = await runAgainst(target, frozen, ledgerPath);
		assert.strictEqual(outcome.refusal, "request-drift");
		assert.strictEqual(denialRecords(ledgerPath)[0].refusal, "request-drift");
		fs.rmSync(target, { recursive: true, force: true });
	});

	it("a grant whose binding matches the frozen tuple passes the gate and consumes", async () => {
		const { root: target } = makeGitTarget();
		const real = realFrozen(target);
		const frozen = frozenBinding(real);
		const ledgerPath = grantedLedger(target, {
			scopeHash: frozen.scopeHash,
			policyVersion: frozen.policyHash,
			capabilityHash: frozen.capabilityHash,
			boundAttemptId: "att-1",
		});
		const outcome = await runAgainst(target, frozen, ledgerPath);
		assert.deepEqual(outcome.errors, [], JSON.stringify(outcome));
		assert.strictEqual(outcome.executed, true);
		// Slice 4 join keys ride the receipt environment (R-RP-3).
		assert.strictEqual(outcome.evidence.environment.runId, runIdOf("s1", "att-1"));
		assert.strictEqual(outcome.evidence.environment.scopeHash, frozen.scopeHash);
		const executed = readLedger(ledgerPath).find((record) => record.kind === "executed");
		assert.ok(executed, "the grant was consumed by its execution");
		fs.rmSync(target, { recursive: true, force: true });
	});
});

// ── slices 5–7: replay slices, timeline run events, metrics fold ──

describe("run contract — replay slices (spec §10.4, §10.8; plan Slice 5)", () => {
	it("hash-only, missing-body, and tampered records are NON_REPLAYABLE (§10.4)", async () => {
		stageRunner._setAdapterTableForTest([BOUNDED]);
		try {
			const { root, sessionDir } = makeGitTarget();
			await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			const records = ledgerRecords(sessionDir);
			const request = records.find((record) => record.kind === "stage_attempt_requested");

			// Hash-only record: frozen admission inputs absent (legacy shape).
			const hashOnly = { ...request };
			delete hashOnly.frozen;
			const hashOnlySlice = handoffBundle.attemptReplaySlice(hashOnly, records);
			assert.strictEqual(hashOnlySlice.replayable, false);
			assert.match(hashOnlySlice.reason, /NON_REPLAYABLE:.*no frozen admission inputs/);

			// Tampered body: the stored values no longer hash to their hashes.
			const tampered = JSON.parse(JSON.stringify(request));
			tampered.frozen.policy.defaultAction = "allow";
			const tamperedSlice = handoffBundle.attemptReplaySlice(tampered, records);
			assert.strictEqual(tamperedSlice.replayable, false);
			assert.match(tamperedSlice.reason, /NON_REPLAYABLE: policy value-hash mismatch/);

			// Missing body pieces: evaluated request dropped.
			const missing = JSON.parse(JSON.stringify(request));
			missing.frozen.evaluatedRequest = null;
			const missingSlice = handoffBundle.attemptReplaySlice(missing, records);
			assert.strictEqual(missingSlice.replayable, false);
			assert.match(missingSlice.reason, /request value-hash mismatch/);
		} finally {
			stageRunner._restoreAdapterTableForTest();
		}
	});

	it("offline replay reproduces the recorded verdict from bundle values only (§10.8)", async () => {
		stageRunner._setAdapterTableForTest([BOUNDED]);
		try {
			const { root, sessionDir } = makeGitTarget();
			const capture = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			grantSessionExecution(root, "s1", { attemptId: capture.request.attemptId });
			const executed = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			assert.strictEqual(executed.settlement.status, "succeeded");

			const records = ledgerRecords(sessionDir);
			const request = records.find((record) => record.kind === "stage_attempt_requested");
			const slice = handoffBundle.attemptReplaySlice(request, records);
			assert.strictEqual(slice.replayable, true);

			// Replay consumes stored values with the pure seam: the working
			// copy's rules.json is deleted first, so only bundle values exist.
			fs.rmSync(path.join(root, ".amber", "governance", "rules.json"));
			const decision = handoffBundle.replayPolicyDecision(slice);
			assert.strictEqual(decision.replayable, true);
			assert.strictEqual(decision.verdict.allowed, true);
			assert.strictEqual(decision.verdict.matchedRule, COMMAND_ID);
			assert.strictEqual(decision.recordedVerdict.matchedRule, COMMAND_ID);
		} finally {
			stageRunner._restoreAdapterTableForTest();
		}
	});

	it("a truncated runId never resolves as a replay scope (R-ID-2)", async () => {
		const sessionId = "a".repeat(8) + "-1111-2222-3333-444444444444";
		const attemptId = "b".repeat(8) + "-aaaa-bbbb-cccc-dddddddddddd";
		assert.deepStrictEqual(handoffBundle.parseReplayScope("s1"), {
			sessionId: "s1",
			attemptId: null,
		});
		assert.deepStrictEqual(handoffBundle.parseReplayScope(`run-${sessionId}-${attemptId}`), {
			sessionId,
			attemptId,
		});
		assert.strictEqual(
			handoffBundle.parseReplayScope(`run-${sessionId}-${attemptId.slice(0, 8)}`),
			null,
			"a truncated display form is never an authority key",
		);
		assert.strictEqual(handoffBundle.parseReplayScope("run-not-a-tuple"), null);
	});
});

describe("run contract — timeline run events (plan Slice 6)", () => {
	it("run_started/run_completed carry the lossless derived runId", async () => {
		stageRunner._setAdapterTableForTest([BOUNDED]);
		try {
			const { root, sessionDir } = makeGitTarget();
			const capture = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			grantSessionExecution(root, "s1", { attemptId: capture.request.attemptId });
			const executed = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			assert.strictEqual(executed.settlement.status, "succeeded");

			const { readSessionEvents } = require("../../scripts/lib/session-timeline");
			const events = readSessionEvents(sessionDir).filter((event) =>
				["run_started", "run_completed"].includes(event.type),
			);
			assert.strictEqual(events.length, 2);
			const expectedRunId = runIdOf("s1", capture.request.attemptId);
			for (const event of events) {
				assert.strictEqual(
					event.data.runId,
					expectedRunId,
					"stored runId equals the derivation (a mismatch fails the fold)",
				);
			}
		} finally {
			stageRunner._restoreAdapterTableForTest();
		}
	});
});

describe("run contract — attempt metrics fold (spec §7 R2; plan Slice 7)", () => {
	it("fail → gate-refused → succeed reads the spec's worked example", async () => {
		stageRunner._setAdapterTableForTest([BOUNDED]);
		try {
			const { root, sessionDir } = makeGitTarget();
			// Attempt 1: executes and fails (exit 3).
			fs.writeFileSync(
				path.join(root, ".amber", "governance", "rules.json"),
				JSON.stringify(rulesObject({ ...ALLOW_RULE, pattern: 'node -e "process.exit(3)"' })),
			);
			const first = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			grantSessionExecution(root, "s1", { attemptId: first.request.attemptId });
			const failed = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			assert.strictEqual(failed.settlement.status, "failed");

			// Attempt 2: the rules change after capture — the gate refuses.
			const drifted = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			fs.writeFileSync(
				path.join(root, ".amber", "governance", "rules.json"),
				JSON.stringify({ ...rulesObject(ALLOW_RULE), defaultAction: "deny" }),
			);
			grantSessionExecution(root, "s1", { attemptId: drifted.request.attemptId });
			const refused = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			assert.strictEqual(refused.success, false);

			// Attempt 3: fresh capture under the restored rules succeeds.
			fs.writeFileSync(
				path.join(root, ".amber", "governance", "rules.json"),
				JSON.stringify(rulesObject(ALLOW_RULE)),
			);
			const third = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			grantSessionExecution(root, "s1", { attemptId: third.request.attemptId });
			const succeeded = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			assert.strictEqual(succeeded.settlement.status, "succeeded", succeeded.message);

			const metrics = attemptMetricsOf(ledgerRecords(sessionDir));
			assert.strictEqual(metrics.attempts_requested_total, 3);
			assert.strictEqual(metrics.attempts_admitted_total, 2, "the refused retry is never admitted");
			assert.strictEqual(metrics.attempts_denied_total, 1);
			assert.strictEqual(metrics.attempts_still_open, 0);
			assert.deepStrictEqual(metrics.attempts_settled_total, {
				failed: 1,
				succeeded: 1,
			});
			// requested = admitted + denied + still-open holds.
			assert.strictEqual(
				metrics.attempts_requested_total,
				metrics.attempts_admitted_total +
					metrics.attempts_denied_total +
					metrics.attempts_still_open,
			);
		} finally {
			stageRunner._restoreAdapterTableForTest();
		}
	});
});
