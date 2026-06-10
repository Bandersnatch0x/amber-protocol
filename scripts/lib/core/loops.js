"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
	readJson,
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
	const absolutePath = path.resolve(options.file);
	const data = readJson(absolutePath);
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

function dryRunLoopContract(options = {}) {
	const errors = [];
	if (!options.dryRun) {
		errors.push(
			"loop run requires --dry-run until live scheduling is implemented.",
		);
	}
	if (errors.length > 0) {
		return {
			errors,
			warnings: [],
			executesAnything: false,
			schedulesJobs: false,
		};
	}
	const absolutePath = path.resolve(options.file);
	const data = readJson(absolutePath);
	const contract = findLoopContract(data, options.contract);
	const ledgerPreview = buildLoopLedgerRecord(data, contract, {
		stopReason: "dry-run-only",
	});
	if (options.output) {
		fs.mkdirSync(path.dirname(path.resolve(options.output)), {
			recursive: true,
		});
		fs.writeFileSync(
			path.resolve(options.output),
			JSON.stringify(ledgerPreview, null, 2),
		);
	}
	return {
		mode: "dry-run",
		file: absolutePath,
		errors: [],
		warnings: [],
		ledgerPreview,
		executesAnything: false,
		schedulesJobs: false,
		callsExternalSystems: false,
	};
}

function recordLoopContract(options = {}) {
	const absolutePath = path.resolve(options.file);
	const data = readJson(absolutePath);
	const contract = findLoopContract(data, options.contract);
	const record = buildLoopLedgerRecord(data, contract, {
		triggerSource: options.triggerSource || "manual",
		stopReason: options.stopReason || "manual-record",
	});
	if (options.output) {
		fs.mkdirSync(path.dirname(path.resolve(options.output)), {
			recursive: true,
		});
		fs.writeFileSync(
			path.resolve(options.output),
			JSON.stringify(record, null, 2),
		);
	}
	return {
		record,
		errors: [],
		warnings: [],
		executesAnything: false,
		schedulesJobs: false,
		callsExternalSystems: false,
	};
}

function inspectLoopLedger(options = {}) {
	const ledgerPath = path.resolve(options.ledger);
	const record = readJson(ledgerPath);
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
