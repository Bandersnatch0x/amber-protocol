"use strict";

// Reusable four-gate governed command runner. Loops (via loop-execution.js) and
// route command-stages (via route-commands.js) both call this, so the governance
// gates — policy, approval, worktree isolation, tamper-evident ledger — are one
// primitive, not duplicated per consumer.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { resolveTarget } = require("./fs-utils");
const { evaluateGovernedPolicy, loadPolicyRules } = require("./loop-policy");
const {
	appendLedgerRecord,
	readLedger,
	verifyLedgerChain,
	latestUnconsumedApproval,
	latestUnconsumedApprovalFor,
} = require("./loop-ledger");
const { codedError } = require("./error-catalog");
const { recordEvidence } = require("./evidence-receipts");
const { resolveRequestCapability } = require("./runner-registry");
const {
	capabilityHashOf,
	inputDigestOf,
	parseCapabilityPin,
	policyHashOf,
} = require("./run-freeze");

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

// ── trusted-control run contract: pre-effect gate verification (Slice 3) ────
// R-AD-3: gates verify BEFORE any effect. The frozen binding (from the
// attempt's captured admission record) is checked in order — request digest,
// policy hash, capability hash — then the real policy evaluation runs, then
// authorization-consumption eligibility (R-AU-3). Any mismatch appends a
// `denied` record with the explicit refusal token and stops: nothing executes,
// the approval is left unconsumed. Drift is refused at the gate, never merely
// noticed in a later fold.

/**
 * Recompute the current registry hash for the pinned capability and compare it
 * with the frozen capabilityHash (R-AD-3 check 3). A registry change to any
 * pinned field is capability drift.
 */
function capabilityDriftProblem(targetRoot, frozen) {
	const parts = parseCapabilityPin(frozen.attemptIdentity.capabilityPin);
	if (!parts) {
		return "the attempt's capability pin does not match the closed F052 grammar";
	}
	let resolution;
	try {
		resolution = resolveRequestCapability(targetRoot, parts);
	} catch (err) {
		return `the capability registry could not be resolved at the gate: ${err.message || String(err)}`;
	}
	if (!resolution.ok) {
		return `the pinned capability no longer resolves from the registry: ${(resolution.errors || [])[0] || "unknown"}`;
	}
	if (capabilityHashOf([resolution.capability]) !== frozen.capabilityHash) {
		return "the registry's capability record no longer hashes to the attempt's frozen capabilityHash";
	}
	return null;
}

/**
 * R-AD-3 checks 1–3, in spec order, each refusing with an explicit token.
 * `globalRules` is the SAME loaded rules object the policy evaluation will
 * use — the check never verifies a different read of the file than the gate
 * evaluates.
 * @returns {{refusal: string, reason: string}|null}
 */
function frozenAdmissionProblem(targetRoot, frozen, resolvedCommand, globalRules) {
	// (1) request binding: the request about to execute hashes to the frozen
	// inputDigest — the executed request is the frozen request, never a
	// re-derived or caller-substituted one (R-FR-0).
	const liveDigest = inputDigestOf({
		resolvedCommand: resolvedCommand ?? null,
		argv: resolvedCommand === null || resolvedCommand === undefined ? null : [],
		capabilityPin: frozen.attemptIdentity.capabilityPin,
		routeHash: frozen.attemptIdentity.routeHash,
		stageName: frozen.attemptIdentity.stageName,
		attemptNumber: frozen.attemptIdentity.attemptNumber,
		fence: frozen.attemptIdentity.fence,
	});
	if (liveDigest !== frozen.inputDigest) {
		return {
			refusal: "request-drift",
			reason:
				"the resolved request does not hash to the attempt's frozen inputDigest; the executed request must be the frozen request (R-AD-3.1)",
		};
	}
	// (2) policy binding: the gate-loaded rules hash to the frozen policyHash.
	if (frozen.policyHash !== undefined && frozen.policyHash !== null) {
		const liveRules = globalRules ?? loadPolicyRules(targetRoot, { required: true });
		if (policyHashOf(liveRules) !== frozen.policyHash) {
			return {
				refusal: "policy-drift",
				reason:
					"the gate-loaded rules do not hash to the attempt's frozen policyHash; policy drift is refused before evaluation (R-AD-3.2)",
			};
		}
	}
	// (3) capability binding: the current registry's pinned capability records
	// hash to the frozen capabilityHash (F052 fail-closed drift refusal).
	if (frozen.capabilityHash !== undefined && frozen.capabilityHash !== null) {
		const drift = capabilityDriftProblem(targetRoot, frozen);
		if (drift) return { refusal: "capability-drift", reason: drift };
	}
	// (3b) R-CA-3: a hard context expiry in the past at the consumption
	// instant refuses — expiry is a boundary, not a warning.
	if (typeof frozen.contextExpiresAt === "string") {
		const expiry = Date.parse(frozen.contextExpiresAt);
		if (Number.isNaN(expiry) || Date.now() >= expiry) {
			return {
				refusal: "context-expired",
				reason: `the attempt's context authority expired at ${frozen.contextExpiresAt} (R-CA-3)`,
			};
		}
	}
	return null;
}

/**
 * R-AU-3: consumption eligibility in order, each refusal explicit. Single-use
 * (check 1) holds by construction — the candidate grant came from
 * `latestUnconsumedApproval`, which only returns unconsumed grants. Binding
 * fields a legacy grant never carried are recorded absences: the dimension is
 * not checkable and is skipped, never fabricated (compat boundary, spec §8).
 *
 * @returns {{refusal: string, reason: string}|null}
 */
function eligibilityProblem(approval, frozen, attemptId) {
	if (
		approval.scopeHash !== undefined &&
		approval.scopeHash !== null &&
		approval.scopeHash !== frozen.scopeHash
	) {
		return {
			refusal: "scope-drift",
			reason: "the grant's scopeHash differs from the attempt's frozen scopeHash (R-AU-3.2)",
		};
	}
	if (
		approval.policyVersion !== undefined &&
		approval.policyVersion !== null &&
		approval.policyVersion !== frozen.policyHash
	) {
		return {
			refusal: "policy-drift",
			reason: "the grant's policyVersion differs from the attempt's frozen policyHash (R-AU-3.3)",
		};
	}
	if (
		approval.capabilityHash !== undefined &&
		approval.capabilityHash !== null &&
		approval.capabilityHash !== frozen.capabilityHash
	) {
		return {
			refusal: "capability-drift",
			reason:
				"the grant's capabilityHash differs from the attempt's frozen capabilityHash (R-AU-3.4)",
		};
	}
	if (
		approval.boundAttemptId !== undefined &&
		approval.boundAttemptId !== null &&
		approval.boundAttemptId !== attemptId
	) {
		return {
			refusal: "attempt-identity-mismatch",
			reason:
				"the grant is bound to a different attemptId; two attempts with identical hashes never silently share an attempt-bound grant (R-AU-3.5)",
		};
	}
	return null;
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
	{ globalRules: suppliedGlobalRules, commandId, v2Subject } = {},
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
	const verdict = evaluateGovernedPolicy(command, ruleset, v2Subject ?? null);
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

// §5.5 row 11 split (governance contract G-9): the FOUR GATES (policy,
// approval, ledger, frozen-admission verification) are Core; the worktree +
// spawnSync EXECUTION semantics are Adapter-injected (the Coding domain's
// ExecutionBoundary in execution-domain-adapter.js). Core never imports
// worktree-manager or child_process at module load (guard G1/G8) — the
// adapter is lazily required at the boundary and injectable for tests.
let executionBoundaryAdapter = null;
function defaultExecutionAdapter() {
	if (executionBoundaryAdapter === null) {
		executionBoundaryAdapter = require("./execution-domain-adapter");
	}
	return executionBoundaryAdapter;
}

/**
 * Test/adapter seam: inject the ExecutionBoundary adapter. Pass null to
 * restore the default lazy Coding-domain adapter.
 */
function setExecutionAdapter(adapter) {
	executionBoundaryAdapter = adapter;
}

function executeInWorktree(
	targetRoot,
	command,
	label,
	budgetMinutes,
	{ captureDigest = false } = {},
) {
	return defaultExecutionAdapter().executeInWorktree(targetRoot, command, label, budgetMinutes, {
		captureDigest,
	});
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
		subject:
			subject.evidenceSubject ||
			subject.subject ||
			`command/${subject.commandId || execution.command}`,
		inputs: [subject.commandId || execution.command],
		tools: ["governed-runner"],
		environment: {
			terminalStatus: execution.terminalStatus,
			requestId: subject.requestId || "none",
			attemptId: subject.attemptId || "none",
			// Run-contract join keys (plan Slice 4, spec R-RP-3): a receipt that
			// cannot join to an admission record by (runId, scopeHash) scores an
			// evidence-completeness gap downstream instead of a silent pass.
			runId: subject.runId || "none",
			scopeHash: subject.scopeHash || "none",
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
	frozen,
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

	// R-AD-3 checks 1–3 (frozen admission binding) run BEFORE policy
	// evaluation, execution, or consumption: a mismatch appends its explicit
	// denial and stops with the approval left unconsumed. The check verifies
	// the same rules object the evaluation will use.
	if (frozen) {
		const admission = frozenAdmissionProblem(targetRoot, frozen, resolvedCommand, globalRules);
		if (admission) {
			appendLedgerRecord(lp, {
				schemaVersion: 2,
				kind: "denied",
				gate: "frozen-admission",
				refusal: admission.refusal,
				...(namedCommand ? { commandId } : {}),
				reason: admission.reason,
				recordedAt: new Date().toISOString(),
				executesAnything: false,
				...subject,
			});
			return {
				target: targetRoot,
				...resultMetadata,
				refusal: admission.refusal,
				errors: [codedError("AMBER_E_POLICY_DENY", admission.reason)],
				warnings: [],
			};
		}
	}

	// §6.2/C0 §3.3: the v2 subject feeds the classification-ceiling face — the
	// capability NAME (the policy-rule vocabulary) and the attempt's own
	// declared context ceiling (R-AU-1). Null classification is the honest
	// absence (R-CA-4) and never satisfies a ceiling rule (fail-closed).
	let v2Subject = null;
	if (frozen) {
		const pinParts = parseCapabilityPin(frozen.attemptIdentity.capabilityPin);
		v2Subject = {
			capability: pinParts ? pinParts.name : frozen.attemptIdentity.capabilityPin,
			contextClassification: frozen.contextClassification ?? null,
		};
	}

	const policyResult = evaluateExecutionPolicy(
		targetRoot,
		lp,
		resolvedCommand,
		executionSubject,
		contextRules,
		{ globalRules, ...(namedCommand ? { commandId } : {}), v2Subject },
	);
	if (policyResult && policyResult.errors.length > 0) return policyResult;
	const matchedRule = namedCommand ? policyResult.matchedRule : undefined;
	// §6.5 `policy.evaluated`: the decision's own ledger event — the PDP
	// verdict recorded as an assertive-redundancy fact whose policyHash equals
	// the attempt's frozen value by construction (R-AD-4); a mismatch would
	// itself be a tamper signal. Appended through the existing record pattern;
	// no new ledger family (0045).
	if (frozen && frozen.policyHash !== undefined && frozen.policyHash !== null) {
		const policyNow = globalRules ?? loadPolicyRules(targetRoot, { required: true });
		const { policyHashOf } = require("./run-freeze");
		const evaluatedHash = policyHashOf(policyNow);
		appendLedgerRecord(lp, {
			kind: "policy.evaluated",
			schemaVersion: 2,
			at: new Date().toISOString(),
			decision: policyResult && policyResult.allowed ? "allow" : "deny",
			matchedRule: matchedRule ?? null,
			reason:
				(policyResult && policyResult.verdict?.reason) || "evaluated against the frozen policy",
			policyHash: evaluatedHash,
			scopeHash: frozen.scopeHash ?? null,
			confidence: policyResult?.verdict?.confidence ?? null,
			executesAnything: false,
			...executionSubject,
		});
	}
	// Grant selection (R-AD-6 mutual binding): a frozen attempt consumes the
	// grant bound to IT (or an explicitly unbound legacy grant) — never a
	// foreign attempt's orphaned grant, which by construction can never be
	// consumed by its own attempt again. R-AU-3's explicit refusals then
	// evaluate against the selected grant.
	const ledgerRecords = readLedger(lp);
	const approval = frozen
		? latestUnconsumedApprovalFor(
				ledgerRecords,
				(grant) =>
					grant.boundAttemptId === undefined ||
					grant.boundAttemptId === null ||
					grant.boundAttemptId === executionSubject.attemptId,
			)
		: latestUnconsumedApproval(ledgerRecords);
	if (!approval) {
		return {
			target: targetRoot,
			...(namedCommand ? { commandId, matchedRule } : {}),
			errors: [codedError("AMBER_E_LOOP_NOT_APPROVED", `No unconsumed approval for ${label}`)],
			warnings: [],
		};
	}

	// R-AU-3: authorization-consumption eligibility, in order, before any
	// effect. A refusal here leaves the grant unconsumed and terminates the
	// attempt at the gate (drift is never noticed only in a later fold).
	if (frozen) {
		const eligibility = eligibilityProblem(approval, frozen, executionSubject.attemptId);
		if (eligibility) {
			appendLedgerRecord(lp, {
				schemaVersion: 2,
				kind: "denied",
				gate: "approval-eligibility",
				refusal: eligibility.refusal,
				approvalKey: approval.approvalKey,
				...(namedCommand ? { commandId } : {}),
				reason: eligibility.reason,
				recordedAt: new Date().toISOString(),
				executesAnything: false,
				...subject,
			});
			return {
				target: targetRoot,
				...resultMetadata,
				refusal: eligibility.refusal,
				errors: [codedError("AMBER_E_POLICY_DENY", eligibility.reason)],
				warnings: [],
			};
		}
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
	// §7.4 budget exhaustion: a timed-out run (the duration budget exhausted)
	// appends the durable `budget.exhausted` ledger event with the observed
	// values — never silently settled as a plain failure.
	if (execution.result?.timedOut === true) {
		appendLedgerRecord(lp, {
			kind: "budget.exhausted",
			schemaVersion: 2,
			at: new Date().toISOString(),
			dimension: "maxMinutes",
			limit: budgetMinutes,
			observed: budgetMinutes,
			executesAnything: false,
			...executionSubject,
		});
	}
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
	eligibilityProblem,
	setExecutionAdapter,
};
