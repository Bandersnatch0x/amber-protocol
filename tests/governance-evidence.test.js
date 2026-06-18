"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
	exportGovernanceEvidence,
} = require("../scripts/lib/governance-commands");

describe("governance evidence", () => {
	let tmpDir;

	before(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "governance-evidence-"));
	});

	after(() => {
		if (tmpDir && fs.existsSync(tmpDir)) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("session export → markdown contains goal + commands", () => {
		const sessionId = "test-session-001";
		const sessionsDir = path.join(tmpDir, ".amber", "sessions", sessionId);
		fs.mkdirSync(sessionsDir, { recursive: true });

		const manifest = {
			sessionId,
			goal: "Implement user authentication",
			status: "active",
			createdAt: new Date().toISOString(),
		};
		fs.writeFileSync(
			path.join(sessionsDir, "manifest.json"),
			JSON.stringify(manifest, null, 2),
		);

		const timeline = [
			{
				type: "session_created",
				timestamp: new Date().toISOString(),
				data: { goal: "Implement user authentication" },
			},
			{
				type: "command_executed",
				timestamp: new Date().toISOString(),
				data: { command: "npm install express" },
			},
			{
				type: "command_executed",
				timestamp: new Date().toISOString(),
				data: { command: "npm test" },
			},
		];
		fs.writeFileSync(
			path.join(sessionsDir, "timeline.jsonl"),
			timeline.map((e) => JSON.stringify(e)).join("\n"),
		);

		const outputPath = path.join(tmpDir, "session-evidence.md");
		const result = exportGovernanceEvidence(tmpDir, {
			session: sessionId,
			output: outputPath,
		});

		assert.strictEqual(result.errors.length, 0);
		assert.ok(result.outputPath || result.output);

		const content = fs.readFileSync(outputPath, "utf8");
		assert.ok(content.includes("# Session Evidence"));
		assert.ok(content.includes(sessionId));
		assert.ok(content.includes("Implement user authentication"));
		assert.ok(content.includes("npm install express"));
		assert.ok(content.includes("npm test"));
	});

	it("execution export → markdown contains plan + worktree", () => {
		const taskId = "test-task-001";
		const taskDir = path.join(tmpDir, ".amber", "executions", taskId);
		fs.mkdirSync(taskDir, { recursive: true });

		const ledger = {
			plan: "# Task Plan\n\n## Steps\n1. Create schema\n2. Add tests",
			status: "completed",
			worktree: "/path/to/worktree",
		};
		fs.writeFileSync(
			path.join(taskDir, "ledger.json"),
			JSON.stringify(ledger, null, 2),
		);

		const evidence = {
			commands: ["npm install", "npm test"],
		};
		fs.writeFileSync(
			path.join(taskDir, "evidence.json"),
			JSON.stringify(evidence, null, 2),
		);

		const outputPath = path.join(tmpDir, "task-evidence.md");
		const result = exportGovernanceEvidence(tmpDir, {
			task: taskId,
			output: outputPath,
		});

		assert.strictEqual(result.errors.length, 0);
		assert.ok(result.outputPath || result.output);

		const content = fs.readFileSync(outputPath, "utf8");
		assert.ok(content.includes("# Execution Evidence"));
		assert.ok(content.includes(taskId));
		assert.ok(content.includes("Create schema"));
		assert.ok(content.includes("Worktree"));
		assert.ok(content.includes("/path/to/worktree"));
	});

	it("session export → empty timeline produces minimal output", () => {
		const sessionId = "test-session-empty";
		const sessionsDir = path.join(tmpDir, ".amber", "sessions", sessionId);
		fs.mkdirSync(sessionsDir, { recursive: true });

		fs.writeFileSync(
			path.join(sessionsDir, "manifest.json"),
			JSON.stringify(
				{
					sessionId,
					goal: "Empty test",
					status: "active",
					createdAt: new Date().toISOString(),
				},
				null,
				2,
			),
		);

		// Empty timeline (0 events)
		fs.writeFileSync(path.join(sessionsDir, "timeline.jsonl"), "");

		const outputPath = path.join(tmpDir, "session-empty.md");
		const result = exportGovernanceEvidence(tmpDir, {
			session: sessionId,
			output: outputPath,
		});

		assert.strictEqual(result.errors.length, 0);
		const content = fs.readFileSync(outputPath, "utf8");
		assert.ok(content.includes("# Session Evidence"));
		assert.ok(content.includes(sessionId));
		// No goal or commands since no session_created event
		assert.ok(!content.includes("Goal:"));
	});

	it("execution export → missing ledger produces markdown with just task id", () => {
		const taskId = "test-task-no-ledger";
		const taskDir = path.join(tmpDir, ".amber", "executions", taskId);
		fs.mkdirSync(taskDir, { recursive: true });

		// Only evidence.json, no ledger.json
		fs.writeFileSync(
			path.join(taskDir, "evidence.json"),
			JSON.stringify({ commands: ["npm install"] }, null, 2),
		);

		const outputPath = path.join(tmpDir, "task-no-ledger.md");
		const result = exportGovernanceEvidence(tmpDir, {
			task: taskId,
			output: outputPath,
		});

		assert.strictEqual(result.errors.length, 0);
		const content = fs.readFileSync(outputPath, "utf8");
		assert.ok(content.includes("# Execution Evidence"));
		assert.ok(content.includes(taskId));
		// Commands from evidence.json still appear
		assert.ok(content.includes("npm install"));
	});

	it("execution export → missing evidence produces markdown without commands section", () => {
		const taskId = "test-task-no-evidence";
		const taskDir = path.join(tmpDir, ".amber", "executions", taskId);
		fs.mkdirSync(taskDir, { recursive: true });

		// Only ledger.json, no evidence.json
		fs.writeFileSync(
			path.join(taskDir, "ledger.json"),
			JSON.stringify(
				{ plan: "# Simple Plan", status: "completed", worktree: "/tmp/wt" },
				null,
				2,
			),
		);

		const outputPath = path.join(tmpDir, "task-no-evidence.md");
		const result = exportGovernanceEvidence(tmpDir, {
			task: taskId,
			output: outputPath,
		});

		assert.strictEqual(result.errors.length, 0);
		const content = fs.readFileSync(outputPath, "utf8");
		assert.ok(content.includes("# Execution Evidence"));
		assert.ok(content.includes("# Simple Plan"));
		assert.ok(content.includes("/tmp/wt"));
		// No commands section
		assert.ok(!content.includes("## Commands"));
	});

	it("execution export → malformed ledger is recorded, valid evidence still exported", () => {
		const taskId = "test-task-corrupt-ledger";
		const taskDir = path.join(tmpDir, ".amber", "executions", taskId);
		fs.mkdirSync(taskDir, { recursive: true });

		// Corrupt ledger.json (not valid JSON), valid evidence.json.
		fs.writeFileSync(path.join(taskDir, "ledger.json"), "{ not: valid json ");
		fs.writeFileSync(
			path.join(taskDir, "evidence.json"),
			JSON.stringify({ commands: ["npm run build"] }, null, 2),
		);

		const outputPath = path.join(tmpDir, "task-corrupt-ledger.md");
		const result = exportGovernanceEvidence(tmpDir, {
			task: taskId,
			output: outputPath,
		});

		assert.strictEqual(result.errors.length, 0);
		const content = fs.readFileSync(outputPath, "utf8");
		assert.ok(content.includes("# Execution Evidence"));
		assert.ok(content.includes(taskId));
		// Corruption is recorded in the audit artifact, not silently dropped.
		assert.ok(/ledger\.json could not be parsed/i.test(content));
		// Evidence from the still-valid file is preserved.
		assert.ok(content.includes("npm run build"));
	});
});
