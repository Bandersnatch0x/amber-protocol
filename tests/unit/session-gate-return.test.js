"use strict";

const { test, describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const stageRunner = require("../../scripts/lib/session-stage-runner");
const { runSessionStage, settleSessionRequest, cursorFromLedger } = stageRunner;
const {
	startSession,
	approveSession,
	verifySession,
} = require("../../scripts/lib/session-commands");
const { installTargetRoutes } = require("../helpers/target-routes");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const {
	registerRunner,
	registerRunnerCapability,
} = require("../../scripts/lib/core/runner-registry");
const { recordEvidence } = require("../../scripts/lib/core/evidence-receipts");
const { appendLedgerRecord } = require("../../scripts/lib/core/loop-ledger");
const { readSessionEvents } = require("../../scripts/lib/session-timeline");

const PIN = "runner/ci@1.0.0#diagnose.check@1";
const RUNNER_DIGEST = `sha256:${"a".repeat(64)}`;
const TOKEN_HASH = crypto.createHash("sha256").update("opaque-token").digest("hex");

const HOST_AGENT = {
	capabilityPin: PIN,
	providerClass: "host-agent",
	adapterId: "agent-turn",
	adapterVersion: "1",
};

// --- verb-route fixture (mirrors session-stage-runner.test.js) ---

function makeVerbTarget({ gates = [], stages } = {}) {
	const root = track(fs.mkdtempSync(path.join(os.tmpdir(), "amber-f090-")));
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

	fs.mkdirSync(path.join(root, "routes"), { recursive: true });
	fs.writeFileSync(
		path.join(root, "routes", "probe.route.json"),
		JSON.stringify({
			schemaVersion: "1.0.0",
			routeId: "probe",
			version: "1.0.0",
			description: "probe route",
			stages: stages || [
				{ name: "check", type: "verb", target: PIN },
				{ name: "second", type: "verb", target: PIN },
			],
			...(gates.length ? { gates } : {}),
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
const bindOf = (run) => ({
	...CLAIM,
	attemptId: run.request.attemptId,
	requestHash: run.request.idempotencyKey,
});

let settleEvidenceSeq = 0;
function settleEvidenceId(root) {
	settleEvidenceSeq += 1;
	const id = `evidence/stage-settle-${settleEvidenceSeq}`;
	const recorded = recordEvidence(root, {
		id,
		producer: "alice@example.com",
		assurance: "observed",
		scope: "F090",
		subject: "spec/F090-gate-return",
		inputs: null,
		tools: null,
		environment: null,
		outputs: null,
		status: "pass",
	});
	assert.equal(recorded.ok, true, (recorded.errors || []).join("; "));
	return id;
}

const track = (dir) => {
	tempDirs.push(dir);
	return dir;
};
const tempDirs = [];
after(() => {
	for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function readLedgerRecords(sessionDir) {
	return fs
		.readFileSync(path.join(sessionDir, "ledger.jsonl"), "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

function readManifest(sessionDir) {
	return JSON.parse(fs.readFileSync(path.join(sessionDir, "manifest.json"), "utf8"));
}

function tmpRepo() {
	const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), "amber-f090-repo-")));
	fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
	installTargetRoutes(dir);
	return dir;
}

// --- behavior tests ---

describe("gate return — ledger cursor derivation", () => {
	before(() => stageRunner._setAdapterTableForTest([HOST_AGENT]));
	after(() => stageRunner._restoreAdapterTableForTest());

	it("cursorFromLedger truncates at the first gate_returned record", () => {
		// "Return to check" means check itself is redone: the cursor rewinds to
		// before the returned-to stage, so its old completion no longer counts.
		const cursor = cursorFromLedger([
			{ kind: "stage_completed", stage: "check" },
			{ kind: "gate_returned", gateId: "user-approval-plan", returnTo: "check" },
		]);
		assert.deepStrictEqual(cursor, []);
	});

	it("cursorFromLedger re-extends after a return as work re-completes", () => {
		const cursor = cursorFromLedger([
			{ kind: "stage_completed", stage: "check" },
			{ kind: "gate_returned", gateId: "user-approval-plan", returnTo: "check" },
			{ kind: "stage_completed", stage: "check" },
			{ kind: "stage_completed", stage: "second" },
		]);
		assert.deepStrictEqual(cursor, ["check", "second"]);
	});

	it("cursorFromLedger with no return equals the plain completed prefix", () => {
		const cursor = cursorFromLedger([
			{ kind: "stage_completed", stage: "check" },
			{ kind: "stage_completed", stage: "second" },
		]);
		assert.deepStrictEqual(cursor, ["check", "second"]);
	});

	it("settle, return, and rerun converge back to the returned stage", async () => {
		const { root, sessionDir } = makeVerbTarget({
			gates: [{ id: "user-approval-check", type: "user-approval" }],
			stages: [
				{ name: "check", type: "verb", target: PIN, gateAfter: "user-approval-check" },
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
		assert.deepStrictEqual(readManifest(sessionDir).completedStages, ["check"]);

		const returned = await approveSession(root, {
			sessionId: "s1",
			gate: "user-approval-check",
			returnTo: "check",
			yes: true,
		});
		assert.equal(returned.exitCode, 0);
		assert.match(returned.text, /Returned to stage check/);

		// The ledger keeps the full history: the stage_completed that advanced the
		// cursor, then the return ruling appended after it.
		const kinds = readLedgerRecords(sessionDir).map((r) => r.kind);
		assert.ok(kinds.includes("stage_completed"));
		assert.ok(kinds.includes("gate_returned"));
		assert.ok(kinds.indexOf("gate_returned") > kinds.indexOf("stage_completed"));

		// The manifest projection rewound: the returned-to stage itself is redone.
		assert.deepStrictEqual(readManifest(sessionDir).completedStages, []);

		// The gate is pending again: rerun before a new approval is refused.
		const rerun = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		assert.equal(rerun.success, false);
		assert.match(rerun.message, /user-approval-check/);

		// Re-approve the same gate (the decision file was cleared), redo the
		// returned stage, and only then does the run proceed past the gate.
		const again = await approveSession(root, {
			sessionId: "s1",
			gate: "user-approval-check",
			yes: true,
		});
		assert.equal(again.exitCode, 0);
		const redo = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		assert.equal(redo.success, true);
		assert.equal(redo.request.stageName, "check");
		await settleSessionRequest(
			root,
			"s1",
			redo.request.requestId,
			{ status: "succeeded", exitCode: 0, evidenceId: settleEvidenceId(root) },
			bindOf(redo),
		);
		const next = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		assert.equal(next.success, true);
		assert.equal(next.request.stageName, "second");
	});

	it("returning to a stage not before the gate is refused", async () => {
		const { root } = makeVerbTarget({
			gates: [{ id: "user-approval-check", type: "user-approval" }],
			stages: [
				{ name: "check", type: "verb", target: PIN, gateAfter: "user-approval-check" },
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
		const wrong = await approveSession(root, {
			sessionId: "s1",
			gate: "user-approval-check",
			returnTo: "second",
			yes: true,
		});
		assert.equal(wrong.exitCode, 1);
		assert.match(wrong.text, /return-to/);
	});

	it("returning to a stage after the gate and to an unknown stage are refused", async () => {
		const { root } = makeVerbTarget({
			gates: [{ id: "user-approval-check", type: "user-approval" }],
			stages: [
				{ name: "check", type: "verb", target: PIN, gateAfter: "user-approval-check" },
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
		for (const target of ["second", "no-such-stage"]) {
			const bad = await approveSession(root, {
				sessionId: "s1",
				gate: "user-approval-check",
				returnTo: target,
				yes: true,
			});
			assert.equal(bad.exitCode, 1, `expected refusal for returnTo=${target}`);
		}
	});

	it("a repeated return to the same stage is idempotent", async () => {
		const { root, sessionDir } = makeVerbTarget({
			gates: [{ id: "user-approval-check", type: "user-approval" }],
			stages: [
				{ name: "check", type: "verb", target: PIN, gateAfter: "user-approval-check" },
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
		const once = await approveSession(root, {
			sessionId: "s1",
			gate: "user-approval-check",
			returnTo: "check",
			yes: true,
		});
		assert.equal(once.exitCode, 0);
		const twice = await approveSession(root, {
			sessionId: "s1",
			gate: "user-approval-check",
			returnTo: "check",
			yes: true,
		});
		assert.equal(twice.exitCode, 0);
		assert.match(twice.text, /already returned/);
		assert.deepStrictEqual(readManifest(sessionDir).completedStages, []);
	});
});

describe("gate return — legacy session path", () => {
	it("verify works after a return on a non-verb route", async () => {
		const dir = tmpRepo();
		const s = await startSession(dir, { goal: "add login feature", route: "feature-standard" });
		const sessionDir = path.join(dir, ".amber", "sessions", s.sessionId);
		const manifest = readManifest(sessionDir);
		manifest.completedStages = ["capture", "plan"];
		fs.writeFileSync(path.join(sessionDir, "manifest.json"), JSON.stringify(manifest));

		const returned = await approveSession(dir, {
			sessionId: s.sessionId,
			gate: "user-approval-implement",
			returnTo: "capture",
			yes: true,
		});
		assert.equal(returned.exitCode, 0);
		const after = readManifest(sessionDir);
		assert.deepStrictEqual(after.completedStages, []);
		assert.equal(after.currentStage, "capture");

		const verify = await verifySession(dir, { sessionId: s.sessionId });
		assert.equal(verify.exitCode, 0);
	});

	it("returnTo must name a stage before the gate in a legacy route", async () => {
		const dir = tmpRepo();
		const s = await startSession(dir, { goal: "add login feature", route: "feature-standard" });
		const returned = await approveSession(dir, {
			sessionId: s.sessionId,
			gate: "user-approval-plan",
			returnTo: "plan",
			yes: true,
		});
		assert.equal(returned.exitCode, 1);
		assert.match(returned.text, /return-to/);
	});
});

describe("gate return — interactive ruling", () => {
	before(() => stageRunner._setAdapterTableForTest([HOST_AGENT]));
	after(() => stageRunner._restoreAdapterTableForTest());

	it("a return without --yes in a non-interactive shell is refused", async () => {
		const { root } = makeVerbTarget({
			gates: [{ id: "user-approval-check", type: "user-approval" }],
			stages: [
				{ name: "check", type: "verb", target: PIN, gateAfter: "user-approval-check" },
				{ name: "second", type: "verb", target: PIN },
			],
		});
		const returned = await approveSession(root, {
			sessionId: "s1",
			gate: "user-approval-check",
			returnTo: "check",
		});
		assert.equal(returned.exitCode, 1);
		assert.match(returned.text, /needs human decision/);
	});
});

describe("gate return — completion check", () => {
	it("a gate_returned after gate_passed voids the approval evidence", async () => {
		const { root, sessionDir } = makeVerbTarget();
		// Build a timeline where the gate passed and was then returned.
		const { appendSessionEvent } = require("../../scripts/lib/session-timeline");
		appendSessionEvent(sessionDir, { type: "gate_passed", data: { gateId: "g1" } });
		appendSessionEvent(sessionDir, {
			type: "gate_returned",
			data: { gateId: "g1", returnTo: "check" },
		});

		const { evaluateCompletion } = require("../../scripts/lib/completion-check");
		const result = evaluateCompletion(root, "s1");
		assert.ok(
			result.missing.includes("approval"),
			`missing should name approval: ${result.missing}`,
		);
	});

	it("a later re-approval restores the approval evidence", async () => {
		const { root, sessionDir } = makeVerbTarget();
		const { appendSessionEvent } = require("../../scripts/lib/session-timeline");
		appendSessionEvent(sessionDir, { type: "gate_passed", data: { gateId: "g1" } });
		appendSessionEvent(sessionDir, {
			type: "gate_returned",
			data: { gateId: "g1", returnTo: "check" },
		});
		appendSessionEvent(sessionDir, { type: "gate_passed", data: { gateId: "g1" } });

		const { evaluateCompletion } = require("../../scripts/lib/completion-check");
		const result = evaluateCompletion(root, "s1");
		assert.ok(
			!result.missing.includes("approval"),
			`approval should be satisfied: ${result.missing}`,
		);
	});
});

describe("gate return — timeline event vocabulary", () => {
	it("gate_returned is a valid timeline event type", () => {
		const { TIMELINE_EVENT_TYPES } = require("../../scripts/lib/session-timeline");
		assert.equal(TIMELINE_EVENT_TYPES.GATE_RETURNED, "gate_returned");
		const schema = require("../../schemas/timeline-event.schema.json");
		assert.ok(schema.properties.type.enum.includes("gate_returned"));
	});
});
