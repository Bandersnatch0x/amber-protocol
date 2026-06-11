const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { run } = require("../scripts/amber");

test("governance audit - project with 2 sessions and 1 execution generates full report", async () => {
	const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "amber-test-"));
	const amberDir = path.join(tmpDir, ".amber");
	const sessionsDir = path.join(amberDir, "sessions");
	const executionsDir = path.join(amberDir, "executions");

	fs.mkdirSync(sessionsDir, { recursive: true });
	fs.mkdirSync(executionsDir, { recursive: true });

	// Policy file
	fs.writeFileSync(
		path.join(amberDir, "autonomous-policy.json"),
		JSON.stringify({
			gates: { auto: "approve", "user-approval": "block", "step-confirm": "block" },
			retry: { maxAttempts: 3, backoffMs: [1000, 5000, 15000], retryableStages: ["implement", "verify"] },
			budget: { onExceed: "pause" },
			notifications: { email: { enabled: false }, slack: { enabled: false } },
		})
	);

	// Session 1
	const session1Id = "session-001";
	const session1Dir = path.join(sessionsDir, session1Id);
	fs.mkdirSync(session1Dir, { recursive: true });
	const timeline1 = [
		{ type: "session_created", timestamp: "2025-01-01T10:00:00Z", data: { goal: "Add feature A" } },
		{ type: "command_executed", timestamp: "2025-01-01T10:05:00Z", data: { command: "npm test" } },
		{ type: "gate_triggered", timestamp: "2025-01-01T10:10:00Z", data: { gate: "user-approval" } },
		{ type: "session_completed", timestamp: "2025-01-01T10:15:00Z", data: {} },
	];
	fs.writeFileSync(path.join(session1Dir, "timeline.jsonl"), timeline1.map(e => JSON.stringify(e)).join("\n"));

	// Session 2
	const session2Id = "session-002";
	const session2Dir = path.join(sessionsDir, session2Id);
	fs.mkdirSync(session2Dir, { recursive: true });
	const timeline2 = [
		{ type: "session_created", timestamp: "2025-01-02T11:00:00Z", data: { goal: "Fix bug B" } },
		{ type: "command_executed", timestamp: "2025-01-02T11:05:00Z", data: { command: "npm run build" } },
		{ type: "command_executed", timestamp: "2025-01-02T11:10:00Z", data: { command: "git commit" } },
		{ type: "session_completed", timestamp: "2025-01-02T11:20:00Z", data: {} },
	];
	fs.writeFileSync(path.join(session2Dir, "timeline.jsonl"), timeline2.map(e => JSON.stringify(e)).join("\n"));

	// Execution 1
	const exec1Id = "exec-001";
	const exec1Dir = path.join(executionsDir, exec1Id);
	fs.mkdirSync(exec1Dir, { recursive: true });
	fs.writeFileSync(
		path.join(exec1Dir, "ledger.json"),
		JSON.stringify({ plan: "docs/plans/feature-a.md", status: "completed" })
	);
	fs.writeFileSync(
		path.join(exec1Dir, "evidence.json"),
		JSON.stringify({ commands: ["npm test", "git add ."] })
	);

	const outputPath = path.join(tmpDir, "audit.md");

	try {
		const exitCode = await run([
			"governance",
			"audit",
			"--target",
			tmpDir,
			"--output",
			outputPath,
		]);
		assert.strictEqual(exitCode, 0);

		assert.ok(fs.existsSync(outputPath));
		const content = fs.readFileSync(outputPath, "utf8");

		assert.ok(content.includes("# Audit Report"));
		assert.ok(content.includes("## 1. Policy Snapshot"));
		assert.ok(content.includes("## 2. Session Summary"));
		assert.ok(content.includes("## 3. Execution Summary"));
		assert.ok(content.includes("## 4. Retention Compliance"));

		assert.ok(content.includes("Add feature A"));
		assert.ok(content.includes("Fix bug B"));
		assert.ok(content.includes("docs/plans/feature-a.md"));

		const sessionRows = content.match(/\| session-/g);
		assert.strictEqual(sessionRows.length, 2);

		const executionRows = content.match(/\| exec-/g);
		assert.strictEqual(executionRows.length, 1);
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("governance audit - --since filter works", async () => {
	const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "amber-test-"));
	const amberDir = path.join(tmpDir, ".amber");
	const sessionsDir = path.join(amberDir, "sessions");

	fs.mkdirSync(sessionsDir, { recursive: true });

	fs.writeFileSync(
		path.join(amberDir, "autonomous-policy.json"),
		JSON.stringify({
			gates: { auto: "approve", "user-approval": "block", "step-confirm": "block" },
			retry: { maxAttempts: 3, backoffMs: [1000, 5000, 15000], retryableStages: ["implement", "verify"] },
			budget: { onExceed: "pause" },
			notifications: { email: { enabled: false }, slack: { enabled: false } },
		})
	);

	// Old session (before cutoff)
	const session1Id = "session-old";
	const session1Dir = path.join(sessionsDir, session1Id);
	fs.mkdirSync(session1Dir, { recursive: true });
	const timeline1 = [
		{ type: "session_created", timestamp: "2024-12-01T10:00:00Z", data: { goal: "Old task" } },
		{ type: "session_completed", timestamp: "2024-12-01T10:15:00Z", data: {} },
	];
	fs.writeFileSync(path.join(session1Dir, "timeline.jsonl"), timeline1.map(e => JSON.stringify(e)).join("\n"));

	// New session (after cutoff)
	const session2Id = "session-new";
	const session2Dir = path.join(sessionsDir, session2Id);
	fs.mkdirSync(session2Dir, { recursive: true });
	const timeline2 = [
		{ type: "session_created", timestamp: "2025-01-15T11:00:00Z", data: { goal: "New task" } },
		{ type: "session_completed", timestamp: "2025-01-15T11:20:00Z", data: {} },
	];
	fs.writeFileSync(path.join(session2Dir, "timeline.jsonl"), timeline2.map(e => JSON.stringify(e)).join("\n"));

	const outputPath = path.join(tmpDir, "audit.md");

	try {
		const exitCode = await run([
			"governance",
			"audit",
			"--target",
			tmpDir,
			"--output",
			outputPath,
			"--since",
			"2025-01-01",
		]);
		assert.strictEqual(exitCode, 0);

		assert.ok(fs.existsSync(outputPath));
		const content = fs.readFileSync(outputPath, "utf8");

		assert.ok(content.includes("New task"));

		// Debug: log content if test fails
		if (content.includes("Old task")) {
			console.log("Audit content:", content);
		}

		assert.ok(!content.includes("Old task"));

		const sessionRows = content.match(/\| session-/g);
		assert.strictEqual(sessionRows.length, 1);
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
});
