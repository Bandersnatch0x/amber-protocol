"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function tempDir(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `regression-proposals-${name}-`));
}

function runAmber(args) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd: ROOT,
		encoding: "utf8",
	});
}

test("amber maintenance regression-proposals - extracts proposed regression", () => {
	const target = tempDir("proposed");
	const executionsDir = path.join(target, ".amber", "executions", "task-1");
	fs.mkdirSync(executionsDir, { recursive: true });
	fs.writeFileSync(
		path.join(executionsDir, "evidence.json"),
		JSON.stringify({
			taskId: "task-1",
			plan: "docs/plans/F001.md",
			regressionProposal: {
				status: "proposed",
				assertion: "user authentication succeeds",
			},
			traceReplay: {
				traceInput: "login flow",
				agentConfig: "worker-a",
			},
		}),
	);

	const result = runAmber(["maintenance", "regression-proposals", "--target", target, "--json"]);

	assert.strictEqual(result.status, 0);
	const json = JSON.parse(result.stdout);
	assert.strictEqual(json.proposals.length, 1);
	assert.strictEqual(json.proposals[0].taskId, "task-1");
	assert.strictEqual(json.proposals[0].assertion, "user authentication succeeds");

	fs.rmSync(target, { recursive: true, force: true });
});

test("amber maintenance regression-proposals - empty list without proposals", () => {
	const target = tempDir("no-proposals");
	const executionsDir = path.join(target, ".amber", "executions", "task-2");
	fs.mkdirSync(executionsDir, { recursive: true });
	fs.writeFileSync(
		path.join(executionsDir, "evidence.json"),
		JSON.stringify({
			taskId: "task-2",
			plan: "docs/plans/F002.md",
		}),
	);

	const result = runAmber(["maintenance", "regression-proposals", "--target", target, "--json"]);

	assert.strictEqual(result.status, 0);
	const json = JSON.parse(result.stdout);
	assert.strictEqual(json.proposals.length, 0);

	fs.rmSync(target, { recursive: true, force: true });
});
