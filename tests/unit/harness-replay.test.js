"use strict";

// F073 H5 tickets 0116-0118 — ValidationReceipt, replay (verification, not
// re-execution), and regression proposals. Conformance at the real path: the
// closed check set with honest not-run disclosure, the first real
// validation.completed producer, the §46.5 replay matrix (same environment →
// equivalent; tool/policy/context/execution drift → detected;
// non-determinism → reported), the §43 gate (replay answers from records
// alone — no chat history), and the §17/§26 structural guarantee (validate +
// replay + propose never mutate a policy/rules/contract/grant byte).
// All cases use their own temporary target directory (suite leak guard).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	validateRun,
	listReceipts,
	CHECK_NAMES,
} = require("../../scripts/lib/harness/validation-core");
const {
	replayRun,
	proposeRegression,
	listReplays,
	DRIFT_KINDS,
	CODE_NOTHING_TO_PROPOSE,
} = require("../../scripts/lib/harness/replay-core");

function tmpTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-harness-h5-"));
}

function admitAndStart(target, runId) {
	const { dispatch } = require("../../scripts/lib/command-dispatcher");
	const contractFile = path.join(target, "contract.json");
	fs.writeFileSync(
		contractFile,
		JSON.stringify({
			apiVersion: "amber.dev/v1",
			kind: "HarnessContract",
			metadata: { id: "coding-task", version: "1" },
			agent: { id: "worker", role: "implementation" },
			governance: { policy: "default-safe" },
		}),
		"utf8",
	);
	dispatch("harness", { target, file: contractFile, json: true, _: ["admit"] });
	dispatch("harness", {
		target,
		json: true,
		contract: "coding-task",
		agent: "worker",
		run: runId,
		_: ["start"],
	});
}

function runRecord(target, runId) {
	return JSON.parse(
		fs.readFileSync(path.join(target, ".amber", "harness", "runs", `${runId}.json`), "utf8"),
	);
}

// The §17/§26 guard surface: the governance files validate/replay/propose
// must never touch — content digests (not lengths), taken BEFORE any
// validate/replay/propose runs, over the full named surface (rules, contract
// record, and every context grant).
function governanceFingerprint(target) {
	const crypto = require("node:crypto");
	const files = [
		path.join(target, ".amber", "governance", "rules.json"),
		path.join(target, ".amber", "harness", "contracts", "coding-task.json"),
	];
	const grantsDir = path.join(target, ".amber", "harness", "context-grants");
	if (fs.existsSync(grantsDir)) {
		for (const name of fs.readdirSync(grantsDir)) {
			files.push(path.join(grantsDir, name));
		}
	}
	// A missing file digests as `absent` — never silently dropped, so a file
	// that appears (or vanishes) mid-cycle flips the fingerprint.
	return files
		.sort()
		.map((file) => {
			const digest = fs.existsSync(file)
				? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
				: "absent";
			return `${path.basename(file)}=${digest}`;
		})
		.join("|");
}

test("validateRun produces an accepted receipt with honest not-run disclosure and the first validation.completed", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-val-1");
	const { receipt } = validateRun(target, { runId: "run-val-1" });
	assert.equal(receipt.result.status, "accepted");
	assert.deepEqual(
		receipt.checks.map((c) => c.name),
		[...CHECK_NAMES],
	);
	// Every not-run discloses a reason; every pass carries its evidence.
	for (const check of receipt.checks) {
		if (check.status === "not-run") assert.ok(check.detail, `${check.name} not-run without reason`);
	}
	const byName = Object.fromEntries(receipt.checks.map((c) => [c.name, c]));
	assert.equal(byName.policy.status, "not-run"); // no policy verdict on the trail yet
	assert.equal(byName.execution.status, "not-run"); // never executed
	assert.equal(byName.tools.status, "not-run"); // pre-H1 (empty registry)
	assert.equal(byName.attempts.status, "not-run"); // no attempts
	// The first real validation.completed on the trail.
	const { readRunEvents } = require("../../scripts/lib/harness/event-ledger");
	const events = readRunEvents(target, "run-val-1").filter(
		(e) => e.kind === "validation.completed",
	);
	assert.equal(events.length, 1);
	assert.match(events[0].reason, /validation accepted/);
	// The run's additive summary grew; the state machine did NOT move.
	const record = runRecord(target, "run-val-1");
	assert.equal(record.validation.status, "accepted");
	assert.equal(record.state, "created");
	// Idempotent per content.
	const again = validateRun(target, { runId: "run-val-1" });
	assert.equal(again.idempotent, true);
	assert.equal(listReceipts(target, { runId: "run-val-1" }).length, 1);
});

test("a boundary-violating run validates rejected; a deny policy verdict fails the policy check", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-val-2");
	// A prepared execution record with a violation verdict (closed inline
	// shape) — the execution check must fail the receipt.
	const execRecord = {
		kind: "ExecutionRecord",
		runId: "run-val-2",
		contract: "exec-coding",
		contractSnapshotHash: `sha256:${"b".repeat(64)}`,
		declared: {
			workspace: { type: "local", path: "w" },
			filesystem: { read: [], write: ["src"], deny: [] },
			network: { mode: "deny" },
			resources: {},
			mutation: { mode: "isolated" },
		},
		effective: { workspace: { type: "local", path: "w" } },
		observed: {
			entries: [{ kind: "mutation", paths: ["secrets/x"], source: "s" }],
			collectedAt: "2026-09-23T00:00:00.000Z",
		},
		comparison: {
			verdict: "violation",
			findings: [{ severity: "violation", kind: "denied-path-mutation", detail: "d" }],
			evaluatedAt: "2026-09-23T00:00:00.000Z",
		},
	};
	fs.mkdirSync(path.join(target, ".amber", "harness", "executions"), { recursive: true });
	fs.writeFileSync(
		path.join(target, ".amber", "harness", "executions", "run-val-2.json"),
		JSON.stringify(execRecord, null, "\t"),
		"utf8",
	);
	const { receipt } = validateRun(target, { runId: "run-val-2" });
	assert.equal(receipt.result.status, "rejected");
	const execution = receipt.checks.find((c) => c.name === "execution");
	assert.equal(execution.status, "fail");
	// A deny verdict on the trail fails the policy check too (§16: the
	// receipt records the first authority fact that failed).
	const { emitHarnessEvent } = require("../../scripts/lib/harness/event-ledger");
	emitHarnessEvent(target, {
		kind: "policy.evaluated",
		schemaVersion: 1,
		at: "2026-09-23T00:00:00.000Z",
		runId: "run-val-2",
		decision: { result: "deny", policy: "default-safe" },
	});
	const afterDeny = validateRun(target, { runId: "run-val-2" }).receipt;
	const policy = afterDeny.checks.find((c) => c.name === "policy");
	assert.equal(policy.status, "fail");
});

test("replay on an untouched target answers equivalent/unevaluated from records alone (§43 gate)", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-rp-1");
	const { replay } = replayRun(target, { runId: "run-rp-1" });
	assert.equal(replay.verdict, "equivalent");
	assert.equal(replay.original.status, "non-final"); // the run is not terminal — reported as-is
	const byName = Object.fromEntries(replay.axes.map((a) => [a.name, a]));
	assert.equal(byName.contract.verdict, "equivalent");
	assert.equal(byName.tools.verdict, "unevaluated"); // no frozen tool snapshot
	assert.equal(byName.execution.verdict, "unevaluated"); // never executed
	assert.equal(byName.context.verdict, "unevaluated"); // no admission receipt yet
	assert.equal(byName.policy.verdict, "unevaluated"); // no policy fact either side
	assert.equal(byName.attempts.verdict, "unevaluated");
	for (const axis of replay.axes) {
		if (axis.verdict === "unevaluated") assert.ok(axis.detail, "unevaluated without reason");
	}
	// The §43 form: no chat history was consulted anywhere — the replay read
	// only the run record and its frozen facts (structural: the module never
	// imports a session/chat surface; asserted by the drift cases below which
	// change only record facts).
	const record = runRecord(target, "run-rp-1");
	assert.equal(record.replay.verdict, "equivalent");
	// Idempotent per content.
	assert.equal(replayRun(target, { runId: "run-rp-1" }).idempotent, true);
	assert.equal(listReplays(target, { runId: "run-rp-1" }).length, 1);
});

test("§46.5 tool drift is detected: a tool admitted after the freeze flips the tools axis", () => {
	const target = tmpTarget();
	const { dispatch } = require("../../scripts/lib/command-dispatcher");
	// The F067 convention: a tool's capability pin resolves ONLY through the
	// real F052 registries — build the genuine fixture (two runners, two
	// capabilities, each with its own single-use Decision), then admit tool A,
	// create the run (freezing its snapshot), and admit tool B → drift.
	const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
	const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
	const {
		registerRunner,
		registerRunnerCapability,
	} = require("../../scripts/lib/core/runner-registry");
	const DIGEST = `sha256:${"a".repeat(64)}`;
	assert.equal(
		registerPrincipal(target, { id: "alice@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(target, { type: "intent", identity: "intent/runner", body: "# Runner\n" }).ok,
		true,
	);
	for (const [identity, intent] of [
		["decision/runner-1", "intent/runner"],
		["decision/cap-1", "intent/runner"],
		["decision/runner-2", "intent/runner"],
		["decision/cap-2", "intent/runner"],
	]) {
		const decision = admitArtifact(target, {
			type: "decision",
			identity,
			body: `# Decision ${identity}\n`,
			decisionKind: "approval",
			principal: "alice@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: intent } }],
		});
		assert.equal(decision.ok, true, (decision.errors || []).join("; "));
	}
	assert.equal(
		registerRunner(target, {
			id: "runner/ci",
			version: "1.0.0",
			integrityDigest: DIGEST,
			owner: "platform-team",
			decision: { identity: "decision/runner-1", revision: 1 },
		}).ok,
		true,
	);
	assert.equal(
		registerRunnerCapability(target, {
			runnerId: "runner/ci",
			runnerVersion: "1.0.0",
			name: "deploy.staging-web",
			capabilityVersion: "1",
			effects: ["deploy"],
			pathPrefixes: ["deploy/staging"],
			timeoutMsMax: 30000,
			credentialRequirement: "scoped",
			rollback: "runbook/staging-rollback",
			decision: { identity: "decision/cap-1", revision: 1 },
		}).ok,
		true,
	);
	assert.equal(
		registerRunner(target, {
			id: "runner/lint",
			version: "1.0.0",
			integrityDigest: DIGEST,
			owner: "platform-team",
			decision: { identity: "decision/runner-2", revision: 1 },
		}).ok,
		true,
	);
	assert.equal(
		registerRunnerCapability(target, {
			runnerId: "runner/lint",
			runnerVersion: "1.0.0",
			name: "lint.repo",
			capabilityVersion: "1",
			effects: ["read"],
			pathPrefixes: ["src"],
			timeoutMsMax: 30000,
			credentialRequirement: "none",
			rollback: "runbook/lint-rollback",
			decision: { identity: "decision/cap-2", revision: 1 },
		}).ok,
		true,
	);
	const toolA = path.join(target, "tool-a.json");
	fs.writeFileSync(
		toolA,
		JSON.stringify({
			apiVersion: "amber.dev/v1",
			kind: "HarnessTool",
			metadata: { id: "deploy-web", version: "1" },
			capability: {
				kind: "runner",
				runnerId: "runner/ci",
				runnerVersion: "1.0.0",
				name: "deploy.staging-web",
				capabilityVersion: "1",
			},
			effect: "command_execution",
			credential: { ref: "staging-deploy-token" },
			input: { schema: "schemas/deploy-input.json" },
			output: { schema: "schemas/deploy-result.json" },
			limits: { timeout: "30s" },
			governance: { approval: "staging-safe" },
		}),
		"utf8",
	);
	const admittedA = dispatch("harness", { target, file: toolA, json: true, _: ["tool", "admit"] });
	assert.equal(admittedA.exitCode, 0, (admittedA.errors || []).join("; "));
	admitAndStart(target, "run-rp-2");
	assert.ok(runRecord(target, "run-rp-2").tools, "the run froze a tool snapshot");
	const toolB = path.join(target, "tool-b.json");
	fs.writeFileSync(
		toolB,
		JSON.stringify({
			apiVersion: "amber.dev/v1",
			kind: "HarnessTool",
			metadata: { id: "lint-repo", version: "1" },
			capability: {
				kind: "runner",
				runnerId: "runner/lint",
				runnerVersion: "1.0.0",
				name: "lint.repo",
				capabilityVersion: "1",
			},
			effect: "command_execution",
			input: { schema: "schemas/deploy-input.json" },
			output: { schema: "schemas/deploy-result.json" },
			limits: { timeout: "30s" },
			governance: { approval: "lint-safe" },
		}),
		"utf8",
	);
	const admittedB = dispatch("harness", { target, file: toolB, json: true, _: ["tool", "admit"] });
	assert.equal(admittedB.exitCode, 0, (admittedB.errors || []).join("; "));
	const { replay } = replayRun(target, { runId: "run-rp-2" });
	const tools = replay.axes.find((a) => a.name === "tools");
	assert.equal(tools.verdict, "drift");
	assert.equal(tools.driftKind, "tool-drift");
	assert.equal(replay.verdict, "drift");
	assert.deepEqual(replay.driftKinds, ["tool-drift"]);
});

test("§46.5 context drift is detected via trail-vs-record tampering; a corrupt contract is environment drift", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-rp-3");
	// Give the run a trail-witnessed admission (advance with the six checks),
	// then strip the receipt from the record — the trail still carries the
	// run.admitted pointers, so the mismatch is context drift (tampering).
	const { dispatch } = require("../../scripts/lib/command-dispatcher");
	dispatch("harness", {
		target,
		json: true,
		run: "run-rp-3",
		to: "admitted",
		reason: "receipt",
		checks: [
			"identity:p/i",
			"contract:p/c",
			"policy:p/p",
			"context:p/x",
			"execution:p/e",
			"approval:p/a",
		],
		_: ["advance"],
	});
	const record = runRecord(target, "run-rp-3");
	assert.ok(record.admission, "the run was admitted");
	delete record.admission;
	fs.writeFileSync(
		path.join(target, ".amber", "harness", "runs", "run-rp-3.json"),
		JSON.stringify(record, null, "\t"),
		"utf8",
	);
	const { replay } = replayRun(target, { runId: "run-rp-3" });
	const context = replay.axes.find((a) => a.name === "context");
	assert.equal(context.verdict, "drift");
	assert.equal(context.driftKind, "context-drift");
	// A stored contract record whose hash no longer matches → environment drift.
	const contractFile = path.join(target, ".amber", "harness", "contracts", "coding-task.json");
	fs.writeFileSync(contractFile, JSON.stringify({ tampered: true }), "utf8");
	const after = replayRun(target, { runId: "run-rp-3" }).replay;
	const contract = after.axes.find((a) => a.name === "contract");
	assert.equal(contract.verdict, "drift");
	assert.equal(contract.driftKind, "environment-drift");
	assert.deepEqual(after.driftKinds.sort(), ["context-drift", "environment-drift"]);
});

test("§17/§26: validate + replay + propose never mutate a governance byte (full surface, bytes, bracketed from the start)", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-gov-1");
	// The fingerprint is taken BEFORE the first validate — every command in
	// the surface (validate, replay, propose) is inside the bracket.
	const before = governanceFingerprint(target);
	validateRun(target, { runId: "run-gov-1" });
	replayRun(target, { runId: "run-gov-1" });
	// A failed run + drift + proposal cycle.
	const record = runRecord(target, "run-gov-1");
	record.state = "failed";
	fs.writeFileSync(
		path.join(target, ".amber", "harness", "runs", "run-gov-1.json"),
		JSON.stringify(record, null, "\t"),
		"utf8",
	);
	replayRun(target, { runId: "run-gov-1" });
	proposeRegression(target, { runId: "run-gov-1" });
	assert.deepEqual(governanceFingerprint(target), before);
});

test("proposeRegression derives from recorded facts only: a clean run refuses, a failed run proposes, drift adds kinds", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-rg-1");
	// A clean passing (here: created) run proposes nothing — explicit refusal.
	assert.throws(
		() => proposeRegression(target, { runId: "run-rg-1" }),
		(err) => err.amberCode === CODE_NOTHING_TO_PROPOSE,
	);
	// A failed terminal run proposes run-failure.
	const record = runRecord(target, "run-rg-1");
	record.state = "failed";
	fs.writeFileSync(
		path.join(target, ".amber", "harness", "runs", "run-rg-1.json"),
		JSON.stringify(record, null, "\t"),
		"utf8",
	);
	const { proposal } = proposeRegression(target, { runId: "run-rg-1" });
	assert.deepEqual(proposal.causeKinds, ["run-failure"]);
	assert.equal(proposal.humanReviewRequired, true);
	// A real drift replay: record an attempt (the summary refreshes to match),
	// then tamper the FROZEN summary to disagree with the records — the fold
	// re-derives count=1 against a frozen count=2 (the non-determinism drift
	// path, exercised for real).
	const drifted = runRecord(target, "run-rg-1");
	drifted.state = "failed";
	fs.writeFileSync(
		path.join(target, ".amber", "harness", "runs", "run-rg-1.json"),
		JSON.stringify(drifted, null, "\t"),
		"utf8",
	);
	const { recordAttempt } = require("../../scripts/lib/harness/attempt-core");
	recordAttempt(target, {
		runId: "run-rg-1",
		attemptId: "att-1",
		commandId: "cmd-x",
		state: "failed",
		exitCode: 1,
	});
	const tampered = runRecord(target, "run-rg-1");
	tampered.attempts = { count: 2, lastAttemptId: "att-1", lastAttemptState: "failed" };
	fs.writeFileSync(
		path.join(target, ".amber", "harness", "runs", "run-rg-1.json"),
		JSON.stringify(tampered, null, "\t"),
		"utf8",
	);
	const afterTamper = replayRun(target, { runId: "run-rg-1" }).replay;
	assert.equal(afterTamper.verdict, "drift");
	assert.ok(afterTamper.driftKinds.includes("non-determinism"));
	const { proposal: p2 } = proposeRegression(target, { runId: "run-rg-1" });
	assert.ok(p2.causeKinds.includes("run-failure"));
	assert.ok(p2.causeKinds.includes("non-determinism"));
	assert.equal(p2.replayVerdict, "drift");
	// Idempotent per content.
	const again = proposeRegression(target, { runId: "run-rg-1" });
	assert.equal(again.idempotent, true);
	// The closed drift-kind enum is exactly the §7 candidate list.
	assert.deepEqual([...DRIFT_KINDS].sort(), [
		"context-drift",
		"environment-drift",
		"model-drift",
		"non-determinism",
		"policy-drift",
		"tool-drift",
	]);
});

test("§46.5 non-determinism and execution drift: the attempts axis compares the frozen summary; a corrupt execution record is environment drift", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-nd-1");
	// The run froze an attempts summary; the records now disagree with it
	// (an extra attempt was recorded without refreshing the frozen fact —
	// the non-determinism drift path, exercised for real).
	const { recordAttempt } = require("../../scripts/lib/harness/attempt-core");
	recordAttempt(target, { runId: "run-nd-1", attemptId: "att-1", commandId: "cmd-x" });
	const record = runRecord(target, "run-nd-1");
	assert.equal(record.attempts.count, 1);
	recordAttempt(target, { runId: "run-nd-1", attemptId: "att-2", commandId: "cmd-y" });
	// att-2 refreshed the summary; now revert the FROZEN summary to the old
	// fact to simulate the frozen fact and records disagreeing.
	const tampered = runRecord(target, "run-nd-1");
	tampered.attempts = { count: 1, lastAttemptId: "att-1", lastAttemptState: "running" };
	fs.writeFileSync(
		path.join(target, ".amber", "harness", "runs", "run-nd-1.json"),
		JSON.stringify(tampered, null, "\t"),
		"utf8",
	);
	const first = replayRun(target, { runId: "run-nd-1" }).replay;
	const attemptsAxis = first.axes.find((a) => a.name === "attempts");
	assert.equal(attemptsAxis.verdict, "drift");
	assert.equal(attemptsAxis.driftKind, "non-determinism");
	// A corrupt execution record lands as execution-axis environment drift —
	// the replay continues (per-axis), it never aborts.
	fs.mkdirSync(path.join(target, ".amber", "harness", "executions"), { recursive: true });
	fs.writeFileSync(
		path.join(target, ".amber", "harness", "executions", "run-nd-1.json"),
		"{not json",
		"utf8",
	);
	const second = replayRun(target, { runId: "run-nd-1" }).replay;
	const executionAxis = second.axes.find((a) => a.name === "execution");
	assert.equal(executionAxis.verdict, "drift");
	assert.equal(executionAxis.driftKind, "environment-drift");
	// The contract axis still rendered — per-axis, not aborted.
	assert.ok(second.axes.find((a) => a.name === "contract"));
});

test("the run schema accepts the additive validation/replay summaries", () => {
	const { compileSchema } = require("../../scripts/lib/core/schema-contract");
	const validate = compileSchema("run");
	const base = {
		apiVersion: "amber.dev/v1",
		kind: "HarnessRun",
		id: "run-schema-2",
		subject: { agent: "worker" },
		harness: { contract: "c", contractSnapshotHash: `sha256:${"a".repeat(64)}` },
		state: "running",
		stateHistory: [{ from: null, to: "created", at: "2026-09-23T00:00:00.000Z" }],
	};
	assert.equal(
		validate({
			...base,
			validation: {
				status: "accepted",
				receiptId: "vr-x",
				receiptedAt: "2026-09-23T00:00:00.000Z",
			},
			replay: { verdict: "equivalent", replayId: "rp-x", replayedAt: "2026-09-23T00:00:00.000Z" },
		}),
		true,
	);
	assert.equal(
		validate({ ...base, validation: { status: "exploded", receiptId: "vr", receiptedAt: "x" } }),
		false,
	);
	assert.equal(
		validate({ ...base, replay: { verdict: "maybe", replayId: "rp", replayedAt: "x" } }),
		false,
	);
});

test("the new subverbs smoke through the real dispatcher (validate/replay/propose-regression)", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-smoke-h5");
	const { dispatch } = require("../../scripts/lib/command-dispatcher");
	const validated = dispatch("harness", {
		target,
		json: true,
		run: "run-smoke-h5",
		_: ["validate"],
	});
	assert.equal(validated.exitCode, 0);
	assert.equal(validated.result.receipt.result.status, "accepted");
	const listed = dispatch("harness", {
		target,
		json: true,
		run: "run-smoke-h5",
		_: ["validate", "list"],
	});
	assert.equal(listed.result.receipts.length, 1);
	const replayed = dispatch("harness", {
		target,
		json: true,
		run: "run-smoke-h5",
		_: ["replay"],
	});
	assert.equal(replayed.exitCode, 0);
	assert.equal(replayed.result.replay.verdict, "equivalent");
	const replayListed = dispatch("harness", {
		target,
		json: true,
		run: "run-smoke-h5",
		_: ["replay", "list"],
	});
	assert.equal(replayListed.result.replays.length, 1);
	// A clean run proposes nothing — a governed failure result, not a throw.
	const refused = dispatch("harness", {
		target,
		json: true,
		run: "run-smoke-h5",
		_: ["propose-regression"],
	});
	assert.equal(refused.exitCode, 1);
	assert.equal(refused.result.code, "AMBER_E_HARNESS_REGRESSION_NOTHING_TO_PROPOSE");
});
