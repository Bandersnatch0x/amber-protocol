"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
	pathExists,
	readJson,
	relativeSlash,
	resolveTarget,
} = require("./fs-utils");

const {
	reviewPlan,
} = require("./planning");

const {
	slugify,
} = require("./text-utils");

function prepareTaskExecution(
	target,
	planRelativePath,
	taskIdInput,
	options = {},
) {
	const targetRoot = resolveTarget(target);
	const taskId = slugify(taskIdInput);
	const errors = [];
	const warnings = [];

	if (!taskIdInput) {
		errors.push("task prepare requires --task <task-id>.");
		return { target: targetRoot, task: null, errors, warnings };
	}

	const review = reviewPlan(targetRoot, planRelativePath);
	if (review.errors.length > 0) {
		return {
			target: targetRoot,
			task: taskId,
			plan: planRelativePath,
			errors: review.errors,
			warnings: review.warnings,
			review,
		};
	}

	const worktreeRelativePath = path.join(".harness", "worktrees", taskId);
	const executionRelativePath = path.join(".harness", "executions", taskId);
	const worktreePath = path.join(targetRoot, worktreeRelativePath);
	const executionPath = path.join(targetRoot, executionRelativePath);
	fs.mkdirSync(worktreePath, { recursive: true });
	fs.mkdirSync(executionPath, { recursive: true });

	const ledger = {
		taskId,
		plan: planRelativePath,
		status: "prepared",
		worktree: {
			type: "directory-worktree",
			path: worktreeRelativePath,
		},
		commands: [],
		failureAttribution: null,
		traceDerived: Boolean(options.traceInput || options.regressionAssertion),
		createdAt: new Date().toISOString(),
	};
	const evidence = {
		taskId,
		plan: planRelativePath,
		evidence: [],
		requiredForReplay: ["ledger.json", "evidence.json", "replay.md"],
		chatHistoryRequired: false,
	};

	if (options.traceInput || options.agentConfig) {
		evidence.traceReplay = {
			traceInput: options.traceInput || "",
			agentConfig: options.agentConfig || "",
			exactReplayRequired: Boolean(options.traceInput),
		};
	}

	if (options.regressionAssertion) {
		evidence.regressionProposal = {
			assertion: options.regressionAssertion,
			status: "proposed",
			modifiesTests: false,
			approvalRequired: true,
		};
	}

	const replayLines = [
		"# Replay",
		"",
		`Task: ${taskId}`,
		`Plan: ${planRelativePath}`,
		`Worktree: ${worktreeRelativePath}`,
		"",
	];

	if (evidence.traceReplay) {
		replayLines.push("## Trace Replay", "");
		replayLines.push(`- Trace input: ${evidence.traceReplay.traceInput}`);
		replayLines.push(`- Agent config: ${evidence.traceReplay.agentConfig}`);
		replayLines.push(
			`- Exact replay required: ${evidence.traceReplay.exactReplayRequired}`,
		);
		replayLines.push("");
	}

	if (evidence.regressionProposal) {
		replayLines.push("## Regression Proposal", "");
		replayLines.push(`- Assertion: ${evidence.regressionProposal.assertion}`);
		replayLines.push(
			`- Modifies tests: ${evidence.regressionProposal.modifiesTests}`,
		);
		replayLines.push(
			`- Approval required: ${evidence.regressionProposal.approvalRequired}`,
		);
		replayLines.push("");
	}

	if (!evidence.traceReplay && !evidence.regressionProposal) {
		replayLines.push(
			"This prepared result contains no executed commands yet. Replay starts from the ledger, evidence pack, and worktree path recorded here.",
		);
		replayLines.push("");
	}

	const replay = replayLines.join("\n");

	fs.writeFileSync(
		path.join(executionPath, "ledger.json"),
		JSON.stringify(ledger, null, 2),
	);
	fs.writeFileSync(
		path.join(executionPath, "evidence.json"),
		JSON.stringify(evidence, null, 2),
	);
	fs.writeFileSync(path.join(executionPath, "replay.md"), replay);

	const result = {
		target: targetRoot,
		task: taskId,
		plan: planRelativePath,
		worktree: worktreeRelativePath,
		execution: executionRelativePath,
		errors,
		warnings,
	};

	if (evidence.traceReplay) {
		result.traceReplay = evidence.traceReplay;
	}

	if (evidence.regressionProposal) {
		result.regressionProposal = evidence.regressionProposal;
	}

	return result;
}

function inspectTaskResult(target, taskIdInput) {
	const targetRoot = resolveTarget(target);
	const taskId = slugify(taskIdInput);
	const errors = [];
	const warnings = [];

	if (!taskIdInput) {
		errors.push("result inspect requires --task <task-id>.");
		return {
			target: targetRoot,
			task: null,
			replayable: false,
			chatHistoryRequired: true,
			errors,
			warnings,
		};
	}

	const executionPath = path.join(targetRoot, ".harness", "executions", taskId);
	const ledgerPath = path.join(executionPath, "ledger.json");
	const evidencePath = path.join(executionPath, "evidence.json");
	const replayPath = path.join(executionPath, "replay.md");
	let ledger = null;
	let evidence = null;

	try {
		ledger = readJson(ledgerPath);
	} catch (error) {
		errors.push(`Cannot read execution ledger: ${error.message}`);
	}
	try {
		evidence = readJson(evidencePath);
	} catch (error) {
		errors.push(`Cannot read evidence pack: ${error.message}`);
	}
	if (!pathExists(replayPath)) {
		errors.push("Replay file is missing.");
	}

	const replayable =
		errors.length === 0 &&
		ledger &&
		evidence &&
		evidence.chatHistoryRequired === false;

	return {
		target: targetRoot,
		task: taskId,
		replayable,
		chatHistoryRequired: !replayable,
		ledger,
		evidence,
		replay: pathExists(replayPath)
			? relativeSlash(targetRoot, replayPath)
			: null,
		errors,
		warnings,
	};
}

function orchestrationPaths(targetRoot, taskId) {
	const root = path.join(targetRoot, ".harness", "orchestration", taskId);
	return {
		root,
		dispatchPath: path.join(root, "dispatch.json"),
		reviewerEvidencePath: path.join(root, "reviewer-evidence.json"),
	};
}

module.exports = {
	prepareTaskExecution,
	inspectTaskResult,
	orchestrationPaths,
};
