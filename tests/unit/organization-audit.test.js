"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	recordAuditEvent,
	listAuditEvents,
	auditCrossRepository,
	checkIsolation,
	recordRetentionAction,
} = require("../../scripts/lib/core/organization-audit");
const { mkTarget } = require("../helpers/harness");

// ── Fail-closed corruption fixtures (F035-S5, decision D4) ────
//
// Only an ABSENT ledger is a legitimate empty state. A corrupt or unreadable
// Organization audit ledger fails closed with the typed code AMBER_E_ORG_CORRUPT.

const ORG_CORRUPT = "AMBER_E_ORG_CORRUPT";

function auditLedgerFile(dir) {
	return path.join(dir, ".amber", "audit", "events.jsonl");
}

function goodEventLine(tenantId = "tenant-a", repositoryId = "repo-1") {
	return JSON.stringify({
		eventId: "e-1",
		tenantId,
		repositoryId,
		action: "policy-assign",
		actor: "admin@org",
		evidenceHash: "sha256:" + "a".repeat(64),
	});
}

// corrupt position matrix: first / middle / last JSONL line
const CORRUPT_LEDGERS = [
	["first line corrupt", ["{ not json", goodEventLine(), goodEventLine("tenant-b", "repo-2")]],
	["middle line corrupt", [goodEventLine(), "{ not json", goodEventLine("tenant-b", "repo-2")]],
	["last line corrupt", [goodEventLine(), goodEventLine("tenant-b", "repo-2"), "{ not json"]],
];

function writeLedger(dir, lines) {
	fs.mkdirSync(path.dirname(auditLedgerFile(dir)), { recursive: true });
	fs.writeFileSync(auditLedgerFile(dir), lines.join("\n") + "\n");
}

/** assert.throws validator: the error is a typed corruption failure. */
function assertTypedCorruption(err) {
	assert.equal(err.amberCode, ORG_CORRUPT, "typed corruption code");
	assert.ok(err.message.includes(ORG_CORRUPT), "diagnostics carry the code");
	assert.ok(err.message.length > ORG_CORRUPT.length, "diagnostics are non-empty");
	return true;
}

// ── Audit ledger ──────────────────────────────────────────────

test("recordAuditEvent appends an evidence-backed event", () => {
	const dir = mkTarget("event");
	const event = recordAuditEvent(dir, {
		tenantId: "tenant-a",
		repositoryId: "repo-1",
		action: "policy-assign",
		actor: "admin@org",
	});
	assert.ok(event.eventId);
	assert.ok(event.evidenceHash, "evidence hash present");
	assert.match(event.evidenceHash, /^sha256:[0-9a-f]{64}$/);
	assert.ok(event.timestamp);

	const events = listAuditEvents(dir);
	assert.equal(events.length, 1);
	assert.equal(events[0].tenantId, "tenant-a");
});

test("listAuditEvents returns empty when no events", () => {
	const dir = mkTarget("empty");
	assert.deepEqual(listAuditEvents(dir), []);
});

test("audit events are append-only", () => {
	const dir = mkTarget("append");
	recordAuditEvent(dir, { tenantId: "a", repositoryId: "r1", action: "x", actor: "u1" });
	recordAuditEvent(dir, { tenantId: "b", repositoryId: "r2", action: "y", actor: "u2" });
	const events = listAuditEvents(dir);
	assert.equal(events.length, 2);
	assert.notEqual(events[0].eventId, events[1].eventId);
});

// ── Tenant/Repository isolation ───────────────────────────────

test("checkIsolation enforces tenant + repository scope", () => {
	const dir = mkTarget("isolation");
	recordAuditEvent(dir, { tenantId: "tenant-a", repositoryId: "repo-1", action: "x", actor: "u" });
	recordAuditEvent(dir, { tenantId: "tenant-b", repositoryId: "repo-2", action: "y", actor: "u" });

	// auditor scoped to tenant-a sees only tenant-a events
	const result = checkIsolation(dir, { tenantId: "tenant-a" });
	assert.equal(result.ok, true);
	assert.ok(result.events.every((e) => e.tenantId === "tenant-a"));
	assert.equal(result.events.length, 1);

	// auditor scoped to tenant-a + repo-1 sees only that cell
	const narrow = checkIsolation(dir, { tenantId: "tenant-a", repositoryId: "repo-1" });
	assert.equal(narrow.ok, true);
	assert.equal(narrow.events.length, 1);
});

test("checkIsolation denies cross-tenant access (deny-wins)", () => {
	const dir = mkTarget("cross-tenant");
	recordAuditEvent(dir, { tenantId: "tenant-a", repositoryId: "repo-1", action: "x", actor: "u" });

	// tenant-b auditor asking about tenant-a → denied (not empty, denied)
	const result = checkIsolation(dir, { tenantId: "tenant-b", queryTenantId: "tenant-a" });
	assert.equal(result.ok, false);
	assert.equal(result.code, "AMBER_E_ORG_DENY");
});

// ── Cross-repository audit ────────────────────────────────────

test("auditCrossRepository is exact-scope and deny-wins", () => {
	const dir = mkTarget("cross-repo");
	recordAuditEvent(dir, {
		tenantId: "tenant-a",
		repositoryId: "repo-1",
		action: "gate-pass",
		actor: "u",
	});
	recordAuditEvent(dir, {
		tenantId: "tenant-a",
		repositoryId: "repo-2",
		action: "gate-fail",
		actor: "u",
	});

	const result = auditCrossRepository(dir, { tenantId: "tenant-a", scope: "repo-1" });
	assert.equal(result.ok, true);
	assert.equal(result.events.length, 1);
	assert.equal(result.events[0].repositoryId, "repo-1");
});

test("auditCrossRepository denies an unknown scope (deny-wins, never empty)", () => {
	const dir = mkTarget("deny");
	recordAuditEvent(dir, { tenantId: "tenant-a", repositoryId: "repo-1", action: "x", actor: "u" });
	const result = auditCrossRepository(dir, { tenantId: "tenant-a", scope: "ghost-repo" });
	assert.equal(result.ok, false);
	assert.equal(result.code, "AMBER_E_ORG_DENY");
});

test("auditCrossRepository with no scope is denied (deny-wins ambiguity)", () => {
	const dir = mkTarget("noscope");
	recordAuditEvent(dir, { tenantId: "tenant-a", repositoryId: "repo-1", action: "x", actor: "u" });
	const result = auditCrossRepository(dir, { tenantId: "tenant-a", scope: null });
	assert.equal(result.ok, false, "ambiguous (unscoped) audit is denied, never guessed");
});

// ── Retention / deletion / revocation ─────────────────────────

test("recordRetentionAction is evidence-backed", () => {
	const dir = mkTarget("retention");
	const result = recordRetentionAction(dir, {
		tenantId: "tenant-a",
		repositoryId: "repo-1",
		action: "revoke",
		target: "actor-123",
		reason: "offboarding",
	});
	assert.equal(result.ok, true);
	assert.ok(result.event.evidenceHash);
	assert.equal(result.event.action, "revoke");

	const events = listAuditEvents(dir);
	assert.equal(events.length, 1);
	assert.equal(events[0].action, "revoke");
});

test("recordRetentionAction persists target and reason to the ledger", () => {
	const dir = mkTarget("retention-ledger");
	const result = recordRetentionAction(dir, {
		tenantId: "tenant-a",
		repositoryId: "repo-1",
		action: "revoke",
		target: "actor-123",
		reason: "offboarding",
	});
	assert.equal(result.ok, true);
	const ledger = listAuditEvents(dir);
	assert.equal(ledger.length, 1);
	assert.equal(ledger[0].target, "actor-123", "ledger copy carries target");
	assert.equal(ledger[0].reason, "offboarding", "ledger copy carries reason");
	const ev = result.event;
	assert.ok(ev.evidenceHash);
	assert.equal(ev.target, "actor-123");
	assert.equal(ev.reason, "offboarding");
});

test("recordRetentionAction rejects unknown action types", () => {
	const dir = mkTarget("bad-action");
	const result = recordRetentionAction(dir, {
		tenantId: "tenant-a",
		repositoryId: "repo-1",
		action: "explode",
		target: "x",
		reason: "y",
	});
	assert.equal(result.ok, false);
});

// ── Fail-closed ───────────────────────────────────────────────

test("audit fails closed on a corrupt ledger", () => {
	const dir = mkTarget("corrupt");
	fs.mkdirSync(path.join(dir, ".amber", "audit"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".amber", "audit", "events.jsonl"), "{ broken\n");
	const result = auditCrossRepository(dir, { tenantId: "a", scope: "repo-1" });
	assert.equal(result.ok, false);
	assert.equal(result.code, ORG_CORRUPT, "corruption carries the explicit typed code");
	assert.deepEqual(result.events, [], "corruption yields an empty payload");
	assert.ok(result.errors.length > 0, "corrupt ledger fails closed");
	assert.ok(result.errors[0].includes(ORG_CORRUPT), "diagnostics carry the code");
});

test("cross-tenant isolation denies (deny-wins)", () => {
	const dir = mkTarget("isolation-denied");
	recordAuditEvent(dir, {
		tenantId: "tenant-a",
		repositoryId: "repo-1",
		action: "retain",
		actor: "ops",
	});
	const result = checkIsolation(dir, {
		tenantId: "tenant-a",
		queryTenantId: "tenant-b",
	});
	assert.equal(result.ok, false);
	assert.equal(result.code, "AMBER_E_ORG_DENY");
	assert.ok(
		result.errors.every((e) => !e.includes(ORG_CORRUPT)),
		"a denial is never misreported as corruption",
	);
});

// ── Fail-closed corruption (F035-S5, decision D4) ────────────
//
// Only an ABSENT ledger is a legitimate empty state. A corrupt or unreadable
// Organization audit ledger produces a typed failure — never an empty
// successful array and never an untyped ok:false.

test("listAuditEvents fails closed on a corrupt ledger (first/middle/last line)", () => {
	for (const [label, lines] of CORRUPT_LEDGERS) {
		const dir = mkTarget("corrupt-events");
		writeLedger(dir, lines);
		assert.throws(() => listAuditEvents(dir), assertTypedCorruption, `listAuditEvents: ${label}`);
	}
});

test("listAuditEvents fails closed on an unreadable ledger (filesystem read error)", () => {
	const dir = mkTarget("corrupt-events-unreadable");
	// a directory where the ledger file is expected → readFileSync fails
	fs.mkdirSync(auditLedgerFile(dir), { recursive: true });
	assert.throws(() => listAuditEvents(dir), assertTypedCorruption);
});

test("checkIsolation reports the typed corruption code on a corrupt ledger", () => {
	const dir = mkTarget("corrupt-isolation");
	writeLedger(dir, [goodEventLine(), "{ not json", goodEventLine("tenant-b", "repo-2")]);
	const result = checkIsolation(dir, { tenantId: "tenant-a" });
	assert.equal(result.ok, false);
	assert.equal(result.code, ORG_CORRUPT);
	assert.deepEqual(result.events, [], "empty payload");
	assert.ok(result.errors.length > 0, "non-empty diagnostics");
	assert.ok(result.errors[0].includes(ORG_CORRUPT), "diagnostics carry the code");
});

test("auditCrossRepository reports the typed corruption code on a corrupt ledger", () => {
	const dir = mkTarget("corrupt-cross-repo");
	writeLedger(dir, [goodEventLine(), "{ not json", goodEventLine("tenant-b", "repo-2")]);
	const result = auditCrossRepository(dir, { tenantId: "tenant-a", scope: "repo-1" });
	assert.equal(result.ok, false);
	assert.equal(result.code, ORG_CORRUPT);
	assert.deepEqual(result.events, [], "empty payload");
	assert.ok(result.errors.length > 0, "non-empty diagnostics");
	assert.ok(result.errors[0].includes(ORG_CORRUPT), "diagnostics carry the code");
});
