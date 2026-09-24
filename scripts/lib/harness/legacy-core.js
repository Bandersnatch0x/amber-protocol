"use strict";

// Harness Legacy-surface dispositions (F075; proposal §52 Rules 4–7,
// ADR-0101 decision 4).
//
// The §52 discipline is "declared, not improvised": the deprecated legacy
// surfaces (task prepare / result inspect / profile inspect) get their
// mapping onto the unified lifecycle DECLARED here — as a read-only view
// over the frozen on-disk legacy shape. Nothing is migrated, adopted, or
// deleted by this module: the view cites, the deletion is an explicit user
// decision, and a legacy run projection is a VIEW (`legacy: true`), never a
// Run record.
//
// The legacy writer (`persistExecutionArtifacts` in task-execution.js) is
// deprecated and frozen — its persisted shape
// (.amber/executions/<taskId>/{ledger.json,evidence.json,replay.md} plus
// .amber/worktrees/<taskId>/) will not change before removal; conformance
// uses frozen fixtures mirroring it exactly (disclosed in the spec).

const fs = require("node:fs");
const path = require("node:path");

const { statePath } = require("../state-dir-resolver");

const CODE_NOT_FOUND = "AMBER_E_HARNESS_LEGACY_NOT_FOUND";
const CODE_CORRUPT = "AMBER_E_HARNESS_LEGACY_CORRUPT";
const CODE_INVALID_ARG = "AMBER_E_INVALID_ARG";

function typedError(code, message) {
	const err = new Error(message);
	err.amberCode = code;
	return err;
}

// The closed nearest-neighbor table: the legacy ledger's status vocabulary
// mapped to the run nine-state vocabulary. Unmapped statuses refuse the
// projection with the raw value shown — never guessed. The legacy surface
// predates Runs, so every projection carries `legacy: true`.
const LEGACY_STATUS_MAP = Object.freeze({
	prepared: "admitted",
	executing: "running",
	completed: "completed",
	failed: "failed",
	blocked: "blocked",
});

function legacyExecutionDirForRead(targetRoot, taskId) {
	return statePath(targetRoot, "executions", taskId);
}

function readJsonStrict(file, label) {
	let raw;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch (err) {
		throw typedError(CODE_NOT_FOUND, `legacy ${label} is missing: ${file}`);
	}
	try {
		return JSON.parse(raw);
	} catch (err) {
		throw typedError(CODE_CORRUPT, `legacy ${label} is not valid JSON: ${file}`);
	}
}

/**
 * The declared §52 mapping for ONE legacy task: the old execution artifacts
 * projected onto the unified lifecycle vocabulary. Read-only; fails closed
 * per artifact (the specific path is named).
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.taskId
 */
function legacyTaskView(targetRoot, { taskId } = {}) {
	if (!taskId || typeof taskId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--task <id> is required for harness legacy task");
	}
	const dir = legacyExecutionDirForRead(targetRoot, taskId);
	if (!fs.existsSync(dir)) {
		throw typedError(
			CODE_NOT_FOUND,
			`no legacy execution artifacts for task "${taskId}" under ${dir}`,
		);
	}
	const ledger = readJsonStrict(path.join(dir, "ledger.json"), `ledger for task "${taskId}"`);
	const evidence = readJsonStrict(path.join(dir, "evidence.json"), `evidence for task "${taskId}"`);
	const replayPath = path.join(dir, "replay.md");
	if (!fs.existsSync(replayPath)) {
		throw typedError(CODE_NOT_FOUND, `legacy replay is missing: ${replayPath}`);
	}
	// The workspace pointer is part of the frozen legacy shape the view reads
	// (the old writer always created it beside the execution artifacts); a
	// missing pointer means the frozen shape is incomplete — fail closed like
	// every other artifact, never silently project half a shape.
	const worktreeDir = statePath(targetRoot, "worktrees", taskId);
	if (!fs.existsSync(worktreeDir)) {
		throw typedError(CODE_NOT_FOUND, `legacy worktree pointer is missing: ${worktreeDir}`);
	}
	// The old result semantics, mapped to the ValidationReceipt vocabulary:
	// replayable ⇔ all artifacts readable AND the old evidence declares no
	// chat-history requirement — exactly what the receipt's evidence check
	// would report for this artifact set (disclosed as the successor answer
	// to the old question, not a computed receipt).
	const replayable = ledger !== null && evidence.chatHistoryRequired === false;
	const legacyState = LEGACY_STATUS_MAP[ledger && ledger.status];
	if (legacyState === undefined) {
		throw typedError(
			CODE_CORRUPT,
			`legacy ledger status ${JSON.stringify(ledger && ledger.status)} is outside the closed nearest-neighbor table; refusing to guess a run state`,
		);
	}
	return {
		ok: true,
		taskId,
		legacy: true,
		runProjection: {
			legacy: true,
			subject: { task: taskId },
			state: legacyState,
			// A view over facts, never a Run record — never written under
			// .amber/harness/runs/ and never a participant in the machine.
			sourcePaths: {
				ledger: path.join(dir, "ledger.json"),
				evidence: path.join(dir, "evidence.json"),
				replay: replayPath,
				worktree: statePath(targetRoot, "worktrees", taskId),
			},
		},
		evidence: {
			// §52: Task + Run + Evidence — the old evidence.json is the
			// evidence bundle the mapping cites.
			correspondence: "evidence bundle",
			bundle: evidence,
		},
		result: {
			// §52: result → ValidationReceipt vocabulary — the old
			// replayable/chatHistoryRequired semantics, disclosed.
			correspondence: "ValidationReceipt vocabulary (disclosed successor answer, not a receipt)",
			replayable,
			chatHistoryRequired: !replayable,
			receiptAxes: {
				evidence: replayable ? "pass" : "fail",
				policy: "not-run",
				execution: "not-run",
				tools: "not-run",
				context: "not-run",
				attempts: "not-run",
			},
		},
		mapping: {
			task: "subject.task (§52 Task)",
			run: "legacy run projection (legacy: true — a view, never a record)",
			evidence: "evidence bundle (.amber/executions/<id>/evidence.json)",
			execution:
				"legacy worktree + ledger (the ExecutionContract+ExecutionRun correspondence; the old surface predates contracts)",
			result: "ValidationReceipt vocabulary (replayable / chatHistoryRequired)",
		},
	};
}

// The declared disposition table (§52): one row per deprecated surface.
const LEGACY_DISPOSITIONS = Object.freeze([
	{
		surface: "task",
		command: "amber task prepare",
		correspondence: "Task + legacy Run projection + Evidence (§52 Task + Run + Evidence)",
		status: "kept (mapping declared by harness legacy task)",
	},
	{
		surface: "result",
		command: "amber result inspect",
		correspondence: "ValidationReceipt vocabulary (replayable / chatHistoryRequired)",
		status: "kept (mapping declared by harness legacy task)",
	},
	{
		surface: "profile",
		command: "amber profile inspect",
		correspondence: null,
		status:
			"deletion candidate (no harness correspondence; superseded by governance/maintenance — removal is an explicit user decision)",
	},
]);

/**
 * The disposition table itself (no subaction): one row per old surface.
 */
function legacyDispositions() {
	return { ok: true, dispositions: [...LEGACY_DISPOSITIONS] };
}

/**
 * The declared disposition for the profile surface (no correspondence).
 */
function legacyProfileView() {
	const profile = LEGACY_DISPOSITIONS.find((d) => d.surface === "profile");
	return { ok: true, ...profile, declaredAbsence: true };
}

module.exports = {
	legacyTaskView,
	legacyDispositions,
	legacyProfileView,
	LEGACY_STATUS_MAP,
	LEGACY_DISPOSITIONS,
	CODE_NOT_FOUND,
	CODE_CORRUPT,
	CODE_INVALID_ARG,
};
