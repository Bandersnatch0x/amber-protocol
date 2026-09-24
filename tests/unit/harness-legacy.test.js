"use strict";

// F075 — Legacy surface dispositions (§52). Conformance over FROZEN
// fixtures: the legacy writer (persistExecutionArtifacts) is deprecated and
// frozen — its persisted shape (.amber/executions/<taskId>/{ledger.json,
// evidence.json,replay.md} plus .amber/worktrees/<taskId>/) will not change
// before removal, so hand-written fixtures mirroring that exact shape are
// the honest conformance surface (driving the real `amber task prepare`
// would require a valid plan gate + active session — heavier than the
// legacy reader's contract warrants; disclosed in the spec).
// The view is read-only and fails closed per artifact; the §52 discipline is
// "declared, not improvised".

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	legacyTaskView,
	legacyDispositions,
	LEGACY_STATUS_MAP,
	CODE_NOT_FOUND,
	CODE_CORRUPT,
} = require("../../scripts/lib/harness/legacy-core");
const { dispatch } = require("../../scripts/lib/command-dispatcher");

function tmpTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-harness-legacy-"));
}

// Byte-level "writes nothing" pin (the spec's wording, exactly): every file
// under the target keyed by repo-relative path with its exact bytes, plus
// every directory (so a created-but-empty runs dir is caught too).
function snapshot(target) {
	const files = {};
	const dirs = [];
	const walk = (dir) => {
		dirs.push(path.relative(target, dir));
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else files[path.relative(target, full)] = fs.readFileSync(full);
		}
	};
	walk(target);
	return { files, dirs };
}

// The frozen legacy shape, mirrored exactly from persistExecutionArtifacts.
function writeLegacyTask(target, taskId, overrides = {}) {
	const dir = path.join(target, ".amber", "executions", taskId);
	fs.mkdirSync(dir, { recursive: true });
	// A string override is written RAW (e.g. a corrupt-JSON fixture); an
	// object override is JSON-encoded; undefined writes the canonical shape.
	const ledgerBody =
		overrides.ledger === undefined
			? JSON.stringify({ task: taskId, status: "prepared", plan: "docs/plans/x.md" }, null, 2)
			: typeof overrides.ledger === "string"
				? overrides.ledger
				: JSON.stringify(overrides.ledger, null, 2);
	fs.writeFileSync(path.join(dir, "ledger.json"), ledgerBody, "utf8");
	if (overrides.evidence !== null) {
		fs.writeFileSync(
			path.join(dir, "evidence.json"),
			JSON.stringify(
				overrides.evidence === undefined
					? { chatHistoryRequired: false, trace: "t" }
					: overrides.evidence,
				null,
				2,
			),
			"utf8",
		);
	}
	if (overrides.replay !== false) {
		fs.writeFileSync(path.join(dir, "replay.md"), "# Replay\n", "utf8");
	}
	fs.mkdirSync(path.join(target, ".amber", "worktrees", taskId), { recursive: true });
}

test("a complete legacy task projects the full declared §52 mapping (Task + legacy Run + Evidence + Receipt vocabulary)", () => {
	const target = tmpTarget();
	writeLegacyTask(target, "old-task-1");
	const before = snapshot(target);
	const view = legacyTaskView(target, { taskId: "old-task-1" });
	assert.equal(view.legacy, true);
	assert.equal(view.runProjection.legacy, true); // a view, never a record
	assert.equal(view.runProjection.state, "admitted"); // prepared → nearest neighbor
	assert.equal(view.runProjection.subject.task, "old-task-1");
	assert.equal(view.evidence.correspondence, "evidence bundle");
	assert.equal(view.result.replayable, true);
	assert.equal(view.result.receiptAxes.evidence, "pass");
	assert.deepEqual(Object.keys(view.mapping).sort(), [
		"evidence",
		"execution",
		"result",
		"run",
		"task",
	]);
	// No Run record was created — the projection stays a view (pinned by
	// bytes: run-record files, harness ledgers, and the directory tree are
	// all byte-identical after the view).
	assert.deepEqual(snapshot(target), before);
});

test("missing or corrupt artifacts fail closed with the specific path; unknown status refuses (never guessed)", () => {
	const target = tmpTarget();
	assert.throws(
		() => legacyTaskView(target, { taskId: "ghost" }),
		(err) => err.amberCode === CODE_NOT_FOUND,
	);
	writeLegacyTask(target, "t2", { replay: false });
	assert.throws(
		() => legacyTaskView(target, { taskId: "t2" }),
		(err) => err.amberCode === CODE_NOT_FOUND && /replay/.test(err.message),
	);
	writeLegacyTask(target, "t3", { ledger: "{not json" });
	assert.throws(
		() => legacyTaskView(target, { taskId: "t3" }),
		(err) => err.amberCode === CODE_CORRUPT,
	);
	writeLegacyTask(target, "t4", { ledger: { task: "t4", status: "weird-status" } });
	assert.throws(
		() => legacyTaskView(target, { taskId: "t4" }),
		(err) => err.amberCode === CODE_CORRUPT && /weird-status/.test(err.message),
	);
	// Missing evidence refuses too — every legacy artifact is required and
	// named (the same discipline the old result-inspect had).
	writeLegacyTask(target, "t5", { evidence: null });
	assert.throws(
		() => legacyTaskView(target, { taskId: "t5" }),
		(err) => err.amberCode === CODE_NOT_FOUND && /evidence/.test(err.message),
	);
	// The workspace pointer is part of the frozen shape — a missing worktree
	// directory refuses exactly like the other artifacts (half a shape is
	// never projected).
	writeLegacyTask(target, "t6");
	fs.rmSync(path.join(target, ".amber", "worktrees", "t6"), { recursive: true, force: true });
	assert.throws(
		() => legacyTaskView(target, { taskId: "t6" }),
		(err) => err.amberCode === CODE_NOT_FOUND && /worktree pointer/.test(err.message),
	);
});

test("the nearest-neighbor table is closed; the CLI subverbs smoke through the dispatcher", () => {
	const target = tmpTarget();
	assert.deepEqual(Object.keys(LEGACY_STATUS_MAP).sort(), [
		"blocked",
		"completed",
		"executing",
		"failed",
		"prepared",
	]);
	writeLegacyTask(target, "old-task-2", { ledger: { task: "old-task-2", status: "executing" } });
	const viaCli = dispatch("harness", { target, json: true, _: ["legacy", "task"] });
	assert.equal(viaCli.exitCode, 1); // no --task → invalid arg
	// The positional task id is not an affordance (the spec's sole surface is
	// --task <id>); a positional extra refuses the same way.
	const viaPositional = dispatch("harness", {
		target,
		json: true,
		_: ["legacy", "task", "old-task-2"],
	});
	assert.equal(viaPositional.exitCode, 1);
	const before = snapshot(target);
	const view = dispatch("harness", {
		target,
		json: true,
		task: "old-task-2",
		_: ["legacy", "task"],
	});
	assert.equal(view.exitCode, 0);
	assert.equal(view.result.runProjection.state, "running");
	const table = dispatch("harness", { target, json: true, _: ["legacy"] });
	assert.equal(table.result.dispositions.length, 3);
	const profile = dispatch("harness", { target, json: true, _: ["legacy", "profile"] });
	assert.equal(profile.result.declaredAbsence, true);
	assert.match(profile.result.status, /deletion candidate/);
	// The view wrote nothing (pinned by bytes — run-record files, harness
	// ledgers, and the directory tree are byte-identical after every call).
	assert.deepEqual(snapshot(target), before);
	// The direct core calls agree with the CLI citation (the dispatcher adds
	// its own envelope fields, so compare the payloads).
	assert.deepEqual(table.result.dispositions, legacyDispositions().dispositions);
	assert.equal(profile.result.declaredAbsence, true);
	assert.equal(profile.result.surface, "profile");
});
