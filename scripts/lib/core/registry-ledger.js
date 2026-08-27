"use strict";

// Shared append-only ledger primitives for Amber's governed registries (the
// principal registry and the evidence receipts ledger). Each registry keeps
// its own file, event kinds, closed field sets, and stable codes; this module
// owns exactly the two disciplines every governed ledger shares, so an
// in-place edit fails closed identically everywhere:
//   1. the tamper-evident hash chain (loop-ledger pattern):
//      hash = sha256(prevHash + canonicalize(event-without-hash))
//   2. the exclusive append lock (admit.lock pattern): create-with-wx, stale
//      after a bounded window (a crashed holder releases the ledger; a live
//      one fails the second writer with the registry's own conflict code).

const fs = require("node:fs");
const path = require("node:path");
const { readLedgerFailClosed } = require("./jsonl");
const { typedError } = require("./error-catalog");
const { sha256Hex } = require("./context-hash");

const GENESIS_HASH = "0".repeat(64);

const DEFAULT_LOCK_STALE_MS = 30_000;

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

function chainHash(event, prevHash) {
	const body = { ...event, prevHash };
	delete body.hash;
	// sortKeys runs AFTER the prevHash merge: merging first and sorting second
	// is what makes the canonical body identical from the writer (which builds
	// the event without prevHash) and from the fold (which reads it back with
	// prevHash already present) — insertion order never leaks into the hash.
	return sha256Hex(prevHash + JSON.stringify(sortKeys(body)));
}

// The chain head: the last event's hash, or the genesis constant for an empty
// ledger. The writers read the tail under their registry lock, so a stale head
// cannot race a concurrent append.
function chainHeadHash(ledgerPath, corruptCode, label) {
	const events = readLedgerFailClosed(ledgerPath, corruptCode, label);
	return events.length > 0 && typeof events[events.length - 1].hash === "string"
		? events[events.length - 1].hash
		: GENESIS_HASH;
}

/**
 * Acquire the exclusive append lock for one ledger. Returns a release
 * function (idempotent). Fails closed with `conflictCode` when a fresh lock
 * is held by a live writer; reclaims a lock older than `staleMs` as a crashed
 * holder's leftover; fails with `corruptCode` on unexpected filesystem
 * errors.
 * @param {object} options - { dirPath, lockName, conflictCode, corruptCode, label, staleMs }.
 * @returns {() => void} The release function.
 */
function acquireLedgerLock({ dirPath, lockName, conflictCode, corruptCode, label, staleMs = DEFAULT_LOCK_STALE_MS }) {
	const lockPath = path.join(dirPath, lockName);
	try {
		fs.mkdirSync(dirPath, { recursive: true });
	} catch (err) {
		throw typedError(corruptCode, `cannot create the ${label} directory (${dirPath}): ${err.message}`);
	}
	for (;;) {
		try {
			const fd = fs.openSync(lockPath, "wx");
			fs.writeFileSync(fd, String(Date.now()), "utf8");
			fs.closeSync(fd);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				fs.rmSync(lockPath, { force: true });
			};
		} catch (err) {
			if (err.code !== "EEXIST") {
				throw typedError(corruptCode, `cannot create the ${label} lock (${lockPath}): ${err.message}`);
			}
			let age;
			try {
				age = Date.now() - fs.statSync(lockPath).mtimeMs;
			} catch {
				continue;
			}
			if (age > staleMs) {
				fs.rmSync(lockPath, { force: true });
				continue;
			}
			throw typedError(
				conflictCode,
				`another ${label} write is in flight (${lockPath} is fresh); the conflicting write is refused rather than racing it — retry once the in-flight write completes`,
			);
		}
	}
}

module.exports = {
	GENESIS_HASH,
	DEFAULT_LOCK_STALE_MS,
	chainHash,
	chainHeadHash,
	acquireLedgerLock,
};
