"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveStateDirForRead } = require("../state-dir-resolver");

const {
	pathExists,
	readJson,
	relativeSlash,
	resolveTarget,
} = require("./fs-utils");

const {
	orchestrationPaths,
} = require("./task-execution");

const {
	slugify,
} = require("./text-utils");

// The accepted loop/dispatch status values, centralized so they cannot drift
// between dispatchAgentTask and recordAgentReview. Each entry maps a status
// field to its accepted set plus the error label used in messages.
const DISPATCH_STATUS_FIELDS = [
	{
		field: "hardStopStatus",
		set: new Set(["not-recorded", "within-limits", "hit-limit"]),
	},
	{
		field: "budgetStatus",
		set: new Set(["not-recorded", "within-budget", "over-budget"]),
	},
	{
		field: "reviewBandwidthStatus",
		set: new Set(["not-recorded", "available", "saturated"]),
	},
	{
		field: "reviewGateStatus",
		set: new Set(["pending", "satisfied", "blocked"]),
	},
];

function statusFieldErrors(options) {
	const errors = [];
	for (const { field, set } of DISPATCH_STATUS_FIELDS) {
		const value = options[field];
		if (value && !set.has(value)) {
			errors.push(
				`Invalid ${field}: ${value}. Must be one of: ${[...set].join(", ")}.`,
			);
		}
	}
	return errors;
}

function dispatchAgentTask(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const taskId = slugify(options.task);
	const errors = [];
	const warnings = [];
	const worker = options.worker;
	const reviewer = options.reviewer;
	const requestedConcurrency = Number.parseInt(options.concurrency || "1", 10);
	const isSwarm = requestedConcurrency > 1;
	const belowHighConfidence = Boolean(options.confidence) && options.confidence !== "high";
	const concurrency = isSwarm && options.confidence === "low" ? 1 : requestedConcurrency;
	// Swarm-class dispatches always expose their approval precondition; callers
	// may also require approval for a single-worker dispatch explicitly.
	const requiresApproval = isSwarm || belowHighConfidence || options.requiresApproval === true;

	if (!options.task) {
		errors.push("agent dispatch requires --task <task-id>.");
	}
	if (!worker) {
		errors.push("agent dispatch requires --worker <worker-id>.");
	}
	if (!reviewer) {
		errors.push("agent dispatch requires --reviewer <reviewer-id>.");
	}
	if (worker && reviewer && worker === reviewer) {
		errors.push(
			"Workers cannot self-approve; worker and reviewer must be different.",
		);
	}
	if (
		!Number.isInteger(requestedConcurrency) ||
		requestedConcurrency < 1 ||
		requestedConcurrency > 4
	) {
		errors.push(
			"agent dispatch concurrency must be an integer between 1 and 4.",
		);
	}
	if (
		!pathExists(
			path.join(resolveStateDirForRead(targetRoot), "executions", taskId, "ledger.json"),
		)
	) {
		errors.push(`Prepared task ledger is missing for ${taskId}.`);
	}

	// Validate loop contract status values
	errors.push(...statusFieldErrors(options));

	if (errors.length > 0) {
		return { target: targetRoot, task: taskId || null, errors, warnings };
	}

	const paths = orchestrationPaths(targetRoot, taskId, { forCreate: true });
	fs.mkdirSync(paths.root, { recursive: true });
	const dispatch = {
		taskId,
		status: "dispatched",
		worker: { id: worker },
		reviewer: { id: reviewer },
		backend: { name: options.backend || "local" },
		concurrencyLimit: concurrency,
		workerOutput: null,
		reviewerEvidence: null,
		controls: { stop: true, resume: true },
		workersCannotSelfApprove: true,
		requiresApproval,
		loop: {
			contractId: options.loopContract || null,
			hardStopStatus: options.hardStopStatus || "not-recorded",
			budgetStatus: options.budgetStatus || "not-recorded",
			reviewBandwidthStatus: options.reviewBandwidthStatus || "not-recorded",
			reviewGateStatus: options.reviewGateStatus || "pending",
		},
		createdAt: new Date().toISOString(),
	};
	fs.writeFileSync(paths.dispatchPath, JSON.stringify(dispatch, null, 2));

	return { target: targetRoot, task: taskId, dispatch, errors, warnings };
}

function setAgentDispatchStatus(target, taskIdInput, status) {
	const targetRoot = resolveTarget(target);
	const taskId = slugify(taskIdInput);
	const errors = [];
	const warnings = [];

	try {
		const paths = orchestrationPaths(targetRoot, taskId);
		const dispatch = readJson(paths.dispatchPath);
		dispatch.status = status;
		dispatch.updatedAt = new Date().toISOString();
		fs.writeFileSync(paths.dispatchPath, JSON.stringify(dispatch, null, 2));
		return { target: targetRoot, task: taskId, dispatch, errors, warnings };
	} catch (error) {
		errors.push(`Cannot update agent dispatch: ${error.message}`);
		return { target: targetRoot, task: taskId || null, errors, warnings };
	}
}

function recordAgentReview(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const taskId = slugify(options.task);
	const errors = [];
	const warnings = [];

	try {
		const paths = orchestrationPaths(targetRoot, taskId);
		const dispatch = readJson(paths.dispatchPath);
		if (dispatch.reviewer.id !== options.reviewer) {
			errors.push(
				"Reviewer evidence must be recorded by the assigned reviewer.",
			);
			return { target: targetRoot, task: taskId, errors, warnings };
		}

		// Validate reviewGateStatus if provided
		if (options.reviewGateStatus) {
			const [statusError] = statusFieldErrors({
				reviewGateStatus: options.reviewGateStatus,
			});
			if (statusError) {
				errors.push(statusError);
				return { target: targetRoot, task: taskId, errors, warnings };
			}
		}

		const reviewerEvidence = {
			taskId,
			reviewer: options.reviewer,
			decision: options.decision || "needs_changes",
			evidence: options.evidence || "",
			workerOutputPath: dispatch.workerOutput,
			recordedAt: new Date().toISOString(),
		};
		fs.writeFileSync(
			paths.reviewerEvidencePath,
			JSON.stringify(reviewerEvidence, null, 2),
		);
		dispatch.reviewerEvidence = relativeSlash(
			targetRoot,
			paths.reviewerEvidencePath,
		);
		dispatch.status = "reviewed";

		// Update loop reviewGateStatus if provided
		if (options.reviewGateStatus) {
			if (!dispatch.loop) {
				dispatch.loop = {
					contractId: null,
					hardStopStatus: "not-recorded",
					budgetStatus: "not-recorded",
					reviewBandwidthStatus: "not-recorded",
					reviewGateStatus: options.reviewGateStatus,
				};
			} else {
				dispatch.loop.reviewGateStatus = options.reviewGateStatus;
			}
		}

		fs.writeFileSync(paths.dispatchPath, JSON.stringify(dispatch, null, 2));
		return {
			target: targetRoot,
			task: taskId,
			reviewerEvidence,
			dispatch,
			errors,
			warnings,
		};
	} catch (error) {
		errors.push(`Cannot record agent review: ${error.message}`);
		return { target: targetRoot, task: taskId || null, errors, warnings };
	}
}

module.exports = {
	dispatchAgentTask,
	setAgentDispatchStatus,
	recordAgentReview,
};
