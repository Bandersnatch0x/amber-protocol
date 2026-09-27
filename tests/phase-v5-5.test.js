"use strict";

// Maintenance proposal surface (survived the agent/team/adoption removal —
// issues/0068). The team-distribution scaffolding that used to set this fixture
// up is gone, so the target is a plain `amber init` tree.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function tempDir(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-v5-5-${name}-`));
}

function runHarness(args) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd: ROOT,
		encoding: "utf8",
	});
}

function initializedTarget(name) {
	const target = tempDir(name);
	assert.equal(runHarness(["init", "--target", target]).status, 0);
	return target;
}

test("maintenance propose writes reviewable gardening proposal without changing source docs", () => {
	const target = initializedTarget("propose");
	const evolutionPath = path.join(target, "docs", "wiki", "engineering", "harness-evolution.md");
	fs.mkdirSync(path.dirname(evolutionPath), { recursive: true });
	fs.writeFileSync(
		evolutionPath,
		[
			"# Harness Evolution",
			"",
			"- Finding: Missing rollback evidence",
			"- Finding: Missing rollback evidence",
			"- Finding: Unclear reviewer gate",
			"",
		].join("\n"),
	);
	const overviewPath = path.join(target, "docs", "wiki", "product", "overview.md");
	const beforeOverview = fs.readFileSync(overviewPath, "utf8");

	// Add trace-derived evidence
	const executionPath = path.join(target, ".amber", "executions", "trace-failure");
	fs.mkdirSync(executionPath, { recursive: true });
	fs.writeFileSync(
		path.join(executionPath, "evidence.json"),
		JSON.stringify(
			{
				taskId: "trace-failure",
				plan: "docs/plans/F001-trace-failure.md",
				evidence: [],
				requiredForReplay: ["ledger.json", "evidence.json", "replay.md"],
				chatHistoryRequired: false,
				traceReplay: {
					traceInput: "fixtures/traces/failing-input.json",
					agentConfig: "crm-agent-v2",
					exactReplayRequired: true,
				},
				regressionProposal: {
					assertion: "The response must include specific deal details, not just a count",
					status: "proposed",
					modifiesTests: false,
					approvalRequired: true,
				},
			},
			null,
			2,
		),
	);

	const inspect = runHarness(["maintenance", "inspect", "--target", target, "--json"]);
	assert.equal(inspect.status, 0, inspect.stderr);
	const inspectPayload = JSON.parse(inspect.stdout);
	assert.ok(
		inspectPayload.regressionProposals.some((proposal) => proposal.taskId === "trace-failure"),
	);

	const result = runHarness(["maintenance", "propose", "--target", target, "--json"]);

	assert.equal(result.status, 0, result.stderr);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.reviewable, true);
	assert.equal(payload.sourceFilesChanged, false);
	const proposalPath = path.join(target, payload.proposalPath);
	assert.equal(fs.existsSync(proposalPath), true);
	const proposal = fs.readFileSync(proposalPath, "utf8");
	assert.match(proposal, /Missing rollback evidence/);
	assert.match(proposal, /Suggested Standards Diff/);
	assert.match(proposal, /Regression Proposals/);
	assert.match(proposal, /trace-failure/);
	assert.match(proposal, /The response must include specific deal details/);
	assert.equal(fs.readFileSync(overviewPath, "utf8"), beforeOverview);
	assert.equal(fs.existsSync(path.join(target, "tests", "trace-failure.test.js")), false);
});
