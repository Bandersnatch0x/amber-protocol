const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const stageRunner = require("../../scripts/lib/session-stage-runner");
const { runSessionStage, settleSessionRequest, verifyLease, cursorFromLedger } = stageRunner;
const {
	verifySession,
	approveSession,
	startSession,
	leaseSession,
} = require("../../scripts/lib/session-commands");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const {
	registerRunner,
	registerRunnerCapability,
} = require("../../scripts/lib/core/runner-registry");
const { recordEvidence } = require("../../scripts/lib/core/evidence-receipts");

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
const withAdapters = (entries) => stageRunner._setAdapterTableForTest(entries);

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
		const restore = withAdapters([{ ...HOST_AGENT, capabilityPin: "runner/ci@1.0.0#other.cap@1" }]);
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
			{ status: "succeeded", exitCode: 0, evidenceId: settleEvidenceId(root) },
			bindOf(first),
		);
		const blocked = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		assert.strictEqual(blocked.success, false);
		assert.match(blocked.message, /user-approval/);
	});
});

// Settle binding args: the pending request's own attempt id and idempotency
// key (spec closed settle contract).
const bindOf = (run) => ({
	...CLAIM,
	attemptId: run.request.attemptId,
	requestHash: run.request.idempotencyKey,
});

// A succeeded settle requires a real, on-disk Evidence receipt (spec: "a
// missing required Evidence receipt fail closed"), so tests that advance the
// cursor must record one first. The producer must be a registered principal —
// makeTarget registers alice@example.com. Each test gets its own root, so a
// fixed id per root is unique.
function settleEvidenceId(root) {
	const recorded = recordEvidence(root, {
		id: "evidence/stage-settle",
		producer: "alice@example.com",
		assurance: "observed",
		scope: "F062",
		subject: "spec/F062-settle-binding",
		inputs: null,
		tools: null,
		environment: null,
		outputs: null,
		status: "pass",
	});
	assert.equal(recorded.ok, true, (recorded.errors || []).join("; "));
	return "evidence/stage-settle";
}

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
			bindOf(run),
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
		await settleSessionRequest(root, "s1", run.request.requestId, body, bindOf(run));
		const again = await settleSessionRequest(root, "s1", run.request.requestId, body, bindOf(run));
		assert.strictEqual(again.success, true);
		assert.strictEqual(again.duplicate, true);
	});

	it("refuses a different result for the same attempt", async () => {
		const { root } = makeTarget();
		const run = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		await settleSessionRequest(
			root,
			"s1",
			run.request.requestId,
			{ status: "failed" },
			bindOf(run),
		);
		const conflict = await settleSessionRequest(
			root,
			"s1",
			run.request.requestId,
			{ status: "succeeded", evidenceId: "evidence/x" },
			bindOf(run),
		);
		assert.strictEqual(conflict.success, false);
		assert.match(conflict.message, /conflict/);
	});

	it("refuses unknown result fields (closed result contract)", async () => {
		const { root } = makeTarget();
		const run = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		const settled = await settleSessionRequest(
			root,
			"s1",
			run.request.requestId,
			{ status: "failed", exitCode: 3, evil: "smuggled" },
			bindOf(run),
		);
		assert.strictEqual(settled.success, false);
		assert.match(settled.message, /unknown field/);
	});

	it("refuses a succeeded settlement whose evidenceId names no recorded receipt", async () => {
		const { root } = makeTarget();
		const run = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		const settled = await settleSessionRequest(
			root,
			"s1",
			run.request.requestId,
			{ status: "succeeded", exitCode: 0, evidenceId: "evidence/ghost" },
			bindOf(run),
		);
		assert.strictEqual(settled.success, false);
		assert.match(settled.message, /names no recorded Evidence receipt/);
		const manifest = JSON.parse(
			fs.readFileSync(path.join(root, ".amber", "sessions", "s1", "manifest.json"), "utf8"),
		);
		assert.deepStrictEqual(manifest.completedStages, []);
	});

	it("records a durable stage_attempt_expired when the request deadline has passed", async () => {
		const { root, sessionDir } = makeTarget();
		// Hand-craft a pending request whose deadline is already past; the hash
		// chain stays intact because appendLedgerRecord recomputes it.
		const { appendLedgerRecord } = require("../../scripts/lib/core/loop-ledger");
		appendLedgerRecord(path.join(sessionDir, "ledger.jsonl"), {
			schemaVersion: 2,
			kind: "stage_attempt_requested",
			requestId: "req-expired",
			attemptId: "att-1",
			stageName: "check",
			status: "pending",
			idempotencyKey: "key-1",
			leaseOwnerId: "agent-a",
			leaseFence: 1,
			deadlineAt: new Date(Date.now() - 1000).toISOString(),
			recordedAt: new Date(Date.now() - 2000).toISOString(),
		});
		const claim = {
			ownerId: "agent-a",
			tokenHash: TOKEN_HASH,
			leaseFence: 1,
			attemptId: "att-1",
			requestHash: "key-1",
		};
		const settled = await settleSessionRequest(
			root,
			"s1",
			"req-expired",
			{ status: "failed" },
			claim,
		);
		assert.strictEqual(settled.success, false);
		assert.match(settled.message, /expired/);
		const ledgerText = fs.readFileSync(path.join(sessionDir, "ledger.jsonl"), "utf8");
		assert.match(ledgerText, /stage_attempt_expired/);
		// The expiry re-fires: a second attempt on the same request also refuses.
		const again = await settleSessionRequest(
			root,
			"s1",
			"req-expired",
			{ status: "failed" },
			claim,
		);
		assert.strictEqual(again.success, false);
		assert.match(again.message, /expired/);
	});

	it("refuses succeeded without an Evidence binding", async () => {
		const { root } = makeTarget();
		const run = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		const settled = await settleSessionRequest(
			root,
			"s1",
			run.request.requestId,
			{ status: "succeeded", exitCode: 0 },
			bindOf(run),
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
			bindOf(run),
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
			bindOf(run),
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
			{ status: "succeeded", exitCode: 0, evidenceId: settleEvidenceId(root) },
			bindOf(run),
		);
		assert.strictEqual(settled.advanced, true);
		const manifest = JSON.parse(fs.readFileSync(path.join(sessionDir, "manifest.json"), "utf8"));
		assert.deepStrictEqual(manifest.completedStages, ["check"]);
		assert.strictEqual(manifest.currentStage, "second");
	});

	it("keeps a retry on the same stage with a fresh attempt number", async () => {
		const { root } = makeTarget();
		const first = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		await settleSessionRequest(
			root,
			"s1",
			first.request.requestId,
			{ status: "failed" },
			bindOf(first),
		);
		const retry = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		assert.strictEqual(retry.request.attemptNumber, 2);
		assert.strictEqual(retry.request.stageName, "check");
		assert.notStrictEqual(retry.request.requestId, first.request.requestId);
		assert.notStrictEqual(retry.request.idempotencyKey, first.request.idempotencyKey);
	});

	it("refuses the same status with a different closed result", async () => {
		const { root } = makeTarget();
		const run = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		await settleSessionRequest(
			root,
			"s1",
			run.request.requestId,
			{ status: "failed", exitCode: 3 },
			bindOf(run),
		);
		const conflict = await settleSessionRequest(
			root,
			"s1",
			run.request.requestId,
			{ status: "failed", exitCode: 4 },
			bindOf(run),
		);
		assert.strictEqual(conflict.success, false);
		assert.match(conflict.message, /conflict/);
	});

	it("refuses a settlement without the attempt binding", async () => {
		const { root } = makeTarget();
		const run = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		const settled = await settleSessionRequest(
			root,
			"s1",
			run.request.requestId,
			{ status: "failed" },
			CLAIM,
		);
		assert.strictEqual(settled.success, false);
		assert.match(settled.message, /--attempt-id/);
	});

	it("refuses a settlement with a mismatched request hash", async () => {
		const { root } = makeTarget();
		const run = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		const settled = await settleSessionRequest(
			root,
			"s1",
			run.request.requestId,
			{ status: "failed" },
			{ ...bindOf(run), requestHash: "0".repeat(64) },
		);
		assert.strictEqual(settled.success, false);
		assert.match(settled.message, /--request-hash/);
	});

	it("refuses a settlement from an owner other than the request creator", async () => {
		const { root } = makeTarget();
		const run = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		const settled = await settleSessionRequest(
			root,
			"s1",
			run.request.requestId,
			{ status: "failed" },
			{ ...bindOf(run), ownerId: "agent-b" },
		);
		assert.strictEqual(settled.success, false);
		assert.match(settled.message, /owner/);
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

describe("session stage runner — legacy seams and lease minting", () => {
	installHostAdapter();
	it("legacy session verify refuses a verb route and points at run/settle", async () => {
		const { root } = makeTarget();
		const outcome = await verifySession(root, { sessionId: "s1" });
		assert.strictEqual(outcome.exitCode, 1);
		assert.match(outcome.text, /verb stages/);
		assert.match(outcome.text, /session run/);
		assert.match(outcome.text, /session settle/);
	});

	it("legacy session verify stays byte-compatible for a route without verb stages", async () => {
		const { root } = makeTarget({
			stages: [{ name: "verify", type: "command", target: "npm test" }],
		});
		const outcome = await verifySession(root, { sessionId: "s1" });
		assert.strictEqual(outcome.exitCode, 0);
	});

	it("session approve unblocks a stage-level gateAfter without a route-level gates entry", async () => {
		const { root } = makeTarget({
			stages: [
				{ name: "check", type: "verb", target: PIN, gateAfter: "user-approval" },
				{ name: "second", type: "verb", target: PIN },
			],
		});
		const before = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		await settleSessionRequest(
			root,
			"s1",
			before.request.requestId,
			{ status: "succeeded", exitCode: 0, evidenceId: settleEvidenceId(root) },
			bindOf(before),
		);
		const blocked = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		assert.strictEqual(blocked.success, false);
		assert.match(blocked.message, /user-approval/);

		const approval = await approveSession(root, {
			sessionId: "s1",
			gate: "user-approval",
			yes: true,
		});
		assert.strictEqual(approval.exitCode, 0);

		const after = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		assert.strictEqual(after.success, true);
		assert.strictEqual(after.request.stageName, "second");
	});

	it("a bounded-command refusal records a terminal rejected event and never advances", async () => {
		const restore = withAdapters([
			{
				capabilityPin: PIN,
				providerClass: "bounded-command",
				adapterId: "governed-runner",
				adapterVersion: "1",
			},
		]);
		try {
			// The fixture root is not a git repository, so governed-runner
			// refuses before any execution — exercising the rejected path.
			const { root, sessionDir } = makeTarget();
			const outcome = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			assert.strictEqual(outcome.success, false);

			const ledger = fs.readFileSync(path.join(sessionDir, "ledger.jsonl"), "utf8");
			const settled = ledger
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line))
				.filter((record) => record.kind === "stage_attempt_settled");
			assert.strictEqual(settled.length, 1);
			assert.strictEqual(settled[0].status, "rejected");

			const manifest = JSON.parse(fs.readFileSync(path.join(sessionDir, "manifest.json"), "utf8"));
			assert.deepStrictEqual(manifest.completedStages, []);
		} finally {
			restore();
		}
	});

	it("session start --agent mints a lease and returns the raw token exactly once", async () => {
		const { root } = makeTarget();
		const started = await startSession(root, {
			goal: "probe the lease minting path",
			route: "probe",
			agent: "agent-a",
		});
		assert.strictEqual(started.exitCode, 0);
		assert.match(started.text, /Lease token \(shown ONCE/);

		const sessionDirActual = path.join(root, ".amber", "sessions", started.sessionId);
		const manifest = JSON.parse(
			fs.readFileSync(path.join(sessionDirActual, "manifest.json"), "utf8"),
		);
		assert.ok(manifest.lease, "lease is on the manifest");
		assert.strictEqual(manifest.lease.ownerId, "agent-a");
		assert.strictEqual(manifest.lease.fence, 1);
		assert.match(manifest.lease.tokenHash, /^[0-9a-f]{64}$/);
		// The raw token is never persisted — only its digest is.
		const rawToken = (started.text.match(
			/Lease token \(shown ONCE, not stored\): ([0-9a-f]{64})/,
		) || [])[1];
		assert.ok(rawToken, "the raw token is returned exactly once");
		assert.ok(!JSON.stringify(manifest).includes(rawToken));
	});

	it("session lease reacquires for the owner, minting a new fence and token", async () => {
		const { root, sessionDir } = makeTarget();
		const reacquired = await leaseSession(root, {
			sessionId: "s1",
			ownerId: "agent-a",
			tokenHash: TOKEN_HASH,
		});
		assert.strictEqual(reacquired.exitCode, 0);
		assert.match(reacquired.text, /Fence: 1 → 2/);
		assert.match(reacquired.text, /Lease token \(shown ONCE/);

		const manifest = JSON.parse(fs.readFileSync(path.join(sessionDir, "manifest.json"), "utf8"));
		assert.strictEqual(manifest.lease.fence, 2);
		assert.strictEqual(manifest.lease.ownerId, "agent-a");
		assert.notStrictEqual(manifest.lease.tokenHash, TOKEN_HASH, "a fresh token digest is minted");
		const rawToken = (reacquired.text.match(
			/Lease token \(shown ONCE, not stored\): ([0-9a-f]{64})/,
		) || [])[1];
		assert.ok(rawToken, "the raw token is returned exactly once");
		assert.ok(!JSON.stringify(manifest).includes(rawToken));

		const timeline = fs.readFileSync(path.join(sessionDir, "timeline.jsonl"), "utf8");
		assert.match(timeline, /lease_reacquired/);
	});

	it("session lease refuses a wrong owner and a wrong token", async () => {
		const { root } = makeTarget();
		const wrongOwner = await leaseSession(root, {
			sessionId: "s1",
			ownerId: "agent-b",
			tokenHash: TOKEN_HASH,
		});
		assert.strictEqual(wrongOwner.exitCode, 1);
		assert.match(wrongOwner.text, /owner-bound/);

		const wrongToken = await leaseSession(root, {
			sessionId: "s1",
			ownerId: "agent-a",
			tokenHash: "0".repeat(64),
		});
		assert.strictEqual(wrongToken.exitCode, 1);
		assert.match(wrongToken.text, /tokenHash/);
	});

	it("session lease refuses a terminal session", async () => {
		const { root } = makeTarget({ status: "completed" });
		const reacquired = await leaseSession(root, {
			sessionId: "s1",
			ownerId: "agent-a",
			tokenHash: TOKEN_HASH,
		});
		assert.strictEqual(reacquired.exitCode, 1);
		assert.match(reacquired.text, /already completed/);
	});

	it("session lease reacquires an EXPIRED lease and unblocks run/settle under the new fence", async () => {
		const { root, sessionDir } = makeTarget();
		installHostAdapter();
		try {
			// Backdate the lease past its window: run/settle must refuse it...
			const manifestPath = path.join(sessionDir, "manifest.json");
			const stale = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
			stale.lease.expiresAt = new Date(Date.now() - 1000).toISOString();
			fs.writeFileSync(manifestPath, JSON.stringify(stale));

			const refused = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			assert.strictEqual(refused.success, false);
			assert.match(refused.message, /expired at/);

			// ...and reacquisition by the owner is exactly the recovery path.
			const reacquired = await leaseSession(root, {
				sessionId: "s1",
				ownerId: "agent-a",
				tokenHash: TOKEN_HASH,
			});
			assert.strictEqual(reacquired.exitCode, 0);

			const fresh = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
			const freshClaim = {
				ownerId: "agent-a",
				tokenHash: fresh.lease.tokenHash,
				leaseFence: fresh.lease.fence,
			};
			const run = await runSessionStage(root, "s1", { execute: true, ...freshClaim });
			assert.strictEqual(run.success, true);
			assert.strictEqual(run.pending, true);
		} finally {
			stageRunner._restoreAdapterTableForTest();
		}
	});

	it("a request created under an older fence can never settle after reacquisition", async () => {
		const { root, sessionDir } = makeTarget();
		installHostAdapter();
		try {
			const run = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			assert.strictEqual(run.pending, true);

			const reacquired = await leaseSession(root, {
				sessionId: "s1",
				ownerId: "agent-a",
				tokenHash: TOKEN_HASH,
			});
			assert.strictEqual(reacquired.exitCode, 0);

			const fresh = JSON.parse(fs.readFileSync(path.join(sessionDir, "manifest.json"), "utf8"));
			const settled = await settleSessionRequest(
				root,
				"s1",
				run.request.requestId,
				{ status: "failed", exitCode: 1 },
				{
					...bindOf(run),
					tokenHash: fresh.lease.tokenHash,
					leaseFence: fresh.lease.fence,
				},
			);
			assert.strictEqual(settled.success, false);
			assert.match(settled.message, /older fence/);
		} finally {
			stageRunner._restoreAdapterTableForTest();
		}
	});
});
