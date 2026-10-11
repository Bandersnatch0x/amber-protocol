"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("node:crypto");
const { resolveStateDirForRead } = require("./state-dir-resolver");
const { sleepSync } = require("./core/fs-utils");
const { isProcessAlive, pidStillOwned, processIdentity } = require("./core/execution-handles");

// Only locks written before leases carried a pid are judged by age.
const PID_LESS_LOCK_TIMEOUT_MS = 300000;
const MAX_ATTEMPTS = 5;
// A takeover guard is itself a lease; a guard left by a crashed taker is taken
// over through one more guard, and no deeper.
const MAX_TAKEOVER_DEPTH = 2;

// link(2) of a fully written temp file is exclusive like O_EXCL, and a reader
// never sees a half-written lease.
function claim(lockPath, lease) {
	const tempPath = `${lockPath}.${lease.leaseId}`;
	fs.writeFileSync(tempPath, JSON.stringify(lease));
	try {
		fs.linkSync(tempPath, lockPath);
		return true;
	} catch (e) {
		if (e.code === "EEXIST") return false;
		throw e;
	} finally {
		fs.rmSync(tempPath, { force: true });
	}
}

// A read can be refused for a moment on Windows when another process is creating the same
// path at that instant. The takeover guard is named after the stale lock's bytes, so two
// takers target one path by design and the loser's read of it races the winner's create,
// which surfaces as a sharing violation rather than as ENOENT. Letting that out would
// crash a governed session command instead of refusing it. Retry briefly, then rethrow: a
// real permission problem still has to surface, and treating the failure as absent would
// make a healthy lock read as corrupt.
const TRANSIENT_READ_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

function readRaw(lockPath) {
	for (let attempt = 0; ; attempt++) {
		try {
			return fs.readFileSync(lockPath, "utf8");
		} catch (e) {
			if (e.code === "ENOENT") return null;
			if (!TRANSIENT_READ_CODES.has(e.code) || attempt >= 20) throw e;
			sleepSync(5);
		}
	}
}

function parseLease(raw) {
	try {
		const lease = JSON.parse(raw);
		return lease && typeof lease === "object" ? lease : null;
	} catch {
		return null;
	}
}

function holderState(lease) {
	if (lease && Number.isInteger(lease.pid)) {
		const running =
			isProcessAlive(lease.pid) && pidStillOwned({ pid: lease.pid, pidStartedAt: lease.startTime });
		return running ? "live" : "stale";
	}
	if (lease && typeof lease.timestamp === "number") {
		return Date.now() - lease.timestamp < PID_LESS_LOCK_TIMEOUT_MS ? "live" : "stale";
	}
	return "corrupt";
}

function locked(holder) {
	const who = Number.isInteger(holder?.pid) ? `pid ${holder.pid}` : "another process";
	return {
		success: false,
		code: "AMBER_E_SESSION_LOCKED",
		error: `Session is locked by ${who}`,
		// On a platform that cannot name a process identity, a live pid may be a
		// recycled one, so "live" there means "not falsifiable", not "the same
		// process". Callers that would otherwise say "just wait" need this.
		identityKnown: Number.isInteger(holder?.pid) && processIdentity(holder.pid) !== null,
	};
}

// Only the winner of the guard keyed by the stale lock's exact bytes may
// remove it, so a slow taker can never delete the lease a faster taker wrote.
function removeStale(lockPath, raw, depth) {
	const guardPath = `${lockPath}.takeover-${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16)}`;
	const guard = acquireAt(guardPath, depth + 1);
	if (!guard.success) return guard;
	try {
		if (readRaw(lockPath) === raw) fs.rmSync(lockPath, { force: true });
	} finally {
		releaseAt(guardPath, guard.leaseId);
	}
	return null;
}

// The chain is bounded, so a crash inside a guard of a guard leaves files nothing
// can reclaim. Naming them is the whole remedy: the code cannot clear them itself,
// and "locked by pid N" would name a process that is already dead. The walk is
// rooted at the real lock, because the guard names are hashes of the bytes they
// guard and cannot be derived by appending. A guard held by a pid that cannot be
// shown to be a live amber process shares this refusal, because it needs the same
// remedy: on a platform that cannot name a process identity the pid may be recycled,
// so nothing would ever release it and "wait" would be a refusal with no way out.
function lockStuck(lockPath, detail) {
	// Only trailing hash-shaped groups come off, and only from the basename: a plain
	// replace would strip at the leftmost `.takeover-` anywhere in the path, so a
	// directory whose own name contains it would be reported and the real lock omitted.
	const base = path.basename(lockPath).replace(/(?:\.takeover-[0-9a-f]{16})+$/, "");
	const root = path.join(path.dirname(lockPath), base);
	const dir = path.dirname(root);
	let guards = [];
	try {
		guards = fs
			.readdirSync(dir)
			.filter((name) => name.startsWith(`${base}.takeover-`))
			.sort()
			.map((name) => path.join(dir, name));
	} catch {
		/* the directory is gone, so there is nothing to name */
	}
	const because = detail ? ` (${detail})` : "";
	return {
		success: false,
		code: "AMBER_E_SESSION_LOCK_STUCK",
		error: `Session lock ${root} cannot be reclaimed${because}; if no amber session command is running, remove ${[root, ...guards].join(", ")}`,
	};
}

function acquireAt(lockPath, depth) {
	fs.mkdirSync(path.dirname(lockPath), { recursive: true });
	const lease = {
		leaseId: crypto.randomUUID(),
		pid: process.pid,
		startTime: processIdentity(process.pid),
		acquiredAt: new Date().toISOString(),
	};
	let guardFailure = null;
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		if (claim(lockPath, lease)) return { success: true, leaseId: lease.leaseId };
		const raw = readRaw(lockPath);
		if (raw === null) continue;
		const holder = parseLease(raw);
		const state = holderState(holder);
		if (state === "corrupt") {
			return {
				success: false,
				code: "AMBER_E_SESSION_LOCK_CORRUPT",
				error: `Session lock ${lockPath} does not name a holder`,
			};
		}
		if (state === "live") return locked(holder);
		if (depth >= MAX_TAKEOVER_DEPTH) return lockStuck(lockPath);
		guardFailure = removeStale(lockPath, raw, depth);
	}
	// The attempts ran out with the holder still stale, so the lock could not be
	// reclaimed. Why matters, and the two reasons want different answers. A guard held
	// by a process whose identity could be checked is genuinely another live process,
	// and it is the guard holder, not the dead lock holder, that must be named, so its
	// own refusal is the honest one. A guard whose identity cannot be checked may be a
	// recycled pid, and then waiting would never end, so that keeps the manual-removal
	// remedy instead.
	if (guardFailure?.code === "AMBER_E_SESSION_LOCK_STUCK") return guardFailure;
	if (guardFailure?.code === "AMBER_E_SESSION_LOCKED") {
		return guardFailure.identityKnown ? guardFailure : lockStuck(lockPath, guardFailure.error);
	}
	const remaining = parseLease(readRaw(lockPath));
	if (holderState(remaining) === "stale") return lockStuck(lockPath);
	return locked(remaining);
}

function releaseAt(lockPath, leaseId) {
	if (parseLease(readRaw(lockPath))?.leaseId === leaseId) fs.rmSync(lockPath, { force: true });
}

// The same crash-safe lease protocol is useful for governed stores that are
// not keyed by a session id (for example a harness run or a monotonic fence
// counter). Keep the primitive path-based so those stores cannot accidentally
// build a weaker open/write lock of their own.
function acquirePathLock(lockPath) {
	return acquireAt(lockPath, 0);
}

function releasePathLock(lockPath, leaseId) {
	releaseAt(lockPath, leaseId);
}

function acquireLock(projectRoot, sessionId) {
	return acquireAt(getLockPath(projectRoot, sessionId), 0);
}

function releaseLock(projectRoot, sessionId, leaseId) {
	releaseAt(getLockPath(projectRoot, sessionId), leaseId);
}

function getLockPath(projectRoot, sessionId) {
	return path.join(resolveStateDirForRead(projectRoot), "sessions", sessionId, ".lock");
}

module.exports = { acquireLock, releaseLock, acquirePathLock, releasePathLock };
