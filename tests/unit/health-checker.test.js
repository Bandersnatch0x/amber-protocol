"use strict";

const assert = require("node:assert");
const test = require("node:test");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
	HEALTH_THRESHOLDS,
	checkDiskSpace,
	checkMemory,
	checkSessions,
	runHealthCheck,
} = require("../../scripts/lib/health-checker");

test("checkDiskSpace - returns availability info", () => {
	const result = checkDiskSpace(".");
	assert.ok(typeof result.available === "boolean");
	if (result.availableGB !== undefined) {
		assert.ok(result.availableGB >= 0);
	}
});

test("checkMemory - returns memory info", () => {
	const result = checkMemory();
	assert.ok(typeof result.available === "boolean");
	assert.ok(result.freeMB > 0);
	assert.ok(result.totalMB > 0);
	assert.ok(result.freeMB <= result.totalMB);
});

test("checkSessions - handles missing sessions directory", () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-test-"));
	try {
		const result = checkSessions(tmpDir);
		assert.strictEqual(result.available, true);
		assert.strictEqual(result.count, 0);
		assert.strictEqual(result.stale, 0);
	} finally {
		fs.rmSync(tmpDir, { recursive: true });
	}
});

test("checkSessions - counts sessions", () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-test-"));
	try {
		const sessionsDir = path.join(tmpDir, ".amber", "sessions");
		fs.mkdirSync(sessionsDir, { recursive: true });

		const sessionId = "test-session-001";
		const sessionDir = path.join(sessionsDir, sessionId);
		fs.mkdirSync(sessionDir);
		fs.writeFileSync(
			path.join(sessionDir, "manifest.json"),
			JSON.stringify({ sessionId, createdAt: new Date().toISOString() }),
		);

		const result = checkSessions(tmpDir);
		assert.strictEqual(result.available, true);
		assert.strictEqual(result.count, 1);
		assert.strictEqual(result.stale, 0);
	} finally {
		fs.rmSync(tmpDir, { recursive: true });
	}
});

test("checkSessions - detects stale sessions", () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-test-"));
	try {
		const sessionsDir = path.join(tmpDir, ".amber", "sessions");
		fs.mkdirSync(sessionsDir, { recursive: true });

		const sessionId = "stale-session-001";
		const sessionDir = path.join(sessionsDir, sessionId);
		fs.mkdirSync(sessionDir);
		const manifestPath = path.join(sessionDir, "manifest.json");
		fs.writeFileSync(
			manifestPath,
			JSON.stringify({ sessionId, createdAt: new Date().toISOString() }),
		);

		// Fake old mtime (8 days ago)
		const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
		fs.utimesSync(manifestPath, eightDaysAgo / 1000, eightDaysAgo / 1000);

		const result = checkSessions(tmpDir);
		assert.strictEqual(result.count, 1);
		assert.strictEqual(result.stale, 1);
	} finally {
		fs.rmSync(tmpDir, { recursive: true });
	}
});

test("runHealthCheck - returns complete health report", () => {
	const result = runHealthCheck(".");
	assert.ok(typeof result.healthy === "boolean");
	assert.ok(result.checks.disk);
	assert.ok(result.checks.memory);
	assert.ok(result.checks.sessions);
	assert.ok(Array.isArray(result.warnings));
	assert.ok(result.timestamp);
});

test("runHealthCheck - healthy system has no warnings", () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-test-"));
	try {
		const result = runHealthCheck(tmpDir);
		if (result.healthy) {
			assert.strictEqual(result.warnings.length, 0);
		}
	} finally {
		fs.rmSync(tmpDir, { recursive: true });
	}
});
