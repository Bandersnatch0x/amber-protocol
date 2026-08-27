"use strict";

// Shared append-only ledger primitives for Amber's governed registries (the
// principal registry and the evidence receipts ledger). Each registry keeps
// its own file, event kinds, closed field sets, and stable codes; this module
// owns exactly the three disciplines every governed ledger shares, so an
// in-place edit fails closed identically everywhere:
//   1. the tamper-evident hash chain (loop-ledger pattern):
//      hash = sha256(prevHash + canonicalize(event-without-its-own-hash))
//   2. the exclusive append lock (admit.lock pattern): create-with-wx, stale
//      after a bounded window (a crashed holder releases the ledger; a live
//      one fails the second writer with the registry's own conflict code)
//   3. the append size ceiling, checked before any durable state is touched
//      (on the body first, then under the lock on the exact chained event).

const fs = require("node:fs");
const path = require("node:path");
const { readLedgerFailClosed } = require("./jsonl");
const { typedError } = require("./error-catalog");
const { sha256Hex } = require("./context-hash");
const { resolvePositiveIntCeiling } = require("./resource-ceilings");

const GENESIS_HASH = "0".repeat(64);

const DEFAULT_LOCK_STALE_MS = 30_000;

function sortKeys(value) {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === "object") {
		return Object.keys(value)
			.sort()
			.reduce((acc, key) => {
				acc[key] = sortKeys(value[key]);
				return acc;
			}, {});
	}
	return value;
}

function chainHash(event, prevHash) {
	const body = { ...event, prevHash };
	// Only the event's OWN top-level hash is excluded — every nested "hash"
	// key (e.g. a receipt environment entry) stays inside the canonical body,
	// so an in-place edit of ANY stored content breaks the chain. Deleting
	// before the sortKeys merge below keeps the canonical body identical from
	// the writer (which builds the event without hash) and from the fold
	// (which reads it back with hash present) — insertion order never leaks
	// into the hash.
	delete body.hash;
	// sortKeys runs AFTER the prevHash merge: merging first and sorting second
	// is what makes the canonical body identical from the writer (which builds
	// the event without prevHash) and from the fold (which reads it back with
	// prevHash already present).
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

let lockTokenSeq = 0;

function readLockToken(lockPath) {
	try {
		return fs.readFileSync(lockPath, "utf8");
	} catch {
		return null;
	}
}

/**
 * Acquire the exclusive append lock for one ledger. Returns a release
 * function (idempotent). Fails closed with `conflictCode` when a fresh lock
 * is held by a live writer; reclaims a lock older than `staleMs` as a crashed
 * holder's leftover; fails with `corruptCode` on unexpected filesystem
 * errors.
 *
 * The lock content is a unique holder token: release only removes the lock it
 * created, and a stale reclaim re-reads the token before removing, so a
 * reclaimed-and-reacquired lock is never mistaken for the stale one (the
 * residual window — the token changing between the re-read and the remove —
 * is nanoseconds against a 30 s stale bound, and any resulting double append
 * still fails the fold's chain walk closed).
 *
 * @param {object} options - { dirPath, lockName, conflictCode, corruptCode, label, staleMs }.
 * @returns {() => void} The release function.
 */
function acquireLedgerLock({
	dirPath,
	lockName,
	conflictCode,
	corruptCode,
	label,
	staleMs = DEFAULT_LOCK_STALE_MS,
}) {
	const lockPath = path.join(dirPath, lockName);
	try {
		fs.mkdirSync(dirPath, { recursive: true });
	} catch (err) {
		throw typedError(
			corruptCode,
			`cannot create the ${label} directory (${dirPath}): ${err.message}`,
		);
	}
	for (;;) {
		const token = `${Date.now()}:${process.pid}:${(lockTokenSeq += 1)}`;
		try {
			const fd = fs.openSync(lockPath, "wx");
			fs.writeFileSync(fd, token, "utf8");
			fs.closeSync(fd);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				// Remove only the lock this holder created: a reclaimed lock
				// may already have been re-acquired by a successor.
				if (readLockToken(lockPath) === token) {
					fs.rmSync(lockPath, { force: true });
				}
			};
		} catch (err) {
			if (err.code !== "EEXIST") {
				throw typedError(
					corruptCode,
					`cannot create the ${label} lock (${lockPath}): ${err.message}`,
				);
			}
			let age;
			try {
				age = Date.now() - fs.statSync(lockPath).mtimeMs;
			} catch {
				continue;
			}
			if (age > staleMs) {
				// Re-read the token right before removing: if another
				// reclaimer already traded this stale lock for a fresh one,
				// the content no longer matches and we back off instead of
				// deleting a live writer's lock.
				const staleToken = readLockToken(lockPath);
				if (staleToken !== null) {
					try {
						if (fs.readFileSync(lockPath, "utf8") !== staleToken) continue;
					} catch {
						continue;
					}
					fs.rmSync(lockPath, { force: true });
				}
				continue;
			}
			throw typedError(
				conflictCode,
				`another ${label} write is in flight (${lockPath} is fresh); the conflicting write is refused rather than racing it — retry once the in-flight write completes`,
			);
		}
	}
}

/**
 * The shared append-size ceiling: would appending `event` grow the ledger at
 * `ledgerPath` past its bound? Refusing BEFORE any durable state is touched
 * (the callers re-check under the lock on the exact chained event, whose
 * chain fields the pre-lock body check cannot count).
 * @param {object} options - { ledgerPath, event, envName, defaultBytes, label }.
 * @returns {{ceiling: number, wouldExceed: boolean}}
 */
function appendWithinCeiling({ ledgerPath, event, envName, defaultBytes, label }) {
	const ceiling = resolvePositiveIntCeiling(envName, defaultBytes, `${label} size ceiling`);
	const line = `${JSON.stringify(event)}\n`;
	let currentBytes = 0;
	try {
		currentBytes = fs.existsSync(ledgerPath) ? fs.statSync(ledgerPath).size : 0;
	} catch {
		currentBytes = 0;
	}
	return { ceiling, wouldExceed: currentBytes + Buffer.byteLength(line, "utf8") > ceiling };
}

module.exports = {
	GENESIS_HASH,
	DEFAULT_LOCK_STALE_MS,
	chainHash,
	chainHeadHash,
	acquireLedgerLock,
	appendWithinCeiling,
};
