"use strict";

// F076 — Cross-run diff (§20, H5 lineage). Conformance at the real path:
// the SAME six-axis derivation the replay engine uses (composed verbatim —
// a per-axis fact for one run equals what `harness replay --run` reports for
// that axis); per-axis same|differs|only-a|only-b; outcome NEVER in the
// verdict; response-only (writes nothing — bytes pinned); same-task
// discipline (unrelated declared tasks refuse); both flags required. All
// cases use their own temporary target directory (suite leak guard).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { diffRuns, replayRun } = require("../../scripts/lib/harness/replay-core");
const { dispatch } = require("../../scripts/lib/command-dispatcher");

function tmpTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-harness-diff-"));
}

function admitAndStart(target, runId, task) {
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
		...(task ? { task } : {}),
		_: ["start"],
	});
}

function runRecord(target, runId) {
	return JSON.parse(
		fs.readFileSync(path.join(target, ".amber", "harness", "runs", `${runId}.json`), "utf8"),
	);
}

test("two runs under the same fixtures diff equivalent-world; the per-axis facts equal what replay reports", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-d1", "task-x");
	admitAndStart(target, "run-d2", "task-x");
	const diff = diffRuns(target, { fromRunId: "run-d1", toRunId: "run-d2" });
	assert.equal(diff.verdict, "equivalent-world");
	assert.ok(diff.axes.every((axis) => axis.comparison === "same"));
	// Same core, self-contained: the from-run's axis facts equal what an
	// actual `harness replay --run` invocation reports for that run (the
	// full replayRun path, not just the shared derivation).
	const replay = replayRun(target, { runId: "run-d1" });
	assert.deepEqual(
		diff.axes.map((a) => [a.name, a.from]),
		replay.replay.axes.map((a) => [a.name, a.verdict]),
	);
	// Outcome states are reported, never compared into the verdict.
	assert.equal(diff.from.state, "created");
	assert.equal(diff.to.state, "created");
});

test("one-sided facts are disclosed (only-a), never guessed into the verdict; a real tool change between runs is world-drift; unrelated tasks refuse", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-e1", "task-y");
	const { recordAttempt } = require("../../scripts/lib/harness/attempt-core");
	recordAttempt(target, { runId: "run-e1", attemptId: "att-1", commandId: "cmd-x" });
	admitAndStart(target, "run-e2", "task-y");
	// run-e1 froze an attempts summary; run-e2 has none → the attempts axis
	// is one-sided (only-a), disclosed; no shared axis differs and the shared
	// contract fact is evaluated → equivalent-world per the spec.
	const diff = diffRuns(target, { fromRunId: "run-e1", toRunId: "run-e2" });
	const attempts = diff.axes.find((a) => a.name === "attempts");
	assert.equal(attempts.comparison, "only-a");
	assert.equal(diff.verdict, "equivalent-world");
	// A REAL differs: the tool registry changed between the two runs — the
	// F052 fixture chain (runner + capability), tool A frozen by run-e1, tool
	// B admitted before run-e2 → run-e1's tools axis drifts, run-e2's is
	// equivalent → world-drift.
	const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
	const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
	const {
		registerRunner,
		registerRunnerCapability,
	} = require("../../scripts/lib/core/runner-registry");
	const DIGEST = `sha256:${"a".repeat(64)}`;
	registerPrincipal(target, { id: "alice@example.com", principalKind: "human" });
	admitArtifact(target, { type: "intent", identity: "intent/runner", body: "# Runner\n" });
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
	registerRunner(target, {
		id: "runner/ci",
		version: "1.0.0",
		integrityDigest: DIGEST,
		owner: "platform-team",
		decision: { identity: "decision/runner-1", revision: 1 },
	});
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
	});
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
	assert.equal(
		dispatch("harness", { target, file: toolA, json: true, _: ["tool", "admit"] }).exitCode,
		0,
	);
	const runG1 = "run-g1";
	admitAndStart(target, runG1, "task-t");
	assert.ok(runRecord(target, runG1).tools, "run-g1 froze a tool snapshot");
	registerRunner(target, {
		id: "runner/lint",
		version: "1.0.0",
		integrityDigest: DIGEST,
		owner: "platform-team",
		decision: { identity: "decision/runner-2", revision: 1 },
	});
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
	});
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
	assert.equal(
		dispatch("harness", { target, file: toolB, json: true, _: ["tool", "admit"] }).exitCode,
		0,
	);
	const runG2 = "run-g2";
	admitAndStart(target, runG2, "task-t");
	const drifted = diffRuns(target, { fromRunId: runG1, toRunId: runG2 });
	const tools = drifted.axes.find((a) => a.name === "tools");
	assert.equal(tools.from, "drift");
	assert.equal(tools.to, "equivalent");
	assert.equal(tools.comparison, "differs");
	assert.equal(drifted.verdict, "world-drift");
	// Unrelated declared tasks refuse.
	admitAndStart(target, "run-e3", "task-z");
	assert.throws(
		() => diffRuns(target, { fromRunId: "run-e1", toRunId: "run-e3" }),
		(err) => err.amberCode === "AMBER_E_INVALID_ARG" && /different tasks/.test(err.message),
	);
});

test("both flags are required; the CLI smokes through the dispatcher; the diff writes nothing", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-f1", "task-w");
	admitAndStart(target, "run-f2", "task-w");
	const runFile = path.join(target, ".amber", "harness", "runs", "run-f1.json");
	const ledgerFile = path.join(target, ".amber", "harness", "events.jsonl");
	const runBytesBefore = fs.readFileSync(runFile, "utf8");
	const trailBefore = fs.readFileSync(ledgerFile, "utf8");
	const viaCli = dispatch("harness", {
		target,
		json: true,
		from: "run-f1",
		to: "run-f2",
		_: ["diff"],
	});
	assert.equal(viaCli.exitCode, 0);
	assert.equal(viaCli.result.verdict, "equivalent-world");
	// One-sided diff refused at the handler.
	const half = dispatch("harness", { target, json: true, from: "run-f1", _: ["diff"] });
	assert.equal(half.exitCode, 1);
	// Nothing was written.
	assert.equal(fs.readFileSync(runFile, "utf8"), runBytesBefore);
	assert.equal(fs.readFileSync(ledgerFile, "utf8"), trailBefore);
});
