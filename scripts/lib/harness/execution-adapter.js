"use strict";

// Execution Adapter + boundary comparison (F068 H2a; Harness v2 §13/§24/§31).
//
// GitWorktreeAdapter and LocalAdapter prepare a workspace and report the
// EFFECTIVE boundary; GitWorktreeAdapter composes the existing
// `worktree-manager.js` seam — the ONE worktree implementation the governed
// runner already uses. Adapters prepare, report, and clean up: they never
// execute target commands and never invent isolation (§24: Amber does not
// own the sandbox; execution stays with the existing governed gates).
//
// compareBoundaries is the deterministic §13 fold: Declared vs Effective vs
// Observed must be comparable; observed outside declared is a violation
// (BLOCK posture), never a silent continuation. Observed entries are mapped
// from records that already exist; H2a writes no new observation mechanism.

const fs = require("node:fs");
const path = require("node:path");

const { createWorktree } = require("../worktree-manager");
const { statePath, statePathForCreate } = require("../state-dir-resolver");
const { inspectExecutionContract } = require("./execution-core");
const { getRun, transitionRun } = require("./run-core");
const { emitHarnessEvent } = require("./event-ledger");

const CODE_PREPARE_FAILED = "AMBER_E_HARNESS_EXEC_PREPARE_FAILED";
const CODE_ALREADY_PREPARED = "AMBER_E_HARNESS_EXEC_ALREADY_PREPARED";
const CODE_ALREADY_EVALUATED = "AMBER_E_HARNESS_EXEC_ALREADY_EVALUATED";
const CODE_NOT_FOUND = "AMBER_E_HARNESS_EXEC_RECORD_NOT_FOUND";
const CODE_CORRUPT = "AMBER_E_HARNESS_EXEC_RECORD_CORRUPT";
const CODE_INVALID_ARG = "AMBER_E_INVALID_ARG";

const EXECUTION_VERDICTS = Object.freeze(["ok", "violation", "unevaluated"]);

function typedError(code, message) {
	const err = new Error(message);
	err.amberCode = code;
	return err;
}

function executionRecordFile(targetRoot, runId) {
	return statePathForCreate(targetRoot, "harness", "executions", `${safeId(runId)}.json`);
}

function executionRecordFileForRead(targetRoot, runId) {
	return statePath(targetRoot, "harness", "executions", `${safeId(runId)}.json`);
}

function safeId(id) {
	return String(id).replace(/[^A-Za-z0-9._-]/g, "-");
}

// The effective report mirrors the declared shape (defaults applied the same
// way the adapters apply them) so declared/effective are field-comparable.
function effectiveBoundaryOf(contract, workspace) {
	return {
		workspace,
		filesystem: contract.filesystem ?? { read: [], write: [], deny: [] },
		network: contract.network ?? { mode: "deny" },
		...(contract.resources ? { resources: contract.resources } : {}),
		mutation: contract.mutation ?? { mode: "isolated" },
	};
}

// Inline closed-shape check for the execution record (a preparation record,
// not a declared contract — no dedicated schema file; the pin budget carries
// only execution-contract.schema.json in H2a).
function executionRecordProblem(record) {
	if (record.kind !== "ExecutionRecord") return "kind must be ExecutionRecord";
	if (typeof record.runId !== "string" || record.runId.length === 0) return "runId required";
	if (!record.contract || typeof record.contract !== "string") return "contract id required";
	if (
		typeof record.contractSnapshotHash !== "string" ||
		!/^sha256:[0-9a-f]{64}$/.test(record.contractSnapshotHash)
	)
		return "contractSnapshotHash must be a sha256 pointer";
	if (!record.declared || !record.effective || !record.effective.workspace) {
		return "declared and effective boundaries required";
	}
	if (record.comparison) {
		if (!EXECUTION_VERDICTS.includes(record.comparison.verdict)) {
			return `comparison verdict must be one of ${EXECUTION_VERDICTS.join(", ")}`;
		}
		if (!Array.isArray(record.comparison.findings)) return "comparison findings must be an array";
	}
	return null;
}

function readExecutionRecord(targetRoot, { runId }) {
	if (!runId || typeof runId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--run <id> is required");
	}
	const file = executionRecordFileForRead(targetRoot, runId);
	let raw;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch (err) {
		return null;
	}
	let record;
	try {
		record = JSON.parse(raw);
	} catch (err) {
		throw typedError(CODE_CORRUPT, `execution record is not valid JSON: ${file}`);
	}
	const problem = executionRecordProblem(record);
	if (problem)
		throw typedError(CODE_CORRUPT, `execution record fails its closed shape: ${problem}`);
	return record;
}

/**
 * Prepare the workspace for one run per its admitted contract and report the
 * EFFECTIVE boundary. One workspace per run: a second prepare refuses.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.contractId @param {string} opts.runId @param {string} [opts.now]
 */
function prepareExecution(targetRoot, { contractId, runId, now } = {}) {
	if (!contractId || typeof contractId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--contract <id> is required to prepare an execution");
	}
	if (!runId || typeof runId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--run <id> is required to prepare an execution");
	}
	const file = executionRecordFile(targetRoot, runId);
	if (fs.existsSync(file)) {
		throw typedError(
			CODE_ALREADY_PREPARED,
			`run "${runId}" already has a prepared execution; one workspace per run`,
		);
	}
	const inspected = inspectExecutionContract(targetRoot, { contractId });
	const contract = inspected.contract;

	let workspace;
	if (contract.workspace.type === "git-worktree") {
		// Compose the ONE worktree seam the governed runner already uses.
		const created = createWorktree(targetRoot, runId);
		if (!created || !created.success) {
			throw typedError(
				CODE_PREPARE_FAILED,
				`git worktree prepare failed: ${created && created.error ? created.error : "unknown"}`,
			);
		}
		workspace = {
			type: "git-worktree",
			path: created.path,
			base: created.baseBranch,
			branch: created.branch,
		};
	} else {
		workspace = { type: "local", path: targetRoot, base: contract.workspace.base };
	}
	const effective = effectiveBoundaryOf(contract, workspace);
	const at = now || new Date().toISOString();
	const record = {
		apiVersion: "amber.dev/v1",
		kind: "ExecutionRecord",
		runId,
		contract: inspected.id,
		contractSnapshotHash: inspected.snapshotHash,
		declared: contract,
		effective,
		preparedAt: at,
	};
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`, "utf8");
	return { ok: true, record, recordFile: file };
}

/**
 * Read one prepared execution record (fail closed on corruption).
 */
function inspectExecution(targetRoot, { runId } = {}) {
	const record = readExecutionRecord(targetRoot, { runId });
	if (!record) {
		throw typedError(CODE_NOT_FOUND, `no prepared execution for run "${runId}"`);
	}
	return { ok: true, record };
}

function listPreparedExecutions(targetRoot) {
	const dir = statePath(targetRoot, "harness", "executions");
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => {
			try {
				const record = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
				return {
					runId: record.runId,
					contract: record.contract,
					verdict: record.comparison ? record.comparison.verdict : null,
				};
			} catch (err) {
				return { runId: name, corrupt: true };
			}
		});
}

function pathMatchesPrefix(prefix, candidatePath) {
	const normalized = String(candidatePath).replace(/\\/g, "/");
	return normalized === prefix || normalized.startsWith(`${prefix}/`);
}

// The §13 fold: deterministic, no numbers invented, no silent continuation.
// refusal entries are info (they were already blocked); mutation entries are
// checked against deny prefixes and — when write prefixes are declared —
// against the write set; timeout entries beyond the declared budget violate.
function compareBoundaries(declared, effective, observedEntries) {
	const findings = [];
	const add = (severity, kind, detail, source) =>
		findings.push({ severity, kind, detail, ...(source ? { source } : {}) });

	// 1) effective-vs-declared: the adapter must report exactly the declared
	// boundary (with the shared defaults); any deviation is adapter drift.
	const declaredShape = effectiveBoundaryOf(declared, declared.workspace);
	for (const section of ["filesystem", "network", "mutation", "resources"]) {
		const declaredJson = JSON.stringify(declaredShape[section] ?? null);
		const effectiveJson = JSON.stringify(effective[section] ?? null);
		if (declaredJson !== effectiveJson) {
			add(
				"violation",
				"effective-deviates-from-declared",
				`effective ${section} deviates from the declared contract`,
				null,
			);
		}
	}

	// 2) observed-vs-declared.
	const deny = (declared.filesystem && declared.filesystem.deny) || [];
	const write = (declared.filesystem && declared.filesystem.write) || [];
	const declaredTimeout =
		declared.resources && Number.isInteger(declared.resources.timeoutMinutes)
			? declared.resources.timeoutMinutes
			: null;
	let observedCount = 0;
	for (const entry of observedEntries || []) {
		if (!entry || typeof entry !== "object") continue;
		observedCount += 1;
		const source = entry.source ?? null;
		if (entry.kind === "refusal") {
			add(
				"info",
				"refusal-observed",
				"an already-blocked attempt is part of the observed trail",
				source,
			);
			continue;
		}
		for (const candidatePath of entry.paths || []) {
			if (deny.some((prefix) => pathMatchesPrefix(prefix, candidatePath))) {
				add(
					"violation",
					"denied-path-mutation",
					`observed mutation at ${JSON.stringify(candidatePath)} hits a declared deny prefix`,
					source,
				);
			} else if (
				write.length > 0 &&
				!write.some((prefix) => pathMatchesPrefix(prefix, candidatePath))
			) {
				add(
					"violation",
					"outside-declared-write",
					`observed mutation at ${JSON.stringify(candidatePath)} is outside every declared write prefix`,
					source,
				);
			} else if (write.length === 0) {
				add(
					"info",
					"unevaluated-mutation",
					`mutation at ${JSON.stringify(candidatePath)} is unevaluated: no write prefixes are declared (H2b wires per-mutation observation)`,
					source,
				);
			}
		}
		if (
			Number.isInteger(entry.timeoutMinutes) &&
			declaredTimeout !== null &&
			entry.timeoutMinutes > declaredTimeout
		) {
			add(
				"violation",
				"declared-timeout-exceeded",
				`observed ${entry.timeoutMinutes}m exceeds the declared ${declaredTimeout}m budget`,
				source,
			);
		}
	}

	if (findings.some((finding) => finding.severity === "violation")) {
		return { verdict: "violation", findings };
	}
	if (observedCount === 0 && findings.length === 0) {
		return { verdict: "unevaluated", findings };
	}
	return { verdict: "ok", findings };
}

/**
 * Evaluate one prepared execution: fold the observed entries against the
 * declared contract, store the comparison, push the boundary into the bound
 * run record, and — on a violation — emit the BLOCK-posture event. One
 * evaluation per execution: observed grows in H2b; re-evaluation refuses.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.runId
 * @param {Array} opts.observedEntries
 * @param {string} [opts.now]
 */
function evaluateExecution(targetRoot, { runId, observedEntries, now } = {}) {
	const record = readExecutionRecord(targetRoot, { runId });
	if (!record) {
		throw typedError(CODE_NOT_FOUND, `no prepared execution for run "${runId}"`);
	}
	if (record.comparison) {
		throw typedError(
			CODE_ALREADY_EVALUATED,
			`execution for run "${runId}" is already evaluated; observed growth is H2b`,
		);
	}
	const comparison = compareBoundaries(record.declared, record.effective, observedEntries);
	const at = now || new Date().toISOString();
	record.observed = { entries: observedEntries || [], collectedAt: at };
	record.comparison = { ...comparison, evaluatedAt: at };
	const file = executionRecordFileForRead(targetRoot, runId);
	fs.writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`, "utf8");

	// Run integration: the run carries contract/effective/observed/comparison
	// in its additive execution section (ADR-0012 conventions).
	const run = getRun(targetRoot, { runId }).run;
	run.execution = {
		...(run.execution && run.execution.ref ? { ref: run.execution.ref } : {}),
		contract: record.contract,
		contractSnapshotHash: record.contractSnapshotHash,
		effective: record.effective,
		observed: record.observed,
		comparison: record.comparison,
	};
	const runFile = statePath(targetRoot, "harness", "runs", `${safeId(runId)}.json`);
	fs.writeFileSync(runFile, `${JSON.stringify(run, null, "\t")}\n`, "utf8");

	if (comparison.verdict === "violation") {
		// BLOCK posture: a refusal event on the trail; the violating sources
		// are pointed at. The run's terminal transition stays with H2b.
		emitHarnessEvent(targetRoot, {
			kind: "execution.failed",
			schemaVersion: 1,
			at,
			runId,
			actor: run.subject ? run.subject.agent : undefined,
			reason: `declared/observed boundary violation: ${comparison.findings
				.filter((finding) => finding.severity === "violation")
				.map((finding) => finding.kind)
				.join("; ")}`,
			pointers: comparison.findings
				.filter((finding) => finding.severity === "violation" && finding.source)
				.map((finding) => finding.source),
		});
		// The run must not march past a violated boundary: a running run is
		// BLOCKed; a created/admitted run is cancelled (it will not proceed).
		// H2b resolves violations by contract revision, never by widening.
		if (run.state === "running") {
			try {
				transitionRun(targetRoot, {
					runId,
					to: "blocked",
					reason: "declared/observed boundary violation (BLOCK posture)",
					now: at,
				});
			} catch (err) {
				// The violation event is the record; never mask it.
			}
		} else if (!["completed", "failed", "cancelled", "expired", "blocked"].includes(run.state)) {
			try {
				transitionRun(targetRoot, {
					runId,
					to: "cancelled",
					reason: "declared/observed boundary violation before start (BLOCK posture)",
					now: at,
				});
			} catch (err) {
				// The violation event is the record; never mask it.
			}
		}
	}
	return { ok: true, comparison, recordFile: file };
}

module.exports = {
	prepareExecution,
	inspectExecution,
	listPreparedExecutions,
	compareBoundaries,
	evaluateExecution,
	EXECUTION_VERDICTS,
	CODE_PREPARE_FAILED,
	CODE_ALREADY_PREPARED,
	CODE_ALREADY_EVALUATED,
	CODE_NOT_FOUND,
	CODE_CORRUPT,
	CODE_INVALID_ARG,
};
