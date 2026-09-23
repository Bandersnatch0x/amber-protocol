"use strict";

// Harness Checkpoint core (F072 H4; proposal §33 "checkpoint supports
// recovery").
//
// A checkpoint is a SNAPSHOT record, not a fact: it lives as a JSON record
// under the harness state area and deliberately never enters the event
// ledger (the trail stays facts-only). The record cites — it never copies —
// the run's durable state: digests of the run and execution record files
// plus the attempt count at capture time. Recovery is a read + verify: the
// run must still stand exactly where the checkpoint captured it, or recovery
// refuses (fail closed); it never rewrites a state.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { statePath, statePathForCreate } = require("../state-dir-resolver");
const { canonicalJson } = require("../core/context-hash");
const { getRun } = require("./run-core");
const { isFinal } = require("./run-state-machine");
const { listAttempts } = require("./attempt-core");

const CODE_NOT_FOUND = "AMBER_E_HARNESS_CHECKPOINT_NOT_FOUND";
const CODE_CORRUPT = "AMBER_E_HARNESS_CHECKPOINT_CORRUPT";
const CODE_FINAL = "AMBER_E_HARNESS_CHECKPOINT_FINAL";
const CODE_DRIFT = "AMBER_E_HARNESS_CHECKPOINT_DRIFT";
const CODE_INVALID_ARG = "AMBER_E_INVALID_ARG";

function typedError(code, message) {
	const err = new Error(message);
	err.amberCode = code;
	return err;
}

function safeId(id) {
	return String(id).replace(/[^A-Za-z0-9._-]/g, "-");
}

function sha256File(file) {
	return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

function checkpointsDirForCreate(targetRoot, runId) {
	return statePathForCreate(targetRoot, "harness", "checkpoints", safeId(runId));
}

function checkpointsDirForRead(targetRoot, runId) {
	return statePath(targetRoot, "harness", "checkpoints", safeId(runId));
}

// The closed inline shape of one checkpoint record (the H2a ExecutionRecord
// precedent). Unknown fields refuse; a hand-edited record never reads as a
// rest point.
function checkpointProblem(record) {
	if (!record || typeof record !== "object" || Array.isArray(record)) {
		return "checkpoint record is not an object";
	}
	for (const field of ["checkpointId", "runId", "state", "at"]) {
		const value = record[field];
		if (typeof value !== "string" || value.length === 0) {
			return `checkpoint record field ${JSON.stringify(field)} is missing or not a string`;
		}
	}
	if (!record.refs || typeof record.refs !== "object") {
		return "checkpoint record carries no refs";
	}
	if (
		typeof record.refs.runRecordDigest !== "string" ||
		!record.refs.runRecordDigest.startsWith("sha256:")
	) {
		return "checkpoint refs.runRecordDigest must be a sha256 digest";
	}
	if (
		record.refs.executionRecordDigest !== undefined &&
		(typeof record.refs.executionRecordDigest !== "string" ||
			!record.refs.executionRecordDigest.startsWith("sha256:"))
	) {
		return "checkpoint refs.executionRecordDigest must be a sha256 digest when present";
	}
	if (!Number.isInteger(record.refs.attemptCount)) {
		return "checkpoint refs.attemptCount must be an integer";
	}
	if (record.reason !== undefined && typeof record.reason !== "string") {
		return "checkpoint reason must be a string when present";
	}
	return null;
}

function readCheckpointFile(file) {
	let raw;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch (err) {
		return null; // absence only — a present-but-unreadable file fails closed below
	}
	let record;
	try {
		record = JSON.parse(raw);
	} catch (err) {
		throw typedError(CODE_CORRUPT, `checkpoint record is not valid JSON: ${file}`);
	}
	const problem = checkpointProblem(record);
	if (problem) {
		throw typedError(CODE_CORRUPT, `checkpoint record fails its closed shape: ${problem}`);
	}
	return record;
}

// The run file's digest is the checkpoint's staleness anchor. The run record
// is the truth, and any transition (state, history, outcome, execution
// section) changes its content — EXCEPT the `checkpoints` summary this
// module itself maintains (capture refreshes it, which would otherwise make
// every digest self-defeating). The digest therefore covers the RECURSIVE
// canonical JSON (sorted keys at every depth — the repo's canonicalJson, the
// same canonicalization canonical artifacts hash with) of the run record
// with that one self-maintained section removed; verify uses the same
// canonicalization, so drift detection stays exact for everything the run's
// state machines own, including nested-only changes (an execution verdict, a
// bound outcome). The `attempts` summary stays IN the digest: it is
// maintained by attempt-core, and an attempt state change is a real change
// of the run's substance (attemptCount alone would miss running→completed).
function canonicalRunDigest(run) {
	const { checkpoints: _selfMaintained, ...rest } = run;
	const canonical = canonicalJson(JSON.stringify(rest));
	return `sha256:${crypto.createHash("sha256").update(canonical).digest("hex")}`;
}

function runDigest(targetRoot, runId) {
	return canonicalRunDigest(JSON.parse(fs.readFileSync(runFileForRead(targetRoot, runId), "utf8")));
}

function runFileForRead(targetRoot, runId) {
	return statePath(targetRoot, "harness", "runs", `${safeId(runId)}.json`);
}

function executionRecordFileForRead(targetRoot, runId) {
	return statePath(targetRoot, "harness", "executions", `${safeId(runId)}.json`);
}

/**
 * Capture one run-scoped checkpoint. Only a non-final run may be
 * checkpointed (a terminal record is settled; there is nothing left to
 * recover toward). The capture is idempotent per content: the same run state
 * + same digests produce the same checkpointId and do not append a duplicate.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.runId
 * @param {string} [opts.reason]
 * @param {string} [opts.now]
 */
function captureCheckpoint(targetRoot, { runId, reason, now } = {}) {
	if (!runId || typeof runId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--run <id> is required to capture a checkpoint");
	}
	const run = getRun(targetRoot, { runId }).run;
	if (isFinal(run.state)) {
		throw typedError(
			CODE_FINAL,
			`run "${runId}" is final (${run.state}); terminal records are settled — there is nothing left to checkpoint`,
		);
	}
	const at = now || new Date().toISOString();
	const executionFile = executionRecordFileForRead(targetRoot, runId);
	const refs = {
		runRecordDigest: runDigest(targetRoot, runId),
		...(fs.existsSync(executionFile) ? { executionRecordDigest: sha256File(executionFile) } : {}),
		attemptCount: listAttempts(targetRoot, { runId }).length,
	};
	// Content-addressed identity: same captured content → same id → the
	// append below dedups, so re-capturing an unchanged run is idempotent.
	const identity = crypto
		.createHash("sha256")
		.update(JSON.stringify({ runId, state: run.state, refs }))
		.digest("hex")
		.slice(0, 16);
	const checkpointId = `ck-${identity}`;
	const record = {
		checkpointId,
		runId,
		state: run.state,
		at,
		refs,
		...(reason ? { reason } : {}),
	};
	const problem = checkpointProblem(record);
	if (problem)
		throw typedError(CODE_CORRUPT, `refusing to store a malformed checkpoint: ${problem}`);
	const file = path.join(
		checkpointsDirForCreate(targetRoot, runId),
		`${safeId(checkpointId)}.json`,
	);
	if (fs.existsSync(file)) {
		// A corrupt existing file never reads as an idempotent success: the
		// read's CORRUPT refusal propagates (fail closed over a rest point).
		const existing = readCheckpointFile(file);
		return { ok: true, checkpoint: existing, checkpointFile: file, idempotent: true };
	}
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`, "utf8");
	refreshCheckpointSummary(targetRoot, { runId });
	return { ok: true, checkpoint: record, checkpointFile: file, idempotent: false };
}

/**
 * List one run's checkpoints (capture order = filename order; the id embeds
 * no clock, so `at` sorts ties deterministically). A corrupt record fails
 * closed.
 */
function listCheckpoints(targetRoot, { runId } = {}) {
	if (!runId || typeof runId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--run <id> is required to list checkpoints");
	}
	const dir = checkpointsDirForRead(targetRoot, runId);
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => {
			const record = readCheckpointFile(path.join(dir, name));
			if (!record) {
				throw typedError(
					CODE_CORRUPT,
					`checkpoint record is not valid JSON: ${path.join(dir, name)}`,
				);
			}
			return record;
		})
		.sort((a, b) =>
			a.at < b.at ? -1 : a.at > b.at ? 1 : a.checkpointId < b.checkpointId ? -1 : 1,
		);
}

/**
 * Recovery verification: read the latest checkpoint and verify the run still
 * stands exactly where it was captured (same state, same run-record digest,
 * same attempt count). A drifted run refuses (fail closed) — recovery is a
 * read + verify, never a state rewrite.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.runId @param {string} [opts.checkpointId] (default: latest)
 */
function verifyCheckpoint(targetRoot, { runId, checkpointId } = {}) {
	if (!runId || typeof runId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--run <id> is required to verify a checkpoint");
	}
	const checkpoints = listCheckpoints(targetRoot, { runId });
	if (checkpoints.length === 0) {
		throw typedError(CODE_NOT_FOUND, `no checkpoint exists for run "${runId}"; capture one first`);
	}
	const record = checkpointId
		? checkpoints.find((entry) => entry.checkpointId === checkpointId)
		: checkpoints[checkpoints.length - 1];
	if (!record) {
		throw typedError(CODE_NOT_FOUND, `no checkpoint "${checkpointId}" for run "${runId}"`);
	}
	const run = getRun(targetRoot, { runId }).run;
	const drift = [];
	if (run.state !== record.state) {
		drift.push(`state ${record.state} → ${run.state}`);
	}
	const digest = runDigest(targetRoot, runId);
	if (digest !== record.refs.runRecordDigest) {
		drift.push("run record digest changed");
	}
	const attemptCount = listAttempts(targetRoot, { runId }).length;
	if (attemptCount !== record.refs.attemptCount) {
		drift.push(`attempt count ${record.refs.attemptCount} → ${attemptCount}`);
	}
	// The cited execution record is verifiable staleness — check it: an
	// execution record that changed after capture (new observed entries, a
	// changed verdict) is drift exactly like the run record's.
	if (record.refs.executionRecordDigest !== undefined) {
		const executionFile = executionRecordFileForRead(targetRoot, runId);
		if (!fs.existsSync(executionFile)) {
			drift.push("the cited execution record is gone");
		} else if (sha256File(executionFile) !== record.refs.executionRecordDigest) {
			drift.push("execution record digest changed");
		}
	}
	if (drift.length > 0) {
		throw typedError(
			CODE_DRIFT,
			`run "${runId}" has drifted from checkpoint "${record.checkpointId}": ${drift.join("; ")}`,
		);
	}
	return { ok: true, checkpoint: record, verifiedAt: new Date().toISOString() };
}

// The run record's additive `checkpoints` summary (ADR-0012): count, last
// checkpoint id, last capture instant. Absent on runs with none.
function refreshCheckpointSummary(targetRoot, { runId } = {}) {
	const checkpoints = listCheckpoints(targetRoot, { runId });
	if (checkpoints.length === 0) return { ok: true, summary: null };
	const { getRun } = require("./run-core");
	const { run } = getRun(targetRoot, { runId });
	const last = checkpoints[checkpoints.length - 1];
	run.checkpoints = {
		count: checkpoints.length,
		lastCheckpointId: last.checkpointId,
		lastCheckpointAt: last.at,
	};
	const runFile = runFileForRead(targetRoot, runId);
	fs.writeFileSync(runFile, `${JSON.stringify(run, null, "\t")}\n`, "utf8");
	return { ok: true, summary: run.checkpoints };
}

/**
 * Read one checkpoint (fail closed).
 */
function getCheckpoint(targetRoot, { runId, checkpointId } = {}) {
	if (!runId || typeof runId !== "string" || !checkpointId || typeof checkpointId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--run <id> and a checkpointId are required");
	}
	const file = path.join(checkpointsDirForRead(targetRoot, runId), `${safeId(checkpointId)}.json`);
	const record = readCheckpointFile(file);
	if (!record) {
		throw typedError(CODE_NOT_FOUND, `no checkpoint "${checkpointId}" for run "${runId}"`);
	}
	return { ok: true, checkpoint: record };
}

module.exports = {
	captureCheckpoint,
	listCheckpoints,
	verifyCheckpoint,
	getCheckpoint,
	CODE_NOT_FOUND,
	CODE_CORRUPT,
	CODE_FINAL,
	CODE_DRIFT,
	CODE_INVALID_ARG,
};
