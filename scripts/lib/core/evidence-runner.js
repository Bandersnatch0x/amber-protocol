"use strict";

// Evidence runner: execute a verification command against the WORKING COPY and
// record its real exit code as tamper-evident evidence. Unlike governed-runner
// (which runs mutating commands in an isolated worktree behind an approval gate),
// verification READS the working tree — so it runs in-place (cwd = target) and
// needs no approval: collecting evidence is not a mutating action. It keeps the
// policy gate (only allow-listed commands run) and the hash-chain ledger, sharing
// loop-policy + loop-ledger with governed-runner.
const { spawnSync } = require("node:child_process");
const { resolveTarget } = require("./fs-utils");
const { evaluateCommandPolicy, loadPolicyRules } = require("./loop-policy");
const { appendLedgerRecord } = require("./loop-ledger");

const STDOUT_CAP = 4000;
const STDERR_CAP = 2000;

function runEvidenceCommand({ target, command, ledgerPath, budgetMinutes = 5, subject = {} }) {
	const targetRoot = resolveTarget(target);

	// Gate — policy (global rules.json; deny-wins, default-deny). Only allow-listed
	// verification commands run, so `verify --execute --command "rm -rf /"` is refused.
	const verdict = evaluateCommandPolicy(command, loadPolicyRules(targetRoot));
	if (!verdict.allowed) {
		const record = appendLedgerRecord(ledgerPath, {
			schemaVersion: 2,
			kind: "verification_denied",
			command,
			reason: verdict.reason,
			recordedAt: new Date().toISOString(),
			executesAnything: false,
			...subject,
		});
		return { target: targetRoot, executed: false, denied: true, reason: verdict.reason, ledgerRecord: record };
	}

	const startedAt = Date.now();
	let exec;
	try {
		const res = spawnSync(command, {
			shell: true,
			cwd: targetRoot,
			encoding: "utf8",
			timeout: budgetMinutes * 60_000,
		});
		// A null status means the process was killed (e.g. timeout/signal); treat as
		// failure (-1) so a timed-out verify never records as passed.
		const exitCode = res.status === null ? -1 : res.status;
		exec = {
			command,
			exitCode,
			stdoutTail: (res.stdout || "").slice(-STDOUT_CAP),
			stderrTail: (res.stderr || "").slice(-STDERR_CAP),
		};
	} catch (e) {
		exec = { command, exitCode: -1, stdoutTail: "", stderrTail: String(e.message).slice(-STDERR_CAP) };
	}
	const durationMs = Date.now() - startedAt;

	const record = appendLedgerRecord(ledgerPath, {
		schemaVersion: 2,
		kind: exec.exitCode === 0 ? "verification_passed" : "verification_failed",
		command,
		exitCode: exec.exitCode,
		durationMs,
		recordedAt: new Date().toISOString(),
		executesAnything: true,
		...subject,
	});

	return {
		target: targetRoot,
		executed: true,
		denied: false,
		exitCode: exec.exitCode,
		stdoutTail: exec.stdoutTail,
		stderrTail: exec.stderrTail,
		durationMs,
		ledgerRecord: record,
	};
}

module.exports = { runEvidenceCommand };
