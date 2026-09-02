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
const { recordEvidence } = require("./evidence-receipts");

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

/**
 * Resolve a closed named command from the human-reviewed policy surface.
 *
 * `commandId` is deliberately not a second command registry. It is the id of
 * one rule in rules.json, and only an exact allow rule can be named. In
 * particular, prefix/regex rules are not accepted here: allowing a caller to
 * select a fuzzy rule would reintroduce an unbounded command suffix.
 *
 * @param {string} commandId
 * @param {{rules?: Array<object>}|null} rules - Parsed rules.json.
 * @returns {{ok: true, commandId: string, command: string, matchedRule: string, rule: object}|{ok: false, commandId: unknown, matchedRule: string|null, reason: string}}
 */
function resolveCommandId(commandId, rules) {
	const requested = commandId;
	if (typeof commandId !== "string" || commandId.trim().length === 0) {
		return {
			ok: false,
			commandId: requested,
			matchedRule: null,
			reason: `commandId must be a non-empty policy rule id; got ${JSON.stringify(commandId)}`,
		};
	}

	const candidates = (Array.isArray(rules?.rules) ? rules.rules : []).filter(
		(rule) => rule && typeof rule === "object" && !Array.isArray(rule) && rule.id === commandId,
	);
	if (candidates.length === 0) {
		return {
			ok: false,
			commandId,
			matchedRule: null,
			reason: `commandId ${JSON.stringify(commandId)} does not resolve to a rule in .amber/governance/rules.json`,
		};
	}
	if (candidates.length > 1) {
		return {
			ok: false,
			commandId,
			matchedRule: commandId,
			reason: `commandId ${JSON.stringify(commandId)} resolves to multiple policy rules; rule ids must be unique`,
		};
	}

	const [rule] = candidates;
	if (rule.action !== "allow") {
		return {
			ok: false,
			commandId,
			matchedRule: commandId,
			reason: `commandId ${JSON.stringify(commandId)} resolves to a rule whose action is ${JSON.stringify(rule.action)}; named commands require action "allow"`,
		};
	}
	if (rule.match !== "exact") {
		return {
			ok: false,
			commandId,
			matchedRule: commandId,
			reason: `commandId ${JSON.stringify(commandId)} resolves to an allow rule with match ${JSON.stringify(rule.match)}; named commands require match "exact"`,
		};
	}
	if (typeof rule.pattern !== "string" || rule.pattern.length === 0) {
		return {
			ok: false,
			commandId,
			matchedRule: commandId,
			reason: `commandId ${JSON.stringify(commandId)} resolves to an exact allow rule with no non-empty pattern`,
		};
	}

	return { ok: true, commandId, command: rule.pattern, matchedRule: rule.id, rule };
}

function policyDenial(targetRoot, ledgerPath, command, reason, subject, metadata = {}) {
	const record = {
		schemaVersion: 2,
		kind: "denied",
		command,
		reason,
		recordedAt: new Date().toISOString(),
		executesAnything: false,
		...subject,
		...metadata,
	};
	if (record.command === undefined) delete record.command;
	appendLedgerRecord(ledgerPath, record);
	return {
		target: targetRoot,
		...metadata,
		errors: [codedError("AMBER_E_POLICY_DENY", reason)],
		warnings: [],
	};
}

function confidenceDenial(targetRoot, ledgerPath, command, verdict, subject, metadata = {}) {
	const reason =
		verdict.confidence === "medium"
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
		...metadata,
	});
	return {
		target: targetRoot,
		...metadata,
		errors: [codedError("AMBER_E_CONFIDENCE_GATE", reason)],
		warnings: [],
	};
}

function evaluateExecutionPolicy(
	targetRoot,
	ledgerPath,
	command,
	subject,
	contextRules,
	{ globalRules: suppliedGlobalRules, commandId } = {},
) {
	const globalRules = suppliedGlobalRules || loadPolicyRules(targetRoot, { required: true });
	const namedCommand = commandId !== undefined;
	const metadata = namedCommand ? { commandId } : {};
	if (!globalRules) {
		return policyDenial(
			targetRoot,
			ledgerPath,
			command,
			"governance rules.json is missing or invalid; governed execution requires an explicit policy",
			subject,
			metadata,
		);
	}
	const ruleset = mergeRules(globalRules, contextRules);
	const verdict = evaluateGovernedPolicy(command, ruleset);
	if (!verdict.allowed)
		return policyDenial(
			targetRoot,
			ledgerPath,
			command,
			verdict.reason,
			subject,
			namedCommand ? { ...metadata, matchedRule: verdict.matchedRule } : {},
		);
	if (verdict.confidence !== "high") {
		const governedVerdict = {
			...verdict,
			confidence: verdict.confidence === "medium" ? "medium" : "low",
		};
		return confidenceDenial(
			targetRoot,
			ledgerPath,
			command,
			governedVerdict,
			subject,
			namedCommand ? { ...metadata, matchedRule: verdict.matchedRule } : {},
		);
	}
	return namedCommand
		? {
			target: targetRoot,
			...metadata,
			matchedRule: verdict.matchedRule,
			verdict,
			errors: [],
			warnings: [],
		}
		: null;
}

function canonicalOutputDigest({
	stdout,
	stderr,
	exitCode,
	signal,
	timedOut,
	startedAt,
	finishedAt,
	terminalStatus,
	capabilityPin = null,
	requestId = null,
	attemptId = null,
}) {
	const sortKeys = (value) => {
		if (Array.isArray(value)) return value.map(sortKeys);
		if (value && typeof value === "object") {
			return Object.keys(value)
				.sort()
				.reduce((out, key) => {
					out[key] = sortKeys(value[key]);
					return out;
				}, {});
		}
		return value;
	};
	const toBuffer = (value) => (Buffer.isBuffer(value) ? value : Buffer.from(value || "", "utf8"));
	const stdoutBytes = toBuffer(stdout);
	const stderrBytes = toBuffer(stderr);
	const envelope = {
		stdout: stdoutBytes.toString("base64"),
		stderr: stderrBytes.toString("base64"),
		stdoutLength: stdoutBytes.length,
		stderrLength: stderrBytes.length,
		exitCode: Number.isInteger(exitCode) ? exitCode : null,
		signal: signal || null,
		timedOut: timedOut === true,
		startedAt: new Date(startedAt).toISOString(),
		finishedAt: new Date(finishedAt).toISOString(),
		terminalStatus,
		capabilityPin: capabilityPin || null,
		requestId: requestId || null,
		attemptId: attemptId || null,
	};
	const canonical = JSON.stringify(sortKeys(envelope));
	return {
		digest: `sha256:${crypto.createHash("sha256").update(canonical, "utf8").digest("hex")}`,
		envelope,
		stdoutBytes,
		stderrBytes,
	};
}

function executeInWorktree(targetRoot, command, label, budgetMinutes, { captureDigest = false } = {}) {
	const safeLabel = String(label).replace(/[^A-Za-z0-9._-]/g, "-");
	const runId = `glx-${safeLabel}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
	const worktree = createWorktree(targetRoot, runId);
	if (!worktree.success) return { error: `Failed to create isolated worktree: ${worktree.error}` };
	let result;
	const startedAt = new Date().toISOString();
	try {
		const spawned = spawnSync(command, {
			shell: true,
			cwd: worktree.path,
			// The legacy command seam intentionally keeps its historical UTF-8
			// envelope.  Only the named-command/F062 seam needs raw bytes for the
			// complete output digest.
			encoding: captureDigest ? "buffer" : "utf8",
			timeout: budgetMinutes * 60_000,
		});
		if (!captureDigest) {
			result = {
				command,
				exitCode: spawned.status === null ? -1 : spawned.status,
				stdout: (spawned.stdout || "").slice(-4000),
				stderr: (spawned.stderr || "").slice(-2000),
			};
			return { result };
		}
		const stdout = Buffer.isBuffer(spawned.stdout)
			? spawned.stdout
			: Buffer.from(spawned.stdout || "", "utf8");
		const stderr = Buffer.isBuffer(spawned.stderr)
			? spawned.stderr
			: Buffer.from(spawned.stderr || "", "utf8");
		const timedOut = spawned.error?.code === "ETIMEDOUT";
		const exitCode = spawned.status === null ? -1 : spawned.status;
		const signal = spawned.signal || null;
		const finishedAt = new Date().toISOString();
		result = {
			command,
			exitCode,
			signal,
			timedOut,
			startedAt,
			finishedAt,
			terminalStatus: timedOut ? "timed_out" : exitCode === 0 ? "succeeded" : "failed",
			stdout,
			stderr,
		};
	} catch (error) {
		const finishedAt = new Date().toISOString();
		result = {
			command,
			exitCode: -1,
			...(captureDigest
				? {
					signal: error.signal || null,
					timedOut: error.code === "ETIMEDOUT",
					startedAt,
					finishedAt,
					terminalStatus: error.code === "ETIMEDOUT" ? "timed_out" : "failed",
					stdout: Buffer.alloc(0),
					stderr: Buffer.from(String(error.message || error), "utf8"),
				}
				: { stdout: "", stderr: String(error.message || error).slice(-2000) }),
		};
	} finally {
		removeWorktree(targetRoot, runId);
	}
	return { result };
}

function attachExecutionDigest(execution, subject = {}) {
	const digest = canonicalOutputDigest({
		stdout: execution.stdout,
		stderr: execution.stderr,
		exitCode: execution.exitCode,
		signal: execution.signal,
		timedOut: execution.timedOut,
		startedAt: execution.startedAt,
		finishedAt: execution.finishedAt,
		terminalStatus: execution.terminalStatus,
		capabilityPin: subject.capabilityPin,
		requestId: subject.requestId,
		attemptId: subject.attemptId,
	});
	return {
		...execution,
		outputDigest: digest.digest,
		stdoutTail: digest.stdoutBytes.toString("utf8").slice(-4000),
		stderrTail: digest.stderrBytes.toString("utf8").slice(-2000),
		_outputEnvelope: digest.envelope,
	};
}

function recordExecutionEvidence(targetRoot, execution, subject = {}) {
	const producer = subject.producer || subject.producerId || subject.evidenceProducer;
	if (typeof producer !== "string" || producer.trim().length === 0) {
		return { receipt: null, error: null };
	}
	const evidenceId =
		subject.evidenceId ||
		`evidence/${subject.sessionId || "governed"}/${subject.attemptId || crypto.randomUUID()}`;
	const evidence = recordEvidence(targetRoot, {
		id: evidenceId,
		producer,
		assurance: "replayable",
		scope: subject.sessionId || null,
		subject: subject.evidenceSubject || subject.subject || `command/${subject.commandId || execution.command}`,
		inputs: [subject.commandId || execution.command],
		tools: ["governed-runner"],
		environment: {
			terminalStatus: execution.terminalStatus,
			requestId: subject.requestId || "none",
			attemptId: subject.attemptId || "none",
		},
		outputs: [`stdout:${execution.stdout.length} bytes`, `stderr:${execution.stderr.length} bytes`],
		outputDigest: execution.outputDigest,
		status: execution.exitCode === 0 ? "pass" : "fail",
		replayOf: `governed.named-command:${subject.commandId || execution.command}`,
	});
	if (!evidence.ok) return { receipt: null, error: evidence.errors.join("; ") };
	return { receipt: evidence.receipt, error: null };
}

function recordGovernedExecution(targetRoot, ledgerPath, approval, execution, subject) {
	const namedCommand = execution.commandId !== undefined;
	if (!namedCommand) {
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
	execution = attachExecutionDigest(execution, subject);
	const evidence = recordExecutionEvidence(targetRoot, execution, subject);
	const publicExecution = { ...execution };
	delete publicExecution.stdout;
	delete publicExecution.stderr;
	delete publicExecution._outputEnvelope;
	const record = appendLedgerRecord(ledgerPath, {
		schemaVersion: 2,
		kind: "executed",
		approvalState: "executed",
		consumedApprovalKey: approval.approvalKey,
		action: publicExecution,
		recordedAt: new Date().toISOString(),
		executesAnything: true,
		stopReason: execution.exitCode === 0 ? "completed" : "command-failed",
		...(execution.outputDigest === undefined ? {} : { outputDigest: execution.outputDigest }),
		...(evidence.receipt ? { evidenceId: evidence.receipt.id } : {}),
		...(evidence.error ? { evidenceError: evidence.error } : {}),
		...subject,
		...(execution.commandId === undefined
			? {}
			: { commandId: execution.commandId, matchedRule: execution.matchedRule ?? null }),
	});
	return {
		target: targetRoot,
		executed: true,
		exitCode: execution.exitCode,
		// The command is resolved from the named policy rule.  Returning this
		// read-only projection keeps the legacy result shape useful while the
		// caller can still prove the source rule through commandId/matchedRule.
		command: execution.command,
		...(execution.commandId === undefined
			? {}
			: { commandId: execution.commandId, matchedRule: execution.matchedRule ?? null }),
		ledgerRecord: record,
		...(execution.outputDigest === undefined ? {} : { outputDigest: execution.outputDigest }),
		...(evidence.receipt ? { evidence: evidence.receipt } : {}),
		...(evidence.error ? { evidenceError: evidence.error } : {}),
		stdoutTail: publicExecution.stdoutTail,
		stderrTail: publicExecution.stderrTail,
		errors: execution.exitCode === 0 ? [] : [`Command exited ${execution.exitCode}`],
		warnings: [],
	};
}

function runGovernedCommand({
	target,
	command,
	commandId,
	producer,
	evidenceId,
	capabilityPin,
	requestId,
	attemptId,
	ledgerPath: lp,
	budgetMinutes = 5,
	subject = {},
	label = "command",
	contextRules,
}) {
	const targetRoot = resolveTarget(target);
	const executionSubject = {
		...subject,
		...(producer === undefined ? {} : { producer }),
		...(evidenceId === undefined ? {} : { evidenceId }),
		...(capabilityPin === undefined ? {} : { capabilityPin }),
		...(requestId === undefined ? {} : { requestId }),
		...(attemptId === undefined ? {} : { attemptId }),
	};
	const namedCommand = commandId !== undefined;
	const resultMetadata = namedCommand ? { commandId, matchedRule: null } : {};
	const chain = verifyLedgerChain(lp);
	if (!chain.intact) {
		const reason = `Ledger chain is broken at record ${chain.brokenAt}: ${chain.reason}`;
		return {
			target: targetRoot,
			...resultMetadata,
			errors: [codedError("AMBER_E_LEDGER_TAMPERED", reason)],
			warnings: [],
		};
	}

	// Named commands have a strict input boundary. Rejecting both fields is
	// intentional: a caller must never be able to smuggle text alongside an id
	// and rely on an implementation-specific precedence rule.
	if (namedCommand && command !== undefined) {
		const reason =
			"commandId and command are mutually exclusive; named execution never accepts caller-supplied command text";
		appendLedgerRecord(lp, {
			schemaVersion: 2,
			kind: "denied",
			commandId,
			matchedRule: null,
			reason,
			recordedAt: new Date().toISOString(),
			executesAnything: false,
			...subject,
		});
		return {
			target: targetRoot,
			...resultMetadata,
			errors: [codedError("AMBER_E_COMMAND_ID_UNRESOLVED", reason)],
			warnings: [],
		};
	}

	let resolvedCommand = command;
	let globalRules;
	if (namedCommand) {
		globalRules = loadPolicyRules(targetRoot, { required: true });
		const resolution = resolveCommandId(commandId, globalRules);
		if (!resolution.ok) {
			const reason = resolution.reason;
			appendLedgerRecord(lp, {
				schemaVersion: 2,
				kind: "denied",
				commandId,
				matchedRule: resolution.matchedRule,
				reason,
				recordedAt: new Date().toISOString(),
				executesAnything: false,
				...subject,
			});
			return {
				target: targetRoot,
				commandId,
				matchedRule: resolution.matchedRule,
				errors: [codedError("AMBER_E_COMMAND_ID_UNRESOLVED", reason)],
				warnings: [],
			};
		}
		resolvedCommand = resolution.command;
	}

	const policyResult = evaluateExecutionPolicy(
		targetRoot,
		lp,
		resolvedCommand,
		executionSubject,
		contextRules,
		{ globalRules, ...(namedCommand ? { commandId } : {}) },
	);
	if (policyResult && policyResult.errors.length > 0) return policyResult;
	const matchedRule = namedCommand ? policyResult.matchedRule : undefined;
	const approval = latestUnconsumedApproval(readLedger(lp));
	if (!approval) {
		return {
			target: targetRoot,
			...(namedCommand ? { commandId, matchedRule } : {}),
			errors: [codedError("AMBER_E_LOOP_NOT_APPROVED", `No unconsumed approval for ${label}`)],
			warnings: [],
		};
	}

	if (!fs.existsSync(path.join(targetRoot, ".git"))) {
		return {
			target: targetRoot,
			...(namedCommand ? { commandId, matchedRule } : {}),
			errors: [codedError("AMBER_E_MISSING_PATH_ARG", "not a git repository")],
			warnings: [],
		};
	}
	const execution = executeInWorktree(targetRoot, resolvedCommand, label, budgetMinutes, {
		captureDigest: namedCommand,
	});
	if (execution.error)
		return {
			target: targetRoot,
			...(namedCommand ? { commandId, matchedRule } : {}),
			errors: [execution.error],
			warnings: [],
		};
	execution.result = {
		...execution.result,
		...(namedCommand ? { commandId, matchedRule } : {}),
	};
	return recordGovernedExecution(targetRoot, lp, approval, execution.result, executionSubject);
}

module.exports = {
	runGovernedCommand,
	mergeRules,
	resolveCommandId,
	canonicalOutputDigest,
	attachExecutionDigest,
};
