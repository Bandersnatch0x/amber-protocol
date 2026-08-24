"use strict";

// GLX tamper-evident ledger (C). Append-only JSONL where each record carries the
// previous record's hash, so an edit anywhere breaks the chain on verify. This
// detects accidental/single-record tampering — not an attacker who rewrites the
// whole file and recomputes every hash (that needs external anchoring; see spec).
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { codedError } = require("./error-catalog");
const { readJSONL } = require("./jsonl");

const GENESIS = "0".repeat(64);

function sortKeys(value) {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === "object") {
		return Object.keys(value)
			.sort()
			.reduce((acc, key) => {
				if (key !== "hash") acc[key] = sortKeys(value[key]);
				return acc;
			}, {});
	}
	return value;
}

function canonicalize(record) {
	return JSON.stringify(sortKeys(record));
}

function hashRecord(record, prevHash) {
	return crypto
		.createHash("sha256")
		.update(prevHash + canonicalize(record))
		.digest("hex");
}

function readLedger(ledgerPath) {
	// SIEM walk semantics: broken lines stay visible as { _unparseable } —
	// data, not refusal (ledger-export reports intact:false downstream).
	return readJSONL(ledgerPath, { onCorrupt: "mark" });
}

function appendLedgerRecord(ledgerPath, record) {
	const existing = readLedger(ledgerPath);
	const prevHash = existing.length ? existing[existing.length - 1].hash || GENESIS : GENESIS;
	const body = { ...record, prevHash };
	const full = { ...body, hash: hashRecord(body, prevHash) };
	fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
	fs.appendFileSync(ledgerPath, JSON.stringify(full) + "\n");
	return full;
}

function verifyLedgerChain(ledgerPath) {
	const records = readLedger(ledgerPath);
	let prev = GENESIS;
	for (let i = 0; i < records.length; i++) {
		const record = records[i];
		if (record._unparseable) return { intact: false, brokenAt: i, reason: "unparseable record" };
		if (record.prevHash !== prev)
			return { intact: false, brokenAt: i, reason: "prevHash mismatch" };
		const { hash, ...body } = record;
		if (hashRecord(body, prev) !== hash)
			return { intact: false, brokenAt: i, reason: "hash mismatch" };
		prev = hash;
	}
	return { intact: true, brokenAt: null, records: records.length };
}

// An approval is consumable until an `executed` record references its approvalKey.
function latestUnconsumedApproval(records) {
	const consumed = new Set(
		records
			.filter((r) => r.kind === "executed" && r.consumedApprovalKey)
			.map((r) => r.consumedApprovalKey),
	);
	const open = records.filter(
		(r) => r.kind === "approved" && r.approvalKey && !consumed.has(r.approvalKey),
	);
	return open.length ? open[open.length - 1] : null;
}

// Walk all GLX ledger homes (loops / routes / sessions) and call cb({ home, sub, ledgerPath })
// for each existing ledger.jsonl. Returns the count of ledgers walked. A single canonical
// scan loop so standards.js and governance-readiness.js don't each duplicate it.
function walkLedgers(stateDir, cb) {
	let count = 0;
	for (const home of ["loops", "routes", "sessions"]) {
		const homeDir = path.join(stateDir, home);
		if (!fs.existsSync(homeDir)) continue;
		for (const sub of fs.readdirSync(homeDir)) {
			const lp = path.join(homeDir, sub, "ledger.jsonl");
			if (!fs.existsSync(lp)) continue;
			count++;
			cb({ home, sub, ledgerPath: lp });
		}
	}
	return count;
}

// Shared verify → outcome mapping so the not-found gating and the
// AMBER_E_LEDGER_TAMPERED phrasing can't drift between the three governance
// homes (loops / routes / sessions). Callers map this onto their own envelope.
function verifyLedgerOutcome(ledgerPath) {
	if (!fs.existsSync(ledgerPath)) return { found: false, intact: false };
	const v = verifyLedgerChain(ledgerPath);
	if (v.intact) return { found: true, intact: true, records: v.records };
	return {
		found: true,
		intact: false,
		tamperedMessage: codedError(
			"AMBER_E_LEDGER_TAMPERED",
			`broken at record ${v.brokenAt}: ${v.reason}`,
		),
	};
}

module.exports = {
	canonicalize,
	hashRecord,
	readLedger,
	appendLedgerRecord,
	verifyLedgerChain,
	verifyLedgerOutcome,
	latestUnconsumedApproval,
	walkLedgers,
	GENESIS,
};
