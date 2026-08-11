"use strict";

const path = require("node:path");

const { REPO_ROOT, SEMVER_PATTERN } = require("./constants");

const { pathExists, readJson, isMissingPath } = require("./fs-utils");

const { discoverStandards } = require("./planning");

function validateWorkflowPackData(data) {
	const errors = [];
	const warnings = [];

	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return { errors: ["Workflow pack must contain an object."], warnings };
	}

	for (const field of ["id", "title", "version"]) {
		if (typeof data[field] !== "string" || data[field].trim() === "") {
			errors.push(`Workflow pack field ${field} must be a non-empty string.`);
		}
	}

	if (typeof data.version === "string" && !SEMVER_PATTERN.test(data.version)) {
		errors.push("Workflow pack version must be semver.");
	}

	if (!Array.isArray(data.steps) || data.steps.length === 0) {
		errors.push("Workflow pack steps must contain at least one step.");
	} else {
		data.steps.forEach((step, index) => {
			const prefix = `Workflow pack steps[${index}]`;
			if (!step || typeof step !== "object" || Array.isArray(step)) {
				errors.push(`${prefix} must be an object.`);
				return;
			}
			for (const field of ["id", "title", "kind"]) {
				if (typeof step[field] !== "string" || step[field].trim() === "") {
					errors.push(`${prefix}.${field} must be a non-empty string.`);
				}
			}
			if (
				step.execute === true ||
				step.run !== undefined ||
				step.command !== undefined ||
				step.script !== undefined
			) {
				errors.push(`${prefix} must not declare executable scripts in smoke validation.`);
			}
		});
	}

	for (const field of ["skills", "standards", "externalIntegrations"]) {
		if (data[field] !== undefined && !Array.isArray(data[field])) {
			errors.push(`Workflow pack ${field} must be an array when present.`);
		}
	}

	const loopResult = validateLoopContracts(data.loopContracts);
	errors.push(...loopResult.errors);
	warnings.push(...loopResult.warnings);

	return { errors, warnings };
}

function validateLoopContracts(loopContracts) {
	const errors = [];
	const warnings = [];

	if (loopContracts === undefined) {
		return { errors, warnings };
	}

	if (!Array.isArray(loopContracts)) {
		errors.push("Workflow pack loopContracts must be an array when present.");
		return { errors, warnings };
	}

	const VALID_TRIGGER_TYPES = new Set(["manual", "scheduled", "goal", "external-signal"]);
	const VALID_TRIAGE_OUTPUTS = new Set([
		"archive",
		"candidate-task",
		"needs-human",
		"blocked",
		"regression-test-proposal",
	]);
	loopContracts.forEach((contract, index) => {
		const prefix = `Loop contract [${index}]`;

		if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
			errors.push(`${prefix} must be an object.`);
			return;
		}

		for (const field of ["id", "goal", "stateSpine"]) {
			if (typeof contract[field] !== "string" || contract[field].trim() === "") {
				errors.push(`${prefix}.${field} must be a non-empty string.`);
			}
		}

		if (contract.trigger && typeof contract.trigger === "object") {
			if (!VALID_TRIGGER_TYPES.has(contract.trigger.type)) {
				errors.push(
					`${prefix}.trigger.type must be one of: manual, scheduled, goal, external-signal.`,
				);
			}
		}

		if (Array.isArray(contract.triageOutputs)) {
			const invalidOutputs = contract.triageOutputs.filter(
				(output) => !VALID_TRIAGE_OUTPUTS.has(output),
			);
			if (invalidOutputs.length > 0) {
				errors.push(
					`${prefix}.triageOutputs contains invalid values: ${invalidOutputs.join(", ")}.`,
				);
			}
		}

		if (contract.hardStops && typeof contract.hardStops === "object") {
			const maxIterations = contract.hardStops.maxIterations;
			if (typeof maxIterations === "number" && maxIterations <= 0) {
				errors.push(`${prefix}.hardStops.maxIterations must be greater than 0.`);
			} else if (maxIterations === undefined) {
				errors.push(`${prefix}.hardStops.maxIterations is required.`);
			}

			if (contract.hardStops.noProgressDetection !== true) {
				errors.push(`${prefix}.hardStops.noProgressDetection must be true.`);
			}
		} else {
			errors.push(`${prefix}.hardStops is required.`);
		}

		const hasTimeout = contract.hardStops && typeof contract.hardStops.timeoutMinutes === "number";
		const hasMinuteBudget = contract.budget && typeof contract.budget.maxMinutes === "number";
		const hasTokenBudget = contract.budget && typeof contract.budget.maxTokens === "number";
		const hasUsdBudget = contract.budget && typeof contract.budget.maxUsd === "number";

		if (!hasTimeout && !hasMinuteBudget && !hasTokenBudget && !hasUsdBudget) {
			errors.push(
				`${prefix} must specify at least one of: hardStops.timeoutMinutes, budget.maxMinutes, budget.maxTokens, or budget.maxUsd.`,
			);
		}

		if (!Array.isArray(contract.reviewGates) || contract.reviewGates.length === 0) {
			errors.push(`${prefix}.reviewGates must contain at least one entry.`);
		}

		if (contract.execution && typeof contract.execution === "object") {
			if (contract.execution.executesAnything !== false) {
				errors.push(`${prefix}.execution.executesAnything must be false.`);
			}
			if (contract.execution.schedulesJobs === true) {
				errors.push(`${prefix} must not schedule jobs.`);
			}
			if (contract.execution.dispatchesAgents === true) {
				errors.push(`${prefix} must not dispatch live agents.`);
			}
			if (contract.execution.writesExternalSystems === true) {
				errors.push(`${prefix} must not write external systems.`);
			}
		}
	});
	return { errors, warnings };
}

function describeLoopContracts(data) {
	return Array.isArray(data.loopContracts)
		? data.loopContracts.map((contract) => ({
				id: contract.id,
				title: contract.title || contract.id,
				trigger: contract.trigger || null,
				goal: contract.goal || "",
				stateSpine: contract.stateSpine || "",
				triageOutputs: Array.isArray(contract.triageOutputs) ? contract.triageOutputs : [],
				hardStops: contract.hardStops || {},
				budget: contract.budget || {},
				connectors: Array.isArray(contract.connectors) ? contract.connectors : [],
				reviewGates: Array.isArray(contract.reviewGates) ? contract.reviewGates : [],
				execution: {
					executesAnything: false,
					schedulesJobs: Boolean(contract.execution && contract.execution.schedulesJobs),
					dispatchesAgents: Boolean(contract.execution && contract.execution.dispatchesAgents),
					writesExternalSystems: Boolean(
						contract.execution && contract.execution.writesExternalSystems,
					),
				},
			}))
		: [];
}

// Marker blocker for the product boundary — the only blocker that does NOT
// prevent dry-run/record. Centralized so the readiness verdict stays a single
// equality check rather than a duplicated string literal.
const LIVE_SCHEDULING_BLOCKER = "live scheduling is disabled by product boundary";

// Extract and normalise the top-level readiness inputs from a pack data object.
function extractReadinessInputs(data) {
	return {
		loopContracts: Array.isArray(data.loopContracts) ? data.loopContracts : [],
		connectorContracts: Array.isArray(data.connectorContracts) ? data.connectorContracts : [],
		approvalPolicy:
			data.approvalPolicy && typeof data.approvalPolicy === "object" ? data.approvalPolicy : null,
		loopLedger: data.loopLedger && typeof data.loopLedger === "object" ? data.loopLedger : null,
		workspaceIsolation:
			data.workspaceIsolation && typeof data.workspaceIsolation === "object"
				? data.workspaceIsolation
				: null,
	};
}

// Check the pack-level controls (loop contract present, approval policy, ledger,
// workspace isolation). Pushes to controls/blockers.
function checkPackLevelControls(inputs, controls, blockers) {
	const { loopContracts, connectorContracts, approvalPolicy, loopLedger, workspaceIsolation } =
		inputs;

	if (loopContracts.length > 0) {
		controls.push("loop contract");
	} else {
		blockers.push("loop contract is missing");
	}

	if (connectorContracts.length > 0) {
		controls.push("connector contracts");
	}

	if (approvalPolicy && approvalPolicy.selfApprovalAllowed === false) {
		controls.push("approval policy");
	} else {
		blockers.push("approval policy must disallow self-approval");
	}

	if (
		loopLedger &&
		loopLedger.required === true &&
		loopLedger.chatHistoryRequired === false &&
		loopLedger.recordsInputSnapshot === true &&
		loopLedger.recordsToolSummary === true &&
		loopLedger.recordsBudgetUsage === true &&
		loopLedger.recordsStopReason === true &&
		loopLedger.recordsApprovalState === true &&
		loopLedger.recordsReviewerOutcome === true
	) {
		controls.push("execution ledger");
	} else {
		blockers.push(
			"execution ledger policy must record replay evidence, budget usage, stop reason, approval state, and reviewer outcome without chat history",
		);
	}

	if (
		workspaceIsolation &&
		workspaceIsolation.mutatingLoopsUseWorktree === true &&
		workspaceIsolation.mainCheckoutMutation === false
	) {
		controls.push("workspace isolation");
	} else {
		blockers.push(
			"workspace isolation must require worktrees for mutating loops and forbid main-checkout mutation",
		);
	}
}

// Check per-contract controls (connector resolution, no-progress detection,
// budget ceiling, reviewer gate). Pushes to controls/blockers.
function checkPerContractControls(loopContracts, connectorContracts, controls, blockers) {
	const connectorIds = new Set(
		connectorContracts.map((connector) => connector && connector.id).filter(Boolean),
	);

	for (const contract of loopContracts) {
		const contractId = contract && contract.id ? contract.id : "unknown-loop";
		const connectors = Array.isArray(contract.connectors) ? contract.connectors : [];

		for (const connector of connectors) {
			if (!connectorIds.has(connector)) {
				blockers.push(`connector contract ${connector} is missing for loop ${contractId}`);
			}
		}

		if (contract && contract.hardStops && contract.hardStops.noProgressDetection === true) {
			controls.push("no-progress detection");
		} else {
			blockers.push(`no-progress detection is missing for loop ${contractId}`);
		}

		if (contract && contract.budget && Number.isFinite(contract.budget.maxMinutes)) {
			controls.push("budget ceiling");
		} else {
			blockers.push(`budget ceiling is missing for loop ${contractId}`);
		}

		if (Array.isArray(contract.reviewGates) && contract.reviewGates.length > 0) {
			controls.push("reviewer gate");
		} else {
			blockers.push(`reviewer gate is missing for loop ${contractId}`);
		}
	}
}

function inspectLoopReadiness(data) {
	const controls = [];
	const blockers = [];
	const inputs = extractReadinessInputs(data);

	checkPackLevelControls(inputs, controls, blockers);
	checkPerContractControls(inputs.loopContracts, inputs.connectorContracts, controls, blockers);

	blockers.push(LIVE_SCHEDULING_BLOCKER);

	// Dry-run and record-only are allowed once every blocker except the
	// always-present product-boundary marker is cleared.
	const onlyBoundaryBlocks =
		inputs.loopContracts.length > 0 &&
		blockers.every((blocker) => blocker === LIVE_SCHEDULING_BLOCKER);

	return {
		readyForDryRun: onlyBoundaryBlocks,
		readyForRecordOnly: onlyBoundaryBlocks,
		readyForLiveScheduling: false,
		allowedNow: ["describe", "validate", "dry-run", "record"],
		controls: [...new Set(controls)],
		blockers,
	};
}

function validateWorkflowPackReferences(packPath, data) {
	const errors = [];
	const standards = new Set(discoverStandards().map((standard) => standard.id));

	for (const skill of data.skills || []) {
		if (typeof skill !== "string" || skill.trim() === "") {
			errors.push("Workflow pack skills must be non-empty strings.");
			continue;
		}
		const skillPath = path.join(REPO_ROOT, "skills", skill, "SKILL.md");
		if (!pathExists(skillPath)) {
			errors.push(`Workflow pack references missing skill: skills/${skill}/SKILL.md.`);
		}
	}

	for (const standard of data.standards || []) {
		if (!standards.has(standard)) {
			errors.push(`Workflow pack references missing standard: ${standard}.`);
		}
	}

	const declaredIntegrations = new Set(data.externalIntegrations || []);
	for (const step of data.steps || []) {
		if (step && typeof step === "object" && typeof step.externalIntegration === "string") {
			if (!declaredIntegrations.has(step.externalIntegration)) {
				errors.push(
					`Workflow pack step ${step.id || "(unknown)"} uses undeclared external integration ${step.externalIntegration}.`,
				);
			}
		}
	}

	return errors;
}

// Deep module: the shared "read, parse, and structurally guard a workflow pack
// file" prelude used by both pack inspectors. Resolves the path and parses the
// JSON; on a read/parse failure OR a non-object body (a literal null/scalar/array
// parses cleanly but would crash the data.* reads downstream) it returns
// { ok: false, result } where result carries the caller-specific error shape.
// On success it returns { ok: true, packPath, data, validation }. The duplicate
// try/catch AND the duplicate non-object guard that lived in both inspectors now
// live here once.
function readWorkflowPackFile(filePath, { executionOnError, includeValidation = false } = {}) {
	if (isMissingPath(filePath)) {
		return {
			ok: false,
			result: {
				file: "",
				errors: ["No workflow pack file specified. Pass --file <path>."],
				warnings: [],
				execution: executionOnError,
			},
		};
	}
	const packPath = path.resolve(filePath);
	let data;

	try {
		data = readJson(packPath);
	} catch (error) {
		return {
			ok: false,
			result: {
				file: packPath,
				errors: [`Cannot read workflow pack: ${error.message}`],
				warnings: [],
				execution: executionOnError,
			},
		};
	}

	const validation = validateWorkflowPackData(data);

	if (!data || typeof data !== "object" || Array.isArray(data)) {
		const result = {
			file: packPath,
			errors: [...validation.errors],
			warnings: [...validation.warnings],
			execution: executionOnError,
		};
		if (includeValidation) result.validation = validation;
		return { ok: false, result };
	}

	return { ok: true, packPath, data, validation };
}

function inspectWorkflowPack(filePath) {
	const read = readWorkflowPackFile(filePath, {
		executionOnError: { executesAnything: false },
	});
	if (!read.ok) {
		return read.result;
	}
	const { packPath, data, validation } = read;
	const errors = [...validation.errors];
	const warnings = [...validation.warnings];

	errors.push(...validateWorkflowPackReferences(packPath, data));

	return {
		file: packPath,
		errors,
		warnings,
		pack: {
			id: data.id,
			title: data.title,
			version: data.version,
			stepCount: Array.isArray(data.steps) ? data.steps.length : 0,
			loopContracts: describeLoopContracts(data),
		},
		execution: {
			executesAnything: false,
			reason: "V1.5 smoke inspection reads declarative pack metadata only.",
		},
		dryRun: {
			summary:
				"This inspection explains the workflow without dispatching workers, executing scripts, or calling external systems.",
			steps: Array.isArray(data.steps)
				? data.steps.map((step) => ({
						id: step.id,
						title: step.title,
						kind: step.kind,
					}))
				: [],
			stopConditions: [
				"missing approval",
				"unsafe script declaration",
				"undeclared external integration",
			],
		},
	};
}

function inspectWorkflowPackReadiness(filePath) {
	const read = readWorkflowPackFile(filePath, {
		executionOnError: {
			executesAnything: false,
			schedulesJobs: false,
			callsExternalSystems: false,
		},
		includeValidation: true,
	});
	if (!read.ok) {
		return read.result;
	}
	const { packPath, data, validation } = read;

	return {
		file: packPath,
		errors: [...validation.errors],
		warnings: [...validation.warnings],
		validation,
		readiness: inspectLoopReadiness(data),
		execution: {
			executesAnything: false,
			schedulesJobs: false,
			callsExternalSystems: false,
		},
	};
}

module.exports = {
	validateWorkflowPackData,
	validateLoopContracts,
	describeLoopContracts,
	inspectLoopReadiness,
	validateWorkflowPackReferences,
	readWorkflowPackFile,
	inspectWorkflowPack,
	inspectWorkflowPackReadiness,
};
