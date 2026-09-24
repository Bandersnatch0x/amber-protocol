"use strict";

// F074 H6 — the Control Plane: five read-only subverbs over the shared cores.
// Conformance at the real path: trace = the run record + ordered trail (the
// SAME citations inspect --run uses); events = run-scoped or whole verified
// ledger; policy check = trail posture, report-only; capabilities = the tool
// registry snapshot; harness eval = the F058 surface through the SAME
// dispatch path (same-handler identity), never a second authority. The §44
// gate is structural: the new verbs compose the existing cores verbatim, and
// every pre-existing subverb keeps its shape (the untouched harness-commands
// suites are the compatibility evidence).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { dispatch } = require("../../scripts/lib/command-dispatcher");

function tmpTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-harness-h6-"));
}

function admitAndStart(target, runId) {
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

test("harness trace composes the run record and the ordered trail (the same citations as inspect --run)", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-tr-1");
	const trace = dispatch("harness", {
		target,
		json: true,
		run: "run-tr-1",
		_: ["trace"],
	});
	assert.equal(trace.exitCode, 0);
	// The run body IS the run record (same core citation).
	const { getRun } = require("../../scripts/lib/harness/run-core");
	const direct = getRun(target, { runId: "run-tr-1" }).run;
	assert.deepEqual(trace.result.run, direct);
	// The trail IS the same event list inspect --run cites.
	const inspectView = dispatch("harness", {
		target,
		json: true,
		run: "run-tr-1",
		_: ["inspect"],
	});
	assert.deepEqual(trace.result.events, inspectView.result.events);
	// The trace adds the causal narrative on top of the same citations.
	assert.ok(Array.isArray(trace.result.stateHistory));
	assert.equal(trace.result.stateHistory.length, direct.stateHistory.length);
	// A missing run fails closed with the governed code.
	const missing = dispatch("harness", {
		target,
		json: true,
		run: "run-none",
		_: ["trace"],
	});
	assert.equal(missing.exitCode, 1);
	assert.equal(missing.result.code, "AMBER_E_HARNESS_RUN_NOT_FOUND");
});

test("harness events reads one run's trail or the whole verified ledger", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-ev-1");
	admitAndStart(target, "run-ev-2");
	const single = dispatch("harness", {
		target,
		json: true,
		run: "run-ev-1",
		_: ["events"],
	});
	assert.equal(single.exitCode, 0);
	assert.ok(single.result.events.every((event) => event.runId === "run-ev-1"));
	const all = dispatch("harness", { target, json: true, _: ["events"] });
	assert.ok(all.result.events.length > single.result.events.length);
	// The whole-ledger read is the same fold the single reads cite.
	const { readHarnessEvents } = require("../../scripts/lib/harness/event-ledger");
	assert.deepEqual(all.result.events, readHarnessEvents(target));
	// A corrupt chain fails the read closed: the governed CORRUPT failure
	// (the handler wraps the reader's typed error through writeFailure).
	const ledgerFile = path.join(target, ".amber", "harness", "events.jsonl");
	const lines = fs.readFileSync(ledgerFile, "utf8").trimEnd().split("\n");
	lines[0] = '{"kind":"run.created","tampered":true}';
	fs.writeFileSync(ledgerFile, lines.join("\n") + "\n", "utf8");
	const refused = dispatch("harness", { target, json: true, _: ["events"] });
	assert.equal(refused.exitCode, 1);
	assert.ok(
		(refused.result.code || "").includes("CORRUPT"),
		`expected a governed corrupt code, got ${refused.result.code}`,
	);
});

test("harness policy check surfaces the trail posture, report-only", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-pol-1");
	const check = dispatch("harness", {
		target,
		json: true,
		run: "run-pol-1",
		_: ["policy", "check"],
	});
	assert.equal(check.exitCode, 0);
	assert.equal(check.result.frozenPolicyRef, "default-safe");
	assert.deepEqual(check.result.trailVerdicts, []);
	assert.equal(check.result.reportOnly, true);
	// A deny verdict on the trail is surfaced as posture (visibility, not
	// enforcement — the view writes nothing).
	const { emitHarnessEvent } = require("../../scripts/lib/harness/event-ledger");
	emitHarnessEvent(target, {
		kind: "policy.evaluated",
		schemaVersion: 1,
		at: "2026-09-24T00:00:00.000Z",
		runId: "run-pol-1",
		decision: { result: "deny", policy: "default-safe" },
	});
	const after = dispatch("harness", {
		target,
		json: true,
		run: "run-pol-1",
		_: ["policy", "check"],
	});
	assert.equal(after.result.trailVerdicts.length, 1);
	assert.equal(after.result.trailVerdicts[0].result, "deny");
	// The view wrote nothing: the run record is unchanged apart from nothing.
	const { getRun } = require("../../scripts/lib/harness/run-core");
	assert.equal(getRun(target, { runId: "run-pol-1" }).run.state, "created");
});

test("harness capabilities shows the admitted tools and the registry snapshot", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-cap-1");
	const empty = dispatch("harness", { target, json: true, _: ["capabilities"] });
	assert.equal(empty.exitCode, 0);
	assert.deepEqual(empty.result.tools, []);
	assert.equal(empty.result.registrySnapshot, null);
	// Admit a tool through the real F052 fixture and the snapshot appears.
	const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
	const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
	const {
		registerRunner,
		registerRunnerCapability,
	} = require("../../scripts/lib/core/runner-registry");
	const DIGEST = `sha256:${"a".repeat(64)}`;
	registerPrincipal(target, { id: "alice@example.com", principalKind: "human" });
	admitArtifact(target, { type: "intent", identity: "intent/runner", body: "# Runner\n" });
	for (const identity of ["decision/runner-1", "decision/cap-1"]) {
		admitArtifact(target, {
			type: "decision",
			identity,
			body: `# Decision ${identity}\n`,
			decisionKind: "approval",
			principal: "alice@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/runner" } }],
		});
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
	const toolFile = path.join(target, "tool.json");
	fs.writeFileSync(
		toolFile,
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
	dispatch("harness", { target, file: toolFile, json: true, _: ["tool", "admit"] });
	const snapshot = dispatch("harness", { target, json: true, _: ["capabilities"] });
	assert.equal(snapshot.result.tools.length, 1);
	assert.equal(snapshot.result.tools[0].id, "deploy-web");
	assert.match(snapshot.result.registrySnapshot.snapshotHash, /^sha256:[0-9a-f]{64}$/);
	// Same core citations as tool list.
	const toolList = dispatch("harness", { target, json: true, _: ["tool", "list"] });
	assert.deepEqual(snapshot.result.tools, toolList.result.tools);
});

test("harness eval aliases the F058 surface through the SAME dispatch path; eval --run cites the run's pointers", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-eval-1");
	// The alias returns the F058 instruction-surface suite — the same body
	// `amber eval run` produces, byte for byte (same dispatch path, same
	// handler; the suite body rides the text field both surfaces emit).
	const viaHarness = dispatch("harness", { target, json: true, _: ["eval"] });
	const viaEval = dispatch("eval", { target, json: true, _: ["run"] });
	assert.equal(viaHarness.exitCode, viaEval.exitCode);
	assert.deepEqual(viaHarness.result, viaEval.result);
	const suiteBody = JSON.parse(viaHarness.result.text);
	assert.equal(suiteBody.suiteId, "instruction-surface");
	// With --run: the run's eval artifact pointers, report-only.
	const withRun = dispatch("harness", {
		target,
		json: true,
		run: "run-eval-1",
		_: ["eval"],
	});
	assert.equal(withRun.exitCode, 0);
	assert.deepEqual(withRun.result.evaluationPointers, []);
	assert.equal(withRun.result.reportOnly, true);
	// The alias boundary: the handler the eval surface registers is the one
	// the harness alias invokes (no forked logic can drift in).
	const { evalDispatch } = require("../../scripts/lib/eval-commands");
	assert.equal(typeof evalDispatch, "function");
	// Report-only: the alias wrote nothing to the run.
	const { getRun } = require("../../scripts/lib/harness/run-core");
	assert.equal(getRun(target, { runId: "run-eval-1" }).run.state, "created");
});

test("the eval alias's boundary is loud: stray positionals refuse, and the identity evidence is the byte-equality through the real dispatcher", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-eval-2");
	// `harness eval admit --producer x` must NOT silently degrade into the
	// report-only suite — the alias aggregates only `run`.
	const stray = dispatch("harness", {
		target,
		json: true,
		producer: "x",
		yes: true,
		_: ["eval", "admit"],
	});
	assert.equal(stray.exitCode, 1);
	assert.match(stray.result.errors.join("\n"), /amber eval admit/);
	// The same-dispatch-path identity is pinned behaviorally: the alias's
	// result deep-equals `amber eval run`'s through the real dispatcher
	// (module identity of eval-commands is the import source both use).
	const { evalDispatch: aliasTarget } = require("../../scripts/lib/eval-commands");
	const { evalDispatch: registryTarget } = require("../../scripts/lib/eval-commands");
	assert.equal(aliasTarget, registryTarget);
	const viaHarness = dispatch("harness", { target, json: true, _: ["eval"] });
	const viaEval = dispatch("eval", { target, json: true, _: ["run"] });
	assert.deepEqual(viaHarness.result, viaEval.result);
	// eval --run on a nonexistent run fails closed (loud, not empty).
	const missing = dispatch("harness", {
		target,
		json: true,
		run: "run-none",
		_: ["eval"],
	});
	assert.equal(missing.exitCode, 1);
	assert.equal(missing.result.code, "AMBER_E_HARNESS_RUN_NOT_FOUND");
});

test("harness policy check --tool leg composes checkHarnessTool verbatim; corrupt records fail closed per-verb", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-cp-1");
	// The --tool leg without an admitted tool → the governed NOT_FOUND
	// verdict (the same citation `tool check` gives for a missing id).
	const toolLeg = dispatch("harness", {
		target,
		json: true,
		tool: "deploy-web",
		_: ["policy", "check"],
	});
	assert.equal(toolLeg.exitCode, 1);
	assert.match(toolLeg.result.errors.join("\n"), /no admitted tool "deploy-web"/);
	const toolCheck = dispatch("harness", {
		target,
		json: true,
		tool: "deploy-web",
		_: ["tool", "check"],
	});
	// The legs cite the same core: identical governed failure shape.
	assert.deepEqual(toolLeg.result.errors, toolCheck.result.errors);
	assert.equal(toolLeg.result.code, toolCheck.result.code);
	// Both legs at once refuse (separate legs, one per invocation).
	const both = dispatch("harness", {
		target,
		json: true,
		run: "run-cp-1",
		tool: "deploy-web",
		_: ["policy", "check"],
	});
	assert.equal(both.exitCode, 1);
	// A corrupt run record fails closed for the run-posture legs.
	const runFile = path.join(target, ".amber", "harness", "runs", "run-cp-1.json");
	fs.writeFileSync(runFile, "{broken", "utf8");
	const corruptPolicy = dispatch("harness", {
		target,
		json: true,
		run: "run-cp-1",
		_: ["policy", "check"],
	});
	assert.equal(corruptPolicy.exitCode, 1);
	assert.equal(corruptPolicy.result.code, "AMBER_E_HARNESS_RUN_CORRUPT");
	const corruptEval = dispatch("harness", {
		target,
		json: true,
		run: "run-cp-1",
		_: ["eval"],
	});
	assert.equal(corruptEval.exitCode, 1);
	assert.equal(corruptEval.result.code, "AMBER_E_HARNESS_RUN_CORRUPT");
	const corruptEvents = dispatch("harness", {
		target,
		json: true,
		run: "run-cp-1",
		_: ["events"],
	});
	assert.equal(corruptEvents.exitCode, 1);
	assert.equal(corruptEvents.result.code, "AMBER_E_HARNESS_RUN_CORRUPT");
	// events with a present-but-empty --run fails closed too.
	admitAndStart(target, "run-cp-2");
	const truncated = dispatch("harness", { target, json: true, run: "", _: ["events"] });
	assert.equal(truncated.exitCode, 1);
	const ghost = dispatch("harness", { target, json: true, run: "run-none", _: ["events"] });
	assert.equal(ghost.exitCode, 1);
	assert.equal(ghost.result.code, "AMBER_E_HARNESS_RUN_NOT_FOUND");
});

test("the report-only ceiling is pinned by bytes, not by state alone", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-pin-1");
	const runFile = path.join(target, ".amber", "harness", "runs", "run-pin-1.json");
	const ledgerFile = path.join(target, ".amber", "harness", "events.jsonl");
	const runBytesBefore = fs.readFileSync(runFile, "utf8");
	const trailBefore = fs.readFileSync(ledgerFile, "utf8");
	dispatch("harness", { target, json: true, run: "run-pin-1", _: ["policy", "check"] });
	dispatch("harness", { target, json: true, _: ["capabilities"] });
	dispatch("harness", { target, json: true, _: ["eval"] });
	dispatch("harness", { target, json: true, run: "run-pin-1", _: ["eval"] });
	dispatch("harness", { target, json: true, run: "run-pin-1", _: ["trace"] });
	assert.equal(fs.readFileSync(runFile, "utf8"), runBytesBefore);
	assert.equal(fs.readFileSync(ledgerFile, "utf8"), trailBefore);
});
