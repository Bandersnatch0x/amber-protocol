"use strict";

// Loop ↔ Run mapping adapter (F066; ADR-0101 decision 4, proposal §52 Rule 5).
//
// The ONE sanctioned bridge between the loop execution surface (ADR-0003) and
// the Harness chain: a governed one-shot execution maps to
// Task + Run + AdmissionReceipt + Events. The adapter is strictly a reader of
// the loop's own admission surfaces — the approval token and the executed
// outcome in the loop's tamper-evident ledger (`.amber/loops/<id>/ledger.jsonl`)
// — and never writes them. Every AdmissionReceipt check names the EXISTING
// governed artifact it witnessed; Harness re-derives nothing, owns no gate,
// and executes nothing.

const { latestUnconsumedApproval, readLedger } = require("../core/loop-ledger");
const { statePath } = require("../state-dir-resolver");
const { createRun, transitionRun, getRun } = require("./run-core");
const { emitHarnessEvent } = require("./event-ledger");

const CODE_LOOP_APPROVAL_MISSING = "AMBER_E_HARNESS_LOOP_APPROVAL_MISSING";
const CODE_LOOP_OUTCOME_MISSING = "AMBER_E_HARNESS_LOOP_OUTCOME_MISSING";

function typedError(code, message) {
	const err = new Error(message);
	err.amberCode = code;
	return err;
}

function readLoopLedgerRecords(targetRoot, loopContractId) {
	const file = statePath(targetRoot, "loops", loopContractId, "ledger.jsonl");
	const records = readLedger(file);
	return records.length > 0 || fsExists(file) ? records : null;
}

function fsExists(file) {
	const fs = require("node:fs");
	return fs.existsSync(file);
}

function latestExecutedRecord(records) {
	for (let index = records.length - 1; index >= 0; index -= 1) {
		const record = records[index];
		if (record && record.kind === "executed") return { record, lineIndex: index + 1 };
	}
	return null;
}

function exitCodeOfExecuted(record) {
	const fromAction =
		record.action && Number.isInteger(record.action.exitCode) ? record.action.exitCode : null;
	if (fromAction !== null) return fromAction;
	return record.stopReason === "completed" ? 0 : 1;
}

/**
 * Start a Run bound to a loop's unconsumed approval, admitting it with the
 * six checks resolved from the loop's real admission surfaces. Fails closed
 * when the loop ledger has no unconsumed approval (AMBER_E_HARNESS_LOOP_
 * APPROVAL_MISSING) or the harness contract is missing/corrupt.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.contractId - The admitted Harness Contract id.
 * @param {string} opts.loopContractId - The loop contract id (`--from-loop`).
 * @param {string} [opts.packFile] - The workflow-pack file declaring the loop.
 * @param {string} [opts.runId] @param {string} [opts.agent] @param {string} [opts.now]
 */
function startRunFromLoop(
	targetRoot,
	{ contractId, loopContractId, packFile, runId, agent, now } = {},
) {
	if (!loopContractId || typeof loopContractId !== "string") {
		throw typedError(
			CODE_LOOP_APPROVAL_MISSING,
			"--from-loop <loopContractId> is required to bind a run to a loop execution",
		);
	}
	const records = readLoopLedgerRecords(targetRoot, loopContractId);
	if (records === null) {
		throw typedError(
			CODE_LOOP_APPROVAL_MISSING,
			`no loop ledger for ${JSON.stringify(loopContractId)}; admission witnesses real approvals, not claims`,
		);
	}
	const approval = latestUnconsumedApproval(records);
	if (!approval) {
		throw typedError(
			CODE_LOOP_APPROVAL_MISSING,
			`loop ${JSON.stringify(loopContractId)} has no unconsumed approval; run "amber loop approve" first — admission witnesses real approvals, not claims`,
		);
	}
	const ledgerPointer = `loops/${loopContractId}/ledger.jsonl`;
	const checks = {
		identity: {
			result: "pass",
			pointer: `subject:loop/${loopContractId}#approval:${approval.approvalKey}`,
		},
		contract: {
			result: "pass",
			pointer: `harness/contracts/${contractId}.json`,
		},
		policy: {
			result: "pass",
			pointer: `${ledgerPointer}#policyVersion:${approval.policyVersion}`,
		},
		context: {
			result: "pass",
			pointer: packFile
				? `${packFile}#contract:${loopContractId}`
				: `loop:${loopContractId}/context`,
		},
		execution: {
			result: "pass",
			pointer: packFile
				? `${packFile}#governed.command`
				: `loop:${loopContractId}/governed-command`,
		},
		approval: {
			result: "pass",
			pointer: `${ledgerPointer}#approved:${approval.approvalKey}`,
		},
	};
	const created = createRun(targetRoot, {
		contractId,
		runId,
		subject: { agent: agent || "unspecified-agent", task: `loop/${loopContractId}` },
		now,
	});
	const admitted = transitionRun(targetRoot, {
		runId: created.run.id,
		to: "admitted",
		admission: checks,
		reason: `loop ${loopContractId} approval ${approval.approvalKey}`,
		now,
	});
	return { ok: true, run: admitted.run, checks };
}

/**
 * Bind one real loop outcome to an admitted/running run: the loop ledger's
 * latest `executed` record drives execution.started/completed/failed events
 * and the run's terminal transition. A failed execution leaves a failed run.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.runId
 * @param {string} opts.loopContractId
 * @param {string} [opts.now]
 */
function bindLoopOutcome(targetRoot, { runId, loopContractId, now } = {}) {
	const current = getRun(targetRoot, { runId });
	const records = readLoopLedgerRecords(targetRoot, loopContractId);
	const found = records === null ? null : latestExecutedRecord(records);
	if (!found) {
		throw typedError(
			CODE_LOOP_OUTCOME_MISSING,
			`loop ${JSON.stringify(loopContractId)} has no executed record to bind; outcomes come from the real governed execution, never from claims`,
		);
	}
	const { record, lineIndex } = found;
	const executedPointer = `loops/${loopContractId}/ledger.jsonl#executed:${lineIndex}`;
	const exitCode = exitCodeOfExecuted(record);
	const at = now || new Date().toISOString();
	const actor = current.run.subject ? current.run.subject.agent : undefined;

	// An admitted run passes through running so the execution window is
	// visible on the trail; a paused run simply resumes it.
	if (current.run.state === "admitted") {
		transitionRun(targetRoot, {
			runId,
			to: "running",
			reason: `loop ${loopContractId} execution started`,
			now,
		});
	}
	emitHarnessEvent(targetRoot, {
		kind: "execution.started",
		schemaVersion: 1,
		at,
		runId,
		...(actor ? { actor } : {}),
		pointers: [executedPointer],
	});
	emitHarnessEvent(targetRoot, {
		kind: "policy.evaluated",
		schemaVersion: 1,
		at,
		runId,
		decision: {
			result: "allow",
			...(current.run.harness && current.run.harness.policy
				? { policy: current.run.harness.policy }
				: {}),
		},
		pointers: [executedPointer],
	});
	const final = transitionRun(targetRoot, {
		runId,
		to: exitCode === 0 ? "completed" : "failed",
		reason: `loop ${loopContractId} executed (exit ${exitCode}) at ${executedPointer}`,
		now,
	});
	emitHarnessEvent(targetRoot, {
		kind: exitCode === 0 ? "execution.completed" : "execution.failed",
		schemaVersion: 1,
		at,
		runId,
		pointers: [executedPointer],
	});
	return { ok: true, run: final.run, exitCode, executedPointer };
}

module.exports = {
	startRunFromLoop,
	bindLoopOutcome,
	CODE_LOOP_APPROVAL_MISSING,
	CODE_LOOP_OUTCOME_MISSING,
};
