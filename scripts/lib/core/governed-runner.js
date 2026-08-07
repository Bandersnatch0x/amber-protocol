"use strict";

// Reusable four-gate governed command runner. Loops (via loop-execution.js) and
// route command-stages (via route-commands.js) both call this, so the governance
// gates — policy, approval, worktree isolation, tamper-evident ledger — are one
// primitive, not duplicated per consumer.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { resolveTarget } = require("./fs-utils");
const { evaluateGovernedPolicy, loadPolicyRules } = require("./loop-policy");
const {
	appendLedgerRecord,
	readLedger,
	verifyLedgerChain,
	latestUnconsumedApproval,
} = require("./loop-ledger");
const { codedError } = require("./error-catalog");
const { createWorktree, removeWorktree } = require("../worktree-manager");

function mergeRules(globalRules, contextRules) {
	const g = Array.isArray(globalRules?.rules) ? globalRules.rules : [];
	const c = Array.isArray(contextRules) ? contextRules : [];
	// Context rules are appended; evaluateGovernedPolicy checks ALL deny rules first
	// (deny-wins, including un-removable built-ins), so a context allow can never
	// override a global OR context deny.
	return {
		...globalRules,
		defaultAction: globalRules?.defaultAction ?? "deny",
		rules: [...g, ...c],
	};
}

function policyDenial(targetRoot, ledgerPath, command, reason, subject) {
	appendLedgerRecord(ledgerPath, {
		schemaVersion: 2,
		kind: "denied",
		command,
		reason,
		recordedAt: new Date().toISOString(),
		executesAnything: false,
		...subject,
	});
	return { target: targetRoot, errors: [codedError("AMBER_E_POLICY_DENY", reason)], warnings: [] };
}

function confidenceDenial(targetRoot, ledgerPath, command, verdict, subject) {
	const reason = verdict.confidence === "medium"
		? "medium confidence permits dry-run only; governed execution requires high confidence"
		: "low confidence requires human review; governed execution requires high confidence";
	appendLedgerRecord(ledgerPath, {
		schemaVersion: 2,
		kind: "denied",
		gate: "confidence",
		command,
		confidence: verdict.confidence,
		matchedRule: verdict.matchedRule,
		reason,
		recordedAt: new Date().toISOString(),
		executesAnything: false,
		...subject,
	});
	return { target: targetRoot, errors: [codedError("AMBER_E_CONFIDENCE_GATE", reason)], warnings: [] };
}

function evaluateExecutionPolicy(targetRoot, ledgerPath, command, subject, contextRules) {
	const globalRules = loadPolicyRules(targetRoot, { required: true });
	if (!globalRules) {
		return policyDenial(
			targetRoot,
			ledgerPath,
			command,
			"governance rules.json is missing or invalid; governed execution requires an explicit policy",
			subject,
		);
	}
	const ruleset = mergeRules(globalRules, contextRules);
	const verdict = evaluateGovernedPolicy(command, ruleset);
	if (!verdict.allowed) return policyDenial(targetRoot, ledgerPath, command, verdict.reason, subject);
	if (verdict.confidence !== "high") {
		const governedVerdict = {
			...verdict,
			confidence: verdict.confidence === "medium" ? "medium" : "low",
		};
		return confidenceDenial(targetRoot, ledgerPath, command, governedVerdict, subject);
	}
	return null;
}

function executeInWorktree(targetRoot, command, label, budgetMinutes) {
	const safeLabel = String(label).replace(/[^A-Za-z0-9._-]/g, "-");
	const runId = `glx-${safeLabel}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
	const worktree = createWorktree(targetRoot, runId);
	if (!worktree.success) return { error: `Failed to create isolated worktree: ${worktree.error}` };
	let result;
	try {
		const spawned = spawnSync(command, { shell: true, cwd: worktree.path, encoding: "utf8", timeout: budgetMinutes * 60_000 });
		result = {
			command,
			exitCode: spawned.status === null ? -1 : spawned.status,
			stdout: (spawned.stdout || "").slice(-4000),
			stderr: (spawned.stderr || "").slice(-2000),
		};
	} catch (error) {
		result = { command, exitCode: -1, stdout: "", stderr: String(error.message).slice(-2000) };
	} finally {
		removeWorktree(targetRoot, runId);
	}
	return { result };
}

function recordGovernedExecution(targetRoot, ledgerPath, approval, execution, subject) {
	const record = appendLedgerRecord(ledgerPath, {
		schemaVersion: 2,
		kind: "executed",
		approvalState: "executed",
		consumedApprovalKey: approval.approvalKey,
		action: execution,
		recordedAt: new Date().toISOString(),
		executesAnything: true,
		stopReason: execution.exitCode === 0 ? "completed" : "command-failed",
		...subject,
	});
	return {
		target: targetRoot,
		executed: true,
		exitCode: execution.exitCode,
		ledgerRecord: record,
		errors: execution.exitCode === 0 ? [] : [`Command exited ${execution.exitCode}`],
		warnings: [],
	};
}

function runGovernedCommand({ target, command, ledgerPath: lp, budgetMinutes = 5, subject = {}, label = "command", contextRules }) {
	const targetRoot = resolveTarget(target);
	const chain = verifyLedgerChain(lp);
	if (!chain.intact) {
		const reason = `Ledger chain is broken at record ${chain.brokenAt}: ${chain.reason}`;
		return { target: targetRoot, errors: [codedError("AMBER_E_LEDGER_TAMPERED", reason)], warnings: [] };
	}
	const policyResult = evaluateExecutionPolicy(targetRoot, lp, command, subject, contextRules);
	if (policyResult) return policyResult;
	const approval = latestUnconsumedApproval(readLedger(lp));
	if (!approval) {
		return {
			target: targetRoot,
			errors: [codedError("AMBER_E_LOOP_NOT_APPROVED", `No unconsumed approval for ${label}`)],
			warnings: [],
		};
	}

	if (!fs.existsSync(path.join(targetRoot, ".git"))) {
		return { target: targetRoot, errors: [codedError("AMBER_E_MISSING_PATH_ARG", "not a git repository")], warnings: [] };
	}
	const execution = executeInWorktree(targetRoot, command, label, budgetMinutes);
	if (execution.error) return { target: targetRoot, errors: [execution.error], warnings: [] };
	return recordGovernedExecution(targetRoot, lp, approval, execution.result, subject);
}

module.exports = { runGovernedCommand, mergeRules };
