"use strict";

// F081 — owned governed-execution handles and truthful cancellation.
//
// Every case drives the REAL seam: a real git target, a real rules file, a real
// approved ledger, a real spawned child, a real persisted handle, and a real
// signal. Cancellation is asserted on what it OBSERVED (`terminated` /
// `already-exited` / `unknown` / no-handle), never on a claim.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync, spawn } = require("node:child_process");

const { runGovernedCommand } = require("../../scripts/lib/core/governed-runner");
const { appendLedgerRecord, readLedger } = require("../../scripts/lib/core/loop-ledger");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { readHarnessEvents, emitHarnessEvent } = require("../../scripts/lib/harness/event-ledger");
const { canonicalHashOf } = require("../../scripts/lib/core/registry-ledger");
const {
	readExecutionHandle,
	persistExecutionHandle,
	clearExecutionHandle,
	isProcessAlive,
} = require("../../scripts/lib/core/execution-handles");
const {
	cancelExecution,
	handleView,
	CODE_NO_HANDLE,
	CODE_CONFLICT,
	OUTCOMES,
} = require("../../scripts/lib/harness/execution-cancel");

const RUN_ID = "run-cancel-1";
const SLEEP_COMMAND = `node -e "setTimeout(()=>{},60000)"`;

function tmpTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cancel-${label}-`));
}

function writeRules(target, rules) {
	const dir = path.join(target, ".amber", "governance");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "rules.json"), JSON.stringify(rules));
}

function gitTarget(label, rules) {
	const target = tmpTarget(label);
	execFileSync("git", ["init", "-q"], { cwd: target });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: target });
	execFileSync("git", ["config", "user.name", "Amber test"], { cwd: target });
	fs.writeFileSync(path.join(target, ".gitignore"), ".amber/\n");
	fs.writeFileSync(path.join(target, "fixture.txt"), "fixture\n");
	execFileSync("git", ["add", "."], { cwd: target });
	execFileSync("git", ["commit", "-qm", "fixture"], { cwd: target });
	writeRules(target, rules);
	return target;
}

function allowRules(pattern, id = "allow-cancel") {
	return {
		schemaVersion: 1,
		defaultAction: "deny",
		confidence_gating: {
			enabled: true,
			byRule: { [id]: "high" },
			defaultConfidence: "low",
		},
		rules: [{ id, action: "allow", match: "exact", pattern }],
	};
}

function ledgerPathOf(target) {
	return path.join(target, ".amber", "loops", "cancel-run", "ledger.jsonl");
}

function approve(target) {
	appendLedgerRecord(ledgerPathOf(target), {
		kind: "approved",
		approvalKey: "cancel-run:approval",
	});
}

// One registered human plus the two committed Decisions a cancellation needs.
function decisionFixture(target, identities = ["decision/cancel-1", "decision/cancel-2"]) {
	registerPrincipal(target, { id: "alice@example.com", principalKind: "human" });
	registerPrincipal(target, { id: "bot@example.com", principalKind: "service" });
	assert.equal(
		admitArtifact(target, { type: "intent", identity: "intent/cancel", body: "# Cancel\n" }).ok,
		true,
	);
	for (const identity of identities) {
		const admitted = admitArtifact(target, {
			type: "decision",
			identity,
			body: `# ${identity}\n`,
			decisionKind: "approval",
			principal: "alice@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/cancel" } }],
		});
		assert.equal(admitted.ok, true, (admitted.errors || []).join("; "));
	}
}

// Start one governed execution and hand back its promise plus the observed
// handle. The command sleeps, so the handle is live when it resolves. A
// prepared workspace is used when one is supplied: that is the workspace whose
// survival a cancellation must not change (a throwaway worktree is removed by
// the seam itself, as it always was).
async function startRunning(
	target,
	{ commandId = "allow-cancel", label = "cancel-run", workspace = null } = {},
) {
	const promise = runGovernedCommand({
		target,
		commandId,
		ledgerPath: ledgerPathOf(target),
		label,
		subject: { runId: RUN_ID },
		budgetMinutes: 5,
		...(workspace === null ? {} : { preparedWorkspacePath: workspace }),
	});
	const handleFile = path.join(target, ".amber", "harness", "executions", `${RUN_ID}.handle.json`);
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline && !fs.existsSync(handleFile)) {
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	assert.ok(fs.existsSync(handleFile), "the governed execution persisted an owned handle");
	const handle = readExecutionHandle(target, RUN_ID);
	assert.ok(handle && handle.status === "live", JSON.stringify(handle));
	return { promise, handle };
}

test("the closed cancellation outcome vocabulary is exactly what was observed", () => {
	assert.deepEqual([...OUTCOMES], ["terminated", "already-exited", "unknown"]);
});

test("cancelling a live governed execution reports terminated, retains the workspace, and spends its own Decision", async () => {
	const target = gitTarget("live", allowRules(SLEEP_COMMAND));
	// A prepared workspace is the case where retention is observable: the
	// throwaway worktree case is removed by the seam itself, as it always was.
	const preparedWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "amber-cancel-ws-"));
	try {
		decisionFixture(target);
		approve(target);
		const { promise, handle } = await startRunning(target, { workspace: preparedWorkspace });
		const workspace = handle.workspace;
		assert.equal(workspace, preparedWorkspace, "the handle names the prepared workspace");
		try {
			const cancelled = await cancelExecution(target, {
				runId: RUN_ID,
				decision: { identity: "decision/cancel-1", revision: 1 },
				reason: "operator stopped a hung verification",
			});
			assert.equal(cancelled.ok, true);
			assert.equal(cancelled.outcome, "terminated");
			assert.equal(cancelled.aliveBefore, true);
			assert.equal(cancelled.handleCleared, true, "the settling process removed the handle");
			assert.equal(isProcessAlive(handle.pid), false, "the observed pid is gone");
			// The workspace is NOT deleted by a cancellation (that is `release`).
			assert.equal(cancelled.workspaceRetained, true);
			assert.ok(fs.existsSync(workspace));
			assert.deepEqual(cancelled.authority, {
				launchAuthority: false,
				deletedWorkspace: false,
				rewroteRunResult: false,
			});

			// The cancellation is a recorded fact with its observed outcome, and
			// it carries the cancellation Decision's spend pointer.
			const record = JSON.parse(fs.readFileSync(cancelled.cancellationFile, "utf8"));
			assert.equal(record.outcome, "terminated");
			assert.equal(record.handlePid, handle.pid);
			assert.match(record.snapshotHash, /^sha256:[0-9a-f]{64}$/);
			const events = readHarnessEvents(target).filter(
				(event) => event.kind === "execution.cancelled",
			);
			assert.equal(events.length, 1);
			assert.equal(events[0].runId, RUN_ID);
			assert.deepEqual(events[0].pointers, [
				`execution-cancel:${RUN_ID}#${record.snapshotHash}`,
				"execution-cancel-decision:decision/cancel-1@1",
			]);

			// The attempt itself settles normally: the cancellation never writes a
			// second terminal fact, it only records what it observed.
			const outcome = await promise;
			assert.equal(outcome.executed, true);
			assert.notEqual(outcome.exitCode, 0, "a signalled command did not succeed");
			const executed = readLedger(ledgerPathOf(target)).filter((r) => r.kind === "executed");
			assert.equal(executed.length, 1, "one terminal execution fact");

			// A second cancellation refuses: one cancel per attempt, and the
			// Decision is single-use.
			await assert.rejects(
				() =>
					cancelExecution(target, {
						runId: RUN_ID,
						decision: { identity: "decision/cancel-1", revision: 1 },
						reason: "again",
					}),
				(error) => [CODE_NO_HANDLE, CODE_CONFLICT].includes(error.amberCode),
			);
		} finally {
			if (isProcessAlive(handle.pid)) {
				try {
					process.kill(handle.pid, "SIGKILL");
				} catch (_error) {
					/* already gone */
				}
			}
			await promise.catch(() => {});
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		fs.rmSync(preparedWorkspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

test("a run with no handle refuses and writes nothing; a stale handle reports already-exited", async () => {
	const target = gitTarget("no-handle", allowRules(SLEEP_COMMAND));
	try {
		decisionFixture(target);
		approve(target);
		// No handle at all: the refusal names the absence, it does not assume
		// "probably stopped".
		await assert.rejects(
			() =>
				cancelExecution(target, {
					runId: "run-never-started",
					decision: { identity: "decision/cancel-1", revision: 1 },
					reason: "nothing to cancel",
				}),
			(error) =>
				error.amberCode === CODE_NO_HANDLE && /no live execution handle/.test(error.message),
		);
		assert.equal(
			fs.existsSync(path.join(target, ".amber", "harness", "executions", "cancellations")),
			false,
			"a refused cancellation writes no record",
		);

		// A stale handle (recorded pid already gone) is reconciled, never read
		// as a kill: the outcome is `already-exited`.
		const handleFile = path.join(
			target,
			".amber",
			"harness",
			"executions",
			`${RUN_ID}.handle.json`,
		);
		fs.mkdirSync(path.dirname(handleFile), { recursive: true });
		const { canonicalHashOf } = require("../../scripts/lib/core/registry-ledger");
		const stale = {
			schemaVersion: 1,
			runId: RUN_ID,
			attemptId: "att-stale",
			label: "cancel-run",
			commandId: "allow-cancel",
			workspace: target,
			pid: 999_999,
			leaseId: "stale-lease",
			fence: 1,
			startedAt: "2026-09-24T00:00:00.000Z",
			deadlineAt: "2026-09-24T00:05:00.000Z",
			target: path.resolve(target),
		};
		stale.snapshotHash = canonicalHashOf(stale);
		fs.writeFileSync(handleFile, `${JSON.stringify(stale, null, "\t")}\n`, "utf8");
		const view = handleView(target, { runId: RUN_ID });
		assert.equal(view.handles[0].status, "stale");
		assert.match(view.handles[0].reconciliation, /never a kill/);

		const reconciled = await cancelExecution(target, {
			runId: RUN_ID,
			decision: { identity: "decision/cancel-1", revision: 1 },
			reason: "controller restarted",
		});
		assert.equal(reconciled.outcome, "already-exited");
		assert.equal(reconciled.aliveBefore, false);
		assert.equal(reconciled.signalResult.signalled, false);
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

test("cancellation refuses a non-human, reused, or missing Decision and consumes nothing", async () => {
	const target = gitTarget("authority", allowRules(SLEEP_COMMAND));
	try {
		decisionFixture(target, ["decision/cancel-1"]);
		approve(target);
		const { promise, handle } = await startRunning(target);
		try {
			// A service identity can never hold an approval slot.
			assert.equal(
				admitArtifact(target, {
					type: "decision",
					identity: "decision/cancel-service",
					body: "# service\n",
					decisionKind: "approval",
					principal: "bot@example.com",
					traces: [{ type: "decides", to: { type: "intent", identity: "intent/cancel" } }],
				}).ok,
				false,
			);
			assert.equal(
				admitArtifact(target, {
					type: "decision",
					identity: "decision/cancel-review",
					body: "# review\n",
					decisionKind: "review",
					principal: "alice@example.com",
					traces: [{ type: "decides", to: { type: "intent", identity: "intent/cancel" } }],
				}).ok,
				true,
			);
			for (const [pin, pattern] of [
				[{ identity: "decision/ghost", revision: 1 }, /is not a committed Decision artifact/],
				[{ identity: "decision/cancel-review", revision: 1 }, /carries decisionKind "review"/],
			]) {
				await assert.rejects(
					() => cancelExecution(target, { runId: RUN_ID, decision: pin, reason: "x" }),
					(error) => error.amberCode === "AMBER_E_INVALID_ARG" && pattern.test(error.message),
				);
			}
			// Every refusal above left the handle live and the Decision unspent.
			const still = readExecutionHandle(target, RUN_ID);
			assert.equal(still.status, "live");
			assert.equal(still.pid, handle.pid);
			assert.equal(
				readHarnessEvents(target).filter((event) => event.kind === "execution.cancelled").length,
				0,
			);
			const cancelled = await cancelExecution(target, {
				runId: RUN_ID,
				decision: { identity: "decision/cancel-1", revision: 1 },
				reason: "legitimate",
			});
			assert.equal(cancelled.outcome, "terminated");
			// The same Decision can never authorize a second cancellation.
			await assert.rejects(
				() =>
					cancelExecution(target, {
						runId: RUN_ID,
						decision: { identity: "decision/cancel-1", revision: 1 },
						reason: "replay",
					}),
				(error) => [CODE_CONFLICT, CODE_NO_HANDLE].includes(error.amberCode),
			);
		} finally {
			await promise.catch(() => {});
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

test("an already-settled attempt is race-losing: the handle is gone and nothing new is written", async () => {
	const target = gitTarget("race", allowRules("node --version", "allow-version"));
	try {
		decisionFixture(target);
		approve(target);
		// A short command settles naturally, removing its handle.
		const outcome = await runGovernedCommand({
			target,
			commandId: "allow-version",
			ledgerPath: ledgerPathOf(target),
			label: "cancel-run",
			subject: { runId: RUN_ID },
		});
		assert.equal(outcome.executed, true);
		assert.equal(outcome.exitCode, 0);
		assert.equal(readExecutionHandle(target, RUN_ID), null, "settlement removed the handle");
		await assert.rejects(
			() =>
				cancelExecution(target, {
					runId: RUN_ID,
					decision: { identity: "decision/cancel-1", revision: 1 },
					reason: "too late",
				}),
			(error) => error.amberCode === CODE_NO_HANDLE,
		);
		// The losing racer appended no terminal cancellation fact.
		assert.equal(
			readHarnessEvents(target).filter((event) => event.kind === "execution.cancelled").length,
			0,
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

test("raw CLI: handles view, cancel flags, and truncated values through the real parseArgs path", async () => {
	const target = gitTarget("rawcli", allowRules(SLEEP_COMMAND));
	try {
		decisionFixture(target);
		approve(target);
		const cli = path.join(__dirname, "..", "..", "scripts", "amber.js");
		const { promise } = await startRunning(target);
		try {
			const view = spawnSync(
				process.execPath,
				[cli, "harness", "execution", "handles", "--run", RUN_ID, "--target", target, "--json"],
				{ encoding: "utf8" },
			);
			assert.equal(view.status, 0, view.stderr || view.stdout);
			assert.match(view.stdout, /"status": "live"/);
			assert.match(view.stdout, /"readOnly": true/);

			const truncated = spawnSync(
				process.execPath,
				[cli, "harness", "execution", "cancel", "--target", target, "--json", "--run"],
				{ encoding: "utf8" },
			);
			assert.equal(truncated.status, 1);
			assert.match(truncated.stdout, /--run is required/);

			const badPin = spawnSync(
				process.execPath,
				[
					cli,
					"harness",
					"execution",
					"cancel",
					"--run",
					RUN_ID,
					"--decision",
					"not-a-pin",
					"--reason",
					"x",
					"--target",
					target,
					"--json",
				],
				{ encoding: "utf8" },
			);
			assert.equal(badPin.status, 1);
			assert.match(badPin.stdout, /must be <identity>@<revision>/);

			const cancelled = spawnSync(
				process.execPath,
				[
					cli,
					"harness",
					"execution",
					"cancel",
					"--run",
					RUN_ID,
					"--decision",
					"decision/cancel-1@1",
					"--reason",
					"cli cancel",
					"--target",
					target,
					"--json",
				],
				{ encoding: "utf8" },
			);
			assert.equal(cancelled.status, 0, cancelled.stderr || cancelled.stdout);
			assert.match(cancelled.stdout, /"outcome": "terminated"/);
		} finally {
			await promise.catch(() => {});
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

// F081 §3.5 requires one `execution.cancel.requested` + `execution.cancelled`
// pair per cancellation, not a lone terminal event.
test("a cancellation records the required requested + cancelled event pair", async () => {
	const target = gitTarget("pair", allowRules(SLEEP_COMMAND));
	try {
		decisionFixture(target);
		approve(target);
		const { promise, handle } = await startRunning(target);
		try {
			await cancelExecution(target, {
				runId: RUN_ID,
				decision: { identity: "decision/cancel-1", revision: 1 },
				reason: "pair check",
			});
			assert.deepEqual(
				readHarnessEvents(target)
					.filter((event) => event.runId === RUN_ID)
					.map((event) => event.kind)
					.filter((kind) => kind.startsWith("execution.cancel")),
				["execution.cancel.requested", "execution.cancelled"],
				"the request must be recorded before the settlement",
			);
			assert.equal(isProcessAlive(handle.pid), false, "the observed pid is gone");
		} finally {
			await promise.catch(() => {});
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

// F081 §3.3: the authorization is consumed BEFORE any effect. A reused Decision
// must be refused while the second process is still alive — not after it has
// already been killed and the conflict is reported post-mortem.
test("a reused Decision is refused before any signal is delivered", async () => {
	const target = gitTarget("spend-order", allowRules(SLEEP_COMMAND));
	const secondRun = "run-cancel-2";
	try {
		decisionFixture(target);
		approve(target);

		// The first cancellation spends decision/cancel-1.
		const first = await startRunning(target);
		try {
			const cancelled = await cancelExecution(target, {
				runId: RUN_ID,
				decision: { identity: "decision/cancel-1", revision: 1 },
				reason: "first",
			});
			assert.equal(cancelled.outcome, "terminated");
		} finally {
			await first.promise.catch(() => {});
		}

		// A SECOND live run with its OWN ledger and its OWN (unconsumed) approval,
		// so the only thing that can refuse the replay is the spent Decision.
		const secondLedger = path.join(target, ".amber", "loops", "cancel-run-2", "ledger.jsonl");
		appendLedgerRecord(secondLedger, {
			kind: "approved",
			approvalKey: "cancel-run-2:approval",
		});
		const secondPromise = runGovernedCommand({
			target,
			commandId: "allow-cancel",
			ledgerPath: secondLedger,
			label: "cancel-run-2",
			subject: { runId: secondRun },
			budgetMinutes: 5,
		});
		const secondFile = path.join(
			target,
			".amber",
			"harness",
			"executions",
			`${secondRun}.handle.json`,
		);
		const deadline = Date.now() + 10_000;
		while (Date.now() < deadline && !fs.existsSync(secondFile)) {
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		const secondHandle = readExecutionHandle(target, secondRun);
		assert.ok(secondHandle && secondHandle.status === "live", JSON.stringify(secondHandle));
		try {
			await assert.rejects(
				() =>
					cancelExecution(target, {
						runId: secondRun,
						decision: { identity: "decision/cancel-1", revision: 1 },
						reason: "replay",
					}),
				(error) => error.amberCode === CODE_CONFLICT && /already spent/.test(error.message),
			);
			// The point of the fix: the refusal landed before the signal.
			assert.equal(
				isProcessAlive(secondHandle.pid),
				true,
				"a reused Decision must not kill the process before the refusal",
			);
			assert.equal(
				readHarnessEvents(target).filter(
					(event) => event.runId === secondRun && event.kind === "execution.cancelled",
				).length,
				0,
				"a refused cancellation records no terminal fact",
			);
			assert.equal(
				fs.existsSync(
					path.join(
						target,
						".amber",
						"harness",
						"executions",
						"cancellations",
						`${secondRun}.json`,
					),
				),
				false,
				"a refused cancellation writes no record",
			);

			// A different, unspent Decision settles the second run cleanly, which
			// also proves the refusal above was about the SPEND, not about the
			// run being uncancellable.
			const settled = await cancelExecution(target, {
				runId: secondRun,
				decision: { identity: "decision/cancel-2", revision: 1 },
				reason: "cleanup with a fresh Decision",
			});
			assert.equal(settled.outcome, "terminated");
		} finally {
			if (isProcessAlive(secondHandle.pid)) {
				try {
					process.kill(secondHandle.pid, "SIGKILL");
				} catch (_error) {
					/* already gone */
				}
			}
			await secondPromise.catch(() => {});
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

// F081 §3.2: the handle must belong to the requested target. A handle copied
// into another target's store still satisfies its own shape and Snapshot Hash,
// so only target-binding can refuse it — before anything is signalled.
test("a handle issued for another target is refused before any signal", async () => {
	const a = gitTarget("x-target-a", allowRules(SLEEP_COMMAND));
	const b = gitTarget("x-target-b", allowRules(SLEEP_COMMAND));
	try {
		decisionFixture(a);
		approve(a);
		const { promise, handle } = await startRunning(a);
		try {
			decisionFixture(b);
			approve(b);
			// Copy A's handle into B's store UNCHANGED.
			const bHandleFile = path.join(b, ".amber", "harness", "executions", `${RUN_ID}.handle.json`);
			fs.mkdirSync(path.dirname(bHandleFile), { recursive: true });
			fs.copyFileSync(handle.file, bHandleFile);
			assert.equal(
				JSON.parse(fs.readFileSync(bHandleFile, "utf8")).target,
				path.resolve(a),
				"the copied handle still names A as its target",
			);

			await assert.rejects(
				() =>
					cancelExecution(b, {
						runId: RUN_ID,
						decision: { identity: "decision/cancel-1", revision: 1 },
						reason: "cross-target attempt",
					}),
				(error) => /different target/.test(error.message),
			);
			assert.equal(
				isProcessAlive(handle.pid),
				true,
				"the other target's process must survive a cross-target cancellation",
			);

			// Legitimate cleanup: A's OWN target and Decision terminate A, which
			// also shows the refusal above was target-binding, not a dead handle.
			const settledA = await cancelExecution(a, {
				runId: RUN_ID,
				decision: { identity: "decision/cancel-1", revision: 1 },
				reason: "cleanup after the cross-target refusal",
			});
			assert.equal(settledA.outcome, "terminated");
		} finally {
			if (isProcessAlive(handle.pid)) {
				try {
					process.kill(handle.pid, "SIGKILL");
				} catch (_error) {
					/* already gone */
				}
			}
			await promise.catch(() => {});
		}
	} finally {
		fs.rmSync(a, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		fs.rmSync(b, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

// A handle whose recorded pid is already gone: no real process is involved, so
// these cases isolate the SETTLEMENT path.
function staleHandle(target, { runId = RUN_ID, overrides = {} } = {}) {
	const file = path.join(target, ".amber", "harness", "executions", `${runId}.handle.json`);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const record = {
		schemaVersion: 1,
		runId,
		attemptId: "att-recover",
		label: "recover-run",
		commandId: "allow-cancel",
		workspace: target,
		pid: 999_999,
		leaseId: "recover-lease",
		fence: 1,
		startedAt: "2026-09-24T00:00:00.000Z",
		deadlineAt: "2026-09-24T00:05:00.000Z",
		target: path.resolve(target),
		...overrides,
	};
	record.snapshotHash = canonicalHashOf(record);
	fs.writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`, "utf8");
	return file;
}

// F081 §3.5. A transient terminal-append failure must not strand the run: the
// authorization is already consumed, so the SAME authorization must be able to
// finish the settlement — without spending again and without signalling twice.
test("a transient terminal-append failure is recoverable with the same authorization", async () => {
	const target = gitTarget("recover", allowRules(SLEEP_COMMAND));
	try {
		decisionFixture(target);
		staleHandle(target);

		// Inject ONE failure on the first terminal append (the review's probe):
		// the request lands, the settlement does not.
		const ledger = require("../../scripts/lib/harness/event-ledger");
		const cancelPath = require.resolve("../../scripts/lib/harness/execution-cancel");
		const realEmit = ledger.emitHarnessEvent;
		let injected = false;
		ledger.emitHarnessEvent = (t, body, guard) => {
			if (!injected && body.kind === "execution.cancelled") {
				injected = true;
				return {
					ok: false,
					code: "AMBER_E_HARNESS_LEDGER_LOCKED",
					errors: ["injected transient settlement failure"],
				};
			}
			return realEmit(t, body, guard);
		};
		let firstError;
		try {
			delete require.cache[cancelPath];
			const patched = require(cancelPath);
			await patched.cancelExecution(target, {
				runId: RUN_ID,
				decision: { identity: "decision/cancel-1", revision: 1 },
				reason: "first attempt",
			});
		} catch (error) {
			firstError = error;
		} finally {
			ledger.emitHarnessEvent = realEmit;
			delete require.cache[cancelPath];
		}

		assert.equal(
			firstError && firstError.amberCode,
			"AMBER_E_HARNESS_LEDGER_LOCKED",
			`the injected settlement failure must surface, got: ${firstError && firstError.message}`,
		);
		// The strand the review found: authorization spent, nothing settled.
		assert.deepEqual(
			readHarnessEvents(target).map((event) => event.kind),
			["execution.cancel.requested"],
		);

		// Recovery with the SAME authorization: no second spend, no second signal.
		const recovered = await cancelExecution(target, {
			runId: RUN_ID,
			decision: { identity: "decision/cancel-1", revision: 1 },
			reason: "recovery",
		});
		assert.equal(recovered.outcome, "already-exited");
		assert.equal(recovered.resumed, true, "the original authorization completed the settlement");
		assert.equal(recovered.signalResult.signalled, false);
		assert.deepEqual(
			readHarnessEvents(target).map((event) => event.kind),
			["execution.cancel.requested", "execution.cancelled"],
		);
		assert.ok(fs.existsSync(recovered.cancellationFile), "the settlement record exists");

		// And the settled run still refuses a second authorization.
		await assert.rejects(
			() =>
				cancelExecution(target, {
					runId: RUN_ID,
					decision: { identity: "decision/cancel-2", revision: 1 },
					reason: "one too many",
				}),
			(error) =>
				error.amberCode === CODE_CONFLICT &&
				/already carries a recorded cancellation/.test(error.message),
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

// Two callers with the same authorization can both see the unsettled state
// outside the ledger lock. The loser must report the conflict WITHOUT deleting
// the winner's committed record (F081 §3.5: one immutable cancellation record).
test("a racing loser never removes the winner's settlement record", async () => {
	const target = gitTarget("race", allowRules(SLEEP_COMMAND));
	try {
		decisionFixture(target);
		staleHandle(target);
		const options = {
			runId: RUN_ID,
			decision: { identity: "decision/cancel-1", revision: 1 },
			reason: "concurrent cancellation",
		};
		const results = await Promise.allSettled([
			cancelExecution(target, options),
			cancelExecution(target, options),
		]);
		assert.equal(
			results.filter((result) => result.status === "fulfilled").length,
			1,
			"exactly one caller settles",
		);
		assert.deepEqual(
			readHarnessEvents(target).map((event) => event.kind),
			["execution.cancel.requested", "execution.cancelled"],
			"one request, one terminal fact",
		);
		const recordFile = path.join(
			target,
			".amber",
			"harness",
			"executions",
			"cancellations",
			`${RUN_ID}.json`,
		);
		assert.equal(
			fs.existsSync(recordFile),
			true,
			"the winner's immutable record must survive the loser's failure",
		);
		assert.equal(JSON.parse(fs.readFileSync(recordFile, "utf8")).runId, RUN_ID);
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

// The shared execution layer clears the handle from its own settlement
// `finally`, so a settlement must not depend on that volatile handle.
test("a settlement survives the shared layer clearing the handle", async () => {
	const target = gitTarget("handle-cleared", allowRules(SLEEP_COMMAND));
	const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},20000)"], {
		detached: true,
		windowsHide: true,
		stdio: "ignore",
	});
	try {
		decisionFixture(target);
		approve(target);
		const owned = persistExecutionHandle({
			targetRoot: target,
			runId: RUN_ID,
			workspace: target,
			pid: child.pid,
			startedAt: new Date().toISOString(),
		});

		const ledger = require("../../scripts/lib/harness/event-ledger");
		const cancelPath = require.resolve("../../scripts/lib/harness/execution-cancel");
		const realEmit = ledger.emitHarnessEvent;
		let injected = false;
		ledger.emitHarnessEvent = (t, body, guard) => {
			if (!injected && body.kind === "execution.cancelled") {
				injected = true;
				return {
					ok: false,
					code: "AMBER_E_HARNESS_LEDGER_LOCKED",
					errors: ["injected transient settlement failure"],
				};
			}
			return realEmit(t, body, guard);
		};
		let firstError;
		try {
			delete require.cache[cancelPath];
			const patched = require(cancelPath);
			await patched.cancelExecution(target, {
				runId: RUN_ID,
				decision: { identity: "decision/cancel-1", revision: 1 },
				reason: "first attempt",
			});
		} catch (error) {
			firstError = error;
		} finally {
			ledger.emitHarnessEvent = realEmit;
			delete require.cache[cancelPath];
		}
		assert.equal(firstError && firstError.amberCode, "AMBER_E_HARNESS_LEDGER_LOCKED");

		// The settling execution clears its handle from its own `finally`.
		clearExecutionHandle(owned);
		assert.equal(readExecutionHandle(target, RUN_ID), null, "the handle is gone");

		// Recovery must NOT depend on that volatile handle.
		const recovered = await cancelExecution(target, {
			runId: RUN_ID,
			decision: { identity: "decision/cancel-1", revision: 1 },
			reason: "recovery after the handle was cleared",
		});
		assert.equal(recovered.resumed, true);
		assert.equal(recovered.outcome, "terminated", "the first attempt observed the kill");
		assert.deepEqual(
			readHarnessEvents(target).map((event) => event.kind),
			["execution.cancel.requested", "execution.cancelled"],
		);
		assert.equal(isProcessAlive(child.pid), false);
	} finally {
		if (isProcessAlive(child.pid)) {
			try {
				process.kill(child.pid, "SIGKILL");
			} catch (_error) {
				/* already gone */
			}
		}
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

// A resumed settlement finishes the ledger; it must not signal again.
test("a resumed settlement never signals a second time", async () => {
	const target = gitTarget("resume-no-signal", allowRules(SLEEP_COMMAND));
	const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},20000)"], {
		detached: true,
		windowsHide: true,
		stdio: "ignore",
	});
	try {
		decisionFixture(target);
		const owned = persistExecutionHandle({
			targetRoot: target,
			runId: RUN_ID,
			workspace: target,
			pid: child.pid,
			startedAt: new Date().toISOString(),
		});
		// A stranded request with no record: the settlement has no observation to
		// reuse, and must still not signal.
		emitHarnessEvent(target, {
			kind: "execution.cancel.requested",
			schemaVersion: 1,
			at: new Date().toISOString(),
			runId: RUN_ID,
			inputHash: owned.snapshotHash,
			reason: "stranded request",
			pointers: [
				`execution-cancel-request:${RUN_ID}#stranded`,
				"execution-cancel-decision:decision/cancel-1@1",
			],
		});
		const recovered = await cancelExecution(target, {
			runId: RUN_ID,
			decision: { identity: "decision/cancel-1", revision: 1 },
			reason: "resume without signalling",
		});
		assert.equal(recovered.resumed, true);
		assert.equal(recovered.signalResult.signalled, false);
		assert.equal(recovered.outcome, "unknown", "an unresignalled live pid is never a claimed kill");
		assert.equal(isProcessAlive(child.pid), true, "the resumed settlement must not signal");
	} finally {
		if (isProcessAlive(child.pid)) {
			try {
				process.kill(child.pid, "SIGKILL");
			} catch (_error) {
				/* already gone */
			}
		}
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});
// it — a second human Decision must not be able to adopt a stranded request.
test("an unsettled request refuses a different authorization", async () => {
	const target = gitTarget("unsettled-other", allowRules(SLEEP_COMMAND));
	try {
		decisionFixture(target);
		staleHandle(target);
		// The post-failure state, constructed directly.
		emitHarnessEvent(target, {
			kind: "execution.cancel.requested",
			schemaVersion: 1,
			at: new Date().toISOString(),
			runId: RUN_ID,
			inputHash: readExecutionHandle(target, RUN_ID).snapshotHash,
			reason: "stranded request",
			pointers: [
				`execution-cancel-request:${RUN_ID}#stranded`,
				"execution-cancel-decision:decision/cancel-1@1",
			],
		});
		await assert.rejects(
			() =>
				cancelExecution(target, {
					runId: RUN_ID,
					decision: { identity: "decision/cancel-2", revision: 1 },
					reason: "different authorization",
				}),
			(error) => error.amberCode === CODE_CONFLICT && /different Decision/.test(error.message),
		);
		// The original authorization still finishes it.
		const recovered = await cancelExecution(target, {
			runId: RUN_ID,
			decision: { identity: "decision/cancel-1", revision: 1 },
			reason: "recovery by the original authorization",
		});
		assert.equal(recovered.outcome, "already-exited");
		assert.deepEqual(
			readHarnessEvents(target).map((event) => event.kind),
			["execution.cancel.requested", "execution.cancelled"],
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

// Leave the state a transient terminal-append failure leaves: a spent request
// plus a real record whose settlement never landed.
async function strandWithRecord(target) {
	const ledger = require("../../scripts/lib/harness/event-ledger");
	const cancelPath = require.resolve("../../scripts/lib/harness/execution-cancel");
	const realEmit = ledger.emitHarnessEvent;
	let injected = false;
	ledger.emitHarnessEvent = (t, body, guard) => {
		if (!injected && body.kind === "execution.cancelled") {
			injected = true;
			return {
				ok: false,
				code: "AMBER_E_HARNESS_LEDGER_LOCKED",
				errors: ["injected transient settlement failure"],
			};
		}
		return realEmit(t, body, guard);
	};
	let error;
	try {
		delete require.cache[cancelPath];
		const patched = require(cancelPath);
		await patched.cancelExecution(target, {
			runId: RUN_ID,
			decision: { identity: "decision/cancel-1", revision: 1 },
			reason: "first attempt",
		});
	} catch (caught) {
		error = caught;
	} finally {
		ledger.emitHarnessEvent = realEmit;
		delete require.cache[cancelPath];
	}
	assert.equal(error && error.amberCode, "AMBER_E_HARNESS_LEDGER_LOCKED");
	return path.join(target, ".amber", "harness", "executions", "cancellations", `${RUN_ID}.json`);
}

// A record is EVIDENCE: a tampered one must be refused, not promoted to a
// terminal receipt that claims a kill nobody observed (F081 §3.5, §6).
test("a tampered cancellation record is refused, never settled", async () => {
	const target = gitTarget("tampered-record", allowRules(SLEEP_COMMAND));
	try {
		decisionFixture(target);
		staleHandle(target);
		const file = await strandWithRecord(target);

		const record = JSON.parse(fs.readFileSync(file, "utf8"));
		assert.equal(record.outcome, "already-exited");
		// Rewrite the outcome and keep the stale Snapshot Hash.
		record.outcome = "terminated";
		fs.writeFileSync(file, JSON.stringify(record));

		await assert.rejects(
			() =>
				cancelExecution(target, {
					runId: RUN_ID,
					decision: { identity: "decision/cancel-1", revision: 1 },
					reason: "tampered record",
				}),
			(error) =>
				error.amberCode === "AMBER_E_HARNESS_EXEC_CANCEL_CORRUPT" &&
				/Snapshot Hash/.test(error.message),
		);
		// Nothing was promoted: the ledger is still unsettled.
		assert.deepEqual(
			readHarnessEvents(target).map((event) => event.kind),
			["execution.cancel.requested"],
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

// A record whose hash is consistent but which is not bound to this run's
// recorded request is refused too — a valid hash is not authenticity.
test("a record unbound to the recorded request is refused even with a valid hash", async () => {
	const target = gitTarget("unbound-record", allowRules(SLEEP_COMMAND));
	try {
		decisionFixture(target);
		staleHandle(target);
		const file = await strandWithRecord(target);

		const record = JSON.parse(fs.readFileSync(file, "utf8"));
		record.requestPointer = `execution-cancel-request:${RUN_ID}#not-my-request`;
		const { snapshotHash: _stale, ...body } = record;
		record.snapshotHash = canonicalHashOf(body);
		fs.writeFileSync(file, JSON.stringify(record));

		await assert.rejects(
			() =>
				cancelExecution(target, {
					runId: RUN_ID,
					decision: { identity: "decision/cancel-1", revision: 1 },
					reason: "unbound record",
				}),
			(error) =>
				error.amberCode === "AMBER_E_HARNESS_EXEC_CANCEL_CORRUPT" &&
				/recorded request/.test(error.message),
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

// Binding fields are REQUIRED: deleting them (and recomputing the content hash so
// the record is self-consistent) must not make it acceptable — "absent" must
// never read as "matches".
test("a record whose binding fields are missing is refused", async () => {
	const target = gitTarget("missing-binding", allowRules(SLEEP_COMMAND));
	try {
		decisionFixture(target);
		staleHandle(target);
		const file = await strandWithRecord(target);

		const record = JSON.parse(fs.readFileSync(file, "utf8"));
		assert.equal(record.outcome, "already-exited");
		delete record.decision;
		delete record.handleSnapshotHash;
		record.outcome = "terminated";
		const { snapshotHash: _stale, ...body } = record;
		record.snapshotHash = canonicalHashOf(body);
		fs.writeFileSync(file, JSON.stringify(record));

		await assert.rejects(
			() =>
				cancelExecution(target, {
					runId: RUN_ID,
					decision: { identity: "decision/cancel-1", revision: 1 },
					reason: "missing binding fields",
				}),
			(error) =>
				error.amberCode === "AMBER_E_HARNESS_EXEC_CANCEL_CORRUPT" &&
				/carries no decision/.test(error.message),
		);
		// Nothing was promoted.
		assert.deepEqual(
			readHarnessEvents(target).map((event) => event.kind),
			["execution.cancel.requested"],
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

// Fields the settlement dereferences, and the record's own timestamp, must be
// required and typed: otherwise a tampered record crashes the settlement with an
// untyped error, or leaks an unrelated code, instead of the governed refusal.
test("a record with a mistyped or missing dereferenced field is refused", async () => {
	const mutations = [
		["signalResult removed", (record) => delete record.signalResult, /carries no signalResult/],
		[
			"signalResult not an object",
			(record) => {
				record.signalResult = "terminated";
			},
			/signalResult is not an object/,
		],
		[
			"observation not a string",
			(record) => {
				record.observation = { nested: true };
			},
			/observation is not a string/,
		],
		[
			"at not a date-time",
			(record) => {
				record.at = "not-a-date";
			},
			/valid date-time/,
		],
	];
	for (const [label, mutate, pattern] of mutations) {
		const target = gitTarget(`mistyped-${label.replace(/\W+/g, "-")}`, allowRules(SLEEP_COMMAND));
		try {
			decisionFixture(target);
			staleHandle(target);
			const file = await strandWithRecord(target);
			const record = JSON.parse(fs.readFileSync(file, "utf8"));
			mutate(record);
			const { snapshotHash: _stale, ...body } = record;
			record.snapshotHash = canonicalHashOf(body);
			fs.writeFileSync(file, JSON.stringify(record));

			await assert.rejects(
				() =>
					cancelExecution(target, {
						runId: RUN_ID,
						decision: { identity: "decision/cancel-1", revision: 1 },
						reason: label,
					}),
				(error) =>
					error.amberCode === "AMBER_E_HARNESS_EXEC_CANCEL_CORRUPT" && pattern.test(error.message),
				`${label} must be refused as a corrupt record, not crash or settle`,
			);
		} finally {
			fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		}
	}
});

// A record that cannot pass verification must never reach the disk: records are
// never deleted, so a persisted bad one would fail every later attempt too.
test("a record that cannot pass verification is never written", async () => {
	const target = gitTarget("no-poison", allowRules(SLEEP_COMMAND));
	try {
		decisionFixture(target);
		staleHandle(target);
		const first = readExecutionHandle(target, RUN_ID);
		// A stranded request that names the FIRST handle's snapshot.
		emitHarnessEvent(target, {
			kind: "execution.cancel.requested",
			schemaVersion: 1,
			at: new Date().toISOString(),
			runId: RUN_ID,
			inputHash: first.snapshotHash,
			reason: "stranded request",
			pointers: [
				`execution-cancel-request:${RUN_ID}#stranded`,
				"execution-cancel-decision:decision/cancel-1@1",
			],
		});
		// The execution restarts and persists a NEW handle (new lease, new fence),
		// so any record built now is bound to a different snapshot than the request.
		fs.rmSync(first.file, { force: true });
		staleHandle(target, { overrides: { leaseId: "restarted-lease", fence: 2 } });
		const second = readExecutionHandle(target, RUN_ID);
		assert.notEqual(
			second.snapshotHash,
			first.snapshotHash,
			"a restarted attempt carries a new handle snapshot",
		);
		const file = path.join(
			target,
			".amber",
			"harness",
			"executions",
			"cancellations",
			`${RUN_ID}.json`,
		);

		await assert.rejects(
			() =>
				cancelExecution(target, {
					runId: RUN_ID,
					decision: { identity: "decision/cancel-1", revision: 1 },
					reason: "restarted execution",
				}),
			(error) =>
				error.amberCode === "AMBER_E_HARNESS_EXEC_CANCEL_CORRUPT" &&
				/before it is written/.test(error.message),
		);
		assert.equal(fs.existsSync(file), false, "an unverifiable record must never reach the disk");
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});
