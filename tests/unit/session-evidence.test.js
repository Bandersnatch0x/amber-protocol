"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	listExecutionEvidence,
	loadSessionEvidence,
} = require("../../scripts/lib/session-evidence");

function writeJson(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

test("Session evidence associates timeline and executions through the Execution Ledger", (t) => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-session-evidence-"));
	t.after(() => fs.rmSync(target, { recursive: true, force: true }));

	const sessionDir = path.join(target, ".amber", "sessions", "session-current");
	writeJson(path.join(sessionDir, "manifest.json"), {
		sessionId: "session-current",
		createdAt: "2026-08-08T00:00:00.000Z",
	});
	fs.writeFileSync(
		path.join(sessionDir, "timeline.jsonl"),
		JSON.stringify({ type: "stage_started", timestamp: "2026-08-08T00:00:01.000Z" }) + "\n",
		"utf8",
	);

	for (const [taskId, sessionId] of [
		["task-current", "session-current"],
		["task-old", "session-old"],
	]) {
		const executionDir = path.join(target, ".amber", "executions", taskId);
		writeJson(path.join(executionDir, "ledger.json"), {
			taskId,
			sessionId,
			commands: ["npm test"],
		});
		writeJson(path.join(executionDir, "evidence.json"), {
			taskId,
			sessionId,
			diff: { filesChanged: taskId === "task-current" ? 1 : 0 },
		});
	}

	const evidence = loadSessionEvidence(target, "session-current");
	assert.equal(evidence.timelineEvents.length, 1);
	assert.deepEqual(
		evidence.executions.map(({ taskId }) => taskId),
		["task-current"],
	);
	assert.deepEqual(evidence.executions[0].commands, ["npm test"]);
	assert.deepEqual(
		evidence.resultEvidence.map(({ taskId }) => taskId),
		["task-current"],
	);
});

test("Execution evidence preserves legacy evidence.json commands", (t) => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-execution-evidence-"));
	t.after(() => fs.rmSync(target, { recursive: true, force: true }));
	writeJson(path.join(target, ".amber", "executions", "legacy-task", "evidence.json"), {
		taskId: "legacy-task",
		commands: ["npm test"],
	});

	const executions = listExecutionEvidence(target);
	assert.equal(executions.length, 1);
	assert.deepEqual(executions[0].commands, ["npm test"]);
});

test("Execution evidence rejects malformed artifacts", (t) => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-execution-invalid-"));
	t.after(() => fs.rmSync(target, { recursive: true, force: true }));
	const ledgerPath = path.join(target, ".amber", "executions", "task-invalid", "ledger.json");
	fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
	fs.writeFileSync(ledgerPath, "{not-json\n", "utf8");

	assert.throws(() => listExecutionEvidence(target), /invalid Execution Ledger.*ledger\.json/i);
});

test("Execution evidence rejects JSON null ledger bodies as invalid", (t) => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-execution-null-"));
	t.after(() => fs.rmSync(target, { recursive: true, force: true }));
	const ledgerPath = path.join(target, ".amber", "executions", "task-null", "ledger.json");
	fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
	fs.writeFileSync(ledgerPath, "null\n", "utf8");

	assert.throws(
		() => listExecutionEvidence(target),
		/invalid Execution Ledger.*ledger\.json.*expected a JSON object/i,
	);
});

test("Execution evidence rejects conflicting Ledger and Task Evidence coordinates", (t) => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-execution-conflict-"));
	t.after(() => fs.rmSync(target, { recursive: true, force: true }));
	const executionDir = path.join(target, ".amber", "executions", "task-conflict");
	writeJson(path.join(executionDir, "ledger.json"), {
		taskId: "task-ledger",
		sessionId: "session-old",
	});
	writeJson(path.join(executionDir, "evidence.json"), {
		taskId: "task-evidence",
		sessionId: "session-current",
	});

	assert.throws(() => listExecutionEvidence(target), /coordinate mismatch.*(?:taskId|sessionId)/i);
});
