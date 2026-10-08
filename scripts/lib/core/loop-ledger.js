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
	// Windows can refuse the rename for a moment after the write, which would
	// report a successful append as a failure and leave the anchor behind the
	// ledger. Retry briefly instead.
	for (let attempt = 0; ; attempt++) {
		try {
			fs.renameSync(tmp, file);
			return;
		} catch (err) {
			if (attempt >= 20) throw err;
			sleepSync(5);
		}
	}
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

function readLockRaw(lockPath) {
	try {
		return fs.readFileSync(lockPath, "utf8");
	} catch {
		return null;
	}
}

// A holder whose pid no longer exists, or a lock that has held no pid for longer
// than any live writer could need. An unparseable lock is otherwise left owned, so
// a lock that is mid-publish is never reclaimed; the grace period is what keeps a
// foreign or truncated leftover from wedging the ledger forever.
const UNDECIDABLE_GRACE_MS = 30000;
function holderIsReclaimable(raw, lockPath) {
	const pid = Number(raw);
	if (!Number.isInteger(pid) || pid <= 0) {
		try {
			return Date.now() - fs.statSync(lockPath).mtimeMs > UNDECIDABLE_GRACE_MS;
		} catch {
			return false;
		}
	}
	try {
		process.kill(pid, 0);
		return false;
	} catch (err) {
		return err.code === "ESRCH";
	}
}

// The pid must be complete before the lock becomes visible. Creating the lock
// empty and writing the pid afterwards lets a concurrent writer read a partial
// pid, find that other process dead, and steal a lock a live holder is inside;
// two writers then append from the same tail and the chain breaks for good.
// link(2) publishes an already-written file, so a reader never sees a partial pid.
// A filesystem without hard links falls back to an exclusive create, which can
// publish the file empty; that window is why an unparseable lock is not reclaimed
// until it is older than the grace period.
function claimLock(lockPath) {
	const tmp = `${lockPath}.${process.pid}.claim`;
	try {
		fs.writeFileSync(tmp, String(process.pid));
	} catch {
		return claimExclusive(lockPath);
	}
	try {
		fs.linkSync(tmp, lockPath);
		return true;
	} catch (err) {
		if (err.code === "EEXIST") return false;
		return claimExclusive(lockPath);
	} finally {
		fs.rmSync(tmp, { force: true });
	}
}

function claimExclusive(lockPath) {
	try {
		const fd = fs.openSync(lockPath, "wx");
		fs.writeSync(fd, String(process.pid));
		fs.closeSync(fd);
		return true;
	} catch (err) {
		if (err.code === "EEXIST") return false;
		throw err;
	}
}

// Windows can refuse a rename or an unlink for a moment after the file is closed,
// so retry briefly. A release that still fails is not fatal: the next writer reads
// the holder's pid and reclaims the lock as a crashed holder's once it is gone.
function removeLock(lockPath) {
	for (let attempt = 0; ; attempt++) {
		try {
			fs.rmSync(lockPath, { force: true });
			return;
		} catch {
			if (attempt >= 20) return;
			sleepSync(5);
		}
	}
}

// A reclaimer can itself die holding the guard, so the guard is reclaimed the same
// way, one level deeper. The chain stops at two levels, the same bound the session
// lock uses. The bound is on depth and never on path length: a length bound turns a
// long repository path into a refusal for an ordinary single crash, which is worse
// than the wedge it was meant to avoid. Reaching the bound takes a crash inside a
// guard of a guard, and it throws an error naming the files a human must remove.
const MAX_TAKEOVER_DEPTH = 2;

// The error names every file that actually exists, walked from the real lock outward.
// Naming only the level the walk stopped at would list one file and leave the rest,
// and an instruction to remove files that are not there leaves the operator with the
// same refusal on the next run.
function takeoverChainTooDeep(lockPath, depth) {
	const root = lockPath.replace(/(?:\.takeover)+$/, "");
	const files = [root];
	for (let p = `${root}.takeover`; fs.existsSync(p); p += ".takeover") files.push(p);
	return new Error(
		codedError(
			"AMBER_E_LEDGER_LOCK_CHAIN",
			`${root} has a takeover chain ${depth} deep after repeated crashes; remove ${files.join(" and ")}`,
		),
	);
}

// Reclaiming a crashed holder's lock is a read-then-remove, and two reclaimers can
// read the same stale lock. Without a guard the slower one removes the lock the
// faster one has already created, so both append from the same tail and the chain
// breaks for good. Only the winner of the guard may remove the stale lock, and only
// while the file still holds exactly the bytes it read.
function acquireLock(lockPath, depth = 0) {
	// Bounded so a lock that is repeatedly created and released under us cannot spin
	// here forever; the caller's deadline owns the waiting.
	for (let spin = 0; spin < 100; spin++) {
		if (claimLock(lockPath)) return true;
		const raw = readLockRaw(lockPath);
		if (raw === null) continue;
		if (!holderIsReclaimable(raw, lockPath)) return false;
		if (depth >= MAX_TAKEOVER_DEPTH) throw takeoverChainTooDeep(lockPath, depth);
		const guardPath = `${lockPath}.takeover`;
		if (!acquireLock(guardPath, depth + 1)) return false;
		try {
			if (readLockRaw(lockPath) === raw) fs.rmSync(lockPath, { force: true });
		} finally {
			removeLock(guardPath);
		}
	}
	return false;
}

function withLedgerLock(ledgerPath, fn) {
	const lockPath = `${ledgerPath}.lock`;
	fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
	const deadline = Date.now() + LOCK_WAIT_MS;
	for (let delay = 1; ; delay = Math.min(delay * 2, 50)) {
		if (acquireLock(lockPath)) break;
		if (Date.now() > deadline) {
			throw new Error(
				codedError("AMBER_E_LEDGER_LOCKED", `${lockPath} is still held after ${LOCK_WAIT_MS} ms`),
			);
		}
		sleepSync(delay);
	}
	try {
		return fn();
	} finally {
		removeLock(lockPath);
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
