"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
	evaluateCompletion,
	formatCompletion,
} = require("../../scripts/lib/completion-gate");

function tempRoot() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-completion-"));
}

function buildSession(root, sessionId, manifest, timelineEvents = []) {
	const sessionDir = path.join(root, ".amber", "sessions", sessionId);
	fs.mkdirSync(sessionDir, { recursive: true });
	fs.writeFileSync(
		path.join(sessionDir, "manifest.json"),
		JSON.stringify(manifest, null, 2),
	);
	if (timelineEvents.length > 0) {
		const lines = timelineEvents
			.map((event) => JSON.stringify({ timestamp: new Date().toISOString(), ...event }))
			.join("\n");
		fs.writeFileSync(path.join(sessionDir, "timeline.jsonl"), `${lines}\n`);
	}
}

test("passes when all completion evidence is present", () => {
	const root = tempRoot();
	const sessionId = "pass-session";
	buildSession(
		root,
		sessionId,
		{
			sessionId,
			goal: "Fix login bug",
			status: "completed",
			handoff: { path: "session-handoff.md" },
			completedStages: ["verify"],
		},
		[
			{ type: "session_created" },
			{ type: "stage_completed", data: { stage: "verify" } },
			{ type: "gate_passed", data: { gate: "final" } },
		],
	);

	const result = evaluateCompletion(root, sessionId);
	assert.equal(result.status, "pass");
	assert.ok(result.reasons.includes("goal present"));
	assert.ok(result.reasons.includes("approval present"));
	assert.equal(result.missing.length, 0);
});

test("fails when verification is missing", () => {
	const root = tempRoot();
	const sessionId = "missing-verification";
	buildSession(
		root,
		sessionId,
		{
			sessionId,
			goal: "Fix login bug",
			status: "completed",
			handoff: { path: "session-handoff.md" },
			completedStages: [],
		},
		[{ type: "session_created" }, { type: "gate_passed" }],
	);

	const result = evaluateCompletion(root, sessionId);
	assert.equal(result.status, "fail");
	assert.ok(result.missing.includes("verification"));
});

test("fails when approval is missing", () => {
	const root = tempRoot();
	const sessionId = "missing-approval";
	buildSession(
		root,
		sessionId,
		{
			sessionId,
			goal: "Fix login bug",
			status: "executing",
			handoff: { path: "session-handoff.md" },
			completedStages: ["verify"],
		},
		[{ type: "session_created" }, { type: "stage_completed" }],
	);

	const result = evaluateCompletion(root, sessionId);
	assert.equal(result.status, "fail");
	assert.ok(result.missing.includes("approval"));
});

test("fails when goal is missing", () => {
	const root = tempRoot();
	const sessionId = "missing-goal";
	buildSession(
		root,
		sessionId,
		{
			sessionId,
			status: "completed",
			handoff: { path: "session-handoff.md" },
			completedStages: ["verify"],
		},
		[{ type: "stage_completed" }, { type: "gate_passed" }],
	);

	const result = evaluateCompletion(root, sessionId);
	assert.equal(result.status, "fail");
	assert.ok(result.missing.includes("goal"));
});

test("fails when open blockers exist", () => {
	const root = tempRoot();
	const sessionId = "open-blocker";
	buildSession(
		root,
		sessionId,
		{
			sessionId,
			goal: "Fix login bug",
			status: "completed",
			handoff: { path: "session-handoff.md" },
			completedStages: ["verify"],
			blockers: [{ id: "b1", status: "open" }],
		},
		[{ type: "stage_completed" }, { type: "gate_passed" }],
	);

	const result = evaluateCompletion(root, sessionId);
	assert.equal(result.status, "fail");
	assert.ok(result.missing.includes("open blockers"));
});

test("formatCompletion produces readable output", () => {
	const text = formatCompletion({
		status: "fail",
		reasons: ["goal present"],
		missing: ["timeline"],
	});
	assert.match(text, /Completion status: fail/);
	assert.match(text, /Missing: timeline/);
});
