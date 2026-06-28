"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
	readJson,
	readJsonSafe,
	isMissingPath,
} = require("./fs-utils");

const {
	inspectLoopReadiness,
} = require("./workflow-packs");

const DEFAULT_RECOMMENDATION_GOAL = "continuous improvement";

const GOAL_KEYWORDS = {
	"continuous improvement": [
		"continuous",
		"improvement",
		"maintenance",
		"triage",
		"health",
		"stale",
		"evolution",
		"drift",
		"candidate",
		"harness",
		"amber",
		"daily",
	],
	maintenance: [
		"maintenance",
		"triage",
		"stale",
		"doc",
		"wiki",
		"evolution",
		"drift",
		"candidate",
	],
	security: [
		"security",
		"secure",
		"vulnerability",
		"secret",
		"permission",
		"audit",
	],
	review: [
		"review",
		"code",
		"accept",
		"diff",
		"changed",
		"approval",
	],
	"vulnerability repair": [
		"vulnerability",
		"vuln",
		"repair",
		"re-scan",
		"regression",
		"verification",
	],
};

function findLoopContract(data, contractId) {
	const contracts = Array.isArray(data.loopContracts) ? data.loopContracts : [];
	const contract = contracts.find(
		(candidate) => candidate && candidate.id === contractId,
	);
	if (!contract) {
		throw new Error(`Loop contract ${contractId} was not found.`);
	}
	return contract;
}

function buildLoopLedgerRecord(data, contract, options = {}) {
	const now = new Date().toISOString();
	return {
		schemaVersion: 1,
		recordedAt: now,
		triggerSource: options.triggerSource || "manual",
		resolvedProfile: options.profile || null,
		workflowPackVersion: data.version || null,
		contractId: contract.id,
		contractVersion: contract.version || data.version || null,
		inputSnapshot: {
			sources: Array.isArray(contract.inputSources)
				? contract.inputSources
				: [],
			capturedAt: now,
		},
		actionSummary:
			options.actionSummary || "dry-run preview only; no actions executed",
		producedArtifacts: [],
		replayEvidence: [],
		budgetUsage: { minutes: 0 },
		stopReason: options.stopReason || "dry-run-only",
		approvalState: "pending-review",
		reviewerOutcome: "not-reviewed",
		executesAnything: false,
		schedulesJobs: false,
		callsExternalSystems: false,
	};
}

function inspectLoopContract(options = {}) {
	if (isMissingPath(options.file)) {
		return {
			file: "",
			errors: ["No workflow pack file specified. Pass --file <path>."],
			warnings: [],
			...noOpExecution(),
		};
	}
	const absolutePath = path.resolve(options.file);
	const { value: data, error } = readJsonSafe(absolutePath);
	if (error) {
		return {
			file: absolutePath,
			errors: [error],
			warnings: [],
			...noOpExecution(),
		};
	}
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return {
			file: absolutePath,
			errors: [`Workflow pack file is not a valid object: ${absolutePath}`],
			warnings: [],
			...noOpExecution(),
		};
	}
	const contract = findLoopContract(data, options.contract);
	return {
		file: absolutePath,
		errors: [],
		warnings: [],
		contract,
		readiness: inspectLoopReadiness(data),
		execution: {
			executesAnything: false,
			schedulesJobs: false,
			callsExternalSystems: false,
		},
	};
}

function readContractAndBuildLedger(options, ledgerOptions) {
	const absolutePath = path.resolve(options.file);
	const { value: data, error } = readJsonSafe(absolutePath);
	if (error) {
		throw new Error(error);
	}
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		throw new Error(`Workflow pack file is not a valid object: ${absolutePath}`);
	}
	const contract = findLoopContract(data, options.contract);
	const ledgerRecord = buildLoopLedgerRecord(data, contract, ledgerOptions);

	if (options.output) {
		fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
		fs.writeFileSync(path.resolve(options.output), JSON.stringify(ledgerRecord, null, 2));
	}

	return { absolutePath, data, contract, ledgerRecord };
}

function noOpExecution() {
	return { executesAnything: false, schedulesJobs: false, callsExternalSystems: false };
}

function normalizeText(value) {
	if (Array.isArray(value)) {
		return value.map(normalizeText).join(" ");
	}
	if (value && typeof value === "object") {
		return Object.values(value).map(normalizeText).join(" ");
	}
	return String(value || "").toLowerCase();
}

function goalKeywords(goal) {
	const normalizedGoal = String(goal || DEFAULT_RECOMMENDATION_GOAL)
		.trim()
		.toLowerCase();
	const direct = GOAL_KEYWORDS[normalizedGoal] || [];
	const goalTerms = normalizedGoal.split(/[^a-z0-9-]+/).filter(Boolean);
	const aliasTerms = [];
	for (const [alias, keywords] of Object.entries(GOAL_KEYWORDS)) {
		const aliasTermsForGoal = alias.split(/[^a-z0-9-]+/).filter(Boolean);
		if (
			alias === normalizedGoal ||
			aliasTermsForGoal.some((term) => goalTerms.includes(term)) ||
			goalTerms.some((term) => keywords.includes(term))
		) {
			aliasTerms.push(...keywords);
		}
	}
	return [...new Set([...goalTerms, ...direct, ...aliasTerms])];
}

function isContinuousMaintenanceGoal(goal) {
	const normalizedGoal = String(goal || DEFAULT_RECOMMENDATION_GOAL)
		.trim()
		.toLowerCase();
	return (
		normalizedGoal === "" ||
		normalizedGoal.includes("continuous") ||
		normalizedGoal.includes("improvement") ||
		normalizedGoal.includes("maintenance") ||
		normalizedGoal.includes("triage") ||
		normalizedGoal.includes("stale") ||
		normalizedGoal.includes("持续") ||
		normalizedGoal.includes("完善") ||
		normalizedGoal.includes("维护")
	);
}

function contractSearchText(pack, contract) {
	return normalizeText([
		pack.id,
		pack.title,
		pack.description,
		pack.name,
		contract.id,
		contract.title,
		contract.goal,
		contract.inputs,
		contract.skills,
		contract.triageOutputs,
		contract.connectors,
		contract.trigger,
	]);
}

function discoverPackFiles(targetRoot) {
	const packDir = path.join(targetRoot, "workflow-packs");
	if (!fs.existsSync(packDir)) {
		return {
			files: [],
			warnings: [`No workflow-packs directory found at ${packDir}.`],
		};
	}
	let entries = [];
	try {
		const stats = fs.statSync(packDir);
		if (!stats.isDirectory()) {
			return {
				files: [],
				warnings: [`Workflow packs path is not a directory: ${packDir}.`],
			};
		}
		entries = fs.readdirSync(packDir, { withFileTypes: true });
	} catch (error) {
		return {
			files: [],
			warnings: [`Cannot read workflow packs directory ${packDir}: ${error.message}`],
		};
	}
	const files = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".pack.json"))
		.map((entry) => path.join(packDir, entry.name))
		.sort();
	return { files, warnings: [] };
}

function sameResolvedPath(left, right) {
	const resolvedLeft = path.resolve(left);
	const resolvedRight = path.resolve(right);
	if (process.platform === "win32") {
		return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase();
	}
	return resolvedLeft === resolvedRight;
}

function commandPackPath(targetRoot, packFile) {
	if (sameResolvedPath(targetRoot, process.cwd())) {
		return path.relative(targetRoot, packFile) || packFile;
	}
	return packFile;
}

function scoreLoopContract(pack, contract, readiness, goal, packFile) {
	const reasons = [];
	let score = 0;

	if (readiness.readyForDryRun) {
		score += 50;
		reasons.push("pack is ready for dry-run and record-only loop use");
	} else {
		score -= 50;
		reasons.push("pack has readiness blockers beyond the live-scheduling boundary");
	}

	const execution = contract.execution || {};
	if (
		execution.executesAnything === false &&
		execution.schedulesJobs === false &&
		execution.writesExternalSystems === false
	) {
		score += 25;
		reasons.push("contract is read-only, unscheduled, and local-only");
	}

	if (contract.trigger && contract.trigger.enabled === false) {
		score += 10;
		reasons.push("trigger is declared but disabled");
	}

	if (
		contract.trigger &&
		contract.trigger.type === "scheduled" &&
		contract.trigger.cadence === "daily" &&
		isContinuousMaintenanceGoal(goal)
	) {
		score += 12;
		reasons.push("daily cadence fits ongoing project maintenance");
	} else if (contract.trigger && contract.trigger.type === "scheduled") {
		score += 4;
		reasons.push("scheduled cadence is declared but remains disabled");
	}

	const text = contractSearchText(pack, contract);
	const matches = goalKeywords(goal).filter((term) => text.includes(term));
	if (matches.length > 0) {
		const uniqueMatches = [...new Set(matches)].slice(0, 8);
		score += Math.min(uniqueMatches.length * 4, 32);
		reasons.push(`matches goal terms: ${uniqueMatches.join(", ")}`);
	}

	const budget = contract.budget || {};
	if (Number.isFinite(budget.maxMinutes) && budget.maxMinutes <= 30) {
		score += 5;
		reasons.push("budget is capped at 30 minutes or less");
	}

	return {
		packId: pack.id || null,
		packTitle: pack.title || null,
		packFile,
		contractId: contract.id,
		title: contract.title || null,
		goal: contract.goal || null,
		trigger: contract.trigger || null,
		stateSpine: contract.stateSpine || null,
		score,
		reasons,
		readiness: {
			readyForDryRun: readiness.readyForDryRun,
			readyForRecordOnly: readiness.readyForRecordOnly,
			readyForLiveScheduling: readiness.readyForLiveScheduling,
			blockers: readiness.blockers,
		},
		execution: {
			executesAnything: execution.executesAnything === true,
			schedulesJobs: execution.schedulesJobs === true,
			writesExternalSystems: execution.writesExternalSystems === true,
		},
	};
}

function recommendLoopContract(options = {}) {
	const targetRoot = path.resolve(options.target || process.cwd());
	const goal = options.goal || DEFAULT_RECOMMENDATION_GOAL;
	const errors = [];
	const warnings = [];
	const packFiles = isMissingPath(options.file)
		? discoverPackFiles(targetRoot)
		: { files: [path.resolve(options.file)], warnings: [] };

	warnings.push(...packFiles.warnings);
	if (packFiles.files.length === 0) {
		errors.push("No workflow pack files were found for loop recommendation.");
		return {
			target: targetRoot,
			goal,
			selected: null,
			candidates: [],
			errors,
			warnings,
			...noOpExecution(),
		};
	}

	const candidates = [];
	for (const packFile of packFiles.files) {
		const { value: data, error } = readJsonSafe(packFile);
		if (error) {
			warnings.push(error);
			continue;
		}
		if (!data || typeof data !== "object" || Array.isArray(data)) {
			warnings.push(`Workflow pack file is not a valid object: ${packFile}`);
			continue;
		}
		const contracts = Array.isArray(data.loopContracts) ? data.loopContracts : [];
		const readiness = inspectLoopReadiness(data);
		for (const contract of contracts) {
			if (!contract || typeof contract !== "object" || !contract.id) {
				continue;
			}
			candidates.push(scoreLoopContract(data, contract, readiness, goal, packFile));
		}
	}

	candidates.sort((left, right) => {
		if (right.score !== left.score) return right.score - left.score;
		return String(left.contractId).localeCompare(String(right.contractId));
	});

	if (candidates.length === 0) {
		errors.push("No loop contracts were found in workflow pack files.");
	}

	const selected = candidates[0] || null;
	if (selected) {
		const recommendedPackPath = commandPackPath(targetRoot, selected.packFile);
		selected.nextCommand = [
			"node scripts/amber.js loop run",
			`--file ${recommendedPackPath}`,
			`--contract ${selected.contractId}`,
			"--dry-run",
			"--json",
		].join(" ");
	}

	return {
		target: targetRoot,
		goal,
		selected,
		candidates,
		errors,
		warnings,
		text: selected
			? `Recommended loop: ${selected.contractId} from ${selected.packId}.`
			: "No loop recommendation available.",
		...noOpExecution(),
	};
}

function dryRunLoopContract(options = {}) {
	const errors = [];
	if (isMissingPath(options.file)) {
		errors.push("No workflow pack file specified. Pass --file <path>.");
	}
	if (!options.dryRun) {
		errors.push("loop run requires --dry-run until live scheduling is implemented.");
	}
	if (errors.length > 0) {
		return { errors, warnings: [], ...noOpExecution() };
	}

	const { absolutePath, ledgerRecord } = readContractAndBuildLedger(options, {
		stopReason: "dry-run-only",
	});

	return {
		mode: "dry-run",
		file: absolutePath,
		errors: [],
		warnings: [],
		ledgerPreview: ledgerRecord,
		...noOpExecution(),
	};
}

function recordLoopContract(options = {}) {
	if (isMissingPath(options.file)) {
		return {
			errors: ["No workflow pack file specified. Pass --file <path>."],
			warnings: [],
			...noOpExecution(),
		};
	}
	const { ledgerRecord } = readContractAndBuildLedger(options, {
		triggerSource: options.triggerSource || "manual",
		stopReason: options.stopReason || "manual-record",
	});

	return {
		record: ledgerRecord,
		errors: [],
		warnings: [],
		...noOpExecution(),
	};
}

function inspectLoopLedger(options = {}) {
	if (isMissingPath(options.ledger)) {
		return {
			ledger: "",
			errors: ["No ledger file specified. Pass --ledger <path>."],
			warnings: [],
		};
	}
	const ledgerPath = path.resolve(options.ledger);
	const { value: record, error } = readJsonSafe(ledgerPath);
	if (error) {
		return {
			ledger: ledgerPath,
			errors: [error],
			warnings: [],
		};
	}
	if (!record || typeof record !== "object" || Array.isArray(record)) {
		return {
			ledger: ledgerPath,
			errors: [`Ledger file is not a valid object: ${ledgerPath}`],
			warnings: [],
		};
	}
	return { ledger: ledgerPath, record, errors: [], warnings: [] };
}

module.exports = {
	findLoopContract,
	buildLoopLedgerRecord,
	inspectLoopContract,
	recommendLoopContract,
	dryRunLoopContract,
	recordLoopContract,
	inspectLoopLedger,
};
