"use strict";

const fs = require("fs");
const path = require("path");
const { resolveStateDirForRead } = require("./state-dir-resolver");

const LOCK_TIMEOUT_MS = 300000; // 5 minutes

function acquireLock(projectRoot, sessionId) {
	const lockPath = getLockPath(projectRoot, sessionId);
	const lockDir = path.dirname(lockPath);

	if (!fs.existsSync(lockDir)) {
		fs.mkdirSync(lockDir, { recursive: true });
	}

	if (fs.existsSync(lockPath)) {
		let lock;
		try {
			lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
		} catch {
			// Corrupt lock file - treat as stale
			fs.unlinkSync(lockPath);
		}
		if (lock) {
			const age = Date.now() - lock.timestamp;
			if (age < LOCK_TIMEOUT_MS) {
				return {
					success: false,
					error: "Session is locked by another process",
				};
			}
			// Stale lock - remove it
			fs.unlinkSync(lockPath);
		}
	}

	fs.writeFileSync(
		lockPath,
		JSON.stringify({
			pid: process.pid,
			timestamp: Date.now(),
		}),
	);

	return { success: true };
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
