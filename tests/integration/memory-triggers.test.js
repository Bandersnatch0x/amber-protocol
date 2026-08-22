"use strict";

// T1/T2 memory write-back trigger mounting (ADR-0018 spec §5.1, F034).
//
// A trigger is a nomination contract + a single memory-request-created event:
// never a schema-fabricated request, never a γ consumer, never a MEMORY.md
// writer. T1 mounts after a successful strict session completion with handoff
// evidence; T2 mounts at the feature-accept write-back site when a booked path
// hits a detectWriteBackTriggers category.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	startSession,
	continueSession,
	completeSession,
	approveSession,
	verifySession,
} = require("../../scripts/lib/session-commands");
const { dispatch } = require("../../scripts/lib/command-dispatcher");
const memoryStore = require("../../scripts/lib/core/memory-store");
const { triggerWriteBackRequest, listTriggers } = require("../../scripts/lib/core/memory-trigger");
const { buildProjection } = require("../../scripts/lib/memory-commands");

function mkTarget({ handoff = true } = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-triggers-"));
	fs.writeFileSync(
		path.join(dir, "package.json"),
		JSON.stringify({ name: "t", scripts: { test: 'node -e "process.exit(0)"' } }),
	);
	if (handoff) {
		fs.writeFileSync(
			path.join(dir, "session-handoff.md"),
			"# Session Handoff\n\nVerification completed and the Session is ready to close.\n",
		);
	}
	// A target-local route set (session route resolution is target-relative).
	const { installTargetRoutes } = require("../helpers/target-routes");
	installTargetRoutes(dir, ["bugfix-quick"]);
	return dir;
}

function memoryEvents(target) {
	return memoryStore.readMemoryEvents(target, 0);
}

function gammaAdmitted(target) {
	return buildProjection(target).gamma.windowAdmitted;
}

// ── trigger module semantics ────────────────────────────────────────────────

test("triggerWriteBackRequest writes a nomination contract + event, exclusively", () => {
	const target = mkTarget();
	const first = triggerWriteBackRequest(target, { channel: "t1-writeback", triggerRef: "sess-1" });
	assert.equal(first.created, true);
	assert.match(first.triggerId, /^trig-/);

	const records = listTriggers(target);
	assert.equal(records.length, 1);
	assert.equal(records[0].channel, "t1-writeback");
	assert.equal(records[0].triggerRef.ref, "sess-1");
	assert.equal(records[0].status, "open");

	const events = memoryEvents(target);
	assert.equal(events.length, 1);
	assert.equal(events[0].kind, "memory-request-created");
	assert.equal(events[0].requestId, first.triggerId);
	assert.equal(events[0].channel, "t1-writeback");
	assert.equal(events[0].triggerRef.ref, "sess-1");
	assert.deepEqual(events[0].entryIds, [], "a trigger is a contract, never an admission");

	// γ counts admitted proposals only — a trigger consumes nothing (M3).
	assert.equal(gammaAdmitted(target), 0);
	// MEMORY.md is never touched by a trigger.
	assert.equal(fs.existsSync(path.join(target, "MEMORY.md")), false);

	// Exclusivity: the same trigger event never nominates twice.
	const duplicate = triggerWriteBackRequest(target, {
		channel: "t1-writeback",
		triggerRef: "sess-1",
	});
	assert.equal(duplicate.created, false);
	assert.equal(listTriggers(target).length, 1);
	assert.equal(memoryEvents(target).length, 1);

	// A different channel is a different trigger event.
	const t2 = triggerWriteBackRequest(target, { channel: "t2-writeback", triggerRef: "sess-1" });
	assert.equal(t2.created, true);
	assert.equal(listTriggers(target).length, 2);

	// Invalid channels are refused.
	assert.throws(() => triggerWriteBackRequest(target, { channel: "t3", triggerRef: "x" }));
	fs.rmSync(target, { recursive: true, force: true });
});

// ── T1: session completion mount ────────────────────────────────────────────

async function prepareStrictSession(target) {
	const start = await startSession(target, {
		goal: "fix memory trigger bug",
		route: "bugfix-quick",
	});
	await continueSession(target, { sessionId: start.sessionId });
	await approveSession(target, {
		sessionId: start.sessionId,
		gate: "user-approval-fix",
		yes: true,
	});
	const verification = await verifySession(target, {
		sessionId: start.sessionId,
		command: "npm test",
		execute: true,
	});
	assert.equal(verification.exitCode, 0, verification.text);
	return start;
}

test("T1 fires exactly once on strict completion with handoff evidence", async () => {
	const target = mkTarget();
	const start = await prepareStrictSession(target);
	const memoryMdBefore = fs.readFileSync(path.join(target, "MEMORY.md"), "utf8");
	const completion = await completeSession(target, { sessionId: start.sessionId, strict: true });
	assert.equal(completion.exitCode, 0, completion.text);

	const warnings = (completion.warnings || []).join("\n");
	assert.match(completion.text, /T1 memory write-back nomination created/, warnings);

	const records = listTriggers(target);
	assert.equal(records.length, 1);
	assert.equal(records[0].channel, "t1-writeback");
	assert.equal(records[0].triggerRef.ref, start.sessionId);

	const created = memoryEvents(target).filter((e) => e.kind === "memory-request-created");
	assert.equal(created.length, 1);
	assert.equal(created[0].channel, "t1-writeback");
	assert.deepEqual(created[0].entryIds, []);
	assert.equal(gammaAdmitted(target), 0, "M3: a nomination contract consumes no γ");
	assert.equal(
		fs.readFileSync(path.join(target, "MEMORY.md"), "utf8"),
		memoryMdBefore,
		"the trigger never edits MEMORY.md (the starter file came from session scaffolding)",
	);

	// Re-completing an already-completed session is a no-op — no second trigger.
	const again = await completeSession(target, { sessionId: start.sessionId, strict: true });
	assert.equal(again.exitCode, 0);
	assert.equal(listTriggers(target).length, 1);
	assert.equal(memoryEvents(target).filter((e) => e.kind === "memory-request-created").length, 1);
	fs.rmSync(target, { recursive: true, force: true });
});

test("T1 never fires when strict completion fails (M1: mount is post-transition)", async () => {
	const target = mkTarget({ handoff: false });
	const start = await startSession(target, {
		goal: "incomplete session",
		route: "bugfix-quick",
	});
	await continueSession(target, { sessionId: start.sessionId });
	await approveSession(target, {
		sessionId: start.sessionId,
		gate: "user-approval-fix",
		yes: true,
	});

	const refused = await completeSession(target, { sessionId: start.sessionId, strict: true });
	assert.notEqual(refused.exitCode, 0);
	assert.equal(listTriggers(target).length, 0, "no completion transition — no nomination");
	assert.equal(memoryEvents(target).length, 0);
	fs.rmSync(target, { recursive: true, force: true });
});

test("T1 stays silent on non-strict completion (explicit strict gate)", async () => {
	const target = mkTarget();
	const start = await prepareStrictSession(target);
	const completion = await completeSession(target, { sessionId: start.sessionId, strict: false });
	assert.equal(completion.exitCode, 0, completion.text);

	assert.equal(listTriggers(target).length, 0, "non-strict completion never nominates (§5.1-M2)");
	assert.equal(memoryEvents(target).filter((e) => e.kind === "memory-request-created").length, 0);
	fs.rmSync(target, { recursive: true, force: true });
});

// ── T2: feature accept mount ────────────────────────────────────────────────

function setupAcceptTarget(paths) {
	const dir = mkTarget();
	fs.mkdirSync(path.join(dir, "docs", "specs"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, "docs", "specs", "2026-08-21-governed-memory-layer.md"),
		"# Governed Memory Layer spec stub\n",
	);
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify({
			features: [
				{
					id: "F001",
					title: "trigger target",
					status: "passing",
					verification: ["node --test"],
					evidence: [{ command: "node --test", result: "passed", date: "2026-08-22" }],
					paths,
				},
			],
		}),
	);
	const planRel = "docs/plans/p.md";
	fs.mkdirSync(path.join(dir, "docs", "plans"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, planRel),
		[
			"# Plan: p",
			"",
			"Feature: F001",
			"Status: implemented-pending-verification",
			"User Confirmation: confirmed",
			"",
			"## Goal",
			"",
			"trigger target",
			"",
			"## High Level Design",
			"",
			"- x",
			"",
			"## Vertical Slices",
			"",
			"- [x] x",
			"",
			"## Resume Checkpoint",
			"",
			"- Resume Point: x",
			"- Blockers: none",
			"- Next Action: accept",
			"- Recovery Instructions: reopen the plan",
			"",
			"## Context manifests",
			"",
			"- implement: docs/specs/2026-08-21-governed-memory-layer.md",
			"- review: docs/specs/2026-08-21-governed-memory-layer.md",
			"",
			"## Acceptance Criteria",
			"",
			"- The user-visible behavior is demonstrably satisfied.",
			"- Existing Amber guardrails still pass.",
			"",
			"## Verification",
			"",
			"- node --test",
			"",
			"## Evidence Schema",
			"",
			"- Command: node --test",
			"- Result: passed",
			"- Date: 2026-08-22",
			"",
		].join("\n"),
	);
	return { dir, planRel };
}

test("T2 fires at feature accept when a write-back path category hits", () => {
	const { dir, planRel } = setupAcceptTarget(["schemas/memory-entry.schema.json"]);
	const { result } = dispatch("accept", { target: dir, plan: planRel });
	assert.equal(result.accepted, true, JSON.stringify(result.errors));

	const warnings = (result.warnings || []).join("\n");
	assert.match(warnings, /T2 memory write-back nomination created/);

	const records = listTriggers(dir);
	assert.equal(records.length, 1);
	assert.equal(records[0].channel, "t2-writeback");
	assert.equal(records[0].triggerRef.ref, "F001");

	const created = memoryEvents(dir).filter((e) => e.kind === "memory-request-created");
	assert.equal(created.length, 1);
	assert.equal(created[0].channel, "t2-writeback", "§9 payload: channel attribution");
	assert.equal(
		created[0].requestId,
		records[0].triggerId,
		"§9 payload: requestId anchors the trigger artifact",
	);
	assert.equal(created[0].triggerRef.ref, "F001", "§9 payload: triggerRef.ref linkage");
	assert.deepEqual(created[0].entryIds, [], "a trigger is a contract, never an admission");
	assert.equal(gammaAdmitted(dir), 0);
	assert.equal(fs.existsSync(path.join(dir, "MEMORY.md")), false);

	// Re-accept is idempotent — exclusivity holds the nomination at one.
	const again = dispatch("accept", { target: dir, plan: planRel });
	assert.equal(again.result.accepted, true);
	assert.equal(listTriggers(dir).length, 1);
	assert.equal(memoryEvents(dir).filter((e) => e.kind === "memory-request-created").length, 1);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("T2 stays silent when no write-back category hits", () => {
	const { dir, planRel } = setupAcceptTarget(["src/only.js"]);
	const { result } = dispatch("accept", { target: dir, plan: planRel });
	assert.equal(result.accepted, true, JSON.stringify(result.errors));
	assert.equal(listTriggers(dir).length, 0);
	assert.equal(memoryEvents(dir).length, 0);
	fs.rmSync(dir, { recursive: true, force: true });
});
