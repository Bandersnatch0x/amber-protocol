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
const {
	appendLedgerRecord,
	latestUnconsumedApproval,
	readLedger,
	verifyLedgerOutcome,
} = require("./loop-ledger");
const {
	eligibilityProblem,
	packAllowRuleProblem,
	runGovernedCommand,
} = require("./governed-runner");
const { loadPolicyRules } = require("./loop-policy");
const { policyHashOf, scopeHashOf } = require("./run-freeze");
const { codedError } = require("./error-catalog");
const { statePathForCreate } = require("../state-dir-resolver");

// Loop execution ledgers (post-rename state kind, 2026-06-30): they never
// existed under .harness, so reads and creates both target the canonical dir
// (see the note in organization-audit.js).
const CONTRACT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function assertContractId(contractId) {
	if (typeof contractId === "string" && CONTRACT_ID.test(contractId)) return;
	throw new Error(
		codedError(
			"AMBER_E_LOOP_CONTRACT_ID_INVALID",
			`loop contract id ${JSON.stringify(contractId)} must match ${CONTRACT_ID.source}`,
		),
	);
}

function ledgerPath(targetRoot, contractId) {
	assertContractId(contractId);
	return statePathForCreate(resolveTarget(targetRoot), "loops", contractId, "ledger.jsonl");
}

function loadContract(file, contractId) {
	const { value: data, error } = readJsonSafe(path.resolve(file));
	if (error) throw new Error(error);
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		throw new Error(`Workflow pack file is not a valid object: ${file}`);
	}
	const contract = findLoopContract(data, contractId);
	assertContractId(contract.id);
	const packProblem = packAllowRuleProblem(contract.governed?.rules);
	if (packProblem) throw new Error(packProblem);
	return contract;
}

// §6.4 loop-surface identity binding: approve records this tuple and run
// recomputes it, so an approval authorizes only the command, pack rules, and
// policy it saw. No separate loopRunId exists — contractId + the consumed
// approvalKey remain the loop execution identity.
function approvalBindingOf(targetRoot, contractId, contract) {
	const rules = loadPolicyRules(targetRoot);
	const command = contract.governed?.command ?? null;
	return {
		scopeHash: scopeHashOf({
			capabilities: [`loop:${contractId}`],
			targets: [command ?? contractId],
			constraints: null,
			context_scope: null,
			side_effect_policy: {
				defaultAction: rules?.defaultAction ?? "deny",
				capabilityEffects: ["execute"],
			},
			expiration: null,
		}),
		policyHash: policyHashOf(rules),
		capabilityHash: policyHashOf({ command, rules: contract.governed?.rules ?? null }),
	};
}

function approveLoopContract({ file, contract: contractId, target, reviewer }) {
	const targetRoot = resolveTarget(target);
	const approvalKey = crypto.randomUUID();
	let record;
	try {
		const contract = loadContract(file, contractId);
		const binding = approvalBindingOf(targetRoot, contractId, contract);
		record = appendLedgerRecord(ledgerPath(targetRoot, contractId), {
			schemaVersion: 2,
			kind: "approved",
			approvalState: "approved",
			contractId,
			approvalKey,
			reviewer: reviewer || "unknown",
			scopeHash: binding.scopeHash,
			policyVersion: binding.policyHash,
			capabilityHash: binding.capabilityHash,
			recordedAt: new Date().toISOString(),
			executesAnything: false,
		});
	} catch (e) {
		return { target: targetRoot, errors: [e.message], warnings: [] };
	}
	return {
		target: targetRoot,
		approvalKey,
		record,
		text: `Approved ${contractId} (approvalKey ${approvalKey}). Now run: amber loop run --file <pack> --contract ${contractId} --execute`,
		errors: [],
		warnings: [],
	};
}

function dryRunWithDriftCheck(targetRoot, { file, contract: contractId, dryRun, output }) {
	const preview = dryRunLoopContract({
		file,
		contract: contractId,
		dryRun: dryRun !== false,
		output,
	});
	if (preview.errors.length > 0) return preview;
	let contract;
	try {
		contract = loadContract(file, contractId);
	} catch (e) {
		return { ...preview, errors: [e.message] };
	}
	const approval = latestUnconsumedApproval(readLedger(ledgerPath(targetRoot, contractId)));
	const drift =
		approval && eligibilityProblem(approval, approvalBindingOf(targetRoot, contractId, contract));
	if (!drift) return preview;
	return {
		...preview,
		warnings: [...preview.warnings, codedError("AMBER_E_LOOP_CONTRACT_DRIFT", drift.reason)],
	};
}

async function executeLoopContract({
	file,
	contract: contractId,
	target,
	execute,
	dryRun,
	output,
}) {
	const targetRoot = resolveTarget(target);

	if (!execute) {
		return dryRunWithDriftCheck(targetRoot, { file, contract: contractId, dryRun, output });
	}

	let contract;
	try {
		contract = loadContract(file, contractId);
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
	const outcome = await runGovernedCommand({
		target: targetRoot,
		command,
		ledgerPath: lp,
		budgetMinutes,
		subject: { contractId },
		label: contractId,
		contextRules: contract.governed.rules,
		approvalBinding: approvalBindingOf(targetRoot, contractId, contract),
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
	let o;
	try {
		o = verifyLedgerOutcome(ledgerPath(targetRoot, contractId));
	} catch (e) {
		return { target: targetRoot, errors: [e.message], warnings: [] };
	}
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
