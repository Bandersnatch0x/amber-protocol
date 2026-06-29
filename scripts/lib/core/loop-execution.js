"use strict";

// GLX execution orchestration: the four governance gates that wrap a governed
// command. The raw spawn is only reached after the policy gate (1) and the
// approval gate (2) pass; it runs inside an isolated worktree (3) and every
// attempt is recorded in the tamper-evident ledger (4). Without --execute this
// delegates to the unchanged dry-run path.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { readJsonSafe, resolveTarget } = require("./fs-utils");
const { findLoopContract, dryRunLoopContract } = require("./loops");
const { evaluateCommandPolicy, loadPolicyRules } = require("./loop-policy");
const {
	appendLedgerRecord,
	readLedger,
	latestUnconsumedApproval,
	verifyLedgerChain,
} = require("./loop-ledger");
const { codedError } = require("./error-catalog");
const { createWorktree, removeWorktree } = require("../worktree-manager");

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
	const approvalId = crypto.randomUUID();
	const record = appendLedgerRecord(ledgerPath(targetRoot, contractId), {
		schemaVersion: 2,
		kind: "approved",
		approvalState: "approved",
		contractId,
		approvalId,
		reviewer: reviewer || "unknown",
		recordedAt: new Date().toISOString(),
		executesAnything: false,
	});
	return {
		target: targetRoot,
		approvalId,
		record,
		text: `Approved ${contractId} (approvalId ${approvalId}). Now run: amber loop run --file <pack> --contract ${contractId} --execute`,
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

	// Gate 1 — policy
	const verdict = evaluateCommandPolicy(command, loadPolicyRules(targetRoot));
	if (!verdict.allowed) {
		appendLedgerRecord(lp, {
			schemaVersion: 2,
			kind: "denied",
			contractId,
			command,
			reason: verdict.reason,
			recordedAt: new Date().toISOString(),
			executesAnything: false,
		});
		return { target: targetRoot, errors: [codedError("AMBER_E_POLICY_DENY", verdict.reason)], warnings: [] };
	}

	// Gate 2 — approval (unconsumed)
	const approval = latestUnconsumedApproval(readLedger(lp));
	if (!approval) {
		return {
			target: targetRoot,
			errors: [codedError("AMBER_E_LOOP_NOT_APPROVED", `No unconsumed approval for ${contractId}`)],
			warnings: [],
		};
	}

	// Gate 3 — git precondition + isolated worktree (reuse worktree-manager)
	if (!fs.existsSync(path.join(targetRoot, ".git"))) {
		return {
			target: targetRoot,
			errors: [codedError("AMBER_E_MISSING_PATH_ARG", "not a git repository")],
			warnings: [],
		};
	}
	const runId = `glx-${contractId}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
	const wt = createWorktree(targetRoot, runId);
	if (!wt.success) {
		return { target: targetRoot, errors: [`Failed to create isolated worktree: ${wt.error}`], warnings: [] };
	}
	const timeoutMs =
		(contract.budget?.maxMinutes || contract.hardStops?.timeoutMinutes || 5) * 60_000;
	let exec;
	try {
		const res = spawnSync(command, { shell: true, cwd: wt.path, encoding: "utf8", timeout: timeoutMs });
		exec = {
			command,
			exitCode: res.status,
			stdout: (res.stdout || "").slice(0, 4000),
			stderr: (res.stderr || "").slice(0, 2000),
		};
	} catch (e) {
		exec = { command, exitCode: -1, stderr: String(e.message).slice(0, 2000) };
	} finally {
		removeWorktree(targetRoot, runId);
	}

	// Gate 4 — tamper-evident executed record (consumes the approval)
	const record = appendLedgerRecord(lp, {
		schemaVersion: 2,
		kind: "executed",
		approvalState: "executed",
		contractId,
		consumedApprovalId: approval.approvalId,
		action: exec,
		recordedAt: new Date().toISOString(),
		executesAnything: true,
		stopReason: exec.exitCode === 0 ? "completed" : "command-failed",
	});
	return {
		target: targetRoot,
		executed: true,
		exitCode: exec.exitCode,
		ledgerRecord: record,
		text: `Executed ${contractId} -> exit ${exec.exitCode}. Ledger: ${path.relative(targetRoot, lp)}`,
		errors: exec.exitCode === 0 ? [] : [`Command exited ${exec.exitCode}`],
		warnings: [],
	};
}

function verifyLoopLedger({ target, contract: contractId }) {
	const targetRoot = resolveTarget(target);
	const lp = ledgerPath(targetRoot, contractId);
	if (!fs.existsSync(lp)) {
		return { target: targetRoot, errors: [`No ledger found for contract ${contractId}`], warnings: [] };
	}
	const v = verifyLedgerChain(lp);
	if (v.intact) {
		return { target: targetRoot, intact: true, text: `Ledger intact (${v.records} records).`, errors: [], warnings: [] };
	}
	return {
		target: targetRoot,
		intact: false,
		errors: [codedError("AMBER_E_LEDGER_TAMPERED", `broken at record ${v.brokenAt}: ${v.reason}`)],
		warnings: [],
	};
}

module.exports = { approveLoopContract, executeLoopContract, verifyLoopLedger, ledgerPath };
