"use strict";

// Regression coverage for the read/modify/write seams that are exercised by
// separate Amber processes. These tests intentionally use child processes so
// an in-process mutex cannot make a broken filesystem protocol look safe.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function tempTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-${label}-`));
}

function runChildren(script, args) {
	return Promise.all(
		args.map(
			(arg) =>
				new Promise((resolve, reject) => {
					const child = spawn(process.execPath, ["-e", script, JSON.stringify(arg)], {
						stdio: ["ignore", "pipe", "pipe"],
					});
					let stdout = "";
					let stderr = "";
					child.stdout.on("data", (chunk) => (stdout += chunk));
					child.stderr.on("data", (chunk) => (stderr += chunk));
					child.on("error", reject);
					child.on("close", (code) => resolve({ code, stdout, stderr }));
				}),
		),
	);
}

test("concurrent attempts preserve every record and the run summary", async () => {
	const target = tempTarget("attempt-race");
	const runId = "run-race";
	const runDir = path.join(target, ".amber", "harness", "runs");
	fs.mkdirSync(runDir, { recursive: true });
	fs.writeFileSync(
		path.join(runDir, `${runId}.json`),
		JSON.stringify({
			apiVersion: "amber.dev/v1",
			kind: "HarnessRun",
			id: runId,
			subject: { agent: "race-test" },
			harness: { contract: "contract", contractSnapshotHash: `sha256:${"0".repeat(64)}` },
			state: "created",
			stateHistory: [{ from: null, to: "created", at: "2026-01-01T00:00:00.000Z" }],
		}) + "\n",
	);

	const modulePath = require.resolve("../../scripts/lib/harness/attempt-core");
	const script = `
const { recordAttempt } = require(${JSON.stringify(modulePath)});
const input = JSON.parse(process.argv[1]);
try {
  let result;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      result = recordAttempt(input.target, { runId: input.runId, attemptId: input.attemptId, commandId: "cmd", state: "completed", exitCode: 0 });
      break;
    } catch (error) {
      if (error.amberCode !== "AMBER_E_SESSION_LOCKED") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (!result) throw new Error("lock remained busy after bounded retries");
  process.stdout.write(JSON.stringify({ ok: true, attemptId: result.attempt.attemptId }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, code: error.amberCode, message: error.message }));
  process.exitCode = 1;
}`;
	const children = await runChildren(
		script,
		Array.from({ length: 12 }, (_, index) => ({ target, runId, attemptId: `attempt-${index}` })),
	);
	assert.ok(
		children.every((child) => child.code === 0),
		JSON.stringify(children),
	);
	const { listAttempts } = require("../../scripts/lib/harness/attempt-core");
	const attempts = listAttempts(target, { runId });
	assert.equal(attempts.length, 12);
	assert.equal(new Set(attempts.map((attempt) => attempt.attemptId)).size, 12);
	const run = JSON.parse(fs.readFileSync(path.join(runDir, `${runId}.json`), "utf8"));
	assert.deepEqual(run.attempts, {
		count: 12,
		lastAttemptId: "attempt-9",
		lastAttemptState: "completed",
	});
	fs.rmSync(target, { recursive: true, force: true });
});

test("concurrent execution-handle fence allocation is strictly monotonic", async () => {
	const target = tempTarget("fence-race");
	const modulePath = require.resolve("../../scripts/lib/core/execution-handles");
	const script = `
const { persistExecutionHandle, clearExecutionHandle } = require(${JSON.stringify(modulePath)});
const input = JSON.parse(process.argv[1]);
try {
  let handle;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      handle = persistExecutionHandle({ targetRoot: input.target, runId: input.runId, workspace: input.target, pid: process.pid, startedAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 60000).toISOString() });
      break;
    } catch (error) {
      if (error.amberCode !== "AMBER_E_SESSION_LOCKED") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (!handle) throw new Error("lock remained busy after bounded retries");
  process.stdout.write(JSON.stringify({ ok: true, fence: handle.fence }));
  clearExecutionHandle(handle);
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, code: error.amberCode, message: error.message }));
  process.exitCode = 1;
}`;
	const children = await runChildren(
		script,
		Array.from({ length: 12 }, (_, index) => ({ target, runId: `run-${index}` })),
	);
	assert.ok(
		children.every((child) => child.code === 0),
		JSON.stringify(children),
	);
	const fences = children.map((child) => JSON.parse(child.stdout).fence).sort((a, b) => a - b);
	assert.deepEqual(
		fences,
		Array.from({ length: 12 }, (_, index) => index + 1),
	);
	const fence = JSON.parse(
		fs.readFileSync(path.join(target, ".amber", "harness", "executions", "fence.json"), "utf8"),
	);
	assert.equal(fence.fence, 12);
	fs.rmSync(target, { recursive: true, force: true });
});
