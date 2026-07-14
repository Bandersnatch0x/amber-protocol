"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execSync, spawnSync } = require("node:child_process");
const {
	evaluateCompletion,
	formatCompletion,
	isScaffoldHandoffContent,
	isLiveHandoff,
} = require("../../scripts/lib/completion-check");

function tempRoot() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-completion-"));
}

/** Non-scaffold handoff content (matches generator shape, not init template). */
const LIVE_HANDOFF = `# Session Handoff

## Summary

Active session \`abc\` — "goal" (executing). 1 feature(s): 1 passing

## Repo State

- Branch: main
- Uncommitted changes: clean
- Last commit: abc123 work

## Runtime / Verification State

- Command: npm test
- Result: passed (exit 0, 10ms)
- When: 2026-07-11

## Feature State

- F001 [passing] Demo

## Verification Evidence

- F001: \`npm test\` → passed

## Blockers

None recorded.

## Next Actions

1. Accept the plan
`;

function buildSession(root, sessionId, manifest, timelineEvents = [], opts = {}) {
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
	if (opts.handoff !== false) {
		const content = opts.handoffContent != null ? opts.handoffContent : LIVE_HANDOFF;
		fs.writeFileSync(path.join(root, "session-handoff.md"), content);
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

test("init scaffold handoff is not live (G2)", () => {
	const scaffold = `# Session Handoff

## Summary

The repository-local Harness has been scaffolded and is ready for project-specific customization.

## Repo State

- Branch: not recorded
- Uncommitted changes: not recorded

## Runtime / Verification State

- Command: not run yet
- Result: pending
`;
	assert.equal(isScaffoldHandoffContent(scaffold), true);
	assert.equal(isScaffoldHandoffContent(LIVE_HANDOFF), false);

	const root = tempRoot();
	fs.writeFileSync(path.join(root, "session-handoff.md"), scaffold);
	assert.equal(isLiveHandoff(root), false);
	fs.writeFileSync(path.join(root, "session-handoff.md"), LIVE_HANDOFF);
	assert.equal(isLiveHandoff(root), true);
});

test("fails complete-check when handoff is still the init scaffold (G2)", () => {
	const root = tempRoot();
	const sessionId = "scaffold-handoff";
	const scaffold = fs.readFileSync(
		path.join(__dirname, "..", "..", "templates", "session-handoff.md"),
		"utf8",
	);
	buildSession(
		root,
		sessionId,
		{
			sessionId,
			goal: "Fix login bug",
			status: "executing",
			completedStages: ["verify"],
		},
		[
			{ type: "session_created" },
			{ type: "stage_completed", data: { executed: true, exitCode: 0 } },
			{ type: "gate_passed", data: { gate: "final" } },
		],
		{ handoffContent: scaffold },
	);

	const result = evaluateCompletion(root, sessionId, { strict: true });
	assert.equal(result.status, "fail");
	assert.ok(result.missing.includes("handoff"), `missing=${result.missing.join(",")}`);
});

test("manifest.handoff.path alone does not pass when file is scaffold", () => {
	const root = tempRoot();
	const sessionId = "manifest-only-scaffold";
	const scaffold = `# Session Handoff\n\nThe repository-local Harness has been scaffolded.\n\n- Command: not run yet\n- Result: pending\n`;
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
			{ type: "stage_completed", data: { executed: true } },
			{ type: "gate_passed" },
		],
		{ handoffContent: scaffold },
	);
	const result = evaluateCompletion(root, sessionId);
	assert.equal(result.status, "fail");
	assert.ok(result.missing.includes("handoff"));
});

test("fails when the session did no work in a git repo (strict)", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-work-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: root });
	fs.writeFileSync(path.join(root, "README.md"), "# x\n");
	// Commit live handoff with the scaffold so writing it later does not count as session work.
	fs.writeFileSync(path.join(root, "session-handoff.md"), LIVE_HANDOFF);
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
		{ handoff: false }, // already committed above
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

// test: regression #56 - complete-check --strict must reject template/scaffold handoff (via CLI path too); live handoff passes. Tests only.
test("complete-check --strict rejects init-scaffold/template handoff via CLI (G2)", () => {
	const root = tempRoot();
	const sessionId = "cli-template-reject-56";
	const scaffold = fs.readFileSync(
		path.join(__dirname, "..", "..", "templates", "session-handoff.md"),
		"utf8",
	);
	buildSession(
		root,
		sessionId,
		{
			sessionId,
			goal: "regression test template handoff reject",
			status: "executing",
			completedStages: ["verify"],
		},
		[
			{ type: "session_created" },
			{ type: "stage_completed", data: { executed: true, exitCode: 0 } },
			{ type: "gate_passed", data: { gate: "final" } },
		],
		{ handoffContent: scaffold },
	);

	const AMBER = path.join(__dirname, "..", "..", "scripts", "amber.js");
	const check = spawnSync(
		process.execPath,
		[AMBER, "session", "complete-check", "--target", root, "--session", sessionId, "--strict"],
		{ encoding: "utf8" },
	);
	assert.equal(check.status, 1, "CLI scaffold reject exit code");
	assert.match(check.stdout || "", /Completion check status: fail/);
	assert.match(check.stdout || "", /Missing:.*handoff/);
	const direct = evaluateCompletion(root, sessionId, { strict: true });
	assert.equal(direct.status, "fail");
	assert.ok(direct.missing.includes("handoff"));
	fs.rmSync(root, { recursive: true, force: true });
});

test("complete-check --strict passes for live handoff via CLI", () => {
	const root = tempRoot();
	const sessionId = "cli-live-handoff-pass-56";
	buildSession(
		root,
		sessionId,
		{
			sessionId,
			goal: "regression test live handoff pass",
			status: "executing",
			completedStages: ["verify"],
		},
		[
			{ type: "session_created" },
			{ type: "stage_completed", data: { executed: true, exitCode: 0 } },
			{ type: "gate_passed", data: { gate: "final" } },
		],
	);

	const AMBER = path.join(__dirname, "..", "..", "scripts", "amber.js");
	const check = spawnSync(
		process.execPath,
		[AMBER, "session", "complete-check", "--target", root, "--session", sessionId, "--strict"],
		{ encoding: "utf8" },
	);
	assert.equal(check.status, 0, "CLI live pass exit");
	assert.match(check.stdout || "", /Completion check status: pass/);
	fs.rmSync(root, { recursive: true, force: true });
});
