"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exportGovernanceEvidence } = require("../scripts/lib/governance-commands");

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
			{ type: "command", command: "npm install express" },
			{ type: "command", command: "npm test" },
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
		assert.ok(content.includes(`# Session ${sessionId}`));
		assert.ok(content.includes("Implement user authentication"));
		assert.ok(content.includes("npm install express"));
		assert.ok(content.includes("npm test"));
	});

	it("execution export → markdown contains plan + worktree", () => {
		const taskId = "test-task-001";
		const taskDir = path.join(tmpDir, ".amber", "tasks", taskId);
		fs.mkdirSync(taskDir, { recursive: true });

		const plan = "# Task Plan\n\n## Steps\n1. Create schema\n2. Add tests";
		fs.writeFileSync(path.join(taskDir, "plan.md"), plan);

		const worktree = {
			path: "/path/to/worktree",
			branch: "task/test-task-001",
		};
		fs.writeFileSync(
			path.join(taskDir, "worktree.json"),
			JSON.stringify(worktree, null, 2),
		);

		const outputPath = path.join(tmpDir, "task-evidence.md");
		const result = exportGovernanceEvidence(tmpDir, {
			task: taskId,
			output: outputPath,
		});

		assert.strictEqual(result.errors.length, 0);
		assert.ok(result.outputPath || result.output);

		const content = fs.readFileSync(outputPath, "utf8");
		assert.ok(content.includes(`# Task ${taskId}`));
		assert.ok(content.includes("# Task Plan"));
		assert.ok(content.includes("Create schema"));
		assert.ok(content.includes("## Worktree"));
		assert.ok(content.includes("/path/to/worktree"));
	});
});
