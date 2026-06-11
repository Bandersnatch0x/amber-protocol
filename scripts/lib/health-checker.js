"use strict";

/**
 * System health diagnostics for production monitoring.
 * Checks disk space, memory, process state, and session validity.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const HEALTH_THRESHOLDS = {
	diskSpaceMinGB: 1,
	memoryMinMB: 256,
	maxStaleSessions: 100,
};

function checkDiskSpace(projectRoot) {
	try {
		const stats = fs.statfsSync ? fs.statfsSync(projectRoot) : null;
		if (!stats) {
			return { available: true, warning: "Unable to check disk space (statfs unavailable)" };
		}

		const availableGB = (stats.bavail * stats.bsize) / (1024 * 1024 * 1024);
		const healthy = availableGB >= HEALTH_THRESHOLDS.diskSpaceMinGB;

		return {
			available: healthy,
			availableGB: Math.round(availableGB * 100) / 100,
			warning: healthy ? null : `Low disk space: ${availableGB.toFixed(2)}GB`,
		};
	} catch (error) {
		return { available: true, warning: `Disk check error: ${error.message}` };
	}
}

function checkMemory() {
	const freeMB = os.freemem() / (1024 * 1024);
	const totalMB = os.totalmem() / (1024 * 1024);
	const healthy = freeMB >= HEALTH_THRESHOLDS.memoryMinMB;

	return {
		available: healthy,
		freeMB: Math.round(freeMB),
		totalMB: Math.round(totalMB),
		warning: healthy ? null : `Low memory: ${Math.round(freeMB)}MB free`,
	};
}

function checkSessions(projectRoot) {
	try {
		const { resolveStateDirForRead } = require("./state-dir-resolver");
		const stateDir = resolveStateDirForRead(projectRoot);
		const sessionsDir = path.join(stateDir, "sessions");

		if (!fs.existsSync(sessionsDir)) {
			return { available: true, count: 0, stale: 0 };
		}

		const sessions = fs.readdirSync(sessionsDir);
		const now = Date.now();
		const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

		let staleCount = 0;
		for (const sessionId of sessions) {
			const manifestPath = path.join(sessionsDir, sessionId, "manifest.json");
			if (fs.existsSync(manifestPath)) {
				const stat = fs.statSync(manifestPath);
				if (now - stat.mtimeMs > oneWeekMs) {
					staleCount++;
				}
			}
		}

		const healthy = staleCount < HEALTH_THRESHOLDS.maxStaleSessions;

		return {
			available: healthy,
			count: sessions.length,
			stale: staleCount,
			warning: healthy ? null : `${staleCount} stale sessions (>1 week old)`,
		};
	} catch (error) {
		return { available: true, count: 0, stale: 0, warning: `Session check error: ${error.message}` };
	}
}

function runHealthCheck(projectRoot) {
	const disk = checkDiskSpace(projectRoot);
	const memory = checkMemory();
	const sessions = checkSessions(projectRoot);

	const healthy = disk.available && memory.available && sessions.available;
	const warnings = [disk.warning, memory.warning, sessions.warning].filter(Boolean);

	return {
		healthy,
		checks: { disk, memory, sessions },
		warnings,
		timestamp: new Date().toISOString(),
	};
}

module.exports = {
	HEALTH_THRESHOLDS,
	checkDiskSpace,
	checkMemory,
	checkSessions,
	runHealthCheck,
};
