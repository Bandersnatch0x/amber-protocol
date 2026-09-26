"use strict";

// F081 — owned governed-execution handles.
//
// One handle per running governed command, written immediately after the child
// is spawned and removed when it settles. The handle is the ONLY thing a
// cancellation may address: it records the pid, the ownership coordinates
// (lease + fence, the F080 pattern), the workspace the command is confined to,
// the declared budget deadline, and a canonical Snapshot Hash over its own body.
//
// Core-level module on purpose: the spawn seam (core) writes it and the harness
// cancellation command reads it, so the store must not depend on either side's
// domain layer.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { statePath, statePathForCreate } = require("../state-dir-resolver");
const { canonicalHashOf } = require("./registry-ledger");

const HANDLE_SCHEMA_VERSION = 1;
const HANDLE_SUFFIX = ".handle.json";
const CODE_CORRUPT = "AMBER_E_HARNESS_EXEC_HANDLE_CORRUPT";

function typedError(code, message) {
	const error = new Error(message);
	error.amberCode = code;
	return error;
}

function safeId(value) {
	return String(value).replace(/[^A-Za-z0-9._-]/g, "-");
}

function handlesDirForRead(targetRoot) {
	return statePath(targetRoot, "harness", "executions");
}

function handleFile(targetRoot, runId, { create = false } = {}) {
	const dir = create
		? statePathForCreate(targetRoot, "harness", "executions")
		: handlesDirForRead(targetRoot);
	return path.join(dir, `${safeId(runId)}${HANDLE_SUFFIX}`);
}

function fenceFile(targetRoot) {
	return statePathForCreate(targetRoot, "harness", "executions", "fence.json");
}

/** Whether a pid currently exists (signal 0 probe; never signals the target). */
function isProcessAlive(pid) {
	if (!Number.isInteger(pid) || pid < 1) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return Boolean(error && error.code === "EPERM");
	}
}

/**
 * Signal a whole process tree. The child is spawned detached, so on POSIX it
 * leads its own process group and a negative pid addresses the group. On
 * Windows there is no process group to address, so the tree is addressed
 * through the platform's own tree-kill switch.
 */
function signalPidTree(pid, signal = "SIGTERM") {
	if (!Number.isInteger(pid) || pid < 1) return { signalled: false, reason: "no-pid" };
	if (process.platform === "win32") {
		try {
			execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
			return { signalled: true, mechanism: "taskkill-tree" };
		} catch (error) {
			// The tree may have exited between the liveness probe and the kill:
			// a failure here is an observation, not a hard error.
			return { signalled: false, reason: error.message || String(error) };
		}
	}
	try {
		process.kill(-pid, signal);
		return { signalled: true, mechanism: "process-group" };
	} catch (error) {
		try {
			process.kill(pid, signal);
			return { signalled: true, mechanism: "single-process" };
		} catch (inner) {
			return { signalled: false, reason: inner.message || String(inner) };
		}
	}
}

function nextFence(targetRoot) {
	const file = fenceFile(targetRoot);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	let current = 0;
	if (fs.existsSync(file)) {
		let record;
		try {
			record = JSON.parse(fs.readFileSync(file, "utf8"));
		} catch (error) {
			throw typedError(CODE_CORRUPT, `execution handle fence is not valid JSON: ${error.message}`);
		}
		if (!Number.isInteger(record.fence) || record.fence < 0)
			throw typedError(CODE_CORRUPT, "execution handle fence is malformed");
		current = record.fence;
	}
	const next = current + 1;
	fs.writeFileSync(file, `${JSON.stringify({ fence: next }, null, "\t")}\n`, "utf8");
	return next;
}

/**
 * Persist the handle for one live governed command. Returns the stored record
 * (including its Snapshot Hash) or throws on a write failure; the caller must
 * clear it with `clearExecutionHandle` in a `finally`.
 */
function persistExecutionHandle(input) {
	const targetRoot = input.targetRoot;
	const record = {
		schemaVersion: HANDLE_SCHEMA_VERSION,
		runId: input.runId,
		attemptId: input.attemptId ?? null,
		label: input.label ?? null,
		commandId: input.commandId ?? null,
		workspace: input.workspace,
		pid: input.pid,
		leaseId: crypto.randomUUID(),
		fence: nextFence(targetRoot),
		startedAt: input.startedAt,
		deadlineAt: input.deadlineAt ?? null,
		target: path.resolve(targetRoot),
	};
	record.snapshotHash = canonicalHashOf(record);
	const file = handleFile(targetRoot, input.runId, { create: true });
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`, {
		encoding: "utf8",
		flag: "wx",
	});
	return { ...record, file };
}

/** Remove one handle; a handle that is already gone is a no-op. */
function clearExecutionHandle(record) {
	if (!record || !record.file) return;
	try {
		fs.rmSync(record.file, { force: true });
	} catch (_error) {
		// The handle's absence is what matters; a failed unlink is retried by
		// the next settlement or reconciled by the reader.
	}
}

function handleProblem(record) {
	if (!record || typeof record !== "object" || Array.isArray(record))
		return "execution handle is not an object";
	for (const field of ["runId", "workspace", "startedAt", "target"]) {
		if (typeof record[field] !== "string" || record[field].length === 0)
			return `execution handle carries no ${field}`;
	}
	if (!Number.isInteger(record.pid) || record.pid < 1) return "execution handle carries no pid";
	if (!Number.isInteger(record.fence) || record.fence < 1)
		return "execution handle carries no fence";
	if (typeof record.leaseId !== "string" || record.leaseId.length === 0)
		return "execution handle carries no leaseId";
	if (record.snapshotHash !== canonicalHashOf(handleHashBody(record)))
		return "execution handle no longer matches its Snapshot Hash";
	return null;
}

function handleHashBody(record) {
	const { snapshotHash: _snapshotHash, file: _file, ...body } = record;
	return body;
}

/**
 * Read one handle fail-closed, or null when the run has no live handle.
 * `status` is the OBSERVED liveness (`live` / `stale`), never an assumption.
 */
function readExecutionHandle(targetRoot, runId) {
	const file = handleFile(targetRoot, runId);
	if (!fs.existsSync(file)) return null;
	let record;
	try {
		record = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		throw typedError(CODE_CORRUPT, `execution handle is not valid JSON: ${error.message}`);
	}
	const problem = handleProblem(record);
	if (problem !== null)
		throw typedError(CODE_CORRUPT, `execution handle fails its closed shape: ${problem}`);
	return {
		...record,
		file,
		status: isProcessAlive(record.pid) ? "live" : "stale",
	};
}

/** Every handle on record, ordered by run id, each with observed liveness. */
function listExecutionHandles(targetRoot) {
	const dir = handlesDirForRead(targetRoot);
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(HANDLE_SUFFIX))
		.sort()
		.map((name) => readExecutionHandle(targetRoot, name.slice(0, -HANDLE_SUFFIX.length)))
		.filter((record) => record !== null);
}

module.exports = {
	HANDLE_SCHEMA_VERSION,
	CODE_CORRUPT,
	persistExecutionHandle,
	clearExecutionHandle,
	readExecutionHandle,
	listExecutionHandles,
	isProcessAlive,
	signalPidTree,
	handleFile,
};
