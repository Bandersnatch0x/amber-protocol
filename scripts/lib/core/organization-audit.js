"use strict";

/**
 * Organization Profile audit + policy tracer (#167).
 *
 * Enforces Tenant/Repository isolation, exact-scope cross-repository audit
 * with deny-wins semantics, and evidence-backed retention/deletion/revocation.
 *
 * Deny-wins: an ambiguous or unauthorized audit scope is DENIED (never an
 * empty-but-ok result, never a guess). All audit events are append-only with
 * an evidence hash. Reads fail closed on a corrupt ledger.
 *
 * Fail-closed reads (F035-S5, decision D4): only an ABSENT ledger is a
 * legitimate empty state. A corrupt or unreadable ledger is a typed failure
 * (AMBER_E_ORG_CORRUPT) — never an empty successful array.
 */

const crypto = require("node:crypto");
const { sha256 } = require("./context-hash");
const { appendJSONL, readLedgerFailClosed } = require("./jsonl");
const fs = require("node:fs");
const { statePathForCreate } = require("../state-dir-resolver");

const RETENTION_ACTIONS = Object.freeze(["retain", "delete", "revoke"]);
const ORG_CORRUPT_CODE = "AMBER_E_ORG_CORRUPT";

// Organization-audit state (#167, post-rename state kind): the ledger never
// existed under .harness, so reads and creates both target the canonical dir —
// statePathForCreate keeps the write policy (always .amber) even on a
// not-yet-migrated legacy repo, and reads lose nothing under either policy.
function auditLedgerPath(cwd) {
	return statePathForCreate(cwd, "audit", "events.jsonl");
}

function ensureDir(cwd) {
	fs.mkdirSync(statePathForCreate(cwd, "audit"), { recursive: true });
}

function readAllEvents(cwd) {
	// fail closed: any corrupt line is an error, never a silent gap
	return readLedgerFailClosed(auditLedgerPath(cwd), ORG_CORRUPT_CODE, "organization audit");
}

/**
 * Record an evidence-backed audit event (append-only).
 * @param {string} cwd - Repository root.
 * @param {{tenantId: string, repositoryId: string, action: string, actor: string, target?: string|null, reason?: string|null}} input
 * @returns {object} The event.
 */
function recordAuditEvent(
	cwd,
	{ tenantId, repositoryId, action, actor, target = null, reason = null },
) {
	ensureDir(cwd);
	const payload = {
		tenantId,
		repositoryId,
		action,
		actor,
		timestamp: new Date().toISOString(),
		...(target != null ? { target } : {}),
		...(reason != null ? { reason } : {}),
	};
	const event = {
		eventId: crypto.randomUUID(),
		...payload,
		evidenceHash: sha256(JSON.stringify(payload)),
	};
	return appendJSONL(auditLedgerPath(cwd), event);
}

/**
 * List all audit events.
 *
 * An absent ledger is a legitimate empty state ([]); a corrupt or unreadable
 * ledger throws the typed AMBER_E_ORG_CORRUPT error instead of masquerading
 * as "no events" (F035-S5, decision D4).
 * @param {string} cwd - Repository root.
 * @returns {Array<object>}
 * @throws {Error} Typed AMBER_E_ORG_CORRUPT error when the ledger is corrupt or unreadable.
 */
function listAuditEvents(cwd) {
	return readAllEvents(cwd);
}

/**
 * Enforce tenant + repository isolation for an auditor. A corrupt or
 * unreadable ledger is a typed corruption failure — distinct from a
 * cross-tenant denial (AMBER_E_ORG_DENY) and never an empty success (F035-S5).
 * @param {string} cwd - Repository root.
 * @param {{tenantId: string, repositoryId?: string|null, queryTenantId?: string|null}} params
 * @returns {{ok: boolean, code: string|null, events: Array<object>, errors: string[]}}
 */
function checkIsolation(cwd, { tenantId, repositoryId = null, queryTenantId = null }) {
	let events;
	try {
		events = readAllEvents(cwd);
	} catch (err) {
		return {
			ok: false,
			code: err.amberCode || ORG_CORRUPT_CODE,
			events: [],
			errors: [err.message],
		};
	}
	// cross-tenant query is denied, never an empty-but-ok result
	if (queryTenantId && queryTenantId !== tenantId) {
		return {
			ok: false,
			code: "AMBER_E_ORG_DENY",
			events: [],
			errors: ["cross-tenant audit denied"],
		};
	}
	const filtered = events.filter((e) => {
		if (e.tenantId !== tenantId) return false;
		if (repositoryId && e.repositoryId !== repositoryId) return false;
		return true;
	});
	return { ok: true, code: null, events: filtered, errors: [] };
}

/**
 * Exact-scope cross-repository audit with deny-wins semantics. A corrupt or
 * unreadable ledger is a typed corruption failure — distinct from a scope
 * denial (AMBER_E_ORG_DENY) and never an empty success (F035-S5).
 * @param {string} cwd - Repository root.
 * @param {{tenantId: string, scope: string|null}} params
 * @returns {{ok: boolean, code: string|null, events: Array<object>, errors: string[]}}
 */
function auditCrossRepository(cwd, { tenantId, scope }) {
	// deny-wins: no scope or unknown scope is denied, never guessed
	if (!scope || typeof scope !== "string") {
		return {
			ok: false,
			code: "AMBER_E_ORG_DENY",
			events: [],
			errors: ["audit scope required (deny-wins)"],
		};
	}
	let events;
	try {
		events = readAllEvents(cwd);
	} catch (err) {
		return {
			ok: false,
			code: err.amberCode || ORG_CORRUPT_CODE,
			events: [],
			errors: [err.message],
		};
	}
	const tenantEvents = events.filter((e) => e.tenantId === tenantId);
	if (tenantEvents.length === 0) {
		return {
			ok: false,
			code: "AMBER_E_ORG_DENY",
			events: [],
			errors: [`tenant "${tenantId}" has no events`],
		};
	}
	const scoped = tenantEvents.filter((e) => e.repositoryId === scope);
	if (scoped.length === 0) {
		return {
			ok: false,
			code: "AMBER_E_ORG_DENY",
			events: [],
			errors: [`scope "${scope}" denied: no matching events`],
		};
	}
	return { ok: true, code: null, events: scoped, errors: [] };
}

/**
 * Record an evidence-backed retention/deletion/revocation action.
 * @param {string} cwd - Repository root.
 * @param {{tenantId: string, repositoryId: string, action: string, target: string, reason: string}} input
 * @returns {{ok: boolean, event: object|null, errors: string[]}}
 */
function recordRetentionAction(cwd, { tenantId, repositoryId, action, target, reason }) {
	if (!RETENTION_ACTIONS.includes(action)) {
		return {
			ok: false,
			event: null,
			errors: [`unknown retention action "${action}" (expected ${RETENTION_ACTIONS.join(", ")})`],
		};
	}
	const event = recordAuditEvent(cwd, {
		tenantId,
		repositoryId,
		action,
		actor: `retention:${action}`,
		target,
		reason,
	});
	return { ok: true, event, errors: [] };
}

module.exports = {
	RETENTION_ACTIONS,
	auditLedgerPath,
	recordAuditEvent,
	listAuditEvents,
	checkIsolation,
	auditCrossRepository,
	recordRetentionAction,
};
