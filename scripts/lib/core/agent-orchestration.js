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

function dispatchAgentTask(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const taskId = slugify(options.task);
	const errors = [];
	const warnings = [];
	const worker = options.worker;
	const reviewer = options.reviewer;
	const concurrency = Number.parseInt(options.concurrency || "1", 10);

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
	if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
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
	const VALID_HARD_STOP_STATUSES = new Set([
		"not-recorded",
		"within-limits",
		"hit-limit",
	]);
	const VALID_BUDGET_STATUSES = new Set([
		"not-recorded",
		"within-budget",
		"over-budget",
	]);
	const VALID_REVIEW_BANDWIDTH_STATUSES = new Set([
		"not-recorded",
		"available",
		"saturated",
	]);
	const VALID_REVIEW_GATE_STATUSES = new Set([
		"pending",
		"satisfied",
		"blocked",
	]);

	if (
		options.hardStopStatus &&
		!VALID_HARD_STOP_STATUSES.has(options.hardStopStatus)
	) {
		errors.push(
			`Invalid hardStopStatus: ${options.hardStopStatus}. Must be one of: not-recorded, within-limits, hit-limit.`,
		);
	}
	if (
		options.budgetStatus &&
		!VALID_BUDGET_STATUSES.has(options.budgetStatus)
	) {
		errors.push(
			`Invalid budgetStatus: ${options.budgetStatus}. Must be one of: not-recorded, within-budget, over-budget.`,
		);
	}
	if (
		options.reviewBandwidthStatus &&
		!VALID_REVIEW_BANDWIDTH_STATUSES.has(options.reviewBandwidthStatus)
	) {
		errors.push(
			`Invalid reviewBandwidthStatus: ${options.reviewBandwidthStatus}. Must be one of: not-recorded, available, saturated.`,
		);
	}
	if (
		options.reviewGateStatus &&
		!VALID_REVIEW_GATE_STATUSES.has(options.reviewGateStatus)
	) {
		errors.push(
			`Invalid reviewGateStatus: ${options.reviewGateStatus}. Must be one of: pending, satisfied, blocked.`,
		);
	}

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
			const VALID_REVIEW_GATE_STATUSES = new Set([
				"pending",
				"satisfied",
				"blocked",
			]);
			if (!VALID_REVIEW_GATE_STATUSES.has(options.reviewGateStatus)) {
				errors.push(
					`Invalid reviewGateStatus: ${options.reviewGateStatus}. Must be one of: pending, satisfied, blocked.`,
				);
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
