"use strict";

/**
 * Governed Knowledge Base lifecycle (#163).
 *
 * Knowledge Records are derived from canonical Context Pages with strict
 * admission rules: admission requires provenance (page sources) and explicit
 * authorization. The lifecycle matches the distributed-governance baseline
 * (docs/architecture/distributed-governance-baseline.md, row "Governed
 * Knowledge Base"): candidate → review → accepted → stale →
 * refresh-required → (refresh → accepted) / superseded / retired.
 *
 * The ledger (records.jsonl) is append-only. Every transition appends a new
 * immutable record state; nothing is ever rewritten or mutated in place. The
 * current state of a record is the LAST line written for its recordId.
 *
 * Freshness is mechanical: a record is stale when its canonical page's
 * content drifts. Retirement and supersession are explicit and
 * evidence-backed. Queries are exact-scope (unknown scope denied) and fail
 * closed on corruption.
 *
 * Fail-closed reads (F035-S5, decision D4): only an ABSENT ledger is a
 * legitimate empty state. A corrupt or unreadable ledger is a typed failure
 * (AMBER_E_KB_CORRUPT) — never an empty success, never a partial projection,
 * and never a misreported "not found" or "scope denied".
 */

const crypto = require("node:crypto");
const { sha256 } = require("./context-hash");
const { readJSONL, appendJSONL, foldJSONL } = require("./jsonl");
const fs = require("node:fs");
const path = require("node:path");
const { statePath, statePathForCreate } = require("../state-dir-resolver");

const KB_CORRUPT_CODE = "AMBER_E_KB_CORRUPT";

const KNOWLEDGE_STATUSES = Object.freeze([
	"candidate",
	"review",
	"accepted",
	"stale",
	"refresh-required",
	"superseded",
	"retired",
]);

// Statuses that can transition onward to a new state.
const ACTIVE_STATUSES = new Set(["candidate", "review", "accepted", "stale", "refresh-required"]);

// Terminal statuses: no further lifecycle transition (except none at all).
const TERMINAL_STATUSES = new Set(["superseded", "retired"]);

// Knowledge Records (#163, post-rename state kind): the ledger never existed
// under .harness, so reads and creates both target the canonical dir —
// statePathForCreate keeps the write policy (always .amber) even on a
// not-yet-migrated legacy repo, and reads lose nothing under either policy.
function recordsPath(cwd) {
	return statePathForCreate(cwd, "knowledge", "records.jsonl");
}

function readPage(cwd, pageId) {
	// Context Pages are post-rename state; the read policy finds them under
	// .amber once it exists and nothing either way before that.
	const pagePath = statePath(cwd, "context", "pages", `${pageId}.json`);
	if (!fs.existsSync(pagePath)) return null;
	try {
		return JSON.parse(fs.readFileSync(pagePath, "utf8"));
	} catch {
		return null;
	}
}

function pageSourceHash(page) {
	if (!page) return null;
	// freshness tracks the full canonical page content, not just sources:
	// any drift in the accepted knowledge is stale until refresh or review.
	return sha256(JSON.stringify(page));
}

/**
 * Wrap a ledger read failure as a typed corruption error (F035-S5).
 * readJSONL only throws for corrupt lines or unreadable files — an absent
 * ledger always reads as [] — so every throw here is corruption, never a
 * legitimate empty state (decision D4).
 * @param {Error} err - The raw read failure.
 * @returns {Error} Error carrying .amberCode = AMBER_E_KB_CORRUPT.
 */
function corruptLedgerError(err) {
	const detail = err && err.message ? err.message : String(err);
	const error = new Error(
		`knowledge ledger corrupt or unreadable — failing closed: ${detail} [${KB_CORRUPT_CODE}]`,
	);
	error.amberCode = KB_CORRUPT_CODE;
	error.cause = err;
	return error;
}

/**
 * Read the ledger and fold it to the CURRENT state of every record.
 *
 * Append-only semantics: each line is an immutable record state. Later lines
 * for the same recordId supersede earlier ones, so the fold is
 * last-writer-wins per recordId and preserves the full lineage on disk.
 * Fails closed on any corrupt line or unreadable file.
 * @param {string} cwd - Repository root.
 * @returns {Array<object>} Current state per record, in first-seen order.
 * @throws {Error} Typed AMBER_E_KB_CORRUPT error when the ledger is corrupt or unreadable.
 */
function readAllRecords(cwd) {
	try {
		return foldJSONL(recordsPath(cwd), "recordId", { onCorrupt: "throw" });
	} catch (err) {
		throw corruptLedgerError(err);
	}
}

/**
 * Read the full append-only lineage of one record. Fails closed on any
 * corrupt line or unreadable file.
 * @param {string} cwd - Repository root.
 * @param {string} recordId - Record id.
 * @returns {Array<object>} Every state line ever appended for the record.
 * @throws {Error} Typed AMBER_E_KB_CORRUPT error when the ledger is corrupt or unreadable.
 */
function readRecordLineage(cwd, recordId) {
	try {
		return readJSONL(recordsPath(cwd), { onCorrupt: "throw" }).filter(
			(r) => r.recordId === recordId,
		);
	} catch (err) {
		throw corruptLedgerError(err);
	}
}

function appendRecordState(cwd, state) {
	return appendJSONL(recordsPath(cwd), state);
}

/**
 * Admit a Knowledge Record from a canonical page.
 *
 * Admission IS acceptance: it requires provenance (page sources) and explicit
 * authorization, and records the source hash that freshness checks against.
 * @param {string} cwd - Repository root.
 * @param {{pageId: string, authorization: string|null}} input
 * @returns {{ok: boolean, record: object|null, errors: string[]}}
 */
function admitKnowledge(cwd, { pageId, authorization }) {
	const page = readPage(cwd, pageId);
	if (!page) {
		return { ok: false, record: null, errors: [`page "${pageId}" not found or unreadable`] };
	}
	const sources = page.sources || {};
	if (Object.keys(sources).length === 0) {
		return {
			ok: false,
			record: null,
			errors: ["knowledge admission requires provenance: page has no sources"],
		};
	}
	if (!authorization || typeof authorization !== "string") {
		return {
			ok: false,
			record: null,
			errors: ["knowledge admission requires explicit authorization"],
		};
	}
	const record = Object.freeze({
		recordId: crypto.randomUUID(),
		pageId,
		status: "accepted",
		title: page.title || pageId,
		provenance: Object.entries(sources).map(([id, source]) => ({
			sourceId: id,
			ref: source && source.ref,
			hash: source && (source.rawHash || source.normHash || null),
		})),
		sourceHash: pageSourceHash(page),
		authorization,
		admittedAt: new Date().toISOString(),
		refreshHistory: [],
		reuseLineage: [],
	});
	appendRecordState(cwd, record);
	return { ok: true, record, errors: [] };
}

/**
 * Register a candidate record (proposal) before any review or acceptance.
 *
 * Candidates need no authorization — they are proposals. Authorization is
 * required to move out of candidate (review/accept).
 * @param {string} cwd - Repository root.
 * @param {{pageId: string, title?: string|null}} input
 * @returns {{ok: boolean, record: object|null, errors: string[]}}
 */
function candidateKnowledge(cwd, { pageId, title = null }) {
	const page = readPage(cwd, pageId);
	if (!page) {
		return { ok: false, record: null, errors: [`page "${pageId}" not found or unreadable`] };
	}
	const record = Object.freeze({
		recordId: crypto.randomUUID(),
		pageId,
		status: "candidate",
		title: title || page.title || pageId,
		provenance: Object.entries(page.sources || {}).map(([id, source]) => ({
			sourceId: id,
			ref: source && source.ref,
			hash: source && (source.rawHash || source.normHash || null),
		})),
		sourceHash: pageSourceHash(page),
		authorization: null,
		candidateAt: new Date().toISOString(),
		refreshHistory: [],
		reuseLineage: [],
	});
	appendRecordState(cwd, record);
	return { ok: true, record, errors: [] };
}

/**
 * Read a single record by id (current state).
 * @param {string} cwd - Repository root.
 * @param {string} recordId - Record id.
 * @returns {object|null} The record's current state, or null when absent.
 * @throws {Error} Typed AMBER_E_KB_CORRUPT error when the ledger is corrupt or unreadable.
 */
function readRecord(cwd, recordId) {
	return readAllRecords(cwd).find((r) => r.recordId === recordId) || null;
}

/**
 * List all records (current state each).
 * @param {string} cwd - Repository root.
 * @returns {Array<object>} Current state of every record ([] only for an absent ledger).
 * @throws {Error} Typed AMBER_E_KB_CORRUPT error when the ledger is corrupt or unreadable.
 */
function listRecords(cwd) {
	return readAllRecords(cwd);
}

/**
 * Move a record into review.
 * @param {string} cwd - Repository root.
 * @param {string} recordId - Record id.
 * @param {{authorization: string|null}} opts - Review authorization.
 * @returns {{ok: boolean, record: object|null, errors: string[]}}
 */
function reviewKnowledge(cwd, recordId, { authorization }) {
	if (!authorization || typeof authorization !== "string") {
		return {
			ok: false,
			record: null,
			errors: ["moving a record into review requires explicit authorization"],
		};
	}
	return transitionRecord(cwd, recordId, (record) => ({
		...record,
		status: "review",
		reviewRequestedAt: new Date().toISOString(),
		reviewAuthorization: authorization,
	}));
}

/**
 * Accept a record out of review (or directly out of candidate).
 * @param {string} cwd - Repository root.
 * @param {string} recordId - Record id.
 * @param {{authorization: string|null}} opts - Acceptance authorization.
 * @returns {{ok: boolean, record: object|null, errors: string[]}}
 */
function acceptKnowledge(cwd, recordId, { authorization }) {
	if (!authorization || typeof authorization !== "string") {
		return {
			ok: false,
			record: null,
			errors: ["knowledge acceptance requires explicit authorization"],
		};
	}
	return transitionRecord(cwd, recordId, (record) => {
		if (record.status !== "review" && record.status !== "candidate") {
			throw new Error(
				`record "${recordId}" is ${record.status}; only review or candidate records can be accepted`,
			);
		}
		const page = readPage(cwd, record.pageId);
		return {
			...record,
			status: "accepted",
			sourceHash: pageSourceHash(page) || record.sourceHash,
			authorization,
			acceptedAt: new Date().toISOString(),
		};
	});
}

/**
 * Mark a record as requiring refresh before reuse (e.g. it is stale).
 * @param {string} cwd - Repository root.
 * @param {string} recordId - Record id.
 * @param {{reason: string|null}} opts - Why refresh is required.
 * @returns {{ok: boolean, record: object|null, errors: string[]}}
 */
function markRefreshRequired(cwd, recordId, { reason = null }) {
	return transitionRecord(cwd, recordId, (record) => ({
		...record,
		status: "refresh-required",
		refreshRequiredAt: new Date().toISOString(),
		refreshRequiredReason: reason || null,
	}));
}

/**
 * Refresh a record from its canonical page: recompute the source hash and
 * restore the accepted status. Refresh is evidence-backed (authorization).
 * @param {string} cwd - Repository root.
 * @param {string} recordId - Record id.
 * @param {{authorization: string|null, reason?: string|null}} opts
 * @returns {{ok: boolean, record: object|null, errors: string[]}}
 */
function refreshKnowledge(cwd, recordId, { authorization, reason = null }) {
	if (!authorization || typeof authorization !== "string") {
		return {
			ok: false,
			record: null,
			errors: ["knowledge refresh requires explicit authorization"],
		};
	}
	return transitionRecord(cwd, recordId, (record) => {
		const page = readPage(cwd, record.pageId);
		if (!page) {
			throw new Error(
				`cannot refresh record "${recordId}": canonical page "${record.pageId}" is gone`,
			);
		}
		return {
			...record,
			status: "accepted",
			sourceHash: pageSourceHash(page),
			authorization,
			refreshedAt: new Date().toISOString(),
			refreshHistory: [
				...(record.refreshHistory || []),
				{
					refreshedAt: new Date().toISOString(),
					reason: reason || null,
					authorization,
				},
			],
		};
	});
}

/**
 * Supersede a record — it is replaced by another record.
 * @param {string} cwd - Repository root.
 * @param {string} recordId - Record id.
 * @param {{byRecordId: string, reason: string|null}} opts
 * @returns {{ok: boolean, record: object|null, errors: string[]}}
 */
function supersedeRecord(cwd, recordId, { byRecordId, reason = null }) {
	if (!byRecordId || typeof byRecordId !== "string") {
		return {
			ok: false,
			record: null,
			errors: ["superseding a record requires byRecordId of the replacing record"],
		};
	}
	return transitionRecord(cwd, recordId, (record) => ({
		...record,
		status: "superseded",
		supersededBy: byRecordId,
		supersededAt: new Date().toISOString(),
		supersedeReason: reason || null,
		reuseLineage: [...(record.reuseLineage || []), byRecordId],
	}));
}

/**
 * Shared transition machinery: load current state, require it active,
 * apply the state change, append the new immutable line. A corrupt or
 * unreadable ledger is a typed corruption failure — transitions never
 * operate on a partial store (F035-S5).
 * @param {string} cwd - Repository root.
 * @param {string} recordId - Record id.
 * @param {(record: object) => object} apply - State change (may throw).
 * @returns {{ok: boolean, code: string|null, record: object|null, errors: string[]}}
 */
function transitionRecord(cwd, recordId, apply) {
	let current;
	try {
		current = readRecord(cwd, recordId);
	} catch (err) {
		return {
			ok: false,
			code: err.amberCode || KB_CORRUPT_CODE,
			record: null,
			errors: [err.message],
		};
	}
	if (!current) {
		return { ok: false, record: null, errors: [`record "${recordId}" not found`] };
	}
	if (TERMINAL_STATUSES.has(current.status)) {
		return {
			ok: false,
			record: null,
			errors: [`record "${recordId}" is ${current.status}; terminal records cannot transition`],
		};
	}
	try {
		const updated = Object.freeze(apply(current));
		appendRecordState(cwd, updated);
		return { ok: true, record: updated, errors: [] };
	} catch (err) {
		return { ok: false, record: null, errors: [err.message] };
	}
}

/**
 * Check freshness: record is stale when its canonical page's content drifts.
 * Terminal records report their own status — a retired or superseded record
 * is never re-reported as stale.
 * @param {string} cwd - Repository root.
 * @param {string} recordId - Record id.
 * @returns {{status: string, detail: string}}
 */
function checkFreshness(cwd, recordId) {
	const record = readRecord(cwd, recordId);
	if (!record) return { status: "candidate", detail: "record not found" };
	if (TERMINAL_STATUSES.has(record.status)) {
		return { status: record.status, detail: `record is ${record.status}` };
	}
	const page = readPage(cwd, record.pageId);
	const currentHash = pageSourceHash(page);
	if (currentHash !== record.sourceHash) {
		return { status: "stale", detail: "canonical page sources drifted since admission" };
	}
	return { status: record.status, detail: "fresh" };
}

/**
 * Retire a record explicitly.
 *
 * Append-only: retirement appends a new immutable state line; the original
 * admitted line is never rewritten or removed.
 * @param {string} cwd - Repository root.
 * @param {string} recordId - Record id.
 * @param {{reason: string}} opts - Retirement reason.
 * @returns {{ok: boolean, record: object|null, errors: string[]}}
 */
function retireRecord(cwd, recordId, { reason }) {
	return transitionRecord(cwd, recordId, (record) => ({
		...record,
		status: "retired",
		retiredAt: new Date().toISOString(),
		retireReason: reason || null,
	}));
}

/**
 * Query records with exact-scope privacy. A corrupt or unreadable ledger is
 * a typed corruption failure (AMBER_E_KB_CORRUPT) — distinct from an
 * unknown-scope denial (AMBER_E_KB_DENY) and never an empty success (F035-S5).
 * @param {string} cwd - Repository root.
 * @param {{scope?: string|null}} params - Query scope.
 * @returns {{ok: boolean, code: string|null, records: Array<object>, errors: string[]}}
 */
function queryKnowledge(cwd, { scope = null } = {}) {
	let records;
	try {
		records = readAllRecords(cwd);
	} catch (err) {
		return {
			ok: false,
			code: err.amberCode || KB_CORRUPT_CODE,
			records: [],
			errors: [err.message],
		};
	}
	if (scope && typeof scope === "string") {
		const filtered = records.filter((r) => r.pageId === scope);
		if (filtered.length === 0) {
			return {
				ok: false,
				code: "AMBER_E_KB_DENY",
				records: [],
				errors: [`unknown scope "${scope}" denied`],
			};
		}
		return { ok: true, code: null, records: filtered, errors: [] };
	}
	return { ok: true, code: null, records, errors: [] };
}

module.exports = {
	KNOWLEDGE_STATUSES,
	ACTIVE_STATUSES,
	TERMINAL_STATUSES,
	recordsPath,
	candidateKnowledge,
	admitKnowledge,
	readRecord,
	readRecordLineage,
	listRecords,
	reviewKnowledge,
	acceptKnowledge,
	markRefreshRequired,
	refreshKnowledge,
	supersedeRecord,
	checkFreshness,
	retireRecord,
	queryKnowledge,
};
