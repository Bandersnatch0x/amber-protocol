"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
	statusSession,
	abortSession,
	continueSession,
	verifySession,
	approveSession,
	verifyLedgerSession,
	runSession,
	settleSession,
	leaseSession,
} = require("../../scripts/lib/session-commands");

test("statusSession rejects path traversal", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-session-id-test-"));
	try {
		fs.mkdirSync(path.join(tempDir, ".amber"), { recursive: true });
		const result = statusSession(tempDir, { sessionId: "../../etc/passwd" });
		assert.strictEqual(result.exitCode, 1);
		assert.match(result.text, /Invalid session ID format/);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("statusSession rejects backslash traversal", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-session-id-test-"));
	try {
		fs.mkdirSync(path.join(tempDir, ".amber"), { recursive: true });
		const result = statusSession(tempDir, { sessionId: "..\\..\\sensitive" });
		assert.strictEqual(result.exitCode, 1);
		assert.match(result.text, /Invalid session ID format/);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("abortSession rejects path traversal", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-session-id-test-"));
	try {
		fs.mkdirSync(path.join(tempDir, ".amber"), { recursive: true });
		const result = await abortSession(tempDir, { sessionId: "../../../etc/passwd" });
		assert.strictEqual(result.exitCode, 1);
		assert.match(result.text, /Invalid session ID format/);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("continueSession rejects path traversal", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-session-id-test-"));
	try {
		fs.mkdirSync(path.join(tempDir, ".amber"), { recursive: true });
		const result = await continueSession(tempDir, { sessionId: "../../sensitive" });
		assert.strictEqual(result.exitCode, 1);
		assert.match(result.text, /Invalid session ID format/);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("verifySession rejects path traversal", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-session-id-test-"));
	try {
		fs.mkdirSync(path.join(tempDir, ".amber"), { recursive: true });
		const result = await verifySession(tempDir, { sessionId: "../../../etc/passwd" });
		assert.strictEqual(result.exitCode, 1);
		assert.match(result.text, /Invalid session ID format/);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("approveSession rejects path traversal", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-session-id-test-"));
	try {
		fs.mkdirSync(path.join(tempDir, ".amber"), { recursive: true });
		const result = await approveSession(tempDir, { sessionId: "../../sensitive" });
		assert.strictEqual(result.exitCode, 1);
		assert.match(result.text, /Invalid session ID format/);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("verifyLedgerSession rejects path traversal", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-session-id-test-"));
	try {
		fs.mkdirSync(path.join(tempDir, ".amber"), { recursive: true });
		const result = verifyLedgerSession(tempDir, "../../../etc/passwd");
		assert.strictEqual(result.exitCode, 1);
		assert.match(result.text, /Invalid session ID format/);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("runSession rejects path traversal", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-session-id-test-"));
	try {
		fs.mkdirSync(path.join(tempDir, ".amber"), { recursive: true });
		const result = await runSession(tempDir, { sessionId: "../../sensitive" });
		assert.strictEqual(result.exitCode, 1);
		assert.match(result.text, /Invalid session ID format/);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("settleSession rejects path traversal", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-session-id-test-"));
	try {
		fs.mkdirSync(path.join(tempDir, ".amber"), { recursive: true });
		const result = await settleSession(tempDir, {
			sessionId: "../../../etc/passwd",
			requestId: "req-123",
			settlementResult: { status: "succeeded" },
		});
		assert.strictEqual(result.exitCode, 1);
		assert.match(result.text, /Invalid session ID format/);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("leaseSession rejects path traversal", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-session-id-test-"));
	try {
		fs.mkdirSync(path.join(tempDir, ".amber"), { recursive: true });
		const result = await leaseSession(tempDir, {
			sessionId: "../../sensitive",
			ownerId: "agent-1",
			tokenHash: "abc123",
		});
		assert.strictEqual(result.exitCode, 1);
		assert.match(result.text, /Invalid session ID format/);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("statusSession accepts valid UUID v4", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-session-id-test-"));
	try {
		fs.mkdirSync(path.join(tempDir, ".amber"), { recursive: true });
		const result = statusSession(tempDir, { sessionId: "550e8400-e29b-41d4-a716-446655440000" });
		// Session won't exist, but validation passes
		assert.ok(!result.text.includes("Invalid session ID format"));
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
