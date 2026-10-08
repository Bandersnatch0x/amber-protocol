"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("node:crypto");
const { resolveStateDirForRead } = require("./state-dir-resolver");
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

function readRaw(lockPath) {
	try {
		return fs.readFileSync(lockPath, "utf8");
	} catch (e) {
		if (e.code === "ENOENT") return null;
		throw e;
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
	};
}

// Only the winner of the guard keyed by the stale lock's exact bytes may
// remove it, so a slow taker can never delete the lease a faster taker wrote.
function removeStale(lockPath, raw, depth) {
	const guardPath = `${lockPath}.takeover-${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16)}`;
	const guard = acquireAt(guardPath, depth + 1);
	if (!guard.success) return;
	try {
		if (readRaw(lockPath) === raw) fs.rmSync(lockPath, { force: true });
	} finally {
		releaseAt(guardPath, guard.leaseId);
	}
}

function acquireAt(lockPath, depth) {
	fs.mkdirSync(path.dirname(lockPath), { recursive: true });
	const lease = {
		leaseId: crypto.randomUUID(),
		pid: process.pid,
		startTime: processIdentity(process.pid),
		acquiredAt: new Date().toISOString(),
	};
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
		if (state === "live" || depth >= MAX_TAKEOVER_DEPTH) return locked(holder);
		removeStale(lockPath, raw, depth);
	}
	return locked(parseLease(readRaw(lockPath)));
}

function releaseAt(lockPath, leaseId) {
	if (parseLease(readRaw(lockPath))?.leaseId === leaseId) fs.rmSync(lockPath, { force: true });
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

module.exports = { acquireLock, releaseLock };
