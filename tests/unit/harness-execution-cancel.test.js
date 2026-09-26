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
const { execFileSync, spawnSync } = require("node:child_process");

const { runGovernedCommand } = require("../../scripts/lib/core/governed-runner");
const { appendLedgerRecord, readLedger } = require("../../scripts/lib/core/loop-ledger");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { readHarnessEvents } = require("../../scripts/lib/harness/event-ledger");
const { readExecutionHandle, isProcessAlive } = require("../../scripts/lib/core/execution-handles");
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
