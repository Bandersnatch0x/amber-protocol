"use strict";

// GLX tamper-evident ledger (C). Append-only JSONL where each record carries the
// previous record's hash, so an edit anywhere breaks the chain on verify. The
// head {count, headHash} is anchored in `<ledger>.anchor/head.json`, so cutting
// records off the end also fails verify. Approval use is recorded there too, as
// one `wx`-created marker per approvalKey, so a spent approval stays spent
// whatever the ledger says. Deleting the anchor store refuses the ledger (fail
// closed). Rewriting ledger and anchor together still needs `amber ledger seal`.
const fs = require("node:fs");
const path = require("node:path");
const { codedError } = require("./error-catalog");
const { readJSONL, appendJSONL } = require("./jsonl");
const { sha256Hex } = require("./context-hash");

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
	return sha256Hex(prevHash + canonicalize(record));
}

function readLedger(ledgerPath) {
	// SIEM walk semantics: broken lines stay visible as { _unparseable } —
	// data, not refusal (ledger-export reports intact:false downstream).
	return readJSONL(ledgerPath, { onCorrupt: "mark" });
}

const LOCK_WAIT_MS = 10000;

const anchorDirOf = (ledgerPath) => `${ledgerPath}.anchor`;
const headPathOf = (ledgerPath) => path.join(anchorDirOf(ledgerPath), "head.json");

function readAnchor(ledgerPath) {
	try {
		return JSON.parse(fs.readFileSync(headPathOf(ledgerPath), "utf8"));
	} catch {
		return null;
	}
}

function writeAnchor(ledgerPath, anchor) {
	const file = headPathOf(ledgerPath);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(anchor));
	fs.renameSync(tmp, file);
}

// The anchor may lag the file by the one record a crash interrupted between the
// line append and the anchor write; a longer chain whose anchored record still
// matches is a valid extension.
function headProblem(records, anchor) {
	if (!anchor) return records.length === 0 ? null : { reason: "anchor-missing", brokenAt: 0 };
	if (records.length < anchor.count) return { reason: "head-truncated", brokenAt: records.length };
	if (records[anchor.count - 1]?.hash !== anchor.headHash)
		return { reason: "head-mismatch", brokenAt: anchor.count - 1 };
	return null;
}

function sleepSync(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function lockHolderIsDead(lockPath) {
	let holder;
	try {
		holder = fs.readFileSync(lockPath, "utf8");
	} catch {
		return false;
	}
	const pid = Number(holder);
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return false;
	} catch (err) {
		return err.code === "ESRCH";
	}
}

function withLedgerLock(ledgerPath, fn) {
	const lockPath = `${ledgerPath}.lock`;
	fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
	const deadline = Date.now() + LOCK_WAIT_MS;
	for (let delay = 1; ; delay = Math.min(delay * 2, 50)) {
		try {
			const fd = fs.openSync(lockPath, "wx");
			fs.writeSync(fd, String(process.pid));
			fs.closeSync(fd);
			break;
		} catch (err) {
			if (err.code !== "EEXIST") throw err;
		}
		if (lockHolderIsDead(lockPath)) {
			fs.rmSync(lockPath, { force: true });
			continue;
		}
		if (Date.now() > deadline) {
			throw new Error(
				codedError(
					"AMBER_E_LEDGER_LOCKED",
					`${lockPath} is held by a live process after ${LOCK_WAIT_MS} ms`,
				),
			);
		}
		sleepSync(delay);
	}
	try {
		return fn();
	} finally {
		fs.rmSync(lockPath, { force: true });
	}
}

function appendLedgerRecord(ledgerPath, record) {
	return withLedgerLock(ledgerPath, () => {
		const existing = readLedger(ledgerPath);
		const problem = headProblem(existing, readAnchor(ledgerPath));
		if (problem) {
			throw new Error(
				codedError("AMBER_E_LEDGER_TAMPERED", `refusing to append: ${problem.reason}`),
			);
		}
		const prevHash = existing.length ? existing[existing.length - 1].hash || GENESIS : GENESIS;
		const body = { ...record, prevHash };
		const full = { ...body, hash: hashRecord(body, prevHash) };
		appendJSONL(ledgerPath, full);
		writeAnchor(ledgerPath, { count: existing.length + 1, headHash: full.hash });
		return full;
	});
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
	const problem = headProblem(records, readAnchor(ledgerPath));
	if (problem) return { intact: false, ...problem };
	return { intact: true, brokenAt: null, records: records.length };
}

// Consume-then-run: the marker is created before the governed command spawns,
// so a crash after it leaves the approval spent and a retry is refused.
function consumeApproval(ledgerPath, approvalKey) {
	const dir = path.join(anchorDirOf(ledgerPath), "consumed");
	fs.mkdirSync(dir, { recursive: true });
	try {
		const fd = fs.openSync(path.join(dir, sha256Hex(approvalKey)), "wx");
		fs.writeSync(fd, JSON.stringify({ approvalKey, consumedAt: new Date().toISOString() }));
		fs.closeSync(fd);
		return true;
	} catch (err) {
		if (err.code === "EEXIST") return false;
		throw err;
	}
}

// The ledger view of consumption: an `executed` record references the
// approvalKey. The single-use guarantee is consumeApproval, not this view.
function latestUnconsumedApproval(records) {
	return latestUnconsumedApprovalFor(records, null);
}

// Selection variant: among unconsumed grants, the latest one satisfying the
// caller's match predicate (the run contract's mutual binding — an attempt
// consumes the grant bound to it, never a foreign attempt's orphaned grant).
function latestUnconsumedApprovalFor(records, match) {
	const consumed = new Set(
		records
			.filter((r) => r.kind === "executed" && r.consumedApprovalKey)
			.map((r) => r.consumedApprovalKey),
	);
	const open = records.filter(
		(r) => r.kind === "approved" && r.approvalKey && !consumed.has(r.approvalKey),
	);
	const selected = match ? open.filter(match) : open;
	return selected.length ? selected[selected.length - 1] : null;
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
	consumeApproval,
	verifyLedgerChain,
	verifyLedgerOutcome,
	latestUnconsumedApproval,
	latestUnconsumedApprovalFor,
	walkLedgers,
	GENESIS,
};
