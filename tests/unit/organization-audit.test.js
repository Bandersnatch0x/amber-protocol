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
	assert.ok(result.errors.length > 0, "corrupt ledger fails closed");
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
});
