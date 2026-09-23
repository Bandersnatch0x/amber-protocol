"use strict";

// F072 H4 ticket 0111 — Attempts are first-class run-scoped records.
// Conformance at the real path: recordAttempt writes the closed-shape record
// and refreshes the run's additive `attempts` summary; terminal attempts are
// immutable; listAttempts folds deterministically; detectNoProgress reports
// (never enforces) the §49 signal; runPreparedExecution records each governed
// attempt (including refusals) and emits execution.started/completed/failed.
// All cases use their own temporary target directory (suite leak guard).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	recordAttempt,
	listAttempts,
	getAttempt,
	detectNoProgress,
	CODE_FINAL,
	CODE_CORRUPT,
} = require("../../scripts/lib/harness/attempt-core");

function tmpTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-harness-attempt-"));
}

// One admitted contract + one run, through the real dispatcher.
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

test("recordAttempt writes a running record then freezes the outcome; the run summary grows", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-att-1");
	const started = recordAttempt(target, {
		runId: "run-att-1",
		attemptId: "att-1",
		commandId: "cmd-tests",
		governedRef: "governed-ledger:run-att-1#att-1",
	});
	assert.equal(started.attempt.state, "running");
	assert.equal(started.attempt.finishedAt, undefined);
	const done = recordAttempt(target, {
		runId: "run-att-1",
		attemptId: "att-1",
		commandId: "cmd-tests",
		state: "completed",
		exitCode: 0,
		now: "2026-09-23T10:00:00.000Z",
	});
	assert.equal(done.attempt.state, "completed");
	assert.equal(done.attempt.exitCode, 0);
	assert.equal(done.attempt.finishedAt, "2026-09-23T10:00:00.000Z");
	// The run's additive summary section.
	const { getRun } = require("../../scripts/lib/harness/run-core");
	const { run } = getRun(target, { runId: "run-att-1" });
	assert.deepEqual(run.attempts, {
		count: 1,
		lastAttemptId: "att-1",
		lastAttemptState: "completed",
	});
});

test("a terminal attempt refuses any rewrite (records are immutable)", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-att-2");
	recordAttempt(target, { runId: "run-att-2", attemptId: "att-1", commandId: "cmd-tests" });
	recordAttempt(target, {
		runId: "run-att-2",
		attemptId: "att-1",
		commandId: "cmd-tests",
		state: "failed",
		exitCode: 1,
	});
	assert.throws(
		() =>
			recordAttempt(target, {
				runId: "run-att-2",
				attemptId: "att-1",
				commandId: "cmd-tests",
				state: "completed",
			}),
		(err) => err.amberCode === CODE_FINAL,
	);
});

test("an unknown outcome state and a malformed record both fail closed", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-att-3");
	assert.throws(
		() =>
			recordAttempt(target, { runId: "run-att-3", attemptId: "a", commandId: "c", state: "weird" }),
		(err) => err.amberCode === "AMBER_E_INVALID_ARG",
	);
	const file = path.join(target, ".amber", "harness", "attempts", "run-att-3", "att-x.json");
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify({ attemptId: "att-x", state: "exploded" }), "utf8");
	assert.throws(
		() => listAttempts(target, { runId: "run-att-3" }),
		(err) => err.amberCode === CODE_CORRUPT,
	);
});

test("listAttempts folds deterministically; getAttempt fails closed on a missing id", () => {
	const target = tmpTarget();
	admitAndStart(target, "run-att-4");
	assert.deepEqual(listAttempts(target, { runId: "run-att-4" }), []);
	recordAttempt(target, { runId: "run-att-4", attemptId: "att-b", commandId: "cmd-2" });
	recordAttempt(target, { runId: "run-att-4", attemptId: "att-a", commandId: "cmd-1" });
	const listed = listAttempts(target, { runId: "run-att-4" });
	assert.deepEqual(
		listed.map((a) => a.attemptId),
		["att-a", "att-b"],
	);
	const { CODE_NOT_FOUND } = require("../../scripts/lib/harness/attempt-core");
	assert.throws(
		() => getAttempt(target, { runId: "run-att-4", attemptId: "att-zzz" }),
		(err) => err.amberCode === CODE_NOT_FOUND,
	);
});

test("detectNoProgress reports two consecutive identical failures and stays silent otherwise", () => {
	const failed = (commandId, exitCode, attemptId) => ({
		attemptId,
		state: "failed",
		commandId,
		exitCode,
	});
	// Two identical failures → detected.
	assert.deepEqual(detectNoProgress([failed("cmd-tests", 1, "a1"), failed("cmd-tests", 1, "a2")]), {
		detected: true,
		commandId: "cmd-tests",
		exitCode: 1,
		consecutiveFailures: 2,
	});
	// A single failure never reaches the two-consecutive threshold.
	assert.equal(detectNoProgress([failed("cmd-tests", 1, "a1")]).detected, false);
	// A completed attempt between failures resets the streak.
	assert.equal(
		detectNoProgress([failed("c", 1, "a1"), { ...failed("c", 1, "a2"), state: "completed" }])
			.detected,
		false,
	);
	// Different exit codes do not count as the same failure.
	assert.equal(detectNoProgress([failed("c", 1, "a1"), failed("c", 2, "a2")]).detected, false);
	// A zero exitCode is not a failure at all.
	assert.equal(detectNoProgress([failed("c", 0, "a1"), failed("c", 0, "a2")]).detected, false);
	// A refused attempt resets too.
	assert.equal(
		detectNoProgress([failed("c", 1, "a1"), { ...failed("c", 1, "a2"), state: "refused" }])
			.detected,
		false,
	);
	// An undefined exitCode never reads as a failure code (integer required).
	assert.equal(
		detectNoProgress([
			{ ...failed("c", 1, "a1"), exitCode: undefined },
			{ ...failed("c", 1, "a2"), exitCode: undefined },
		]).detected,
		false,
	);
});

// H2b fixture pattern (tests/unit/harness-execution.test.js): a real git
// repo, an admitted ExecutionContract, and a governed rules.json — the full
// governed path, not a mock.
function git(dir, args) {
	require("node:child_process").execFileSync("git", args, { cwd: dir, stdio: "ignore" });
}

function governedFixture(target, runId, commandPattern) {
	const { dispatch } = require("../../scripts/lib/command-dispatcher");
	git(target, ["init", "-b", "main"]);
	git(target, ["config", "user.email", "test@example.com"]);
	git(target, ["config", "user.name", "test"]);
	fs.writeFileSync(path.join(target, "seed.txt"), "seed\n");
	git(target, ["add", "."]);
	git(target, ["commit", "-m", "init"]);
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
	const execFile = path.join(target, "exec.json");
	fs.writeFileSync(
		execFile,
		JSON.stringify({
			apiVersion: "amber.dev/v1",
			kind: "ExecutionContract",
			metadata: { id: "exec-coding", version: "1" },
			workspace: { type: "git-worktree", base: "HEAD" },
			filesystem: { read: ["src"], write: ["src"], deny: [".amber", "secrets"] },
			network: { mode: "deny" },
			resources: { timeoutMinutes: 30, maxChildren: 8 },
			mutation: { mode: "isolated" },
		}),
		"utf8",
	);
	dispatch("harness", { target, file: execFile, json: true, _: ["execution", "admit"] });
	dispatch("harness", {
		target,
		json: true,
		contract: "coding-task",
		agent: "worker",
		run: runId,
		_: ["start"],
	});
	dispatch("harness", {
		target,
		json: true,
		contract: "exec-coding",
		run: runId,
		_: ["execution", "prepare"],
	});
	const rulesPath = path.join(target, ".amber", "governance", "rules.json");
	fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
	fs.writeFileSync(
		rulesPath,
		JSON.stringify({
			schemaVersion: 1,
			defaultAction: "deny",
			confidence_gating: {
				enabled: true,
				byRule: { "h2b-ok": "high" },
				defaultConfidence: "low",
			},
			rules: [{ id: "h2b-ok", action: "allow", match: "exact", pattern: commandPattern }],
		}),
		"utf8",
	);
	return dispatch;
}

test("a successful governed attempt emits started + completed, records the attempt, and grows the run summary", () => {
	const target = tmpTarget();
	try {
		const command = `node -e "require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/ok.txt','x')"`;
		const dispatch = governedFixture(target, "run-att-gov-1", command);
		const { appendLedgerRecord } = require("../../scripts/lib/core/loop-ledger");
		appendLedgerRecord(path.join(target, ".amber", "loops", "run-att-gov-1", "ledger.jsonl"), {
			kind: "approved",
			approvalKey: "run-att-gov-1:approval",
		});
		const attempt = dispatch("harness", {
			target,
			json: true,
			run: "run-att-gov-1",
			commandId: "h2b-ok",
			_: ["execution", "run"],
		});
		assert.equal(attempt.exitCode, 0, "the governed command succeeded");
		assert.equal(attempt.result.attemptState, "completed");
		// The trail carries started then completed, run-scoped.
		const { readRunEvents } = require("../../scripts/lib/harness/event-ledger");
		const events = readRunEvents(target, "run-att-gov-1").filter((e) =>
			e.kind.startsWith("execution."),
		);
		assert.deepEqual(
			events.map((e) => e.kind),
			["execution.started", "execution.completed"],
		);
		// The attempt record is terminal with its exit code.
		const attempts = listAttempts(target, { runId: "run-att-gov-1" });
		assert.equal(attempts.length, 1);
		assert.equal(attempts[0].state, "completed");
		assert.equal(attempts[0].exitCode, 0);
		// The run's additive summary grew.
		const { getRun } = require("../../scripts/lib/harness/run-core");
		assert.equal(
			getRun(target, { runId: "run-att-gov-1" }).run.attempts.lastAttemptState,
			"completed",
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("a failing governed attempt emits started + failed with the non-zero exit code recorded", () => {
	const target = tmpTarget();
	try {
		const command = `node -e "process.exit(3)"`;
		const dispatch = governedFixture(target, "run-att-gov-2", command);
		const { appendLedgerRecord } = require("../../scripts/lib/core/loop-ledger");
		appendLedgerRecord(path.join(target, ".amber", "loops", "run-att-gov-2", "ledger.jsonl"), {
			kind: "approved",
			approvalKey: "run-att-gov-2:approval",
		});
		const attempt = dispatch("harness", {
			target,
			json: true,
			run: "run-att-gov-2",
			commandId: "h2b-ok",
			_: ["execution", "run"],
		});
		assert.equal(attempt.exitCode, 1, "the failed command reports non-zero");
		const { readRunEvents } = require("../../scripts/lib/harness/event-ledger");
		const events = readRunEvents(target, "run-att-gov-2").filter((e) =>
			e.kind.startsWith("execution."),
		);
		assert.deepEqual(
			events.map((e) => e.kind),
			["execution.started", "execution.failed"],
		);
		const attempts = listAttempts(target, { runId: "run-att-gov-2" });
		assert.equal(attempts[0].state, "failed");
		assert.equal(attempts[0].exitCode, 3);
		// The same failure twice is the reported (never enforced) no-progress.
		appendLedgerRecord(path.join(target, ".amber", "loops", "run-att-gov-2", "ledger.jsonl"), {
			kind: "approved",
			approvalKey: "run-att-gov-2:approval-2",
		});
		dispatch("harness", {
			target,
			json: true,
			run: "run-att-gov-2",
			commandId: "h2b-ok",
			_: ["execution", "run"],
		});
		const { detectNoProgress } = require("../../scripts/lib/harness/attempt-core");
		assert.deepEqual(detectNoProgress(listAttempts(target, { runId: "run-att-gov-2" })), {
			detected: true,
			commandId: "h2b-ok",
			exitCode: 3,
			consecutiveFailures: 2,
		});
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("a gate refusal emits execution.failed with the refusal reason and records state refused", () => {
	const target = tmpTarget();
	try {
		const command = `node -e "require('fs').writeFileSync('src/never.txt','x')"`;
		const dispatch = governedFixture(target, "run-att-gov-3", command);
		// The closed rule exists, but the run's ledger has NO unconsumed
		// approval — the approval gate refuses before any effect.
		const attempt = dispatch("harness", {
			target,
			json: true,
			run: "run-att-gov-3",
			commandId: "h2b-ok",
			_: ["execution", "run"],
		});
		assert.equal(attempt.exitCode, 1);
		assert.equal(attempt.result.refused, true);
		const { readRunEvents } = require("../../scripts/lib/harness/event-ledger");
		const events = readRunEvents(target, "run-att-gov-3").filter((e) =>
			e.kind.startsWith("execution."),
		);
		assert.deepEqual(
			events.map((e) => e.kind),
			["execution.started", "execution.failed"],
		);
		assert.match(events[1].reason, /refused before any effect/);
		const attempts = listAttempts(target, { runId: "run-att-gov-3" });
		assert.equal(attempts[0].state, "refused");
		assert.match(attempts[0].reason, /approval/i);
		// A refused attempt observes nothing (F070 behavior preserved).
		const record = JSON.parse(
			fs.readFileSync(
				path.join(target, ".amber", "harness", "executions", "run-att-gov-3.json"),
				"utf8",
			),
		);
		assert.equal(record.observed, undefined);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("the attempt surface exports stay minimal and the governed runner is composable", () => {
	// The attempt core never re-judges a gate: it only records what the
	// governed runner already decided. Compose-only is a structural fact of
	// the wiring (runPreparedExecution calls recordAttempt; the four gates
	// stay in Core) — the real-path emission/refusal cases above exercise the
	// wiring end to end.
	const surface = require("../../scripts/lib/harness/attempt-core");
	for (const name of ["recordAttempt", "listAttempts", "getAttempt", "detectNoProgress"]) {
		assert.equal(typeof surface[name], "function");
	}
	assert.deepEqual([...surface.ATTEMPT_STATES], ["running", "completed", "failed", "refused"]);
});

test("the run schema accepts the additive attempts summary and rejects unknown fields", () => {
	const { compileSchema } = require("../../scripts/lib/core/schema-contract");
	const validate = compileSchema("run");
	const base = {
		apiVersion: "amber.dev/v1",
		kind: "HarnessRun",
		id: "run-schema-1",
		subject: { agent: "worker" },
		harness: { contract: "c", contractSnapshotHash: `sha256:${"a".repeat(64)}` },
		state: "running",
		stateHistory: [{ from: null, to: "created", at: "2026-09-23T00:00:00.000Z" }],
	};
	assert.equal(
		validate({ ...base, attempts: { count: 2, lastAttemptId: "a", lastAttemptState: "failed" } }),
		true,
	);
	assert.equal(
		validate({
			...base,
			checkpoints: {
				count: 1,
				lastCheckpointId: "ck",
				lastCheckpointAt: "2026-09-23T00:00:00.000Z",
			},
		}),
		true,
	);
	assert.equal(validate({ ...base, attempts: { count: 1, lastAttemptId: "a" } }), false);
	assert.equal(
		validate({ ...base, attempts: { count: 1, lastAttemptId: "a", lastAttemptState: "exploded" } }),
		false,
	);
});

// Spec Testing Decision: flag mapping must be smoke-tested through the real
// CLI (the parseArgs FLAG_SPECS whitelist silently turns unregistered flags
// into positionals). Raw argv against the real scripts/amber.js process.
test("raw-CLI --attempt maps through FLAG_SPECS (the earlier gap: a missing whitelist entry made inspect unusable)", () => {
	const { spawnSync } = require("node:child_process");
	const target = tmpTarget();
	try {
		admitAndStart(target, "run-rawcli-1");
		const result = spawnSync(
			process.execPath,
			[
				path.join(__dirname, "..", "..", "scripts", "amber.js"),
				"harness",
				"attempt",
				"inspect",
				"--run",
				"run-rawcli-1",
				"--attempt",
				"att-none",
				"--target",
				target,
				"--json",
			],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 1);
		// The flag reached the handler: the governed NOT_FOUND failure (not
		// the "required" positional trap).
		assert.match(result.stdout, /AMBER_E_HARNESS_ATTEMPT_NOT_FOUND/);
		assert.doesNotMatch(result.stdout, /--attempt <id> is required/);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});
