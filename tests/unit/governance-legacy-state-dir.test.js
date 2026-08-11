"use strict";

// Regression for #60: governance audit / evidence-export must read session +
// execution evidence through resolveStateDirForRead, so legacy .harness state
// (pre-migration) is visible. Previously these paths hardcoded .amber and missed
// .harness state that governance-readiness correctly found via the resolver.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { generateAuditReport, exportSessionEvidence } = require("../../scripts/lib/core/governance");

function tempDir(prefix) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

// Write a session under the LEGACY .harness state dir with NO .amber present,
// so resolveStateDirForRead must fall back to .harness (the path that was
// previously hardcoded away and thus invisible to audit/evidence-export).
function writeLegacySession(targetRoot, id, events) {
	const dir = path.join(targetRoot, ".harness", "sessions", id);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "timeline.jsonl"),
		events.map((e) => JSON.stringify(e)).join("\n"),
	);
}

test("generateAuditReport finds sessions under the legacy .harness state dir", () => {
	const target = tempDir("gov-legacy-audit");
	writeLegacySession(target, "s-legacy", [
		{ type: "session_created", timestamp: "2025-01-01T10:00:00Z", data: { goal: "legacy run" } },
		{ type: "command_executed", timestamp: "2025-01-01T10:05:00Z", data: { command: "npm test" } },
		{ type: "gate_passed", timestamp: "2025-01-01T10:10:00Z", data: { gate: "user-approval" } },
		{ type: "session_completed", timestamp: "2025-01-01T10:15:00Z", data: {} },
	]);

	const out = path.join(target, "audit.md");
	const result = generateAuditReport(target, out);
	const report = fs.readFileSync(out, "utf8");

	assert.equal(result.sessions, 1, "audit must find the 1 legacy .harness session");
	assert.match(report, /s-legacy/);
	assert.match(report, /legacy run/);
});

test("exportSessionEvidence reads a session under the legacy .harness state dir", () => {
	const target = tempDir("gov-legacy-evidence");
	writeLegacySession(target, "s-legacy", [
		{ type: "session_created", timestamp: "2025-01-01T10:00:00Z", data: { goal: "legacy run" } },
		{ type: "command_executed", timestamp: "2025-01-01T10:05:00Z", data: { command: "npm test" } },
		{ type: "session_completed", timestamp: "2025-01-01T10:15:00Z", data: {} },
	]);

	const out = path.join(target, "evidence.md");
	const result = exportSessionEvidence("s-legacy", target, out);
	const report = fs.readFileSync(out, "utf8");

	assert.equal(result.exported, true);
	assert.equal(result.events, 3);
	assert.match(report, /legacy run/);
	assert.match(report, /npm test/);
});
