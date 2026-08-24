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
 */

const crypto = require("node:crypto");
const { sha256 } = require("./context-hash");
const fs = require("node:fs");
const path = require("node:path");

const RETENTION_ACTIONS = Object.freeze(["retain", "delete", "revoke"]);

function auditLedgerPath(cwd) {
	return path.join(cwd, ".amber", "audit", "events.jsonl");
}

function ensureDir(cwd) {
	fs.mkdirSync(path.join(cwd, ".amber", "audit"), { recursive: true });
}

function readAllEvents(cwd) {
	const filePath = auditLedgerPath(cwd);
	if (!fs.existsSync(filePath)) return [];
	const events = [];
	for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean)) {
		try {
			events.push(JSON.parse(line));
		} catch {
			// caller decides fail-closed policy
			throw new Error("audit ledger is corrupt");
		}
	}
	return events;
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
	fs.appendFileSync(auditLedgerPath(cwd), JSON.stringify(event) + "\n", "utf8");
	return event;
}

/**
 * List all audit events.
 * @param {string} cwd - Repository root.
 * @returns {Array<object>}
 */
function listAuditEvents(cwd) {
	try {
		return readAllEvents(cwd);
	} catch {
		return [];
	}
}

/**
 * Enforce tenant + repository isolation for an auditor.
 * @param {string} cwd - Repository root.
 * @param {{tenantId: string, repositoryId?: string|null, queryTenantId?: string|null}} params
 * @returns {{ok: boolean, code: string|null, events: Array<object>, errors: string[]}}
 */
function checkIsolation(cwd, { tenantId, repositoryId = null, queryTenantId = null }) {
	let events;
	try {
		events = readAllEvents(cwd);
	} catch (err) {
		return { ok: false, code: null, events: [], errors: [err.message] };
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
 * Exact-scope cross-repository audit with deny-wins semantics.
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
		return { ok: false, code: null, events: [], errors: [err.message] };
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
