"use strict";

// Shared append-only ledger primitives for Amber's governed registries.
// Each registry keeps its own file, event kinds, closed field sets, and
// stable codes; this module owns the disciplines every governed ledger
// shares, so an in-place edit fails closed identically everywhere:
//   1. the tamper-evident hash chain (loop-ledger pattern):
//      hash = sha256(prevHash + canonicalize(event-without-its-own-hash))
//   2. the exclusive append lock (admit.lock pattern): create-with-wx, stale
//      after a bounded window (a crashed holder releases the ledger; a live
//      one fails the second writer with the registry's own conflict code)
//   3. the append size ceiling, checked before any durable state is touched
//      (on the body first, then under the lock on the exact chained event)
//   4. the credential-material refusal shared by every ledger-bound field
//      (credentialLeakProblem), so no registry can store a secret.
//   5. the Decision primitives (ADR-0028): the kinds-parameterized decision
//      snapshot validator, the canonical content hash, and the single
//      spend-scan kernel every family spender shell consumes.

const fs = require("node:fs");
const path = require("node:path");
const { appendJSONL, readLedgerFailClosed } = require("./jsonl");
const { typedError } = require("./error-catalog");
const { sha256Hex, canonicalJson } = require("./context-hash");
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

// The canonical content hash governed registries store and re-derive
// (`sha256:` + hex of the key-sorted JSON, hashed as UTF-8): one source,
// so a fingerprint computed by one family always re-derives in another.
function canonicalHashOf(value) {
	return `sha256:${sha256Hex(canonicalJson(JSON.stringify(value)))}`;
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
	let currentBytes;
	try {
		currentBytes = fs.existsSync(ledgerPath) ? fs.statSync(ledgerPath).size : 0;
	} catch {
		currentBytes = 0;
	}
	return { ceiling, wouldExceed: currentBytes + Buffer.byteLength(line, "utf8") > ceiling };
}

// Shared governed-append orchestration: lock → fold → guard → chain-head →
// ceiling → append → re-fold → derive. Guard contract: any non-null guard
// result is returned verbatim without appending; `derive(fold)` picks the
// caller's record after the append. `body` may be a factory evaluated
// against the in-lock fold (after the guard, same fold object), for events
// whose shape depends on current ledger state. Optional
// `options.ceilingMessage(event, ceiling)` (ADR-0028 Amendment) overrides
// the shared ceiling refusal wording; `options.chainHeadLabel` (ADR-0028
// Amendment) optionally preserves a family-specific label for the chain-head
// read; absent, the shared label rides unchanged. `options.appendMessage`
// optionally preserves a family-specific append I/O refusal wording.
function appendLedgerEvent(cwd, options, body, guard, derive) {
	const failure = (err, message = null) => ({
		ok: false,
		code: err.amberCode || options.corruptCode,
		record: null,
		errors: [message ?? (err.message || String(err))],
	});
	let release;
	try {
		release = options.acquire(cwd);
	} catch (err) {
		return failure(err);
	}
	try {
		let folded;
		try {
			folded = options.fold(cwd);
		} catch (err) {
			return failure(err);
		}
		const guardVerdict = guard(folded);
		if (guardVerdict !== null) return guardVerdict;
		const eventBody = typeof body === "function" ? body(folded) : body;
		let prevHash;
		try {
			prevHash = chainHeadHash(
				options.path(cwd),
				options.corruptCode,
				options.chainHeadLabel ?? options.label,
			);
		} catch (err) {
			return failure(err);
		}
		const event = { ...eventBody, prevHash, hash: chainHash(eventBody, prevHash) };
		let ceiling;
		try {
			ceiling = appendWithinCeiling({
				ledgerPath: options.path(cwd),
				event,
				envName: options.envName,
				defaultBytes: options.defaultBytes,
				label: options.label,
			});
		} catch (err) {
			return failure(err);
		}
		if (ceiling.wouldExceed)
			return {
				ok: false,
				code: options.sizeCeilingCode,
				record: null,
				errors: [
					options.ceilingMessage
						? options.ceilingMessage(event, ceiling.ceiling)
						: `${options.label} event would exceed ${ceiling.ceiling} bytes`,
				],
			};
		try {
			appendJSONL(options.path(cwd), event);
		} catch (err) {
			return failure(err, options.appendMessage?.(event, err));
		}
		let record;
		try {
			record = derive(options.fold(cwd)) ?? null;
		} catch (err) {
			return failure(err);
		}
		return { ok: true, code: null, record, errors: [] };
	} finally {
		release();
	}
}

// The chain-walk prologue every governed fold shares: object shape, link,
// and content hash. Returns the problem text (the caller owns the corrupt
// error type) or null. Optional `wording(kind, event, lineIndex, label)`
// (ADR-0028 Amendment, #307) overrides the shared refusal text per kind
// (`"not-object"` / `"broken"` / `"mismatch"`) so a family whose recorded
// contract names `prevHash` or appends "edited in place" keeps that
// wording; absent, the shared orchestration text rides unchanged.
function chainLinkProblem(event, prevHash, lineIndex, label, wording) {
	const text = (kind, fallback) => {
		if (typeof wording !== "function") return fallback;
		const override = wording(kind, event, lineIndex, label);
		return typeof override === "string" && override.length > 0 ? override : fallback;
	};
	if (!isPlainObject(event))
		return text("not-object", `${label} event ${lineIndex} is not an object`);
	if (typeof event.prevHash !== "string" || event.prevHash !== prevHash)
		return text("broken", `${label} event ${lineIndex} breaks the hash chain`);
	if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash)
		return text(
			"mismatch",
			`${label} event ${lineIndex} carries a hash that does not match its content`,
		);
	return null;
}

// ── Shared registry validators (acceptance review S1) ───────────────────
// The governed registries (maintain/retention/external/breakglass) share
// one validation vocabulary: plain-object/non-empty-string primitives,
// closed field sets, the {identity, revision} Decision pin, and the
// committed-unscoped-human-Decision resolver. One canonical signature
// lives here; per-registry latitude stays in the caller (labels, kind
// sets, and error-code mapping).

function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function quotedList(values) {
	return values.map((value) => JSON.stringify(value)).join(", ");
}

function closedFieldProblem(value, fields, label) {
	const unknown = Object.keys(value)
		.filter((key) => !fields.includes(key))
		.sort();
	if (unknown.length > 0) {
		return `${label} carries unknown field${unknown.length > 1 ? "s" : ""} ${quotedList(unknown)}; the closed field set is ${fields.join(", ")}`;
	}
	const missing = fields.filter((field) => !(field in value));
	if (missing.length > 0) {
		return `${label} is missing field${missing.length > 1 ? "s" : ""} ${quotedList(missing)}; the closed field set is ${fields.join(", ")}`;
	}
	return null;
}

function unknownFieldProblem(value, fields, label) {
	const unknown = Object.keys(value)
		.filter((key) => !fields.includes(key))
		.sort();
	if (unknown.length === 0) return null;
	return `${label} carries unknown field${unknown.length > 1 ? "s" : ""} ${quotedList(unknown)}; the closed field set is ${fields.join(", ")}`;
}

function decisionPinProblem(value) {
	if (!isPlainObject(value)) return "decision must be an object carrying identity and revision";
	const unknown = unknownFieldProblem(value, ["identity", "revision"], "decision");
	if (unknown !== null) return unknown;
	if (!isNonEmptyString(value.identity)) return "decision.identity must be a non-empty string";
	if (!Number.isInteger(value.revision) || value.revision < 1)
		return "decision.revision must be a positive integer";
	return null;
}

// Resolve one committed, unscoped Decision artifact revision whose kind
// is inside the caller's closed human-authority set, freezing the
// verified principal snapshot. Returns {decision} on success or
// {problem} with the refusal text; the caller owns the error code.
function resolveRegistrationDecision(revisions, decision, kinds, label) {
	const match = revisions.find(
		(revision) =>
			revision.type === "decision" &&
			revision.identity === decision.identity &&
			revision.revision === decision.revision,
	);
	if (!match)
		return {
			problem: `decision ${JSON.stringify(decision.identity)}@${decision.revision} is not a committed Decision artifact`,
		};
	if ((match.scope ?? null) !== null)
		return {
			problem: `decision ${JSON.stringify(decision.identity)}@${decision.revision} is scoped to ${JSON.stringify(match.scope)}; ${label} is repository-global and binds an unscoped Decision`,
		};
	if (!kinds.includes(match.decisionKind))
		return {
			problem: `${label} requires a human acceptance or approval Decision; ${JSON.stringify(decision.identity)}@${decision.revision} carries decisionKind ${JSON.stringify(match.decisionKind)}`,
		};
	const principal = match.principal?.id;
	if (!isNonEmptyString(principal))
		return {
			problem: `decision ${JSON.stringify(decision.identity)}@${decision.revision} carries no verified principal snapshot`,
		};
	return {
		decision: {
			identity: decision.identity,
			revision: decision.revision,
			decisionKind: match.decisionKind,
			principal,
		},
	};
}

// The frozen Decision snapshot a governed event stores after resolution.
// The closed kind set stays per-registry latitude, passed as `kinds`.
const DECISION_SNAPSHOT_FIELDS = Object.freeze([
	"identity",
	"revision",
	"decisionKind",
	"principal",
]);

function decisionSnapshotProblem(value, kinds, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, DECISION_SNAPSHOT_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(value.identity)) return `${label}.identity must be a non-empty string`;
	if (!Number.isInteger(value.revision) || value.revision < 1)
		return `${label}.revision must be a positive integer`;
	if (!kinds.includes(value.decisionKind))
		return `${label}.decisionKind must be one of ${kinds.join(", ")}`;
	if (!isNonEmptyString(value.principal)) return `${label}.principal must be a non-empty string`;
	return null;
}

// The single spend-scan kernel (ADR-0028): walk folded records in ledger
// order and each record's declared slot paths in declaration order; the
// first slot already carrying the pinned Decision names the spend as
// {record, slot}, or null when the Decision is unspent. A dot-separated
// slot path reads through nested objects; a null or missing step reads
// as unspent. The family shells own return shapes and refusal wording.
function findDecisionSpend(records, decision, slots) {
	for (const record of records) {
		for (const slot of slots) {
			let pin = record;
			for (const step of slot.split(".")) {
				pin = isPlainObject(pin) ? pin[step] : null;
			}
			if (
				isPlainObject(pin) &&
				pin.identity === decision.identity &&
				pin.revision === decision.revision
			)
				return { record, slot };
		}
	}
	return null;
}

// Well-known credential shapes refuse in any ledger-bound field —
// belt-and-braces on top of closed shapes that carry no handle slot.
const CREDENTIAL_MATERIAL_PATTERN =
	/(bearer\s|basic\s|eyJ[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{10,}|xox[a-z]-|AKIA[0-9A-Z]{10,}|-----BEGIN|api[-_]?key\s*[=:]|secret\s*[=:]|password\s*[=:]|token\s*[=:])/i;

function credentialLeakProblem(value, label) {
	if (typeof value !== "string") return null;
	if (CREDENTIAL_MATERIAL_PATTERN.test(value))
		return `${label} carries what looks like credential material; credentials never ride a record, receipt, or error — only the purpose/scope/expiry boundary is ever stored`;
	return null;
}

// One home for the heuristic's message signature: callers map a leak
// problem onto their registry's dedicated code without re-matching text.
function isCredentialLeakProblem(problem) {
	return typeof problem === "string" && problem.includes("credential material");
}

module.exports = {
	GENESIS_HASH,
	DEFAULT_LOCK_STALE_MS,
	chainHash,
	chainHeadHash,
	acquireLedgerLock,
	appendWithinCeiling,
	appendLedgerEvent,
	credentialLeakProblem,
	isCredentialLeakProblem,
	chainLinkProblem,
	isPlainObject,
	isNonEmptyString,
	quotedList,
	closedFieldProblem,
	unknownFieldProblem,
	decisionPinProblem,
	resolveRegistrationDecision,
	DECISION_SNAPSHOT_FIELDS,
	decisionSnapshotProblem,
	canonicalHashOf,
	findDecisionSpend,
};
