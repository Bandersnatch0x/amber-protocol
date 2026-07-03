"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execSync } = require("node:child_process");
const {
	evaluateCompletion,
	formatCompletion,
} = require("../../scripts/lib/completion-check");

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

test("reports a corrupt manifest as fail instead of throwing", () => {
	const root = tempRoot();
	const sessionId = "corrupt-session";
	const sessionDir = path.join(root, ".amber", "sessions", sessionId);
	fs.mkdirSync(sessionDir, { recursive: true });
	fs.writeFileSync(path.join(sessionDir, "manifest.json"), "{ broken json");
	// A corrupt manifest must be reported as a failed gate, symmetric with the
	// existing "manifest not found" handling, rather than crashing the check.
	const result = evaluateCompletion(root, sessionId);
	assert.equal(result.status, "fail");
	assert.ok(result.missing.includes("manifest is corrupt"));
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
	assert.match(text, /Completion check status: fail/);
	assert.match(text, /Missing: timeline/);
});

test("fails when the session did no work in a git repo (strict)", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-work-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: root });
	fs.writeFileSync(path.join(root, "README.md"), "# x\n");
	execSync("git add -A && git commit -qm init", { cwd: root });

	const sessionId = "no-work";
	buildSession(
		root,
		sessionId,
		{
			sessionId,
			goal: "add feature",
			status: "completed",
			createdAt: new Date().toISOString(),
			handoff: { path: "session-handoff.md" },
			completedStages: ["verify"],
		},
		[{ type: "stage_completed", data: { executed: false } }, { type: "gate_passed" }],
	);

	// A clean tree with no commits since createdAt has no work evidence.
	const relaxed = evaluateCompletion(root, sessionId);
	assert.ok(relaxed.missing.includes("work"), "work missing in default mode");

	// Strict additionally rejects claim-only verification.
	const strict = evaluateCompletion(root, sessionId, { strict: true });
	assert.equal(strict.status, "fail");
	assert.ok(strict.missing.includes("verification"), "strict rejects executed:false");
	fs.rmSync(root, { recursive: true, force: true });
});

test("passes work check when the tree is dirty", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-work2-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: root });
	fs.writeFileSync(path.join(root, "README.md"), "# x\n");
	execSync("git add -A && git commit -qm init", { cwd: root });
	fs.writeFileSync(path.join(root, "feature.js"), "// new work\n"); // dirty tree

	const sessionId = "dirty";
	buildSession(
		root,
		sessionId,
		{
			sessionId,
			goal: "add feature",
			status: "completed",
			createdAt: new Date().toISOString(),
			handoff: { path: "session-handoff.md" },
			completedStages: ["verify"],
		},
		[{ type: "stage_completed", data: { executed: true, exitCode: 0 } }, { type: "gate_passed" }],
	);

	const strict = evaluateCompletion(root, sessionId, { strict: true });
	assert.equal(strict.status, "pass");
	fs.rmSync(root, { recursive: true, force: true });
});
