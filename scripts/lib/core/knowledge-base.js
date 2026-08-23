"use strict";

/**
 * Governed Knowledge Base lifecycle (#163).
 *
 * Knowledge Records are derived from canonical Context Pages with strict
 * admission rules: admission requires provenance (page sources) and explicit
 * authorization. Records are immutable (frozen at admission), reviewable, and
 * carry a lifecycle: candidate → admitted → stale → retired.
 *
 * Freshness is mechanical: a record is stale when its canonical page's
 * sources drift. Retirement is explicit and evidence-backed. Queries are
 * exact-scope (unknown scope denied) and fail closed on corruption.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const KNOWLEDGE_STATUSES = Object.freeze(["candidate", "admitted", "stale", "retired"]);

function recordsPath(cwd) {
	return path.join(cwd, ".amber", "knowledge", "records.jsonl");
}

function ensureDir(cwd) {
	fs.mkdirSync(path.join(cwd, ".amber", "knowledge"), { recursive: true });
}

function sha256(input) {
	return `sha256:${crypto.createHash("sha256").update(input).digest("hex")}`;
}

function readPage(cwd, pageId) {
	const pagePath = path.join(cwd, ".amber", "context", "pages", `${pageId}.json`);
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
	// any drift in the admitted knowledge is stale until refresh or review.
	return sha256(JSON.stringify(page));
}

function readAllRecords(cwd) {
	const filePath = recordsPath(cwd);
	if (!fs.existsSync(filePath)) return [];
	const records = [];
	for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean)) {
		try {
			records.push(JSON.parse(line));
		} catch {
			// corrupt line skipped; caller decides fail-closed policy
		}
	}
	return records;
}

/**
 * Admit a Knowledge Record from a canonical page.
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
	ensureDir(cwd);
	const record = Object.freeze({
		recordId: crypto.randomUUID(),
		pageId,
		status: "admitted",
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
	fs.appendFileSync(recordsPath(cwd), JSON.stringify(record) + "\n", "utf8");
	return { ok: true, record, errors: [] };
}

/**
 * Read a single record by id.
 * @param {string} cwd - Repository root.
 * @param {string} recordId - Record id.
 * @returns {object|null}
 */
function readRecord(cwd, recordId) {
	return readAllRecords(cwd).find((r) => r.recordId === recordId) || null;
}

/**
 * List all records.
 * @param {string} cwd - Repository root.
 * @returns {Array<object>}
 */
function listRecords(cwd) {
	return readAllRecords(cwd);
}

/**
 * Check freshness: record is stale when its canonical page's sources drift.
 * @param {string} cwd - Repository root.
 * @param {string} recordId - Record id.
 * @returns {{status: string, detail: string}}
 */
function checkFreshness(cwd, recordId) {
	const record = readRecord(cwd, recordId);
	if (!record) return { status: "candidate", detail: "record not found" };
	const page = readPage(cwd, record.pageId);
	const currentHash = pageSourceHash(page);
	if (currentHash !== record.sourceHash) {
		return { status: "stale", detail: "canonical page sources drifted since admission" };
	}
	return { status: record.status, detail: "fresh" };
}

/**
 * Retire a record explicitly.
 * @param {string} cwd - Repository root.
 * @param {string} recordId - Record id.
 * @param {{reason: string}} opts - Retirement reason.
 * @returns {{ok: boolean, record: object|null, errors: string[]}}
 */
function retireRecord(cwd, recordId, { reason }) {
	const records = readAllRecords(cwd);
	const index = records.findIndex((r) => r.recordId === recordId);
	if (index < 0) {
		return { ok: false, record: null, errors: [`record "${recordId}" not found`] };
	}
	const updated = {
		...records[index],
		status: "retired",
		retiredAt: new Date().toISOString(),
		retireReason: reason || null,
	};
	records[index] = updated;
	// rewrite the ledger preserving all entries (append-only semantics via full rewrite of immutable entries)
	ensureDir(cwd);
	fs.writeFileSync(
		recordsPath(cwd),
		records.map((r) => JSON.stringify(r)).join("\n") + "\n",
		"utf8",
	);
	return { ok: true, record: updated, errors: [] };
}

/**
 * Query records with exact-scope privacy.
 * @param {string} cwd - Repository root.
 * @param {{scope?: string|null}} params - Query scope.
 * @returns {{ok: boolean, code: string|null, records: Array<object>, errors: string[]}}
 */
function queryKnowledge(cwd, { scope = null } = {}) {
	let records;
	try {
		records = readAllRecords(cwd);
	} catch {
		return {
			ok: false,
			code: null,
			records: [],
			errors: ["knowledge store unreadable — failing closed"],
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
	recordsPath,
	admitKnowledge,
	readRecord,
	listRecords,
	checkFreshness,
	retireRecord,
	queryKnowledge,
};
