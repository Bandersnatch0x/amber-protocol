"use strict";

// Harness Lifecycle view (F072 H4; proposal §42 gate).
//
// ONE read-only report answering the Phase-H4 gate question: do the existing
// surfaces (route, session, loop, execution) map onto the unified lifecycle?
// Every field is read from existing records and cited — the view writes
// nothing, re-derives nothing it cannot cite, and fails closed on a corrupt
// record. The run is the spine; loop provenance comes from the run's own
// admission pointers (F066 receipt), never from re-walking the loop ledger;
// the subject carries the session/task refs the run already declares.
//
// The route mapping is structural, not per-run: the route surface's stages
// (the session's `created → routed → executing → verify` spine) and the
// session machine are mapped by the sanctioned bridge only (ADR-0101: the
// vertical-slice adapter); this view reports the run's session/task refs as
// the mapping witness, it never translates session states.

const { getRun, listRuns } = require("./run-core");
const { listAttempts, detectNoProgress } = require("./attempt-core");
const { listCheckpoints } = require("./checkpoint-core");

const CODE_INVALID_ARG = "AMBER_E_INVALID_ARG";

function typedError(code, message) {
	const err = new Error(message);
	err.amberCode = code;
	return err;
}

// The run's additive execution section is the execution surface's mapping
// witness (contract + snapshot + comparison verdict + releasedAt). Absent
// means the run never prepared an execution — reported as null, never
// inferred.
function executionWitness(run) {
	if (!run.execution) return null;
	return {
		contract: run.execution.contract,
		contractSnapshotHash: run.execution.contractSnapshotHash,
		comparison: run.execution.comparison ? run.execution.comparison.verdict : null,
		releasedAt: run.execution.releasedAt ?? null,
	};
}

// Loop provenance: the F066 receipt's admission checks cite the loop's real
// gate artifacts. The approval/contract pointers name the loop surface; the
// view cites them verbatim and walks nothing.
function loopProvenance(run) {
	if (!run.admission || !run.admission.checks) return null;
	const approvalPointer = run.admission.checks.approval
		? run.admission.checks.approval.pointer
		: null;
	const contractPointer = run.admission.checks.contract
		? run.admission.checks.contract.pointer
		: null;
	if (!approvalPointer && !contractPointer) return null;
	return {
		approvalPointer,
		contractPointer,
		receiptedAt: run.admission.receiptedAt,
	};
}

// One run's unified-lifecycle row: the spine (state + history), the
// subject's session/task mapping witnesses, the execution verdict, and the
// attempt/checkpoint folds.
function runLifecycle(targetRoot, runId) {
	const run = getRun(targetRoot, { runId }).run;
	const attempts = listAttempts(targetRoot, { runId });
	const checkpoints = listCheckpoints(targetRoot, { runId });
	return {
		id: run.id,
		state: run.state,
		harness: run.harness,
		subject: run.subject,
		stateHistory: run.stateHistory,
		outcome: run.outcome ?? null,
		loop: loopProvenance(run),
		execution: executionWitness(run),
		attempts: {
			count: attempts.length,
			lastAttemptState: attempts.length > 0 ? attempts[attempts.length - 1].state : null,
			noProgress: detectNoProgress(attempts),
		},
		checkpoints: {
			count: checkpoints.length,
			lastCheckpointId:
				checkpoints.length > 0 ? checkpoints[checkpoints.length - 1].checkpointId : null,
		},
		tools: run.tools ? { snapshotHash: run.tools.snapshotHash, ids: run.tools.ids } : null,
	};
}

/**
 * The unified lifecycle view. With `--run <id>`: one run's mapping. Without:
 * every run's mapping plus the surface note that names the sanctioned bridge
 * (the route/session machines map through the vertical-slice adapter only —
 * ADR-0101 decision 4). In run-scoped mode a corrupt underlying record fails
 * closed through the readers this view composes. In registry-wide mode a
 * corrupt run file is reported as its `{id, corrupt: true}` tombstone
 * (listRuns' own contract) — the tombstone IS the cited fact; the other
 * runs' mappings still render.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} [opts.runId]
 */
function lifecycleView(targetRoot, { runId } = {}) {
	if (runId !== undefined && (typeof runId !== "string" || runId.length === 0)) {
		throw typedError(CODE_INVALID_ARG, "--run <id> must be a run id");
	}
	if (runId !== undefined) {
		return { ok: true, run: runLifecycle(targetRoot, runId) };
	}
	const runs = listRuns(targetRoot);
	return {
		ok: true,
		runs: runs.map((entry) => {
			if (entry.corrupt) {
				// listRuns' tombstone: cite the corruption, render the rest.
				return { id: entry.id, corrupt: true };
			}
			return runLifecycle(targetRoot, entry.id);
		}),
		// The §42 mapping statement, readable from the view itself: run is the
		// spine; the other surfaces map through declared bridges, never ad hoc.
		mapping: {
			route:
				"stage spine (created → routed → executing → verify); maps to Run through the vertical-slice adapter only (ADR-0101)",
			session:
				"continuity lifecycle (its own settled machine); the run's subject.session ref is the mapping witness",
			loop: "governed one-shot execution; the run's admission pointers cite the loop's real gate artifacts (F066)",
			execution:
				"declared/effective/observed boundary; the run's execution section is the mapping witness (F068/F070)",
		},
	};
}

module.exports = { lifecycleView, runLifecycle, CODE_INVALID_ARG };
