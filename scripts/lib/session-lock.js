"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("node:crypto");
const { resolveStateDirForRead } = require("./state-dir-resolver");

const LOCK_TIMEOUT_MS = 300000; // 5 minutes
// Bounds retry against concurrent stale-lock cleaners: if several processes
// all decide a stale lock is removable, they each unlink and race to re-link
// a replacement. Only one can win per round; the rest loop. A cap keeps this
// finite instead of spinning forever under contention.
const MAX_STALE_RETRIES = 4;

// Atomically claim the lock by writing the full payload to a unique temp
// file and then link(2)-ing it into place. link is atomic: concurrent
// callers cannot both succeed (the second hits EEXIST), AND a reader never
// observes a half-written lock - lockPath only exists once the complete temp
// file is linked in. This closes both races the old existsSync+writeFileSync
// had: the TOCTOU double-acquire (two processes both see "no lock" and both
// write one) and the create-then-write gap a bare O_EXCL+write would leave
// open (a concurrent reader sees an empty file, mistakes it for a corrupt/
// stale lock, and unlinks a lock its owner had only half-created).
function claimLockAtomically(lockPath) {
	const tempPath = `${lockPath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}`;
	fs.writeFileSync(tempPath, JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
	try {
		fs.linkSync(tempPath, lockPath);
	} finally {
		// Drop the temp name whether we won the link or hit EEXIST. The
		// inode lives on via lockPath if the link succeeded.
		try {
			fs.unlinkSync(tempPath);
		} catch {
			// already removed - nothing to do
		}
	}
}

function readLock(lockPath) {
	try {
		return JSON.parse(fs.readFileSync(lockPath, "utf8"));
	} catch {
		// Missing (ENOENT) or corrupt - treat as stale so the caller removes
		// any leftover and re-claims. A missing file after EEXIST means a
		// concurrent cleaner already unlinked it; retrying is correct.
		return null;
	}
}

function acquireLock(projectRoot, sessionId) {
	const lockPath = getLockPath(projectRoot, sessionId);
	const lockDir = path.dirname(lockPath);

	if (!fs.existsSync(lockDir)) {
		fs.mkdirSync(lockDir, { recursive: true });
	}

	for (let attempt = 0; attempt <= MAX_STALE_RETRIES; attempt++) {
		try {
			claimLockAtomically(lockPath);
			return { success: true };
		} catch (e) {
			if (e.code !== "EEXIST") throw e;
		}

		// Lock exists - decide stale vs active. Because link is atomic, the
		// file we read here is either complete or absent (a concurrent cleaner
		// may have unlinked it between our EEXIST and our read); never partial.
		const lock = readLock(lockPath);
		const stale = !lock || Date.now() - lock.timestamp >= LOCK_TIMEOUT_MS;

		if (!stale) {
			return { success: false, error: "Session is locked by another process" };
		}

		// Stale (or corrupt, or just-unlinked) - remove and let the next link
		// decide the sole winner. Concurrent cleaners may both unlink; only
		// one's next link succeeds, so the lock is never granted twice.
		try {
			fs.unlinkSync(lockPath);
		} catch (e) {
			if (e.code !== "ENOENT") throw e; // already removed by a concurrent cleaner
		}
	}

	// Exhausted retries under sustained contention. Fail safe: refuse rather
	// than fall back to a non-atomic write that would reintroduce the race.
	return { success: false, error: "Session is locked by another process" };
}

function releaseLock(projectRoot, sessionId) {
	const lockPath = getLockPath(projectRoot, sessionId);

	if (fs.existsSync(lockPath)) {
		fs.unlinkSync(lockPath);
	}
}

function isLocked(projectRoot, sessionId) {
	const lockPath = getLockPath(projectRoot, sessionId);

	if (!fs.existsSync(lockPath)) {
		return false;
	}

	let lock;
	try {
		lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
	} catch {
		return false;
	}
	const age = Date.now() - lock.timestamp;

	return age < LOCK_TIMEOUT_MS;
}

function getLockPath(projectRoot, sessionId) {
	return path.join(resolveStateDirForRead(projectRoot), "sessions", sessionId, ".lock");
}

module.exports = { acquireLock, releaseLock, isLocked };
