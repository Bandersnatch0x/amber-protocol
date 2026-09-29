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

const { statePathForCreate } = require("../state-dir-resolver");
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
const { emitHarnessEvent, readHarnessEvents } = require("./event-ledger");

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

function cancelRequestPointerPrefix(runId) {
	return `execution-cancel-request:${safeId(runId)}#`;
}

function cancellationPointerPrefix(runId) {
	return `execution-cancel:${safeId(runId)}#`;
}

function runCarriesCancellation(fold, runId) {
	return fold.find((event) =>
		(event.pointers || []).some(
			(pointer) =>
				pointer.startsWith(cancelRequestPointerPrefix(runId)) ||
				pointer.startsWith(cancellationPointerPrefix(runId)),
		),
	);
}

// The SPEND guard runs in-lock for the `execution.cancel.requested` append: the
// authorization is consumed (and the request recorded) BEFORE any signal, so a
// reused Decision or a second cancellation is refused without an effect.
function cancellationSpendGuard(runId, decision) {
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
		const already = runCarriesCancellation(fold, runId);
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

// The settlement guard runs in-lock for the `execution.cancelled` append: a
// settlement can never precede its recorded request, and one attempt settles at
// most once.
function cancellationSettlementGuard(runId) {
	return (fold) => {
		const requested = fold.find((event) =>
			(event.pointers || []).some((pointer) =>
				pointer.startsWith(cancelRequestPointerPrefix(runId)),
			),
		);
		if (!requested)
			return {
				ok: false,
				code: CODE_CONFLICT,
				record: null,
				errors: [
					`no recorded cancellation request for run ${JSON.stringify(runId)}; a settlement cannot precede its authorization`,
				],
			};
		const already = fold.find((event) =>
			(event.pointers || []).some((pointer) =>
				pointer.startsWith(cancellationPointerPrefix(runId)),
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

function requestAuthorizedBy(event, decisionPointer) {
	return (event.pointers || []).includes(decisionPointer);
}

// The recorded state of one run's cancellation: its (single) request and its
// (single) settlement, if the settlement landed. A request WITHOUT a settlement
// is an authorization that was consumed but never settled — exactly the state a
// transient terminal-append failure leaves behind, and the state a retry must be
// able to finish rather than strand.
function readCancellationState(targetRoot, runId) {
	const events = readHarnessEvents(targetRoot);
	const requestPrefix = cancelRequestPointerPrefix(runId);
	const settlePrefix = cancellationPointerPrefix(runId);
	const carries = (event, prefix) => (event.pointers || []).some((p) => p.startsWith(prefix));
	return {
		request: events.find((event) => carries(event, requestPrefix)) || null,
		settled: events.find((event) => carries(event, settlePrefix)) || null,
	};
}

/** Raw read of the cancellation record for a run, or null when absent. */
function readCancellationRecord(targetRoot, runId) {
	const file = cancellationFile(targetRoot, runId);
	if (!fs.existsSync(file)) return null;
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		throw typedError(CODE_CORRUPT, `cancellation record is not valid JSON: ${error.message}`);
	}
}

// The closed field set of one cancellation record.
const CANCELLATION_RECORD_FIELDS = Object.freeze([
	"schemaVersion",
	"runId",
	"attemptId",
	"label",
	"commandId",
	"handlePid",
	"handleLeaseId",
	"handleFence",
	"handleSnapshotHash",
	"workspace",
	"aliveBefore",
	"signal",
	"signalResult",
	"outcome",
	"handleCleared",
	"decision",
	"requestPointer",
	"resumed",
	"observation",
	"note",
	"reason",
	"at",
	"snapshotHash",
]);

function requestCarriesPointer(request, pointer) {
	return Boolean(request) && Array.isArray(request.pointers) && request.pointers.includes(pointer);
}

// A cancellation record is EVIDENCE: it is what a terminal receipt cites. It is
// therefore verified — closed field set, recomputed Snapshot Hash, and binding
// to THIS run's recorded request, handle and Decision — before any caller may
// reuse it. Unverified bytes are never promoted to a settled outcome: a
// tampered or unbound record is refused, never repaired in place.
function cancellationRecordProblem(record, { runId, request, decision }) {
	if (!record || typeof record !== "object" || Array.isArray(record))
		return "cancellation record is not an object";
	for (const field of Object.keys(record)) {
		if (!CANCELLATION_RECORD_FIELDS.includes(field))
			return `cancellation record carries unknown field ${JSON.stringify(field)}`;
	}
	for (const field of ["schemaVersion", "runId", "signal", "outcome", "requestPointer", "at"]) {
		if (record[field] === undefined || record[field] === null || record[field] === "")
			return `cancellation record carries no ${field}`;
	}
	if (record.schemaVersion !== SCHEMA_VERSION)
		return `cancellation record declares unsupported schemaVersion ${JSON.stringify(record.schemaVersion)}`;
	if (!OUTCOMES.includes(record.outcome))
		return `cancellation record carries unknown outcome ${JSON.stringify(record.outcome)}`;
	const { snapshotHash, ...body } = record;
	if (snapshotHash !== canonicalHashOf(body))
		return "cancellation record no longer matches its Snapshot Hash";
	if (record.runId !== runId)
		return `cancellation record belongs to run ${JSON.stringify(record.runId)}`;
	if (!requestCarriesPointer(request, record.requestPointer))
		return "cancellation record does not match this run's recorded request";
	if (
		record.handleSnapshotHash &&
		request.inputHash &&
		record.handleSnapshotHash !== request.inputHash
	)
		return "cancellation record was taken against a different handle than the recorded request";
	if (
		decision &&
		record.decision &&
		(record.decision.identity !== decision.identity ||
			record.decision.revision !== decision.revision)
	)
		return "cancellation record was authorized by a different Decision";
	return null;
}

// The shared read boundary for cancellation records: a verified record, or a
// refusal. Every reuse path (recovery, EEXIST adoption, pre-settlement) goes
// through here, so none of them can cite evidence this one would not accept.
function verifiedCancellationRecord(targetRoot, runId, { request, decision }) {
	const record = readCancellationRecord(targetRoot, runId);
	if (record === null) return null;
	const problem = cancellationRecordProblem(record, { runId, request, decision });
	if (problem !== null)
		throw typedError(
			CODE_CORRUPT,
			`cancellation record for run ${JSON.stringify(runId)} fails verification: ${problem}`,
		);
	return record;
}

// Observe one addressable handle and classify the outcome honestly. A FIRST
// attempt signals; a RESUMED settlement never signals a second time — the
// original authorization already did.
async function observeHandle(handle, { signal }) {
	const aliveBefore = isProcessAlive(handle.pid);
	if (!aliveBefore)
		return {
			aliveBefore,
			signalResult: { signalled: false, reason: "not-needed" },
			outcome: "already-exited",
		};
	if (!signal)
		return {
			aliveBefore,
			signalResult: { signalled: false, reason: "resumed-settlement" },
			outcome: "unknown",
		};
	const signalResult = signalPidTree(handle.pid, SIGNAL);
	const exited = await waitFor(() => !isProcessAlive(handle.pid));
	return { aliveBefore, signalResult, outcome: exited ? "terminated" : "unknown" };
}

// One immutable record per attempt: the observation it settled on, plus what it
// was authorized by. `observation` states WHERE that observation came from, so a
// settlement recovered without a handle is never readable as an observed kill.
function cancellationRecordFor({
	runId,
	handle,
	observation,
	decision,
	requestPointer,
	resumed,
	observationSource,
	handleSnapshotHash,
	note,
	reason,
	at,
}) {
	const record = {
		schemaVersion: SCHEMA_VERSION,
		runId,
		attemptId: handle ? (handle.attemptId ?? null) : null,
		label: handle ? (handle.label ?? null) : null,
		commandId: handle ? (handle.commandId ?? null) : null,
		handlePid: handle ? handle.pid : null,
		handleLeaseId: handle ? handle.leaseId : null,
		handleFence: handle ? handle.fence : null,
		handleSnapshotHash: handle ? handle.snapshotHash : (handleSnapshotHash ?? null),
		workspace: handle ? handle.workspace : null,
		aliveBefore: observation.aliveBefore,
		signal: SIGNAL,
		signalResult: observation.signalResult,
		outcome: observation.outcome,
		handleCleared: observation.handleCleared ?? false,
		decision,
		requestPointer,
		resumed,
		observation: observationSource,
		note: note ?? null,
		reason,
		at,
	};
	record.snapshotHash = canonicalHashOf(record);
	return record;
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

	// Step 1: what does this run ALREADY carry? Read the cancellation state and
	// any record BEFORE reaching for the execution handle. The shared execution
	// layer clears that handle from its own settlement `finally`, so an
	// authorized-but-unsettled cancellation must be completable without it.
	const state = readCancellationState(targetRoot, runId);
	if (state.settled)
		throw typedError(
			CODE_CONFLICT,
			`run ${JSON.stringify(runId)} already carries a recorded cancellation (${state.settled.at}); one cancellation per attempt`,
		);
	const resuming = state.request !== null;

	// Step 2: the cancellation's OWN human Decision (never the execution's).
	const decision = resolveCancellationDecision(targetRoot, pin);
	const decisionPointer = cancellationDecisionPointer(decision);

	let handle = null;
	let record;
	let requestPointer;

	if (resuming) {
		if (!requestAuthorizedBy(state.request, decisionPointer))
			throw typedError(
				CODE_CONFLICT,
				`run ${JSON.stringify(runId)} already carries a cancellation request authorized by a different Decision (${state.request.at}); a cancellation authorization is single-use`,
			);
		requestPointer =
			(state.request.pointers || []).find((pointer) =>
				pointer.startsWith(cancelRequestPointerPrefix(runId)),
			) || null;
		// Step 3 (resume): the authorization is already consumed, so this call
		// finishes the settlement from whatever evidence survived — the attempt's
		// own record when it landed, else the handle if it is still there, else
		// nothing observable (reported `unknown`, never a claimed termination).
		record = verifiedCancellationRecord(targetRoot, runId, { request: state.request, decision });
		if (record === null) {
			handle = readExecutionHandle(targetRoot, runId);
			if (handle === null) {
				record = cancellationRecordFor({
					runId,
					handle: null,
					observation: {
						aliveBefore: null,
						signalResult: { signalled: false, reason: "no-handle" },
						outcome: "unknown",
						handleCleared: true,
					},
					decision,
					requestPointer,
					resumed: true,
					observationSource: "none",
					handleSnapshotHash: state.request.inputHash ?? null,
					note: "resumed without a surviving handle or record: the outcome is unknown, never a claimed termination",
					reason,
					at,
				});
			} else {
				const observation = await observeHandle(handle, { signal: false });
				observation.handleCleared = await waitFor(() => !fs.existsSync(handle.file), 0);
				record = cancellationRecordFor({
					runId,
					handle,
					observation,
					decision,
					requestPointer,
					resumed: true,
					observationSource: "handle",
					reason,
					at,
				});
			}
		}
	} else {
		// Step 3 (first attempt): a cancellation addresses only an owned handle,
		// and spends its authorization BEFORE any effect (F081 §3.3). The
		// `execution.cancel.requested` append is the in-lock spend point, so a
		// reused Decision — or a second cancellation — is refused here, before the
		// pid is signalled.
		handle = readExecutionHandle(targetRoot, runId);
		if (handle === null)
			throw typedError(
				CODE_NO_HANDLE,
				`run ${JSON.stringify(runId)} has no live execution handle; nothing is running under F081 ownership (inspect the recorded execution with amber harness execution inspect --run ${runId})`,
			);
		requestPointer = `${cancelRequestPointerPrefix(runId)}${canonicalHashOf({
			runId,
			at,
			handle: handle.snapshotHash,
			decision: decisionPointer,
		})}`;
		const request = emitHarnessEvent(
			targetRoot,
			{
				kind: "execution.cancel.requested",
				schemaVersion: SCHEMA_VERSION,
				at,
				runId,
				actor: decision.principal,
				inputHash: handle.snapshotHash,
				reason: `governed execution cancellation requested (pid ${handle.pid}); ${reason}`.slice(
					0,
					2000,
				),
				pointers: [requestPointer, decisionPointer],
			},
			cancellationSpendGuard(runId, decision),
		);
		if (!request || request.ok !== true) {
			throw typedError(
				(request && request.code) || CODE_CONFLICT,
				(request && request.errors && request.errors[0]) || "cancellation refused",
			);
		}
		// Step 4: observe BEFORE signalling. A pid that is already gone is a stale
		// handle — a cancellation never claims a kill it did not perform.
		const observation = await observeHandle(handle, { signal: true });
		observation.handleCleared = await waitFor(
			() => !fs.existsSync(handle.file),
			observation.outcome === "terminated" ? 5_000 : 0,
		);
		record = cancellationRecordFor({
			runId,
			handle,
			observation,
			decision,
			requestPointer,
			resumed: false,
			observationSource: "handle",
			reason,
			at,
		});
	}

	// Step 5: the record is written ONCE (exclusive create) and is NEVER deleted.
	// It is the immutable observation of an authorized attempt, and the settlement
	// event is what makes it authoritative; if a concurrent attempt already wrote
	// it, that record stands — a racing loser never removes the winner's evidence.
	const file = cancellationFile(targetRoot, runId);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	try {
		fs.writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`, {
			encoding: "utf8",
			flag: "wx",
		});
	} catch (error) {
		// `EEXIST` means another attempt's record is already the authority. It is
		// read back and verified below, at the moment it becomes authoritative.
		if (!error || error.code !== "EEXIST") throw error;
	}

	// Step 6: the record becomes authoritative only now, so it is re-verified at
	// that moment: a record changed (or gone) between read and settle is refused
	// rather than cited, and the cited hash is always the hash on disk.
	const settlementRequest = readCancellationState(targetRoot, runId).request;
	const settledRecord = verifiedCancellationRecord(targetRoot, runId, {
		request: settlementRequest,
		decision,
	});
	if (settledRecord === null)
		throw typedError(
			CODE_CORRUPT,
			`cancellation record for run ${JSON.stringify(runId)} is missing at settlement time; refusing to cite evidence that is not on disk`,
		);
	record = settledRecord;

	const pointers = [
		`${cancellationPointerPrefix(runId)}${record.snapshotHash}`,
		cancellationDecisionPointer(decision),
	];
	const appended = emitHarnessEvent(
		targetRoot,
		{
			kind: "execution.cancelled",
			schemaVersion: SCHEMA_VERSION,
			at: record.at,
			runId,
			actor: decision.principal,
			inputHash: record.handleSnapshotHash || record.snapshotHash,
			reason:
				`governed execution cancelled: ${record.outcome} (pid ${record.handlePid ?? "unknown"}; ${record.signalResult.mechanism || record.signalResult.reason}); ${reason}`.slice(
					0,
					2000,
				),
			pointers,
		},
		cancellationSettlementGuard(runId),
	);
	if (!appended || appended.ok !== true) {
		throw typedError(
			(appended && appended.code) || CODE_CONFLICT,
			(appended && appended.errors && appended.errors[0]) || "cancellation refused",
		);
	}
	return {
		ok: true,
		runId,
		outcome: record.outcome,
		aliveBefore: record.aliveBefore,
		handleCleared: record.handleCleared,
		signalResult: record.signalResult,
		resumed: resuming,
		cancellation: record,
		cancellationFile: file,
		workspaceRetained: record.workspace ? fs.existsSync(record.workspace) : false,
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
