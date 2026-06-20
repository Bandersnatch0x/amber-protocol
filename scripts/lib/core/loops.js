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
	dryRunLoopContract,
	recordLoopContract,
	inspectLoopLedger,
};
