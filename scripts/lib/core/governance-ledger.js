"use strict";

// Structured governance ledger (issues/0155, derived from the 0141 consistency
// review D-4). A repository-local, append-only, chain-hashed record of the
// governance decisions that shape this repo's own rules — the structured,
// queryable counterpart to the prose `issues/` Log.
//
// Design floor:
//   - Tracked at docs/governance/ (a delivered artifact, not `.amber/` runtime),
//     so CI and a fresh clone can gate it — the whole point of the mechanism.
//   - Every schema compile routes through schema-contract.js (never a local Ajv).
//   - Each event carries a chain hash = sha256(canonicalJson(event\hash) chained
//     onto prevHash). In-place edits break the chain and fail closed.
//   - `adjudicated` events are user-only (schema-enforced and re-checked here).
//   - History is never rewritten; new decisions append. Prose Log stays the
//     authority for decisions made before this ledger existed (no backfill).

const path = require("node:path");
const { validate } = require("./schema-contract");
const { sha256, canonicalJson } = require("./context-hash");
const { readJSONL, appendJSONL } = require("./jsonl");

const SCHEMA_NAME = "governance-event";
const LEDGER_PATH = path.join(
	__dirname,
	"..",
	"..",
	"..",
	"docs",
	"governance",
	"governance-ledger.jsonl",
);

/**
 * The chain hash of one event: sha256 over the canonical form of the event
 * (with its own `hash` field removed) chained onto the previous event's hash.
 * @param {object} event - Full or partial event; the `hash` field is ignored.
 * @param {string|null} prevHash - Previous event's hash, or null for genesis.
 * @returns {string} `sha256:<hex>`
 */
function computeHash(event, prevHash) {
	const { hash: _ignored, ...rest } = event;
	rest.prevHash = prevHash ?? null;
	return sha256(`${prevHash ?? ""}\n${canonicalJson(JSON.stringify(rest))}`);
}

/**
 * Read every event from the ledger, failing closed on any corrupt line.
 * @param {string} [ledgerPath]
 * @returns {Array<object>}
 */
function readEvents(ledgerPath = LEDGER_PATH) {
	return readJSONL(ledgerPath, { onCorrupt: "throw", missing: "empty" });
}

/**
 * Verify the append-only chain: every event's recorded hash must equal the
 * recomputed chain hash, and each `prevHash` must link to the prior `hash`.
 * @param {Array<object>} events
 * @returns {{ ok: boolean, errors: string[] }}
 */
function verifyChain(events) {
	const errors = [];
	let prevHash = null;
	events.forEach((event, index) => {
		const where = `event[${index}] ${event && event.id ? event.id : "(no id)"}`;
		if (!event || typeof event !== "object") {
			errors.push(`${where}: not an object`);
			return;
		}
		if ((event.prevHash ?? null) !== prevHash) {
			errors.push(
				`${where}: prevHash ${JSON.stringify(event.prevHash ?? null)} does not link to prior hash ${JSON.stringify(prevHash)}`,
			);
		}
		const expected = computeHash(event, prevHash);
		if (event.hash !== expected) {
			errors.push(`${where}: hash mismatch (recorded ${event.hash}, recomputed ${expected})`);
		}
		prevHash = event.hash;
	});
	return { ok: errors.length === 0, errors };
}

/**
 * Validate every event against the schema. Returns the first failure's errors.
 * @param {Array<object>} events
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateEvents(events) {
	for (let i = 0; i < events.length; i += 1) {
		const result = validate(SCHEMA_NAME, events[i]);
		if (!result.valid) {
			const id = events[i] && events[i].id ? events[i].id : `index ${i}`;
			return { ok: false, errors: result.errors.map((e) => `${id}: ${e}`) };
		}
	}
	return { ok: true, errors: [] };
}

/**
 * Seal one event onto the chain: fill prevHash + hash from the current tail,
 * schema-validate the sealed event, then append. The caller supplies id,
 * event, decidedBy, rationale, confirmedAt, and any event-specific fields.
 *
 * `adjudicated` is user-only; this is re-checked here so a caller that bypasses
 * the schema still fails closed.
 *
 * @param {object} partial - Event without prevHash/hash.
 * @param {string} [ledgerPath]
 * @returns {object} The sealed, appended event.
 */
function appendEvent(partial, ledgerPath = LEDGER_PATH) {
	if (partial.event === "adjudicated" && partial.decidedBy !== "user") {
		throw new Error(
			`governance-ledger: an "adjudicated" event must be decidedBy "user" (got ${JSON.stringify(partial.decidedBy)})`,
		);
	}
	const events = readEvents(ledgerPath);
	const prevHash = events.length > 0 ? events[events.length - 1].hash : null;
	const sealed = { ...partial, prevHash };
	sealed.hash = computeHash(sealed, prevHash);
	const result = validate(SCHEMA_NAME, sealed);
	if (!result.valid) {
		throw new Error(`governance-ledger: event fails schema: ${result.errors.join("; ")}`);
	}
	appendJSONL(ledgerPath, sealed);
	return sealed;
}

module.exports = {
	SCHEMA_NAME,
	LEDGER_PATH,
	computeHash,
	readEvents,
	verifyChain,
	validateEvents,
	appendEvent,
};
