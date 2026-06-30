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
const { evaluateCommandPolicy, loadPolicyRules } = require("./loop-policy");
const { appendLedgerRecord, readLedger, latestUnconsumedApproval } = require("./loop-ledger");
const { codedError } = require("./error-catalog");
const { createWorktree, removeWorktree } = require("../worktree-manager");

function runGovernedCommand({ target, command, ledgerPath: lp, budgetMinutes = 5, subject = {}, label = "command" }) {
	const targetRoot = resolveTarget(target);

	// Gate 1 — policy
	const verdict = evaluateCommandPolicy(command, loadPolicyRules(targetRoot));
	if (!verdict.allowed) {
		appendLedgerRecord(lp, {
			schemaVersion: 2,
			kind: "denied",
			command,
			reason: verdict.reason,
			recordedAt: new Date().toISOString(),
			executesAnything: false,
			...subject,
		});
		return { target: targetRoot, errors: [codedError("AMBER_E_POLICY_DENY", verdict.reason)], warnings: [] };
	}

	// Gate 2 — approval (unconsumed)
	const approval = latestUnconsumedApproval(readLedger(lp));
	if (!approval) {
		return {
			target: targetRoot,
			errors: [codedError("AMBER_E_LOOP_NOT_APPROVED", `No unconsumed approval for ${label}`)],
			warnings: [],
		};
	}

	// Gate 3 — git precondition + isolated worktree
	if (!fs.existsSync(path.join(targetRoot, ".git"))) {
		return { target: targetRoot, errors: [codedError("AMBER_E_MISSING_PATH_ARG", "not a git repository")], warnings: [] };
	}
	// Sanitize the label for use as a git branch-name suffix (git forbids :, ~, ^, etc.).
	const safeLabel = String(label).replace(/[^A-Za-z0-9._-]/g, "-");
	const runId = `glx-${safeLabel}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
	const wt = createWorktree(targetRoot, runId);
	if (!wt.success) {
		return { target: targetRoot, errors: [`Failed to create isolated worktree: ${wt.error}`], warnings: [] };
	}
	let exec;
	try {
		const res = spawnSync(command, { shell: true, cwd: wt.path, encoding: "utf8", timeout: budgetMinutes * 60_000 });
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
		consumedApprovalKey: approval.approvalKey,
		action: exec,
		recordedAt: new Date().toISOString(),
		executesAnything: true,
		stopReason: exec.exitCode === 0 ? "completed" : "command-failed",
		...subject,
	});
	return {
		target: targetRoot,
		executed: true,
		exitCode: exec.exitCode,
		ledgerRecord: record,
		errors: exec.exitCode === 0 ? [] : [`Command exited ${exec.exitCode}`],
		warnings: [],
	};
}

module.exports = { runGovernedCommand };
