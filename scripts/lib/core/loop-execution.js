"use strict";

// GLX execution orchestration: the four governance gates that wrap a governed
// command. The raw spawn is only reached after the policy gate (1) and the
// approval gate (2) pass; it runs inside an isolated worktree (3) and every
// attempt is recorded in the tamper-evident ledger (4). Without --execute this
// delegates to the unchanged dry-run path.
const path = require("node:path");
const crypto = require("node:crypto");
const { readJsonSafe, resolveTarget } = require("./fs-utils");
const { findLoopContract, dryRunLoopContract } = require("./loops");
const { appendLedgerRecord, verifyLedgerOutcome } = require("./loop-ledger");
const { runGovernedCommand } = require("./governed-runner");

function ledgerPath(targetRoot, contractId) {
	return path.join(resolveTarget(targetRoot), ".amber", "loops", contractId, "ledger.jsonl");
}

function loadContract(file, contractId) {
	const { value: data, error } = readJsonSafe(path.resolve(file));
	if (error) throw new Error(error);
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		throw new Error(`Workflow pack file is not a valid object: ${file}`);
	}
	return { data, contract: findLoopContract(data, contractId) };
}

function approveLoopContract({ file, contract: contractId, target, reviewer }) {
	const targetRoot = resolveTarget(target);
	try {
		loadContract(file, contractId);
	} catch (e) {
		return { target: targetRoot, errors: [e.message], warnings: [] };
	}
	const approvalKey = crypto.randomUUID();
	const record = appendLedgerRecord(ledgerPath(targetRoot, contractId), {
		schemaVersion: 2,
		kind: "approved",
		approvalState: "approved",
		contractId,
		approvalKey,
		reviewer: reviewer || "unknown",
		recordedAt: new Date().toISOString(),
		executesAnything: false,
	});
	return {
		target: targetRoot,
		approvalKey,
		record,
		text: `Approved ${contractId} (approvalKey ${approvalKey}). Now run: amber loop run --file <pack> --contract ${contractId} --execute`,
		errors: [],
		warnings: [],
	};
}

function executeLoopContract({ file, contract: contractId, target, execute, dryRun, output }) {
	const targetRoot = resolveTarget(target);

	// Default path unchanged: no --execute → existing dry-run behaviour.
	if (!execute) {
		return dryRunLoopContract({ file, contract: contractId, dryRun: dryRun !== false, output });
	}

	let contract;
	try {
		({ contract } = loadContract(file, contractId));
	} catch (e) {
		return { target: targetRoot, errors: [e.message], warnings: [] };
	}

	const command = contract.governed && contract.governed.command;
	if (!command) {
		return {
			target: targetRoot,
			errors: ["Contract declares no governed.command; nothing to execute."],
			warnings: [],
		};
	}

	const lp = ledgerPath(targetRoot, contractId);

	// Gates 1–4 delegated to the reusable governed runner (policy, approval,
	// worktree isolation, tamper-evident ledger). The loop's identity (contractId)
	// is passed as `subject` so it is recorded on every ledger entry.
	const budgetMinutes = contract.budget?.maxMinutes || contract.hardStops?.timeoutMinutes || 5;
	const outcome = runGovernedCommand({
		target: targetRoot,
		command,
		ledgerPath: lp,
		budgetMinutes,
		subject: { contractId },
		label: contractId,
		contextRules: contract.governed && contract.governed.rules,
	});
	if (outcome.errors.length > 0) {
		return { target: targetRoot, errors: outcome.errors, warnings: outcome.warnings };
	}
	return {
		target: targetRoot,
		executed: true,
		exitCode: outcome.exitCode,
		ledgerRecord: outcome.ledgerRecord,
		text: `Executed ${contractId} -> exit ${outcome.exitCode}. Ledger: ${path.relative(targetRoot, lp)}`,
		errors: outcome.errors,
		warnings: outcome.warnings,
	};
}

function verifyLoopLedger({ target, contract: contractId }) {
	const targetRoot = resolveTarget(target);
	const o = verifyLedgerOutcome(ledgerPath(targetRoot, contractId));
	if (!o.found) {
		return {
			target: targetRoot,
			errors: [`No ledger found for contract ${contractId}`],
			warnings: [],
		};
	}
	if (o.intact) {
		return {
			target: targetRoot,
			intact: true,
			text: `Ledger intact (${o.records} records).`,
			errors: [],
			warnings: [],
		};
	}
	return {
		target: targetRoot,
		intact: false,
		errors: [o.tamperedMessage],
		warnings: [],
	};
}

module.exports = { approveLoopContract, executeLoopContract, verifyLoopLedger, ledgerPath };
