"use strict";

// F081 — truthful cancellation of a live governed execution.
//
// The only thing this module may address is an owned execution handle: a pid
// with recorded ownership (lease + fence), the workspace it is confined to, and
// a declared deadline. Cancellation:
//
//   * refuses when there is no handle (never "probably nothing running");
//   * consumes its OWN single-use human Decision — never the execution's own
//     approval, and never the same Decision twice;
//   * OBSERVES the pid before and after signalling and reports what it saw
//     (`terminated` / `already-exited` / `unknown`), never a claim;
//   * never deletes the workspace (that stays `execution release`), never
//     rewrites the run's terminal result, and never re-executes anything;
//   * is race-safe: whichever settles first wins, and the loser reports
//     `already-settled` instead of appending a second terminal fact.

const fs = require("node:fs");
const path = require("node:path");

const { statePath, statePathForCreate } = require("../state-dir-resolver");
const {
	canonicalHashOf,
	decisionPinProblem,
	resolveRegistrationDecision,
} = require("../core/registry-ledger");
const { listArtifactRevisions } = require("../core/canonical-artifacts");
const {
	readExecutionHandle,
	listExecutionHandles,
	isProcessAlive,
	signalPidTree,
	CODE_CORRUPT: CODE_HANDLE_CORRUPT,
} = require("../core/execution-handles");
const { emitHarnessEvent } = require("./event-ledger");

const SCHEMA_VERSION = 1;
const DECISION_KINDS = Object.freeze(["acceptance", "approval"]);
const OUTCOMES = Object.freeze(["terminated", "already-exited", "unknown"]);

const CODE_INVALID = "AMBER_E_INVALID_ARG";
const CODE_NO_HANDLE = "AMBER_E_HARNESS_EXEC_NO_HANDLE";
const CODE_CONFLICT = "AMBER_E_HARNESS_EXEC_CANCEL_CONFLICT";
const CODE_CORRUPT = "AMBER_E_HARNESS_EXEC_CANCEL_CORRUPT";

const SIGNAL = "SIGTERM";
const SETTLE_BOUND_MS = 10_000;
const POLL_MS = 50;

function typedError(code, message) {
	const error = new Error(message);
	error.amberCode = code;
	return error;
}

function safeId(value) {
	return String(value).replace(/[^A-Za-z0-9._-]/g, "-");
}

function cancellationDirCreate(targetRoot) {
	return statePathForCreate(targetRoot, "harness", "executions", "cancellations");
}

function cancellationFile(targetRoot, runId) {
	return path.join(cancellationDirCreate(targetRoot), `${safeId(runId)}.json`);
}

function readJsonOrNull(file) {
	if (!fs.existsSync(file)) return null;
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		throw typedError(CODE_CORRUPT, `cancellation record is not valid JSON: ${error.message}`);
	}
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wait until `predicate` holds or the bound elapses; returns whether it held.
// Asynchronous on purpose: the settling execution runs in THIS process when a
// CLI cancels its own run, so a blocking wait would prevent the very
// continuation that removes the handle from ever running.
async function waitFor(predicate, boundMs = SETTLE_BOUND_MS) {
	if (predicate()) return true;
	const deadline = Date.now() + boundMs;
	while (Date.now() < deadline) {
		await sleep(POLL_MS);
		if (predicate()) return true;
	}
	return predicate();
}

function resolveCancellationDecision(targetRoot, pin) {
	const problem = decisionPinProblem(pin);
	if (problem !== null) throw typedError(CODE_INVALID, problem);
	let revisions;
	try {
		revisions = listArtifactRevisions(targetRoot);
	} catch (error) {
		throw typedError(error.amberCode || CODE_CORRUPT, error.message || String(error));
	}
	const resolved = resolveRegistrationDecision(
		revisions,
		pin,
		DECISION_KINDS,
		"execution cancellation",
	);
	if (resolved.problem) throw typedError(CODE_INVALID, resolved.problem);
	return resolved.decision;
}

// The single-use spend, re-derived from the folded chain while the ledger lock
// is held: an authorization is consumed exactly once, by exactly one
// cancellation.
function cancellationDecisionPointer(decision) {
	return `execution-cancel-decision:${decision.identity}@${decision.revision}`;
}

function decisionSpentIn(fold, decision) {
	const marker = cancellationDecisionPointer(decision);
	return fold.some((event) => (event.pointers || []).includes(marker));
}

function cancellationAppendGuard(runId, decision) {
	return (fold) => {
		if (decisionSpentIn(fold, decision))
			return {
				ok: false,
				code: CODE_CONFLICT,
				record: null,
				errors: [
					`decision ${decision.identity}@${decision.revision} is already spent; a cancellation authorization is single-use`,
				],
			};
		const already = fold.find(
			(event) =>
				event.kind === "execution.cancelled" &&
				(event.pointers || []).some((pointer) =>
					pointer.startsWith(`execution-cancel:${safeId(runId)}#`),
				),
		);
		if (already)
			return {
				ok: false,
				code: CODE_CONFLICT,
				record: null,
				errors: [
					`run ${JSON.stringify(runId)} already carries a recorded cancellation (${already.at}); one cancellation per attempt`,
				],
			};
		return null;
	};
}

/**
 * Cancel one live governed execution.
 *
 * @param {string} targetRoot
 * @param {{runId: string, decision: {identity: string, revision: number}, reason: string, now?: string}} opts
 */
async function cancelExecution(targetRoot, { runId, decision: pin, reason, now } = {}) {
	if (!runId || typeof runId !== "string") throw typedError(CODE_INVALID, "--run <id> is required");
	if (!reason || typeof reason !== "string" || reason.trim().length === 0)
		throw typedError(CODE_INVALID, "--reason <text> is required");
	const at = now || new Date().toISOString();

	// Step 1: an owned handle must exist. No handle is NOT "nothing running" —
	// it is the absence of the only object a cancellation may address.
	const handle = readExecutionHandle(targetRoot, runId);
	if (handle === null)
		throw typedError(
			CODE_NO_HANDLE,
			`run ${JSON.stringify(runId)} has no live execution handle; nothing is running under F081 ownership (inspect the recorded execution with amber harness execution inspect --run ${runId})`,
		);

	// Step 2: the cancellation's OWN human Decision (never the execution's).
	const decision = resolveCancellationDecision(targetRoot, pin);

	// Step 3: observe BEFORE signalling. A pid that is already gone is a stale
	// handle — a cancellation can never claim a kill it did not perform.
	const aliveBefore = isProcessAlive(handle.pid);
	let outcome;
	let signalResult = { signalled: false, reason: "not-needed" };
	if (!aliveBefore) {
		outcome = "already-exited";
	} else {
		signalResult = signalPidTree(handle.pid, SIGNAL);
		const exited = await waitFor(() => !isProcessAlive(handle.pid));
		outcome = exited ? "terminated" : "unknown";
	}
	// The settling process removes the handle; its absence is the second
	// observation that the attempt really stopped.
	const handleCleared = await waitFor(
		() => !fs.existsSync(handle.file),
		outcome === "terminated" ? 5_000 : 0,
	);

	const record = {
		schemaVersion: SCHEMA_VERSION,
		runId,
		attemptId: handle.attemptId ?? null,
		label: handle.label ?? null,
		commandId: handle.commandId ?? null,
		handlePid: handle.pid,
		handleLeaseId: handle.leaseId,
		handleFence: handle.fence,
		workspace: handle.workspace,
		aliveBefore,
		signal: SIGNAL,
		signalResult,
		outcome,
		handleCleared,
		decision,
		reason,
		at,
	};
	record.snapshotHash = canonicalHashOf(record);
	const file = cancellationFile(targetRoot, runId);
	if (fs.existsSync(file)) {
		const existing = readJsonOrNull(file);
		if (existing && existing.at !== at)
			throw typedError(
				CODE_CONFLICT,
				`run ${JSON.stringify(runId)} already carries a cancellation record (${existing.at}); one cancellation per attempt`,
			);
	}
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`, {
		encoding: "utf8",
		flag: "wx",
	});

	const pointers = [
		`execution-cancel:${safeId(runId)}#${record.snapshotHash}`,
		cancellationDecisionPointer(decision),
	];
	let appended;
	try {
		appended = emitHarnessEvent(
			targetRoot,
			{
				kind: "execution.cancelled",
				schemaVersion: SCHEMA_VERSION,
				at,
				runId,
				actor: decision.principal,
				inputHash: handle.snapshotHash,
				reason:
					`governed execution cancelled: ${outcome} (pid ${handle.pid}; ${signalResult.mechanism || signalResult.reason}); ${reason}`.slice(
						0,
						2000,
					),
				pointers,
			},
			cancellationAppendGuard(runId, decision),
		);
	} catch (error) {
		fs.rmSync(file, { force: true });
		throw error;
	}
	if (!appended || appended.ok !== true) {
		fs.rmSync(file, { force: true });
		throw typedError(
			(appended && appended.code) || CODE_CONFLICT,
			(appended && appended.errors && appended.errors[0]) || "cancellation refused",
		);
	}
	return {
		ok: true,
		runId,
		outcome,
		aliveBefore,
		handleCleared,
		signalResult,
		cancellation: record,
		cancellationFile: file,
		workspaceRetained: fs.existsSync(handle.workspace),
		authority: {
			launchAuthority: false,
			deletedWorkspace: false,
			rewroteRunResult: false,
		},
	};
}

/** Read-only handle view with OBSERVED liveness and reconciliation notes. */
function handleView(targetRoot, { runId } = {}) {
	const records =
		runId === undefined
			? listExecutionHandles(targetRoot)
			: [readExecutionHandle(targetRoot, runId)].filter((record) => record !== null);
	return {
		ok: true,
		handles: records.map((record) => ({
			runId: record.runId,
			attemptId: record.attemptId,
			commandId: record.commandId,
			pid: record.pid,
			fence: record.fence,
			workspace: record.workspace,
			startedAt: record.startedAt,
			deadlineAt: record.deadlineAt,
			snapshotHash: record.snapshotHash,
			status: record.status,
			observedAt: new Date().toISOString(),
			reconciliation:
				record.status === "stale"
					? "the recorded pid is gone; a cancellation reports already-exited, never a kill"
					: null,
		})),
		authority: {
			readOnly: true,
			launchAuthority: false,
		},
	};
}

module.exports = {
	SCHEMA_VERSION,
	OUTCOMES,
	CODE_INVALID,
	CODE_NO_HANDLE,
	CODE_CONFLICT,
	CODE_CORRUPT,
	CODE_HANDLE_CORRUPT,
	cancelExecution,
	handleView,
};
