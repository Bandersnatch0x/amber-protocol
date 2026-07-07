const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {
	startSession,
	continueSession,
	abortSession,
} = require("../../scripts/lib/session-commands");
const { dispatch } = require("../../scripts/lib/command-dispatcher");
const { parseArgs } = require("../../scripts/lib/core/cli-output");
const { readRunnerAck, writeRunnerAck } = require("../../scripts/lib/runner-ack");

const TEST_ROOT = path.join(__dirname, "../fixtures/session-runner-ack");

function cleanup() {
	if (fs.existsSync(TEST_ROOT)) {
		fs.rmSync(TEST_ROOT, { recursive: true, force: true });
	}
}

function manifestPath(sessionId) {
	return path.join(TEST_ROOT, ".amber", "sessions", sessionId, "manifest.json");
}

function setStatus(sessionId, status) {
	const file = manifestPath(sessionId);
	const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
	fs.writeFileSync(file, JSON.stringify({ ...manifest, status }, null, 2));
}

describe("session runner ACK files", () => {
	beforeEach(() => {
		cleanup();
		fs.mkdirSync(TEST_ROOT, { recursive: true });
	});

	afterEach(() => {
		cleanup();
	});

	it("continueSession writes an ACK file for a matching web control request", async () => {
		const start = await startSession(TEST_ROOT, {
			goal: "resume with runner ack",
			route: "feature-standard",
		});
		setStatus(start.sessionId, "paused");

		const result = await continueSession(TEST_ROOT, {
			sessionId: start.sessionId,
			requestId: "resume-request-1",
		});

		assert.strictEqual(result.exitCode, 0);
		const ack = readRunnerAck(TEST_ROOT, start.sessionId, "resume-request-1");
		assert.deepStrictEqual(
			{
				requestId: ack.requestId,
				action: ack.action,
				status: ack.status,
				requestedStatus: ack.requestedStatus,
				source: ack.source,
				message: ack.message,
			},
			{
				requestId: "resume-request-1",
				action: "resume",
				status: "acked",
				requestedStatus: "executing",
				source: "amber-session-continue",
				message: "Session resumed by Amber CLI.",
			},
		);
		assert.ok(ack.receivedAt);
	});

	it("session continue command forwards --request-id to the runner ACK writer", async () => {
		const start = await startSession(TEST_ROOT, {
			goal: "resume with dispatched runner ack",
			route: "feature-standard",
		});
		setStatus(start.sessionId, "paused");

		const dispatched = await dispatch(
			"session",
			parseArgs([
				"continue",
				"--target",
				TEST_ROOT,
				"--session",
				start.sessionId,
				"--request-id",
				"resume-request-dispatched",
			]),
		);

		assert.strictEqual(dispatched.exitCode, 0);
		const ack = readRunnerAck(TEST_ROOT, start.sessionId, "resume-request-dispatched");
		assert.strictEqual(ack.requestId, "resume-request-dispatched");
		assert.strictEqual(ack.action, "resume");
		assert.strictEqual(ack.status, "acked");
		assert.strictEqual(ack.source, "amber-session-continue");
	});

	it("abortSession writes an ACK file for a matching web control request", async () => {
		const start = await startSession(TEST_ROOT, {
			goal: "abort with runner ack",
			route: "feature-standard",
		});
		setStatus(start.sessionId, "executing");

		const result = await abortSession(TEST_ROOT, {
			sessionId: start.sessionId,
			requestId: "abort-request-1",
		});

		assert.strictEqual(result.exitCode, 0);
		const ack = readRunnerAck(TEST_ROOT, start.sessionId, "abort-request-1");
		assert.strictEqual(ack.action, "abort");
		assert.strictEqual(ack.status, "acked");
		assert.strictEqual(ack.requestedStatus, "aborted");
		assert.strictEqual(ack.source, "amber-session-abort");
	});

	it("continueSession writes a rejected ACK when the transition is refused", async () => {
		const start = await startSession(TEST_ROOT, {
			goal: "reject completed resume",
			route: "feature-standard",
		});
		setStatus(start.sessionId, "completed");

		const result = await continueSession(TEST_ROOT, {
			sessionId: start.sessionId,
			requestId: "resume-request-rejected",
		});

		assert.notStrictEqual(result.exitCode, 0);
		const ack = readRunnerAck(TEST_ROOT, start.sessionId, "resume-request-rejected");
		assert.strictEqual(ack.status, "rejected");
		assert.strictEqual(ack.action, "resume");
		assert.match(ack.message, /already completed/i);
	});

	it("writeRunnerAck rejects request ids that escape the runner ACK directory", async () => {
		const start = await startSession(TEST_ROOT, {
			goal: "reject traversal",
			route: "feature-standard",
		});

		assert.throws(
			() => writeRunnerAck(TEST_ROOT, start.sessionId, {
				requestId: "../evil",
				action: "resume",
				status: "acked",
				requestedStatus: "executing",
			}),
			/Invalid runner ACK request id/,
		);
	});
});
