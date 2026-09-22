"use strict";

// Harness Run core (F065 H0; ADR-0101).
//
// Owns every semantic verdict of the Run lifecycle: binding to an admitted
// contract snapshot (fail closed when the contract is missing or corrupt),
// schema-validated records under the harness state area, closed nine-state
// transitions via the Run state machine, and immutable terminal records
// (a final run is never rewritten; retry is a new Run on the same task).
// Storage paths resolve through the state-dir seam only.

const fs = require("node:fs");
const path = require("node:path");

const { compileSchema } = require("../core/schema-contract");
const { statePath, statePathForCreate } = require("../state-dir-resolver");
const { inspectHarnessContract } = require("./contract-core");
const { isLegalTransition, isFinal } = require("./run-state-machine");
const { emitHarnessEvent } = require("./event-ledger");

const CODE_ILLEGAL = "AMBER_E_HARNESS_RUN_ILLEGAL_TRANSITION";
const CODE_FINAL = "AMBER_E_HARNESS_RUN_FINAL";
const CODE_NOT_FOUND = "AMBER_E_HARNESS_RUN_NOT_FOUND";
const CODE_CORRUPT = "AMBER_E_HARNESS_RUN_CORRUPT";
const CODE_ADMISSION_INCOMPLETE = "AMBER_E_HARNESS_ADMISSION_INCOMPLETE";
const CODE_INVALID_ARG = "AMBER_E_INVALID_ARG";

// The six AdmissionReceipt checks (ADR-0100 decision 3, F066): each names the
// EXISTING governed artifact it witnessed. A receipt is only ever written
// complete — a missing or malformed check refuses the whole admission, so a
// stored receipt is always all-pass.
const ADMISSION_CHECK_NAMES = Object.freeze([
	"identity",
	"contract",
	"policy",
	"context",
	"execution",
	"approval",
]);

function typedError(code, message) {
	const err = new Error(message);
	err.amberCode = code;
	return err;
}

function runFileForCreate(targetRoot, runId) {
	return statePathForCreate(targetRoot, "harness", "runs", `${safeId(runId)}.json`);
}

function runFileForRead(targetRoot, runId) {
	return statePath(targetRoot, "harness", "runs", `${safeId(runId)}.json`);
}

function safeId(runId) {
	return String(runId).replace(/[^A-Za-z0-9._-]/g, "-");
}

function validateRunRecord(candidate) {
	const validate = compileSchema("run");
	if (validate(candidate)) return null;
	const detail = (validate.errors || [])
		.map((e) => `${e.instancePath || "/"} ${e.message}`)
		.join("; ");
	return typedError(CODE_CORRUPT, `run record does not satisfy schemas/run.schema.json: ${detail}`);
}

function readRunFile(file) {
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
		throw typedError(CODE_CORRUPT, `run record is not valid JSON: ${file}`);
	}
	const problem = validateRunRecord(record);
	if (problem) throw problem;
	return record;
}

// The run record is the truth; the event ledger is the trail. Emission is
// deliberately after the record write and its failure propagates: a run
// whose trail is missing an event is visible on inspect (the ledger fold is
// re-derived on every read), while a silent gap would not be.
function eventKindForTransition(from, to) {
	if (to === "created") return "run.created";
	if (to === "admitted") return "run.admitted";
	if (to === "running") return from === "paused" ? "run.resumed" : "run.started";
	if (to === "paused") return "run.paused";
	if (to === "blocked") return "run.blocked";
	if (to === "failed") return "run.failed";
	if (to === "completed") return "run.completed";
	if (to === "cancelled") return "run.cancelled";
	if (to === "expired") return "run.expired";
	throw typedError(CODE_ILLEGAL, `no event kind for run transition to ${JSON.stringify(to)}`);
}

function emitRunEvent(targetRoot, kind, run, at, reason, pointers) {
	emitHarnessEvent(targetRoot, {
		kind,
		schemaVersion: 1,
		at,
		runId: run.id,
		actor: run.subject ? run.subject.agent : undefined,
		...(reason ? { reason } : {}),
		...(pointers && pointers.length > 0 ? { pointers } : {}),
	});
}

// The AdmissionReceipt is only ever stored complete: every one of the six
// checks must name the existing governed artifact it witnessed. Anything
// less refuses the whole admission — a receipt is evidence, not intent.
function admissionProblem(admission) {
	if (!admission || typeof admission !== "object" || Array.isArray(admission)) {
		return "admission to the admitted state requires the six receipt checks (--check <name:pointer> per check)";
	}
	for (const name of ADMISSION_CHECK_NAMES) {
		const check = admission[name];
		if (!check || typeof check !== "object" || check.result !== "pass") {
			return `admission check "${name}" is missing or not a pass — a receipt records witnessed gates only`;
		}
		if (typeof check.pointer !== "string" || check.pointer.trim().length === 0) {
			return `admission check "${name}" carries no pointer to a governed artifact`;
		}
	}
	return null;
}

function generateRunId(now) {
	const stamp = (now || new Date()).getTime().toString(36);
	const salt = Math.floor(Math.random() * 0xffff)
		.toString(16)
		.padStart(4, "0");
	return `run-${stamp}-${salt}`;
}

/**
 * Create one Run bound to an admitted contract. Fails closed when the
 * contract is not admitted or its stored record no longer hashes to its
 * snapshot (the binding carries the Snapshot Hash, never a mutable ref).
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.contractId
 * @param {{agent: string, session?: string, task?: string}} opts.subject
 * @param {string} [opts.runId] Explicit run id; generated when absent.
 * @param {string} [opts.executionRef]
 * @param {string} [opts.now]
 */
function createRun(targetRoot, { contractId, subject, runId, executionRef, now } = {}) {
	if (!contractId || typeof contractId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--contract <id> is required to start a run");
	}
	if (!subject || !subject.agent) {
		throw typedError(CODE_INVALID_ARG, "--agent <id> is required as the run subject");
	}
	const admitted = inspectHarnessContract(targetRoot, { contractId });
	const id = runId || generateRunId(now);
	const at = now || new Date().toISOString();
	const record = {
		apiVersion: "amber.dev/v1",
		kind: "HarnessRun",
		id,
		subject: {
			agent: subject.agent,
			...(subject.session ? { session: subject.session } : {}),
			...(subject.task ? { task: subject.task } : {}),
		},
		harness: {
			contract: admitted.id,
			contractSnapshotHash: admitted.snapshotHash,
			...(admitted.contract.governance && admitted.contract.governance.policy
				? { policy: admitted.contract.governance.policy }
				: {}),
		},
		...(executionRef ? { execution: { ref: String(executionRef) } } : {}),
		events: { stream: "harness/events.jsonl" },
		state: "created",
		stateHistory: [{ from: null, to: "created", at }],
	};
	const file = runFileForCreate(targetRoot, id);
	if (fs.existsSync(file)) {
		throw typedError(
			CODE_INVALID_ARG,
			`run id "${id}" already exists; retry is a new run, never a rewrite`,
		);
	}
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`, "utf8");
	emitRunEvent(targetRoot, "run.created", record, at);
	return { ok: true, run: record, runFile: file };
}

/**
 * Advance one run through a legal state transition. Terminal states are
 * frozen: a final run refuses every transition (retry is a new run).
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.runId
 * @param {string} opts.to
 * @param {string} [opts.reason]
 * @param {string} [opts.now]
 */
function transitionRun(targetRoot, { runId, to, reason, now, admission } = {}) {
	if (!runId || typeof runId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--run <id> is required to advance a run");
	}
	if (!to || typeof to !== "string") {
		throw typedError(CODE_INVALID_ARG, "--to <state> is required to advance a run");
	}
	const file = runFileForRead(targetRoot, runId);
	const record = readRunFile(file);
	if (!record) {
		throw typedError(CODE_NOT_FOUND, `no run "${runId}" under the harness state area`);
	}
	if (isFinal(record.state)) {
		throw typedError(
			CODE_FINAL,
			`run "${runId}" is final (${record.state}); terminal records are immutable — retry is a new run on the same task`,
		);
	}
	if (!isLegalTransition(record.state, to)) {
		throw typedError(
			CODE_ILLEGAL,
			`illegal run transition ${record.state} → ${to}; see run-state-machine TRANSITIONS`,
		);
	}
	const at = now || new Date().toISOString();
	let receiptPointers = null;
	if (to === "admitted") {
		const problem = admissionProblem(admission);
		if (problem !== null) throw typedError(CODE_ADMISSION_INCOMPLETE, problem);
		record.admission = {
			receiptedAt: at,
			checks: Object.fromEntries(
				ADMISSION_CHECK_NAMES.map((name) => [
					name,
					{ result: "pass", pointer: admission[name].pointer },
				]),
			),
		};
		receiptPointers = ADMISSION_CHECK_NAMES.map(
			(name) => `${name}:${record.admission.checks[name].pointer}`,
		);
	}
	record.stateHistory.push({ from: record.state, to, at, ...(reason ? { reason } : {}) });
	record.state = to;
	record.outcome = record.outcome || {};
	if (to === "running" && !record.outcome.startedAt) record.outcome.startedAt = at;
	if (isFinal(to)) record.outcome.finishedAt = at;
	fs.writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`, "utf8");
	emitRunEvent(
		targetRoot,
		eventKindForTransition(record.stateHistory[record.stateHistory.length - 2].to, to),
		record,
		at,
		reason,
		receiptPointers,
	);
	return { ok: true, run: record, runFile: file };
}

/**
 * Read one run (schema-validated, fail closed on corruption).
 */
function getRun(targetRoot, { runId } = {}) {
	if (!runId || typeof runId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--run <id> is required to show a run");
	}
	const record = readRunFile(runFileForRead(targetRoot, runId));
	if (!record) {
		throw typedError(CODE_NOT_FOUND, `no run "${runId}" under the harness state area`);
	}
	return { ok: true, run: record };
}

/**
 * List runs (id, state, contract, snapshot hash) in id order. A missing
 * directory is an empty list, not an error.
 */
function listRuns(targetRoot) {
	const dir = statePath(targetRoot, "harness", "runs");
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => {
			try {
				const record = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
				return {
					id: record.id,
					state: record.state,
					contract: record.harness ? record.harness.contract : null,
					contractSnapshotHash: record.harness ? record.harness.contractSnapshotHash : null,
					agent: record.subject ? record.subject.agent : null,
				};
			} catch (err) {
				return { id: name, state: null, corrupt: true };
			}
		});
}

module.exports = {
	createRun,
	transitionRun,
	getRun,
	listRuns,
	ADMISSION_CHECK_NAMES,
	CODE_ILLEGAL,
	CODE_FINAL,
	CODE_NOT_FOUND,
	CODE_CORRUPT,
	CODE_ADMISSION_INCOMPLETE,
	CODE_INVALID_ARG,
};
