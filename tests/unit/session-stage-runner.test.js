const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const stageRunner = require("../../scripts/lib/session-stage-runner");
const { runSessionStage, settleSessionRequest, verifyLease, cursorFromLedger } = stageRunner;
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const {
	registerRunner,
	registerRunnerCapability,
} = require("../../scripts/lib/core/runner-registry");

const PIN = "runner/ci@1.0.0#diagnose.check@1";
const RUNNER_DIGEST = `sha256:${"a".repeat(64)}`;
const TOKEN_HASH = crypto.createHash("sha256").update("opaque-token").digest("hex");

// Each test gets its own mkdtemp root: shared fixtures made earlier suites flaky.
function makeTarget({ stages, status = "executing", lease = true } = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-t4-"));

	registerPrincipal(root, { id: "alice@example.com", principalKind: "human" });
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
		name: "diagnose.check",
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
			stages: stages || [
				{ name: "check", type: "verb", target: PIN },
				{ name: "second", type: "verb", target: PIN },
			],
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
			status,
			completedStages: [],
			...(lease
				? {
						lease: {
							ownerId: "agent-a",
							tokenHash: TOKEN_HASH,
							acquiredAt: new Date().toISOString(),
							expiresAt: new Date(Date.now() + 120000).toISOString(),
							ttlMs: 120000,
							fence: 1,
						},
					}
				: {}),
		}),
	);
	return { root, sessionDir };
}

const CLAIM = { ownerId: "agent-a", tokenHash: TOKEN_HASH, leaseFence: 1 };

const HOST_AGENT = {
	capabilityPin: PIN,
	providerClass: "host-agent",
	adapterId: "agent-turn",
	adapterVersion: "1",
};

// ADR-0029 §7: the adapter table is an in-code constant — "a reviewed code
// change, not a new registry or a mutable target-repository record". Tests
// therefore swap it wholesale through the module's test-only seam and restore
// the pristine constant after each suite, never writing a target file.
const withAdapters = (entries) => {
	stageRunner._setAdapterTableForTest(entries);
	return () => stageRunner._restoreAdapterTableForTest();
};

// Suites that need the pin mapped install it in before() and restore in
// after() — describe bodies only register subtests, so a wrapper's finally
// would restore before any subtest actually runs.
function installHostAdapter() {
	before(() => stageRunner._setAdapterTableForTest([HOST_AGENT]));
	after(() => stageRunner._restoreAdapterTableForTest());
}

describe("session stage runner — adapter resolution", () => {
	it("fails closed when no adapter is registered for the pin", async () => {
		const { root } = makeTarget();
		const outcome = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		assert.strictEqual(outcome.success, false);
		assert.match(outcome.message, /no entry in the implementation-owned adapter table/);
		assert.match(outcome.message, /AMBER_E_STAGE_ADAPTER_UNAVAILABLE/);
	});

	it("fails closed when a different pin is the only mapped one", async () => {
		const restore = withAdapters([
			{ ...HOST_AGENT, capabilityPin: "runner/ci@1.0.0#other.cap@1" },
		]);
		try {
			const { root } = makeTarget();
			const outcome = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			assert.strictEqual(outcome.success, false);
			assert.match(outcome.message, /AMBER_E_STAGE_ADAPTER_UNAVAILABLE/);
		} finally {
			restore();
		}
	});

	it("rejects the external provider class and points at F056", async () => {
		const restore = withAdapters([
			{ capabilityPin: PIN, providerClass: "external", adapterId: "f056", adapterVersion: "1" },
		]);
		try {
			const { root } = makeTarget();
			const outcome = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			assert.strictEqual(outcome.success, false);
			assert.match(outcome.message, /AMBER_E_STAGE_EXTERNAL_LIFECYCLE_REQUIRED/);
			assert.match(outcome.message, /F056/);
		} finally {
			restore();
		}
	});

	it("reuses the F052 refusal code for an unregistered capability", async () => {
		const restore = withAdapters([HOST_AGENT]);
		try {
			const { root } = makeTarget({
				stages: [{ name: "check", type: "verb", target: "runner/ci@1.0.0#missing.cap@1" }],
			});
			const outcome = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			assert.strictEqual(outcome.success, false);
			assert.match(outcome.message, /AMBER_E_RUNNER_CAPABILITY_NOT_FOUND/);
		} finally {
			restore();
		}
	});
});

describe("session stage runner — lease", () => {
	installHostAdapter();
	it("refuses a fence that does not match the recorded lease", async () => {
		const { root } = makeTarget();
		const outcome = await runSessionStage(root, "s1", { execute: true, ...CLAIM, leaseFence: 99 });
		assert.strictEqual(outcome.success, false);
		assert.match(outcome.message, /fence/);
	});

	it("refuses an expired lease instead of transferring it", () => {
		const expired = {
			lease: {
				ownerId: "agent-a",
				tokenHash: TOKEN_HASH,
				acquiredAt: new Date(Date.now() - 600000).toISOString(),
				expiresAt: new Date(Date.now() - 1000).toISOString(),
				ttlMs: 599000,
				fence: 1,
			},
		};
		// verifyLease takes the lease-record spelling (`fence`); the CLI-facing
		// options object spells it `leaseFence` to match --lease-fence.
		const verdict = verifyLease(expired, { ownerId: "agent-a", tokenHash: TOKEN_HASH, fence: 1 });
		assert.strictEqual(verdict.valid, false);
		assert.match(verdict.reason, /expired/);
	});

	it("refuses an owner mismatch", () => {
		const manifest = {
			lease: {
				ownerId: "agent-b",
				tokenHash: TOKEN_HASH,
				acquiredAt: new Date().toISOString(),
				expiresAt: new Date(Date.now() + 60000).toISOString(),
				ttlMs: 60000,
				fence: 1,
			},
		};
		const verdict = verifyLease(manifest, {
			ownerId: "agent-a",
			tokenHash: TOKEN_HASH,
			fence: 1,
		});
		assert.strictEqual(verdict.valid, false);
		assert.match(verdict.reason, /owner/);
	});
});

describe("session stage runner — run", () => {
	installHostAdapter();
	it("dry-run resolves the request without creating an attempt", async () => {
		const { root, sessionDir } = makeTarget();
		const outcome = await runSessionStage(root, "s1", { execute: false, ...CLAIM });
		assert.strictEqual(outcome.success, true);
		assert.strictEqual(outcome.dryRun, true);
		assert.strictEqual(outcome.request.stageName, "check");
		assert.strictEqual(fs.existsSync(path.join(sessionDir, "ledger.jsonl")), false);
	});

	it("creates a pending host-agent request and never starts the Agent", async () => {
		const { root } = makeTarget();
		const outcome = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		assert.strictEqual(outcome.success, true);
		assert.strictEqual(outcome.pending, true);
		assert.strictEqual(outcome.request.attemptNumber, 1);
	});

	it("refuses a non-verb stage", async () => {
		const { root } = makeTarget({
			stages: [{ name: "plan", type: "skill", target: "planning" }],
		});
		const outcome = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		assert.strictEqual(outcome.success, false);
		assert.match(outcome.message, /verb stages only/);
	});

	it("refuses a terminal session", async () => {
		const { root } = makeTarget({ status: "completed" });
		const outcome = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		assert.strictEqual(outcome.success, false);
		assert.match(outcome.message, /terminal session/);
	});

	it("blocks the next stage until gateAfter passes", async () => {
		const { root } = makeTarget({
			stages: [
				{ name: "check", type: "verb", target: PIN, gateAfter: "user-approval" },
				{ name: "second", type: "verb", target: PIN },
			],
			});
		const first = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		await settleSessionRequest(
			root,
			"s1",
			first.request.requestId,
			{ status: "succeeded", exitCode: 0, evidenceId: "evidence/x" },
			CLAIM,
		);
		const blocked = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		assert.strictEqual(blocked.success, false);
		assert.match(blocked.message, /user-approval/);
	});
});

describe("session stage runner — settle", () => {
	installHostAdapter();
	it("does not advance the cursor on a failed attempt", async () => {
		const { root, sessionDir } = makeTarget();
		const run = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		const settled = await settleSessionRequest(
			root,
			"s1",
			run.request.requestId,
			{ status: "failed", exitCode: 3 },
			CLAIM,
		);
		assert.strictEqual(settled.success, true);
		assert.strictEqual(settled.advanced, false);
		const manifest = JSON.parse(fs.readFileSync(path.join(sessionDir, "manifest.json"), "utf8"));
		assert.deepStrictEqual(manifest.completedStages, []);
	});

	it("treats an exact duplicate settlement as idempotent", async () => {
		const { root } = makeTarget();
		const run = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		const body = { status: "failed", exitCode: 3 };
		await settleSessionRequest(root, "s1", run.request.requestId, body, CLAIM);
		const again = await settleSessionRequest(root, "s1", run.request.requestId, body, CLAIM);
		assert.strictEqual(again.success, true);
		assert.strictEqual(again.duplicate, true);
	});

	it("refuses a different result for the same attempt", async () => {
		const { root } = makeTarget();
		const run = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		await settleSessionRequest(root, "s1", run.request.requestId, { status: "failed" }, CLAIM);
		const conflict = await settleSessionRequest(
			root,
			"s1",
			run.request.requestId,
			{ status: "succeeded", evidenceId: "evidence/x" },
			CLAIM,
		);
		assert.strictEqual(conflict.success, false);
		assert.match(conflict.message, /conflict/);
	});

	it("refuses succeeded without an Evidence binding", async () => {
		const { root } = makeTarget();
		const run = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		const settled = await settleSessionRequest(
			root,
			"s1",
			run.request.requestId,
			{ status: "succeeded", exitCode: 0 },
			CLAIM,
		);
		assert.strictEqual(settled.success, false);
		assert.match(settled.message, /Evidence/);
	});

	it("refuses succeeded paired with a non-zero exit code", async () => {
		const { root } = makeTarget();
		const run = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		const settled = await settleSessionRequest(
			root,
			"s1",
			run.request.requestId,
			{ status: "succeeded", exitCode: 7, evidenceId: "evidence/x" },
			CLAIM,
		);
		assert.strictEqual(settled.success, false);
		assert.match(settled.message, /non-zero exitCode/);
	});

	it("refuses skipping a non-optional stage", async () => {
		const { root } = makeTarget();
		const run = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		const settled = await settleSessionRequest(
			root,
			"s1",
			run.request.requestId,
			{ status: "skipped" },
			CLAIM,
		);
		assert.strictEqual(settled.success, false);
		assert.match(settled.message, /not optional/);
	});

	it("advances the cursor once on success and projects it onto the manifest", async () => {
		const { root, sessionDir } = makeTarget();
		const run = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		const settled = await settleSessionRequest(
			root,
			"s1",
			run.request.requestId,
			{ status: "succeeded", exitCode: 0, evidenceId: "evidence/x" },
			CLAIM,
		);
		assert.strictEqual(settled.advanced, true);
		const manifest = JSON.parse(fs.readFileSync(path.join(sessionDir, "manifest.json"), "utf8"));
		assert.deepStrictEqual(manifest.completedStages, ["check"]);
		assert.strictEqual(manifest.currentStage, "second");
	});

	it("keeps a retry on the same stage with a fresh attempt number", async () => {
		const { root } = makeTarget();
		const first = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		await settleSessionRequest(root, "s1", first.request.requestId, { status: "failed" }, CLAIM);
		const retry = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		assert.strictEqual(retry.request.attemptNumber, 2);
		assert.strictEqual(retry.request.stageName, "check");
		assert.notStrictEqual(retry.request.requestId, first.request.requestId);
		assert.notStrictEqual(retry.request.idempotencyKey, first.request.idempotencyKey);
	});
});

describe("session stage runner — cursor", () => {
	it("collapses a stage recorded twice into one step", () => {
		const records = [
			{ kind: "stage_completed", stage: "a" },
			{ kind: "stage_attempt_requested", stageName: "b" },
			{ kind: "stage_completed", stage: "a" },
			{ kind: "stage_completed", stage: "b" },
		];
		assert.deepStrictEqual(cursorFromLedger(records), ["a", "b"]);
	});
});
