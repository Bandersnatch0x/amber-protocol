"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { summarizeSessions, summarizeExecutions } = require("../../scripts/lib/core/governance");

function tempDir(prefix) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function writeSession(sessionsDir, id, events) {
	const dir = path.join(sessionsDir, id);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "timeline.jsonl"),
		events.map((event) => JSON.stringify(event)).join("\n"),
	);
}

function writeExecution(executionsDir, id, ledger, evidence) {
	const dir = path.join(executionsDir, id);
	fs.mkdirSync(dir, { recursive: true });
	if (ledger !== undefined) {
		fs.writeFileSync(path.join(dir, "ledger.json"), JSON.stringify(ledger));
	}
	if (evidence !== undefined) {
		fs.writeFileSync(path.join(dir, "evidence.json"), JSON.stringify(evidence));
	}
}

test("summarizeSessions returns [] for a missing directory", () => {
	assert.deepEqual(summarizeSessions(path.join(tempDir("gov"), "none")), []);
});

test("summarizeSessions summarizes goal, counts, and completed status", () => {
	const sessionsDir = tempDir("gov-sessions");
	writeSession(sessionsDir, "s1", [
		{ type: "session_created", timestamp: "2025-01-01T10:00:00Z", data: { goal: "Add feature A" } },
		{ type: "command_executed", timestamp: "2025-01-01T10:05:00Z", data: { command: "npm test" } },
		{ type: "gate_triggered", timestamp: "2025-01-01T10:10:00Z", data: { gate: "user-approval" } },
		{ type: "session_completed", timestamp: "2025-01-01T10:15:00Z", data: {} },
	]);

	const [session] = summarizeSessions(sessionsDir);
	assert.equal(session.id, "s1");
	assert.equal(session.goal, "Add feature A");
	assert.equal(session.commands, 1);
	assert.equal(session.approvals, 1);
	assert.equal(session.status, "completed");
});

// Live session verify --execute writes stage_completed with data.command, not
// the phantom command_executed type. Audit must count those or every real
// dogfood session reports commands=0.
test("summarizeSessions counts stage_completed verification commands", () => {
	const sessionsDir = tempDir("gov-live-verify");
	writeSession(sessionsDir, "dogfood", [
		{
			type: "session_created",
			timestamp: "2026-07-14T16:00:00Z",
			data: { goal: "fix governance" },
		},
		{
			type: "stage_completed",
			timestamp: "2026-07-14T16:02:00Z",
			data: {
				stage: "verify",
				command: "npm test",
				result: "passed",
				executed: true,
				exitCode: 0,
				durationMs: 83527,
			},
		},
		{
			type: "gate_passed",
			timestamp: "2026-07-14T16:03:00Z",
			data: { gateId: "user-approval-plan" },
		},
		{
			type: "gate_passed",
			timestamp: "2026-07-14T16:04:00Z",
			data: { gateId: "user-approval-implement" },
		},
		{ type: "session_completed", timestamp: "2026-07-14T16:05:00Z", data: {} },
	]);

	const [session] = summarizeSessions(sessionsDir);
	assert.equal(session.commands, 1);
	assert.equal(session.approvals, 2);
	assert.equal(session.status, "completed");
});

test("summarizeSessions counts verification_failed as a command observation", () => {
	const sessionsDir = tempDir("gov-verify-fail");
	writeSession(sessionsDir, "s1", [
		{ type: "session_created", timestamp: "2026-07-14T16:00:00Z", data: { goal: "fail path" } },
		{
			type: "verification_failed",
			timestamp: "2026-07-14T16:01:00Z",
			data: { stage: "verify", command: "npm test", exitCode: 1 },
		},
	]);
	assert.equal(summarizeSessions(sessionsDir)[0].commands, 1);
});

test("summarizeSessions reports running when there is no end event", () => {
	const sessionsDir = tempDir("gov-running");
	writeSession(sessionsDir, "s1", [
		{ type: "session_created", timestamp: "2025-01-01T10:00:00Z", data: { goal: "wip" } },
	]);
	assert.equal(summarizeSessions(sessionsDir)[0].status, "running");
});

test("summarizeSessions skips directories without a timeline", () => {
	const sessionsDir = tempDir("gov-empty");
	fs.mkdirSync(path.join(sessionsDir, "no-timeline"), { recursive: true });
	assert.deepEqual(summarizeSessions(sessionsDir), []);
});

test("summarizeSessions applies the since filter to creation time", () => {
	const sessionsDir = tempDir("gov-since");
	writeSession(sessionsDir, "old", [
		{ type: "session_created", timestamp: "2024-12-01T10:00:00Z", data: { goal: "Old" } },
		{ type: "session_completed", timestamp: "2024-12-01T10:15:00Z", data: {} },
	]);
	writeSession(sessionsDir, "new", [
		{ type: "session_created", timestamp: "2025-01-15T11:00:00Z", data: { goal: "New" } },
		{ type: "session_completed", timestamp: "2025-01-15T11:20:00Z", data: {} },
	]);

	const result = summarizeSessions(sessionsDir, { since: "2025-01-01" });
	assert.deepEqual(
		result.map((session) => session.goal),
		["New"],
	);
});

test("summarizeExecutions returns [] for a missing directory", () => {
	assert.deepEqual(summarizeExecutions(path.join(tempDir("gov"), "none")), []);
});

test("summarizeExecutions reads ledger fields and evidence command count", () => {
	const executionsDir = tempDir("gov-exec");
	writeExecution(
		executionsDir,
		"e1",
		{ plan: "docs/plans/a.md", status: "completed" },
		{ commands: ["npm test", "git add ."] },
	);

	const [execution] = summarizeExecutions(executionsDir);
	assert.equal(execution.id, "e1");
	assert.equal(execution.plan, "docs/plans/a.md");
	assert.equal(execution.status, "completed");
	assert.equal(execution.commands, 2);
});

test("summarizeExecutions skips tasks without a ledger and tolerates missing evidence", () => {
	const executionsDir = tempDir("gov-exec2");
	fs.mkdirSync(path.join(executionsDir, "no-ledger"), { recursive: true });
	writeExecution(executionsDir, "e1", { plan: "p", status: "running" });

	const result = summarizeExecutions(executionsDir);
	assert.equal(result.length, 1);
	assert.equal(result[0].commands, 0);
});

test("summarizeExecutions records a corrupt ledger as corrupt instead of throwing", () => {
	const executionsDir = tempDir("gov-corrupt-ledger");
	writeExecution(executionsDir, "healthy", { plan: "p", status: "completed" });
	const corruptDir = path.join(executionsDir, "broken");
	fs.mkdirSync(corruptDir, { recursive: true });
	fs.writeFileSync(path.join(corruptDir, "ledger.json"), "{ not json");

	const result = summarizeExecutions(executionsDir);
	// Neither row is lost: the corrupt task is surfaced as an audit signal.
	assert.equal(result.length, 2);
	const broken = result.find((e) => e.id === "broken");
	assert.equal(broken.status, "corrupt");
});

test("summarizeExecutions records a JSON null ledger body as corrupt instead of throwing", () => {
	// readJsonSafe returns {value:null, error:null} for a literal `null` body
	// (parse succeeds), so the corrupt-error branch is skipped and ledger.plan
	// used to throw. A non-object ledger is just as unusable as unparseable JSON.
	const executionsDir = tempDir("gov-null-ledger");
	writeExecution(executionsDir, "healthy", { plan: "p", status: "completed" });
	const nullDir = path.join(executionsDir, "nullish");
	fs.mkdirSync(nullDir, { recursive: true });
	fs.writeFileSync(path.join(nullDir, "ledger.json"), "null");

	const result = summarizeExecutions(executionsDir);
	assert.equal(result.length, 2);
	const nullish = result.find((e) => e.id === "nullish");
	assert.equal(nullish.status, "corrupt");
});

test("summarizeExecutions tolerates a corrupt evidence file with commands=0", () => {
	const executionsDir = tempDir("gov-corrupt-evidence");
	writeExecution(executionsDir, "e1", { plan: "p", status: "running" });
	fs.writeFileSync(path.join(executionsDir, "e1", "evidence.json"), "{ broken");

	const [execution] = summarizeExecutions(executionsDir);
	assert.equal(execution.status, "running");
	assert.equal(execution.commands, 0);
});
