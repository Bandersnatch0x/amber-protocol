"use strict";

// Execution Adapter + boundary comparison (F068 H2a; F070 H2b wiring).
//
// GitWorktreeAdapter and LocalAdapter prepare a workspace and report the
// EFFECTIVE boundary; GitWorktreeAdapter composes the existing
// `worktree-manager.js` seam — the ONE worktree implementation the governed
// runner already uses. Adapters prepare, report, and clean up: they never
// execute target commands and never invent isolation (§24: Amber does not own
// the sandbox; execution stays with the existing governed gates).
//
// compareBoundaries is the deterministic §13 fold: Declared vs Effective vs
// Observed must be comparable; observed outside declared is a violation
// (BLOCK posture), never a silent continuation.
//
// F070 H2b: the governed runner consumes the prepared workspace through the
// row-11 seam, and each governed attempt appends a deterministic per-mutation
// observation entry (dirty-path classification — no new observation mechanism).
// The observed trail is append-only; the fold recomputes over the FULL trail
// at every evaluation.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { createWorktree } = require("../worktree-manager");
const { statePath, statePathForCreate } = require("../state-dir-resolver");
const { inspectExecutionContract } = require("./execution-core");
const { getRun, transitionRun } = require("./run-core");
const { emitHarnessEvent } = require("./event-ledger");
const { runGovernedCommand } = require("../core/governed-runner");
const { recordAttempt } = require("./attempt-core");

const CODE_PREPARE_FAILED = "AMBER_E_HARNESS_EXEC_PREPARE_FAILED";
const CODE_ALREADY_PREPARED = "AMBER_E_HARNESS_EXEC_ALREADY_PREPARED";
const CODE_ALREADY_RELEASED = "AMBER_E_HARNESS_EXEC_ALREADY_RELEASED";
const CODE_RUN_TERMINAL = "AMBER_E_HARNESS_EXEC_RUN_TERMINAL";
const CODE_NOT_FOUND = "AMBER_E_HARNESS_EXEC_RECORD_NOT_FOUND";
const CODE_CORRUPT = "AMBER_E_HARNESS_EXEC_RECORD_CORRUPT";
const CODE_INVALID_ARG = "AMBER_E_INVALID_ARG";

// Run states from which a governed attempt may be launched for this run. A
// BLOCKED run is deliberately absent: a boundary violation must first be
// human-recovered (blocked→running), never executed through.
const RUN_EXECUTABLE_STATES = ["created", "admitted", "running", "paused"];

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
		// F070 H2b: a local workspace is a BOUNDED scratch root under the
		// harness state area — never the main checkout (§31: the main checkout
		// is not the default cwd of a prepared run). The path itself shows the
		// bound; the workspace object stays field-comparable to the declared
		// shape (the run schema's closed boundary def carries no extra marker).
		const boundedRoot = statePathForCreate(targetRoot, "harness", "workspaces", safeId(runId));
		fs.mkdirSync(boundedRoot, { recursive: true });
		workspace = { type: "local", path: boundedRoot, base: contract.workspace.base };
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
					`mutation at ${JSON.stringify(candidatePath)} is unevaluated: no write prefixes are declared (per-mutation observation is wired; evaluation needs declared write prefixes)`,
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
 * Evaluate one prepared execution: fold the observed trail against the
 * declared contract, store the comparison, push the boundary into the bound
 * run record, and — on a NEW violation — emit the BLOCK-posture event.
 * F070 H2b: the observed trail grows (append-only; exact-duplicate entries
 * are ignored so re-submitting the same observed file is idempotent) and the
 * comparison is recomputed over the FULL trail at every evaluation. A verdict
 * that was already a violation is never re-emitted: BLOCK posture dedups.
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
	const at = now || new Date().toISOString();
	const existing =
		record.observed && Array.isArray(record.observed.entries) ? record.observed.entries : [];
	const seen = new Set(existing.map((entry) => JSON.stringify(entry)));
	const appended = [];
	for (const entry of observedEntries || []) {
		const key = JSON.stringify(entry);
		if (seen.has(key)) continue;
		seen.add(key);
		appended.push(entry);
	}
	const fullTrail = [...existing, ...appended];
	const previousVerdict = record.comparison ? record.comparison.verdict : null;
	if (record.releasedAt) {
		// The workspace is gone; nothing new can be observed for it, and a
		// recompute over a stale trail would read as fresh evidence.
		throw typedError(
			CODE_ALREADY_RELEASED,
			`the workspace for run "${runId}" was released at ${record.releasedAt}; its recorded comparison is final`,
		);
	}
	const comparison = compareBoundaries(record.declared, record.effective, fullTrail);
	record.observed = { entries: fullTrail, collectedAt: at };
	record.comparison = { ...comparison, evaluatedAt: at };
	const file = executionRecordFileForRead(targetRoot, runId);
	fs.writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`, "utf8");

	// Run integration: the run carries contract/effective/observed/comparison
	// in its additive execution section (ADR-0012 conventions).
	const run = getRun(targetRoot, { runId }).run;
	run.execution = {
		...(run.execution && run.execution.ref ? { ref: run.execution.ref } : {}),
		...(run.execution && run.execution.releasedAt ? { releasedAt: run.execution.releasedAt } : {}),
		contract: record.contract,
		contractSnapshotHash: record.contractSnapshotHash,
		effective: record.effective,
		observed: record.observed,
		comparison: record.comparison,
	};
	const runFile = statePath(targetRoot, "harness", "runs", `${safeId(runId)}.json`);
	fs.writeFileSync(runFile, `${JSON.stringify(run, null, "\t")}\n`, "utf8");

	if (comparison.verdict === "violation" && previousVerdict !== "violation") {
		// BLOCK posture: a refusal event on the trail; the violating sources
		// are pointed at. A verdict that was already a violation is recorded,
		// not re-emitted — the run stays stopped, the trail stays one-event.
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
	return { ok: true, comparison, appended: appended.length, recordFile: file };
}

/**
 * F070 H2b: deterministic per-attempt mutation observation of the prepared
 * workspace. A git-worktree workspace classifies its dirty paths (git status
 * via the adapter's existing observe() — no new observation mechanism, no OS
 * watchers); a bounded local root lists its top-level entries. Per-attempt
 * dirty-path delta is the finest deterministic granularity Amber owns; per-
 * write interception is a sandbox feature Amber does not own (§24).
 */
function observePreparedWorkspace(workspace) {
	if (workspace.type === "git-worktree") {
		const { observe } = require("../core/execution-domain-adapter");
		const snapshot = observe(workspace.path);
		return { paths: snapshot.dirtyPaths || [], observedVia: "git-status" };
	}
	const entries = fs.existsSync(workspace.path) ? fs.readdirSync(workspace.path) : [];
	return {
		paths: entries.sort().map((name) => String(name)),
		observedVia: "bounded-root-listing",
	};
}

/**
 * F070 H2b: execute ONE governed named command for this run inside the
 * adapter-prepared workspace, then observe and fold. The FOUR GATES (policy,
 * approval, ledger, frozen-admission verification) run inside
 * runGovernedCommand — Core — unchanged and always precede any effect; this
 * caller never re-implements or reorders a gate. On success the attempt's
 * dirty-path observation is appended to the run's observed trail and the
 * comparison recomputes over the full trail.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.runId @param {string} opts.commandId
 * @param {string} [opts.ledger] governed ledger name (default: the run id)
 * @param {number} [opts.budgetMinutes] @param {string} [opts.producer]
 * @param {string} [opts.requestId] @param {string} [opts.now]
 */
function runPreparedExecution(
	targetRoot,
	{ runId, commandId, ledger, budgetMinutes, producer, requestId, now } = {},
) {
	if (!runId || typeof runId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--run <id> is required for harness execution run");
	}
	if (!commandId || typeof commandId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--command-id <id> is required for harness execution run");
	}
	const record = readExecutionRecord(targetRoot, { runId });
	if (!record) {
		throw typedError(CODE_NOT_FOUND, `no prepared execution for run "${runId}"`);
	}
	if (record.releasedAt) {
		throw typedError(
			CODE_ALREADY_RELEASED,
			`the workspace for run "${runId}" was released at ${record.releasedAt}; preparation is one-per-run — execute under a new run`,
		);
	}
	const run = getRun(targetRoot, { runId }).run;
	if (!RUN_EXECUTABLE_STATES.includes(run.state)) {
		throw typedError(
			CODE_RUN_TERMINAL,
			`run "${runId}" is ${run.state}; execution requires created/admitted/running/paused — a terminal or blocked run never executes (blocked must be human-recovered first)`,
		);
	}
	const workspacePath = record.effective.workspace.path;
	if (!fs.existsSync(workspacePath)) {
		throw typedError(
			CODE_PREPARE_FAILED,
			`the prepared workspace for run "${runId}" is missing on disk: ${workspacePath}`,
		);
	}
	const ledgerName = ledger || runId;
	const ledgerPath = statePath(targetRoot, "loops", safeId(ledgerName), "ledger.jsonl");
	const attemptId = `att-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
	const at0 = now || new Date().toISOString();
	// F072 H4: the attempt is a first-class run-scoped record and its launch
	// is a fact on the trail (the three execution.* kinds are already in the
	// closed event enum — additive wiring, zero enum growth).
	recordAttempt(targetRoot, {
		runId,
		attemptId,
		commandId,
		governedRef: `governed-ledger:${safeId(ledgerName)}#${attemptId}`,
		now: at0,
	});
	emitHarnessEvent(targetRoot, {
		kind: "execution.started",
		schemaVersion: 1,
		at: at0,
		runId,
		actor: run.subject ? run.subject.agent : undefined,
		reason: `governed attempt ${attemptId} for command ${commandId}`,
		pointers: [`governed-ledger:${safeId(ledgerName)}#${attemptId}`],
	});
	// The declared resource budget is the attempt budget unless the caller
	// narrows it — the declared timeout dimension of the §13 fold must be able
	// to fire from the run's own trail, not only from caller-supplied entries.
	const declaredTimeout =
		record.declared.resources && Number.isInteger(record.declared.resources.timeoutMinutes)
			? record.declared.resources.timeoutMinutes
			: undefined;
	const budget = Number.isInteger(budgetMinutes) ? budgetMinutes : declaredTimeout;
	const governed = runGovernedCommand({
		target: targetRoot,
		commandId,
		ledgerPath,
		label: `h2b-${safeId(runId)}`,
		...(budget === undefined ? {} : { budgetMinutes: budget }),
		preparedWorkspacePath: workspacePath,
		attemptId,
		...(producer === undefined ? {} : { producer }),
		...(requestId === undefined ? {} : { requestId }),
		subject: { runId },
	});
	// A gate refusal is an attempt that never executed (the ledger carries a
	// denied record and no executed record). A command that EXECUTED but
	// exited non-zero is a completed governed attempt — its mutations are
	// still observed and folded; the failure rides the normal result.
	const executed = governed.executed === true || Boolean(governed.ledgerRecord);
	if (!executed && Array.isArray(governed.errors) && governed.errors.length > 0) {
		const refusalAt = new Date().toISOString();
		const refusalReason = governed.errors
			.map((entry) => String(entry))
			.join("; ")
			.slice(0, 2000);
		recordAttempt(targetRoot, {
			runId,
			attemptId,
			commandId,
			state: "refused",
			reason: refusalReason,
			now: refusalAt,
		});
		emitHarnessEvent(targetRoot, {
			kind: "execution.failed",
			schemaVersion: 1,
			at: refusalAt,
			runId,
			actor: run.subject ? run.subject.agent : undefined,
			reason: `governed attempt ${attemptId} refused before any effect: ${refusalReason}`,
			pointers: [`governed-ledger:${safeId(ledgerName)}#${attemptId}`],
		});
		return { ok: false, refused: true, attemptId, governed };
	}
	const observation = observePreparedWorkspace(record.effective.workspace);
	const at = now || new Date().toISOString();
	const entry = {
		kind: "mutation",
		paths: observation.paths,
		source: `governed-ledger:${safeId(ledgerName)}#${attemptId}`,
		attemptId,
		at,
		observedVia: observation.observedVia,
	};
	const evaluation = evaluateExecution(targetRoot, { runId, observedEntries: [entry], now: at });
	// F072 H4: the attempt's outcome is a terminal record + one trail event.
	// An executed-but-failed command is state `failed` (its mutations were
	// still observed above); exitCode 0 completes it. The ledger record
	// carries the exit code inside its public action envelope
	// (`ledgerRecord.action.exitCode`); the governed result itself carries it
	// top-level — prefer the governed value, fall back to the envelope.
	const governedExitCode = Number.isInteger(governed.exitCode)
		? governed.exitCode
		: governed.ledgerRecord && governed.ledgerRecord.action
			? governed.ledgerRecord.action.exitCode
			: undefined;
	const attemptState = governedExitCode === 0 ? "completed" : "failed";
	recordAttempt(targetRoot, {
		runId,
		attemptId,
		commandId,
		state: attemptState,
		...(governedExitCode === undefined ? {} : { exitCode: governedExitCode }),
		observedRef: `observed-entry:${safeId(runId)}#${attemptId}`,
		now: at,
	});
	emitHarnessEvent(targetRoot, {
		kind: attemptState === "completed" ? "execution.completed" : "execution.failed",
		schemaVersion: 1,
		at,
		runId,
		actor: run.subject ? run.subject.agent : undefined,
		reason:
			attemptState === "completed"
				? `governed attempt ${attemptId} completed`
				: `governed attempt ${attemptId} exited non-zero (${governedExitCode})`,
		pointers: [`governed-ledger:${safeId(ledgerName)}#${attemptId}`],
	});
	return {
		ok: true,
		attemptId,
		attemptState,
		observedEntry: entry,
		comparison: evaluation.comparison,
		...(Array.isArray(governed.errors) && governed.errors.length > 0
			? { commandErrors: governed.errors }
			: {}),
		governedExitCode,
		recordFile: evaluation.recordFile,
	};
}

/**
 * F070 H2b: release the prepared workspace as a RECORDED step. A
 * git-worktree workspace is removed through the ONE worktree seam; a bounded
 * local root is deleted. A finished command never silently deletes the
 * workspace, and a release is never repeated.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.runId @param {string} [opts.now]
 */
function releaseExecution(targetRoot, { runId, now } = {}) {
	if (!runId || typeof runId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--run <id> is required for harness execution release");
	}
	const record = readExecutionRecord(targetRoot, { runId });
	if (!record) {
		throw typedError(CODE_NOT_FOUND, `no prepared execution for run "${runId}"`);
	}
	if (record.releasedAt) {
		throw typedError(
			CODE_ALREADY_RELEASED,
			`the workspace for run "${runId}" was already released at ${record.releasedAt}`,
		);
	}
	const at = now || new Date().toISOString();
	const workspace = record.effective.workspace;
	if (workspace.type === "git-worktree") {
		const { removeWorktree } = require("../worktree-manager");
		const removed = removeWorktree(targetRoot, runId);
		if (!removed || removed.success === false) {
			throw typedError(
				CODE_PREPARE_FAILED,
				`release failed: ${removed && removed.error ? removed.error : "unknown"}`,
			);
		}
	} else {
		// A local workspace is the bounded scratch root prepared under the
		// harness state area — delete exactly that directory, never the target.
		fs.rmSync(workspace.path, { recursive: true, force: true });
	}
	record.releasedAt = at;
	const file = executionRecordFileForRead(targetRoot, runId);
	fs.writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`, "utf8");
	// The run's additive execution section carries the release too (one view).
	try {
		const run = getRun(targetRoot, { runId }).run;
		if (run.execution) {
			run.execution.releasedAt = at;
			const runFile = statePath(targetRoot, "harness", "runs", `${safeId(runId)}.json`);
			fs.writeFileSync(runFile, `${JSON.stringify(run, null, "\t")}\n`, "utf8");
		}
	} catch (err) {
		// The release record itself is the durable fact; never mask it.
	}
	return { ok: true, runId, releasedAt: at, recordFile: file };
}

module.exports = {
	prepareExecution,
	inspectExecution,
	listPreparedExecutions,
	compareBoundaries,
	evaluateExecution,
	runPreparedExecution,
	releaseExecution,
	observePreparedWorkspace,
	RUN_EXECUTABLE_STATES,
	EXECUTION_VERDICTS,
	CODE_PREPARE_FAILED,
	CODE_ALREADY_PREPARED,
	CODE_ALREADY_RELEASED,
	CODE_RUN_TERMINAL,
	CODE_NOT_FOUND,
	CODE_CORRUPT,
	CODE_INVALID_ARG,
};
