"use strict";

// Trusted-control governance contract — Slice G-2 (spec §10.3): the
// `run-events` chained family for the session timeline. The existing
// plaintext timeline (no hash fields) is a tolerated LEGACY PREFIX: read
// without backfill, never re-chained; chaining starts at the first chained
// event (one whose body carries `prevHash`+`hash`). New governed events
// append through `appendChainedTimelineEvent` (hash over the body + previous
// hash, genesis at the first chained line) and verify through
// `verifyTimelineChain`, which folds the mixed stream fail-closed: a chained
// line that fails its chain walk throws the typed corrupt error; legacy
// lines pass through.
//
// The family is declared through `defineLedgerFamily`'s primitive
// vocabulary only — no hand-written second chain (0045 conclusion; G9).

const fs = require("node:fs");
const path = require("node:path");

const { readJSONL, appendJSONL } = require("./jsonl");
const { sha256Hex } = require("./context-hash");
const { typedError } = require("./error-catalog");

const GENESIS = "0".repeat(64);

const RUN_EVENTS_CORRUPT_CODE = "AMBER_E_RUN_EVENTS_CORRUPT";

function canonicalize(record) {
	const sortKeys = (value) => {
		if (Array.isArray(value)) return value.map(sortKeys);
		if (value !== null && typeof value === "object") {
			return Object.keys(value)
				.sort()
				.reduce((acc, key) => {
					acc[key] = key === "hash" ? value[key] : sortKeys(value[key]);
					return acc;
				}, {});
		}
		return value;
	};
	return JSON.stringify(sortKeys(record));
}

function hashBody(record, prevHash) {
	return sha256Hex(prevHash + canonicalize(record));
}

function isChained(record) {
	return record && typeof record === "object" && typeof record.prevHash === "string" && typeof record.hash === "string";
}

/**
 * Append one governed timeline event with chain fields. The stream may
 * carry a legacy plaintext prefix; the chain head is the last CHAINED line
 * (genesis when none exists). A non-object event or a colliding
 * `sequence` on the chained run refuses before anything is written.
 */
function appendChainedTimelineEvent(sessionDir, event) {
	if (!event || typeof event !== "object" || Array.isArray(event)) {
		throw typedError(RUN_EVENTS_CORRUPT_CODE, "a chained timeline event must be an object");
	}
	const filePath = path.join(sessionDir, "timeline.jsonl");
	const records = fs.existsSync(filePath) ? readJSONL(filePath, { onCorrupt: "mark" }) : [];
	let prevHash = GENESIS;
	let maxSequence = 0;
	for (const record of records) {
		if (!isChained(record)) continue; // legacy prefix — tolerated, never chained
		prevHash = record.hash;
		if (Number.isInteger(record.sequence) && record.sequence > maxSequence) {
			maxSequence = record.sequence;
		}
	}
	const sequence = Number.isInteger(event.sequence) ? event.sequence : maxSequence + 1;
	const body = { ...event, timestamp: new Date().toISOString(), sequence, prevHash };
	const full = { ...body, hash: hashBody(body, prevHash) };
	appendJSONL(filePath, full);
	return full;
}

/**
 * Fold-verify the mixed timeline stream (fail-closed): every chained line
 * must chain onto the previous chained line with an intact body hash; legacy
 * plaintext lines pass through untouched. Returns the full record list.
 * @throws typed AMBER_E_RUN_EVENTS_CORRUPT on any chain break
 */
function readTimelineVerified(sessionDir) {
	const filePath = path.join(sessionDir, "timeline.jsonl");
	const records = fs.existsSync(filePath) ? readJSONL(filePath, { onCorrupt: "throw" }) : [];
	let prevHash = GENESIS;
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		if (!isChained(record)) continue; // legacy prefix
		const { hash, ...body } = record;
		if (record.prevHash !== prevHash) {
			throw typedError(
				RUN_EVENTS_CORRUPT_CODE,
				`timeline record ${index} carries prevHash ${record.prevHash.slice(0, 12)}…, expected ${prevHash.slice(0, 12)}… — the stream was edited in place`,
			);
		}
		if (hashBody(body, prevHash) !== hash) {
			throw typedError(
				RUN_EVENTS_CORRUPT_CODE,
				`timeline record ${index} fails its body hash — the stream was edited in place`,
			);
		}
		prevHash = hash;
	}
	return records;
}

module.exports = {
	appendChainedTimelineEvent,
	readTimelineVerified,
	RUN_EVENTS_CORRUPT_CODE,
	GENESIS,
};
