"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { startSession, approveSession } = require("../../scripts/lib/session-commands");

function tmpRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-ai-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
	fs.writeFileSync(path.join(dir, ".gitignore"), ".amber/\n");
	fs.writeFileSync(path.join(dir, "x.txt"), "hi");
	execSync("git add -A && git commit -qm init", { cwd: dir });
	return dir;
}

// node:test runs with a non-TTY stdin, so these exercise the agent/pipe path.
test("refuses approval in a non-interactive shell without --yes", async () => {
	const dir = tmpRepo();
	const s = await startSession(dir, { goal: "add login feature", route: "feature-standard" });
	const r = await approveSession(dir, { sessionId: s.sessionId, gate: "user-approval-plan" });
	assert.equal(r.exitCode, 1);
	assert.match(r.text, /needs human approval/);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("--yes approves and records the approval source", async () => {
	const dir = tmpRepo();
	const s = await startSession(dir, { goal: "add login feature", route: "feature-standard" });
	const r = await approveSession(dir, {
		sessionId: s.sessionId,
		gate: "user-approval-plan",
		yes: true,
	});
	assert.equal(r.exitCode, 0);
	const tl = path.join(dir, ".amber", "sessions", s.sessionId, "timeline.jsonl");
	const events = fs.readFileSync(tl, "utf8").trim().split("\n").map(JSON.parse);
	const gate = events.find((e) => e.type === "gate_passed");
	assert.ok(gate);
	assert.equal(gate.data.approvedBy, "flag (--yes)");
	fs.rmSync(dir, { recursive: true, force: true });
});
