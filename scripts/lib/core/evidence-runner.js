"use strict";

// Evidence runner: execute a verification command against the WORKING COPY and
// record its real exit code as tamper-evident evidence. Unlike governed-runner
// (which runs mutating commands in an isolated worktree behind an approval gate),
// verification READS the working tree — so it runs in-place (cwd = target) and
// needs no approval: collecting evidence is not a mutating action. It keeps the
// policy gate (only allow-listed commands run) and the hash-chain ledger, sharing
// loop-policy + loop-ledger with governed-runner.
//
// This is the ONE verification pipeline (ADR-0107). The web console's async
// evidence-job service calls this same function through web-adapter rather than
// re-implementing the execution layer: two implementations of "run the command
// and write the record" drift on exactly the details that make evidence
// verifiable — spawn mode, output caps, kill semantics, ledger shape.
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

// A budget kill signals the tree with SIGTERM first so a well-behaved command
// can flush and exit. A command that ignores SIGTERM would otherwise hold the
// caller open past its budget with no exit in sight, so the tree is force-killed
// this long after the first signal. The timer is unref'd: an ordinary run must
// not keep a server process alive for the grace window.
const KILL_GRACE_MS = 2000;

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
 *
 * This validates the `--budget-minutes` FLAG, at the boundary where a human
 * types it. `runEvidenceCommand` accepts any positive finite duration instead:
 * a programmatic caller (the web console's job service) may legitimately ask
 * for a sub-minute budget, and the executor is not where that policy lives.
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

function resolveExecutableBudgetMinutes(requested) {
	const minutes =
		requested === undefined || requested === null ? resolveBudgetMinutes(undefined) : requested;
	if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) {
		throw typedError(
			"AMBER_E_INVALID_ARG",
			`must be a positive number of minutes when passed; got ${String(requested)}`,
		);
	}
	return minutes;
}

/**
 * Spawn one argv with no shell, capturing capped output tails. `exitCode` is -1
 * when the spawn failed OR the budget kill landed, so a timed-out run can never
 * be mistaken for a command that exited on its own — `timedOut` names which.
 * @returns {Promise<{exitCode: number, timedOut: boolean, stdout: string, stderr: string}>}
 */
function spawnAndCapture(argv, cwd, timeoutMs) {
	return new Promise((resolve) => {
		const child = spawn(argv[0], argv.slice(1), {
			shell: false,
			cwd,
			windowsHide: true,
			// POSIX: lead a process group so a budget kill can address the WHOLE
			// tree; a bare signal would orphan grandchildren that keep the stdio
			// pipes open, and 'close' would then wait out their full runtime.
			detached: process.platform !== "win32",
			stdio: ["ignore", "pipe", "pipe"],
		});
		const out = [],
			err = [];
		let timedOut = false;
		let forceTimer = null;
		let settled = false;
		const settle = (value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (forceTimer) clearTimeout(forceTimer);
			resolve(value);
		};
		const timer = setTimeout(() => {
			timedOut = true;
			signalPidTree(child.pid, "SIGTERM");
			forceTimer = setTimeout(() => signalPidTree(child.pid, "SIGKILL"), KILL_GRACE_MS);
			if (typeof forceTimer.unref === "function") forceTimer.unref();
		}, timeoutMs);
		child.stdout.on("data", (b) => out.push(Buffer.from(b)));
		child.stderr.on("data", (b) => err.push(Buffer.from(b)));
		child.on("error", (e) => settle({ exitCode: -1, timedOut, stdout: "", stderr: e.message }));
		child.on("close", (code) =>
			settle({
				exitCode: timedOut ? -1 : (code ?? -1),
				timedOut,
				stdout: Buffer.concat(out).toString(),
				stderr: Buffer.concat(err).toString(),
			}),
		);
	});
}

/**
 * Gate, execute, and record one verification command. Both the CLI
 * (`session verify --execute`) and the web console reach this function; neither
 * owns a second copy of the policy verdict, the spawn, or the ledger shape.
 *
 * A denial returns `executed: false` and writes a `verification_denied` record
 * (`executesAnything: false`); an execution writes `verification_passed` or
 * `verification_failed` with the real exit code.
 */
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
	let minutes = null;
	let exec;
	try {
		minutes = resolveExecutableBudgetMinutes(budgetMinutes);
		const argv = toSpawnArgv(parseGovernedArgv(command));
		const res = await spawnAndCapture(argv, targetRoot, minutes * 60_000);
		exec = {
			command,
			exitCode: res.exitCode,
			timedOut: res.timedOut,
			stdoutTail: res.stdout.slice(-STDOUT_CAP),
			stderrTail: res.stderr.slice(-STDERR_CAP),
		};
	} catch (e) {
		exec = {
			command,
			exitCode: -1,
			timedOut: false,
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
		timedOut: exec.timedOut,
		budgetMinutes: minutes,
		stdoutTail: exec.stdoutTail,
		stderrTail: exec.stderrTail,
		durationMs,
		ledgerRecord: record,
	};
}

module.exports = { runEvidenceCommand, resolveBudgetMinutes };
