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

/**
 * Whether a pid is a ZOMBIE: it has terminated, but its parent has not reaped
 * it yet. Linux keeps an unreaped process addressable — `kill(pid, 0)`
 * SUCCEEDS, and the pid stays a member of its process group — so a bare
 * liveness probe reads a process that has already ended as still running.
 *
 * This is not academic. A cancellation that signals the group from a process
 * whose event loop is blocked (a `spawnSync` supervisor, for instance) really
 * does kill the child, then polls a defunct pid for the whole settle bound and
 * honestly — but wrongly — reports `unknown` for a kill it performed. That
 * happened on Linux CI.
 */
function pidIsZombie(pid) {
	if (process.platform !== "linux") return false;
	try {
		// Format: "<pid> (<comm>) <state> ...". `comm` may itself contain spaces
		// and parentheses, so the state is the first field after the LAST ")".
		const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
		return stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z");
	} catch {
		// No /proc entry (or no /proc at all): the signal probe is the only
		// evidence available, so a non-Linux POSIX host cannot tell a defunct pid
		// from a live one. That residual is documented, never claimed away — a
		// cancellation that cannot observe an exit still reports `unknown`, which
		// is never success.
		return false;
	}
}

/**
 * The kernel's identity for a running process, or null when the platform cannot
 * provide one. A recycled pid belongs to a process with a different identity, and
 * comparing it is how this seam knows the pid it is about to signal is still OURS.
 *
 *   - Linux: the process start time (the 22nd field of /proc/<pid>/stat, in clock
 *     ticks since boot) — a plain file read.
 *   - macOS: `ps -o lstart=` — locale-formatted, but stable within a run. Implemented;
 *     not exercised by this session's test runs (no macOS host).
 *   - Windows: deliberately unimplemented — see the note at the end of the function.
 *
 * Any other platform returns null, and the caller must read "no identity" as
 * "cannot falsify ownership" — a residual, never a guess.
 */
function processIdentity(pid) {
	if (!Number.isInteger(pid) || pid < 1) return null;
	if (process.platform === "linux") {
		try {
			const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
			const fields = stat
				.slice(stat.lastIndexOf(")") + 2)
				.trim()
				.split(/\s+/);
			// Field 3 (state) is fields[0], so starttime (field 22) is fields[19].
			return fields[19] ?? null;
		} catch {
			return null;
		}
	}
	if (process.platform === "darwin") {
		try {
			const started = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
			return started.length === 0 ? null : started;
		} catch {
			return null;
		}
	}
	// Windows is deliberately NOT probed. Its only identity primitive is a process
	// spawn (Get-Process via PowerShell), and measuring it here showed ~1-3s per call —
	// which turned this suite from 37s into 100s for a check that matters only when a
	// pid was recycled between two reads. `tasklist` carries no start time and `wmic` is
	// gone from current Windows. So on Windows the recorded pid is signalled after the
	// liveness, zombie and ownership-shape checks, and that gap is a stated residual.
	return null;
}

/**
 * Whether the recorded pid still belongs to the process the handle recorded.
 * Reports true when either side has no identity: a platform that cannot name one,
 * or a handle written before identity was recorded, cannot FALSIFY ownership, and
 * that residual is stated in the spec rather than guessed at here.
 */
function pidStillOwned(record) {
	if (!record || !Number.isInteger(record.pid)) return false;
	const recorded = typeof record.pidStartedAt === "string" ? record.pidStartedAt : null;
	const live = processIdentity(record.pid);
	if (recorded === null || live === null) return true;
	return recorded === live;
}

/** Whether a pid is a LIVE process (signal 0 probe; never signals the target). */
function isProcessAlive(pid) {
	if (!Number.isInteger(pid) || pid < 1) return false;
	let addressable;
	try {
		process.kill(pid, 0);
		addressable = true;
	} catch (error) {
		addressable = Boolean(error && error.code === "EPERM");
	}
	// Addressable is not the same as alive: a zombie still answers signal 0.
	return addressable && !pidIsZombie(pid);
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
		pidStartedAt: processIdentity(input.pid),
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

function handleProblem(record, targetRoot) {
	if (!record || typeof record !== "object" || Array.isArray(record))
		return "execution handle is not an object";
	for (const field of ["runId", "workspace", "startedAt", "target"]) {
		if (typeof record[field] !== "string" || record[field].length === 0)
			return `execution handle carries no ${field}`;
	}
	// F081 §3.2: a handle is bound to the target it was issued for, and that
	// binding is enforced here at the SHARED read boundary so no caller can
	// signal the pid it names. Shape/hash validity is not target validity: a
	// handle copied into another target's store is still internally consistent.
	if (path.resolve(record.target) !== path.resolve(targetRoot))
		return `execution handle was issued for a different target (${record.target}); it is not valid for ${path.resolve(targetRoot)}`;
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
	const problem = handleProblem(record, targetRoot);
	if (problem !== null)
		throw typedError(CODE_CORRUPT, `execution handle fails its closed shape: ${problem}`);
	return {
		...record,
		file,
		// Observed liveness only. This verdict is read in polling loops (a readiness
		// wait, a handle listing), so it must stay cheap; identity verification is
		// reserved for the decision that SIGNALS, in `pidStillOwned`. The residual is
		// stated: a recycled pid reads `live` here, and only the cancellation path
		// refuses to act on it.
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
	pidStillOwned,
	processIdentity,
	signalPidTree,
	handleFile,
};
