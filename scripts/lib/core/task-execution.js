"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveStateDirForRead, resolveStateDirForCreate } = require("../state-dir-resolver");
const { TRANSITIONS, isFinal } = require("../session-state-machine");

const { pathExists, readJson, relativeSlash, resolveTarget } = require("./fs-utils");

const { reviewPlan } = require("./planning");

const { slugify } = require("./text-utils");

const { MESSAGES, cannotReadTaskEvidence } = require("./terminology");

// Pure renderer for replay.md: builds the replay document from the task
// coordinates and the assembled evidence object. Extracted from
// prepareTaskExecution so the markdown shape is testable on its own.
function buildReplayContent(taskId, planRelativePath, worktreeRelativePath, evidence) {
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
		replayLines.push(`- Exact replay required: ${evidence.traceReplay.exactReplayRequired}`);
		replayLines.push("");
	}

	if (evidence.regressionProposal) {
		replayLines.push("## Regression Proposal", "");
		replayLines.push(`- Assertion: ${evidence.regressionProposal.assertion}`);
		replayLines.push(`- Modifies tests: ${evidence.regressionProposal.modifiesTests}`);
		replayLines.push(`- Approval required: ${evidence.regressionProposal.approvalRequired}`);
		replayLines.push("");
	}

	if (!evidence.traceReplay && !evidence.regressionProposal) {
		replayLines.push(MESSAGES.replayNoCommandsYet);
		replayLines.push("");
	}

	return replayLines.join("\n");
}

const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function explicitExecutionSession(options) {
	const keys = ["session", "sessionId"].filter((key) => Object.hasOwn(options, key));
	if (keys.length === 0) return { provided: false };
	const values = [];
	for (const key of keys) {
		const value = options[key];
		if (typeof value !== "string" || !value.trim()) {
			return { error: `task prepare requires a non-empty Session ID in --${key}.` };
		}
		const sessionId = value.trim();
		if (!SESSION_ID_RE.test(sessionId)) {
			return { error: `Invalid Session ID for task prepare: ${sessionId}` };
		}
		values.push(sessionId);
	}
	if (new Set(values).size > 1) {
		return { error: "task prepare received conflicting session and sessionId values." };
	}
	return { provided: true, sessionId: values[0] };
}

function resolveExecutionSession(targetRoot, options) {
	const { findMostRecentSession, loadSessionManifest } = require("../session-commands");
	const explicit = explicitExecutionSession(options);
	if (explicit.error) return explicit;
	const sessionId = explicit.provided
		? explicit.sessionId
		: findMostRecentSession(targetRoot, { excludeCompleted: true });
	if (!sessionId) {
		return {
			error: "task prepare requires an active non-terminal Session in the target repository.",
		};
	}
	if (!SESSION_ID_RE.test(sessionId)) {
		return { error: `Invalid Session ID for task prepare: ${sessionId}` };
	}
	const loaded = loadSessionManifest(targetRoot, sessionId);
	if (!loaded) return { error: `Session not found in target repository: ${sessionId}` };
	if (loaded.corrupt) return { error: `Session manifest is corrupt: ${sessionId}` };
	const manifest = loaded.manifest;
	if (manifest.sessionId !== sessionId) {
		return { error: `Session manifest ID mismatch for task prepare: ${sessionId}` };
	}
	if (!Object.hasOwn(TRANSITIONS, manifest.status)) {
		return { error: `Session ${sessionId} has invalid status: ${manifest.status}` };
	}
	if (isFinal(manifest.status)) {
		return {
			error: `Session ${sessionId} is terminal (${manifest.status}); task prepare requires a non-terminal Session.`,
		};
	}
	return { sessionId };
}

function buildExecutionLedger(coordinates, worktreeRelativePath, options) {
	const { taskId, sessionId, planRelativePath } = coordinates;
	return {
		taskId,
		sessionId,
		plan: planRelativePath,
		status: "prepared",
		worktree: { type: "directory-worktree", path: worktreeRelativePath },
		commands: [],
		failureAttribution: null,
		traceDerived: Boolean(options.traceInput || options.regressionAssertion),
		createdAt: new Date().toISOString(),
	};
}

function buildExecutionEvidence(coordinates, options) {
	const { taskId, sessionId, planRelativePath } = coordinates;
	const evidence = {
		taskId,
		sessionId,
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
	return evidence;
}

function persistExecutionArtifacts(coordinates, artifacts) {
	const { targetRoot, taskId } = coordinates;
	const worktreeRelativePath = path.join(".amber", "worktrees", taskId);
	const executionRelativePath = path.join(".amber", "executions", taskId);
	const worktreePath = path.join(targetRoot, worktreeRelativePath);
	const executionPath = path.join(targetRoot, executionRelativePath);
	fs.mkdirSync(worktreePath, { recursive: true });
	fs.mkdirSync(executionPath, { recursive: true });
	fs.writeFileSync(
		path.join(executionPath, "ledger.json"),
		JSON.stringify(artifacts.ledger, null, 2),
	);
	fs.writeFileSync(
		path.join(executionPath, "evidence.json"),
		JSON.stringify(artifacts.evidence, null, 2),
	);
	fs.writeFileSync(path.join(executionPath, "replay.md"), artifacts.replay);
	return { worktreeRelativePath, executionRelativePath };
}

function buildPreparationResult(coordinates, paths, evidence) {
	const { targetRoot, taskId, planRelativePath } = coordinates;
	const result = {
		target: targetRoot,
		task: taskId,
		plan: planRelativePath,
		worktree: paths.worktreeRelativePath,
		execution: paths.executionRelativePath,
		errors: [],
		warnings: [],
	};
	if (evidence.traceReplay) result.traceReplay = evidence.traceReplay;
	if (evidence.regressionProposal) result.regressionProposal = evidence.regressionProposal;
	return result;
}

function preparationFailure(coordinates, errors, warnings, review) {
	return {
		target: coordinates.targetRoot,
		task: coordinates.taskId,
		plan: coordinates.planRelativePath,
		errors,
		warnings,
		review,
	};
}

function prepareTaskExecution(target, planRelativePath, taskIdInput, options = {}) {
	const targetRoot = resolveTarget(target);
	const taskId = slugify(taskIdInput);
	const coordinates = { targetRoot, taskId, planRelativePath };
	if (!taskIdInput) {
		return {
			target: targetRoot,
			task: null,
			errors: ["task prepare requires --task <task-id>."],
			warnings: [],
		};
	}
	const review = reviewPlan(targetRoot, planRelativePath);
	if (review.errors.length > 0) {
		return preparationFailure(coordinates, review.errors, review.warnings, review);
	}
	const session = resolveExecutionSession(targetRoot, options);
	if (session.error) {
		return preparationFailure(coordinates, [session.error], [], review);
	}
	const boundCoordinates = { ...coordinates, sessionId: session.sessionId };
	const worktreeRelativePath = path.join(".amber", "worktrees", taskId);
	const evidence = buildExecutionEvidence(boundCoordinates, options);
	const artifacts = {
		evidence,
		ledger: buildExecutionLedger(boundCoordinates, worktreeRelativePath, options),
		replay: buildReplayContent(taskId, planRelativePath, worktreeRelativePath, evidence),
	};
	const paths = persistExecutionArtifacts(boundCoordinates, artifacts);
	return buildPreparationResult(boundCoordinates, paths, evidence);
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

	const executionPath = path.join(resolveStateDirForRead(targetRoot), "executions", taskId);
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
		errors.push(cannotReadTaskEvidence(error.message));
	}
	if (!pathExists(replayPath)) {
		errors.push("Replay file is missing.");
	}

	const replayable =
		errors.length === 0 && ledger && evidence && evidence.chatHistoryRequired === false;

	return {
		target: targetRoot,
		task: taskId,
		replayable,
		chatHistoryRequired: !replayable,
		ledger,
		evidence,
		replay: pathExists(replayPath) ? relativeSlash(targetRoot, replayPath) : null,
		errors,
		warnings,
	};
}

function orchestrationPaths(targetRoot, taskId, options = {}) {
	// Dispatch creates a new orchestration record (canonical .amber);
	// status/review operate on the record wherever it already lives.
	const stateDir = options.forCreate
		? resolveStateDirForCreate(targetRoot)
		: resolveStateDirForRead(targetRoot);
	const root = path.join(stateDir, "orchestration", taskId);
	return {
		root,
		dispatchPath: path.join(root, "dispatch.json"),
		reviewerEvidencePath: path.join(root, "reviewer-evidence.json"),
	};
}

module.exports = {
	buildReplayContent,
	prepareTaskExecution,
	inspectTaskResult,
	orchestrationPaths,
};
