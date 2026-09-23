"use strict";

// Harness Attempt core (F072 H4; proposal §4.4/§33/§49).
//
// A governed attempt becomes a first-class, run-scoped record. The record is
// derived at write time from the attempt's REAL governed result (the ledger
// pointer and the observed-entry source the F070 wiring already produced) and
// is never rewritten: a refused attempt and a failed command are both
// terminal records. There is deliberately no second trail here — the record
// CITES the governed ledger, it never re-derives or re-judges a gate verdict.
//
// The §49 no-progress signal is derivable from these records (the same
// commandId with the same non-zero exitCode on ≥ 2 consecutive attempts) and
// is REPORTED only: enforcement (auto-cancel, budget stop) stays a future
// Loop/Runtime concern (§49 names it there), never an attempt-core verdict.

const fs = require("node:fs");
const path = require("node:path");

const { statePath, statePathForCreate } = require("../state-dir-resolver");

const CODE_NOT_FOUND = "AMBER_E_HARNESS_ATTEMPT_NOT_FOUND";
const CODE_CORRUPT = "AMBER_E_HARNESS_ATTEMPT_CORRUPT";
const CODE_FINAL = "AMBER_E_HARNESS_ATTEMPT_FINAL";
const CODE_INVALID_ARG = "AMBER_E_INVALID_ARG";

// The closed attempt-state set. `refused` (a gate stopped the attempt before
// any effect) and `failed` (the command executed and exited non-zero) are the
// F070 distinction carried verbatim; both are terminal.
const ATTEMPT_STATES = Object.freeze(["running", "completed", "failed", "refused"]);
const FINAL_ATTEMPT_STATES = new Set(["completed", "failed", "refused"]);

function typedError(code, message) {
	const err = new Error(message);
	err.amberCode = code;
	return err;
}

function safeId(id) {
	return String(id).replace(/[^A-Za-z0-9._-]/g, "-");
}

function attemptsDirForCreate(targetRoot, runId) {
	return statePathForCreate(targetRoot, "harness", "attempts", safeId(runId));
}

function attemptsDirForRead(targetRoot, runId) {
	return statePath(targetRoot, "harness", "attempts", safeId(runId));
}

function attemptFile(targetRoot, runId, attemptId) {
	return path.join(attemptsDirForCreate(targetRoot, runId), `${safeId(attemptId)}.json`);
}

// A pure read resolves through the read policy (listAttempts does too), so
// the legacy state-dir fallback applies symmetrically.
function attemptFileForRead(targetRoot, runId, attemptId) {
	return path.join(attemptsDirForRead(targetRoot, runId), `${safeId(attemptId)}.json`);
}

// Fail-closed shape check: unknown fields refuse (the closed-field problem is
// a feature here — a hand-edited record must not read as evidence).
function attemptProblem(record) {
	if (!record || typeof record !== "object" || Array.isArray(record)) {
		return "attempt record is not an object";
	}
	for (const field of ["attemptId", "runId", "state", "commandId", "startedAt"]) {
		const value = record[field];
		if (typeof value !== "string" || value.length === 0) {
			return `attempt record field ${JSON.stringify(field)} is missing or not a string`;
		}
	}
	if (!ATTEMPT_STATES.includes(record.state)) {
		return `attempt record carries unknown state ${JSON.stringify(record.state)}`;
	}
	if (
		record.exitCode !== undefined &&
		record.exitCode !== null &&
		!Number.isInteger(record.exitCode)
	) {
		return "attempt record exitCode must be an integer when present";
	}
	for (const field of ["governedRef", "observedRef", "finishedAt", "reason"]) {
		const value = record[field];
		if (value !== undefined && value !== null && typeof value !== "string") {
			return `attempt record field ${JSON.stringify(field)} must be a string when present`;
		}
	}
	if (FINAL_ATTEMPT_STATES.has(record.state) && !record.finishedAt) {
		return `a terminal attempt (${record.state}) carries no finishedAt`;
	}
	return null;
}

function readAttemptFile(file) {
	let raw;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch (err) {
		return null;
	}
	let record;
	try {
		record = JSON.parse(raw);
	} catch (err) {
		throw typedError(CODE_CORRUPT, `attempt record is not valid JSON: ${file}`);
	}
	const problem = attemptProblem(record);
	if (problem) throw typedError(CODE_CORRUPT, `attempt record fails its closed shape: ${problem}`);
	return record;
}

/**
 * Record ONE governed attempt for a run, from the attempt's real governed
 * result. A first call writes the record with state `running`; the outcome
 * call (same attemptId) moves it to completed/failed/refused and freezes it.
 * An already-terminal attempt refuses any rewrite (records are immutable).
 * The run's additive `attempts` summary is refreshed on every record.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.runId @param {string} opts.attemptId @param {string} opts.commandId
 * @param {string} [opts.state] - outcome state; absent = still `running`.
 * @param {number} [opts.exitCode] @param {string} [opts.governedRef] @param {string} [opts.observedRef]
 * @param {string} [opts.reason] @param {string} [opts.now]
 */
function recordAttempt(
	targetRoot,
	{ runId, attemptId, commandId, state, exitCode, governedRef, observedRef, reason, now } = {},
) {
	if (!runId || typeof runId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--run <id> is required to record an attempt");
	}
	if (!attemptId || typeof attemptId !== "string") {
		throw typedError(CODE_INVALID_ARG, "an attemptId is required to record an attempt");
	}
	if (!commandId || typeof commandId !== "string") {
		throw typedError(CODE_INVALID_ARG, "a commandId is required to record an attempt");
	}
	const at = now || new Date().toISOString();
	const file = attemptFile(targetRoot, runId, attemptId);
	let record = readAttemptFile(file);
	if (record === null) {
		record = {
			attemptId,
			runId,
			state: "running",
			commandId,
			startedAt: at,
			...(governedRef ? { governedRef } : {}),
			...(observedRef ? { observedRef } : {}),
		};
	} else if (FINAL_ATTEMPT_STATES.has(record.state)) {
		throw typedError(
			CODE_FINAL,
			`attempt "${attemptId}" is already terminal (${record.state}); attempt records are immutable`,
		);
	}
	if (state !== undefined) {
		if (!ATTEMPT_STATES.includes(state)) {
			throw typedError(
				CODE_INVALID_ARG,
				`unknown attempt state ${JSON.stringify(state)}; closed set: ${ATTEMPT_STATES.join(", ")}`,
			);
		}
		record.state = state;
	}
	if (exitCode !== undefined) record.exitCode = exitCode;
	if (governedRef !== undefined) record.governedRef = governedRef;
	if (observedRef !== undefined) record.observedRef = observedRef;
	if (reason !== undefined) record.reason = reason;
	if (FINAL_ATTEMPT_STATES.has(record.state)) record.finishedAt = at;
	const problem = attemptProblem(record);
	if (problem) throw typedError(CODE_CORRUPT, `refusing to store a malformed attempt: ${problem}`);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`, "utf8");
	refreshAttemptSummary(targetRoot, { runId });
	return { ok: true, attempt: record, attemptFile: file };
}

/**
 * List one run's attempts (id order) — a fold over the run's attempt records.
 * A missing directory is an empty list, not an error; a corrupt record fails
 * closed.
 */
function listAttempts(targetRoot, { runId } = {}) {
	if (!runId || typeof runId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--run <id> is required to list attempts");
	}
	const dir = attemptsDirForRead(targetRoot, runId);
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => readAttemptFile(path.join(dir, name)));
}

/**
 * The §49 derivation, deterministic over attempt records: the same commandId
 * with the same non-zero exitCode on >= 2 consecutive attempts (an integer
 * exitCode is required — `undefined` never reads as a failure code).
 * Reported, not enforced.
 */
function detectNoProgress(attempts) {
	let streak = 0;
	let commandId = null;
	let exitCode = null;
	for (const attempt of attempts) {
		if (
			attempt.state !== "failed" ||
			!Number.isInteger(attempt.exitCode) ||
			attempt.exitCode === 0
		) {
			streak = 0;
			commandId = null;
			exitCode = null;
			continue;
		}
		if (attempt.commandId === commandId && attempt.exitCode === exitCode) {
			streak += 1;
		} else {
			streak = 1;
			commandId = attempt.commandId;
			exitCode = attempt.exitCode;
		}
	}
	return streak >= 2
		? {
				detected: true,
				commandId,
				exitCode,
				consecutiveFailures: streak,
			}
		: { detected: false, consecutiveFailures: streak };
}

// The run record's additive `attempts` summary (ADR-0012): count, last
// attempt id, last attempt state. Absent on pre-H4 records — a run with no
// attempts never grows the section (byte-compatibility).
function refreshAttemptSummary(targetRoot, { runId } = {}) {
	const attempts = listAttempts(targetRoot, { runId });
	const { getRun } = require("./run-core");
	const { run } = getRun(targetRoot, { runId });
	if (attempts.length === 0) return { ok: true, summary: null };
	const last = attempts[attempts.length - 1];
	run.attempts = {
		count: attempts.length,
		lastAttemptId: last.attemptId,
		lastAttemptState: last.state,
	};
	const runFile = statePath(targetRoot, "harness", "runs", `${safeId(runId)}.json`);
	fs.writeFileSync(runFile, `${JSON.stringify(run, null, "\t")}\n`, "utf8");
	return { ok: true, summary: run.attempts };
}

/**
 * Read one attempt (fail closed).
 */
function getAttempt(targetRoot, { runId, attemptId } = {}) {
	if (!runId || typeof runId !== "string" || !attemptId || typeof attemptId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--run <id> and an attemptId are required");
	}
	const file = attemptFileForRead(targetRoot, runId, attemptId);
	const record = readAttemptFile(file);
	if (!record) {
		throw typedError(CODE_NOT_FOUND, `no attempt "${attemptId}" for run "${runId}"`);
	}
	return { ok: true, attempt: record };
}

module.exports = {
	recordAttempt,
	listAttempts,
	getAttempt,
	detectNoProgress,
	ATTEMPT_STATES,
	FINAL_ATTEMPT_STATES,
	CODE_NOT_FOUND,
	CODE_CORRUPT,
	CODE_FINAL,
	CODE_INVALID_ARG,
};
