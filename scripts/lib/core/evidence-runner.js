"use strict";

// Evidence runner: execute a verification command against the WORKING COPY and
// record its real exit code as tamper-evident evidence. Unlike governed-runner
// (which runs mutating commands in an isolated worktree behind an approval gate),
// verification READS the working tree — so it runs in-place (cwd = target) and
// needs no approval: collecting evidence is not a mutating action. It keeps the
// policy gate (only allow-listed commands run) and the hash-chain ledger, sharing
// loop-policy + loop-ledger with governed-runner.
const { spawn } = require("node:child_process");
const { resolveTarget } = require("./fs-utils");
const {
	evaluateVerifyPolicy,
	loadVerifyPolicyRules,
	parseGovernedArgv,
	toSpawnArgv,
} = require("./loop-policy");
const { appendLedgerRecord } = require("./loop-ledger");
const { resolvePositiveIntCeiling } = require("./resource-ceilings");
const { typedError } = require("./error-catalog");
const { signalPidTree } = require("./execution-handles");

const STDOUT_CAP = 4000;
const STDERR_CAP = 2000;

// The default budget is env-overridable so an operator can raise it
// deliberately for a repository whose verification suite legitimately runs
// longer (#315: this repo's full `npm test` needs ~9 minutes against the old
// hardcoded 5). A per-invocation budgetMinutes (the --budget-minutes flag) is
// validated against a hard cap — a verification command that needs more than
// an hour is not a verification.
const DEFAULT_BUDGET_MINUTES = 5;
const MAX_FLAG_BUDGET_MINUTES = 60;

/**
 * Resolve the verification budget in minutes. Unset falls back to the
 * AMBER_VERIFY_BUDGET_MINUTES env override or the 5-minute default; a passed
 * value must be an integer within [1, MAX_FLAG_BUDGET_MINUTES].
 * @param {number|undefined} requested
 * @returns {number}
 * @throws {Error} Typed AMBER_E_INVALID_ARG on an out-of-range request.
 */
function resolveBudgetMinutes(requested) {
	if (requested === undefined || requested === null) {
		return resolvePositiveIntCeiling(
			"AMBER_VERIFY_BUDGET_MINUTES",
			DEFAULT_BUDGET_MINUTES,
			"verification budget minutes",
		);
	}
	if (!Number.isInteger(requested) || requested < 1 || requested > MAX_FLAG_BUDGET_MINUTES) {
		throw typedError(
			"AMBER_E_INVALID_ARG",
			`must be an integer between 1 and ${MAX_FLAG_BUDGET_MINUTES} when passed; got ${String(requested)} — unset it for the default ${DEFAULT_BUDGET_MINUTES} (or the AMBER_VERIFY_BUDGET_MINUTES override)`,
		);
	}
	return requested;
}

async function runEvidenceCommand({ target, command, ledgerPath, budgetMinutes, subject = {} }) {
	const targetRoot = resolveTarget(target);

	// Gate — verification policy (verify-rules.json; deny-wins, default-deny). Only
	// allow-listed verification commands run, so `verify --execute --command "rm -rf /"`
	// is refused even if the global governance rules.json has been relaxed. Built-in
	// denies (destructive argv, anything that needs a shell) are enforced BEFORE user
	// rules, so a custom verify-rules.json can neither drop destructive protection nor
	// chain a second command (`pytest && rm -rf`); the command then runs as argv.
	const verdict = evaluateVerifyPolicy(command, loadVerifyPolicyRules(targetRoot));
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
		return {
			target: targetRoot,
			executed: false,
			denied: true,
			reason: verdict.reason,
			ledgerRecord: record,
		};
	}

	const startedAt = Date.now();
	let exec;
	try {
		const argv = toSpawnArgv(parseGovernedArgv(command));
		const timeoutMs = resolveBudgetMinutes(budgetMinutes) * 60_000;
		const res = await new Promise((resolve) => {
			const child = spawn(argv[0], argv.slice(1), {
				shell: false,
				cwd: targetRoot,
				detached: process.platform !== "win32",
				stdio: ["ignore", "pipe", "pipe"],
			});
			const out = [],
				err = [];
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				// Kill the whole tree. A bare signal stops only the direct child, so a
				// timed-out verification could leave grandchildren running. signalPidTree
				// already covers both platforms (taskkill /T on win32, process group on POSIX).
				signalPidTree(child.pid, "SIGTERM");
			}, timeoutMs);
			child.stdout.on("data", (b) => out.push(Buffer.from(b)));
			child.stderr.on("data", (b) => err.push(Buffer.from(b)));
			child.on("error", (e) => {
				clearTimeout(timer);
				resolve({ status: -1, stdout: "", stderr: e.message });
			});
			child.on("close", (code, _signal) => {
				clearTimeout(timer);
				resolve({
					status: timedOut ? -1 : (code ?? -1),
					stdout: Buffer.concat(out).toString(),
					stderr: Buffer.concat(err).toString(),
				});
			});
		});
		const exitCode = res.status;
		exec = {
			command,
			exitCode,
			stdoutTail: res.stdout.slice(-STDOUT_CAP),
			stderrTail: res.stderr.slice(-STDERR_CAP),
		};
	} catch (e) {
		exec = {
			command,
			exitCode: -1,
			stdoutTail: "",
			stderrTail: String(e.message).slice(-STDERR_CAP),
		};
	}
	const durationMs = Date.now() - startedAt;

	const record = appendLedgerRecord(ledgerPath, {
		schemaVersion: 2,
		kind: exec.exitCode === 0 ? "verification_passed" : "verification_failed",
		command,
		exitCode: exec.exitCode,
		durationMs,
		stdoutTail: exec.stdoutTail,
		stderrTail: exec.stderrTail,
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

module.exports = { runEvidenceCommand, resolveBudgetMinutes };
