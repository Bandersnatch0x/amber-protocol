"use strict";

/**
 * Canonical Planning Artifacts — Intent admission (F049, #218/#219).
 *
 * A Canonical Artifact is a bound pair (ADR-0023): one human-readable
 * Artifact Body (Markdown) and one machine-actionable Artifact Envelope
 * (JSON). The pair is committed atomically through a durable
 * prepared/committed/aborted journal; only committed revisions are visible
 * to reads. Revisions are append-only and immutable — there is no in-place
 * mutation path for a committed revision's status or content.
 *
 * Admission is a compare-and-swap transaction on the expected head (#219)
 * with two serialization layers, so correctness never depends on call
 * interleaving:
 *
 *   1. Per-artifact exclusive admission lock (O_EXCL create + stale steal).
 *      The racing loser of a live admission fails closed immediately as
 *      AMBER_E_ARTIFACT_CONFLICT; sequential losers fail on the stale
 *      expected head instead. The lock is exclusion, not durability.
 *   2. The journal itself. Every prepared record claims its revision slot
 *      with a unique attemptId plus the expected head and admission hash it
 *      commits to; the admission re-validates slot ownership, the expected
 *      head, and settlement consistency after every append. Prepared slots
 *      are consumed, so a crashed attempt's dangling prepared record never
 *      lets a later admission reuse and overwrite its half-written files.
 *      validateSettlement replays the journal and fails closed on any
 *      sequence admission could not have written (double commit, commit
 *      without matching prepared, commit against a stale expected head — a
 *      forked settlement — or skipped revision slots).
 *
 * Idempotency is bound to the FULL canonical envelope content (ticket-01
 * review finding F3): the admission key covers schemaVersion, type,
 * identity, supersedes (the expected head), bodyHash, and provenance — only
 * assigned/volatile fields (revision, committedAt, envelopeHash) are
 * excluded. A verbatim retry recomputes the same key and returns the
 * original receipt without a new revision; the same Body with any other
 * envelope difference (e.g. changed provenance) fails closed as
 * AMBER_E_ARTIFACT_IDEMPOTENCY_CONFLICT instead of silently discarding the
 * new content. An optional caller idempotency key is admission metadata —
 * replaying it with identical content returns the original receipt, reusing
 * it with different content fails closed — but it never determines
 * identity: canonical identity stays owner-generated (identity + revision
 * + hashes), per the F049 spec.
 *
 * Storage layout (repository-local, always under .amber):
 *   .amber/artifacts/<types>/<identity-slug>/
 *     rev-<n>.md                 Body, verbatim
 *     rev-<n>.envelope.json      Envelope (canonical JSON)
 *     journal.jsonl              prepared/committed/aborted records
 *     admit.lock                 transitory exclusive admission lock
 *
 * Hashes reuse the existing canonical-hash primitives: the Body contentHash
 * is sha256 of the verbatim Body text; the Envelope hash covers the sorted-key
 * canonical serialization with the self-referential envelopeHash field
 * excluded, so an external verifier can recompute it from the stored file.
 */

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { sha256Hex, canonicalJson } = require("./context-hash");
const { appendJSONL, readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { codedError } = require("./error-catalog");

const ARTIFACT_TYPES = Object.freeze(["intent"]);
const ARTIFACT_STATUSES = Object.freeze(["prepared", "committed", "aborted"]);

// Journal record kinds double as the durable status names.
const KIND_PREPARED = "prepared";
const KIND_COMMITTED = "committed";
const KIND_ABORTED = "aborted";

const JOURNAL_CORRUPT_CODE = "AMBER_E_ARTIFACT_JOURNAL_CORRUPT";
const SETTLEMENT_CORRUPT_CODE = "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT";
const IDEMPOTENCY_CONFLICT_CODE = "AMBER_E_ARTIFACT_IDEMPOTENCY_CONFLICT";
const CONFLICT_CODE = "AMBER_E_ARTIFACT_CONFLICT";
const INVALID_ARG_CODE = "AMBER_E_INVALID_ARG";

// ponytail: exclusive-lock admission (open O_EXCL lock file → settle →
// unlink) instead of OS-level advisory locking; a crashed holder leaves the
// lock behind, so a stale lock older than LOCK_STALE_MS is stolen — and the
// journal serialization above still refuses to fork history even then.
const LOCK_STALE_MS = 30_000;

const TYPE_DIR_BY_TYPE = Object.freeze({ intent: "intents" });

// Pure-dot path segments ("." / "..") would resolve the artifact home to the
// store root or its parent instead of a per-identity directory.
const DOT_SEGMENT_PATTERN = /^\.+$/;

function isValidIdentity(identity) {
	return typeof identity === "string" && identity.length > 0 && !DOT_SEGMENT_PATTERN.test(identity);
}

function artifactDir(cwd, type, identity) {
	// ponytail: flat slug identity→dir; collisions across e.g. "a/b" vs "a_b"
	// would alias, acceptable for the tracer bullet's intent-only registry.
	const slug = `${identity}`.replace(/[^a-zA-Z0-9._-]+/g, "_");
	return statePathForCreate(cwd, "artifacts", TYPE_DIR_BY_TYPE[type] || type, slug);
}

function journalPath(dir) {
	return path.join(dir, "journal.jsonl");
}

// Per-artifact admission lock: O_EXCL create is the mutex. A crashed holder
// leaves the file behind, so a lock older than LOCK_STALE_MS is stolen.
// Returns an unlock function; throws a typed AMBER_E_ARTIFACT_CONFLICT when
// another admission holds a fresh lock (the live racing loser fails closed).
function acquireAdmissionLock(dir) {
	const lockPath = path.join(dir, "admit.lock");
	fs.mkdirSync(dir, { recursive: true });
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
			if (err.code !== "EEXIST") throw err;
			let age;
			try {
				age = Date.now() - fs.statSync(lockPath).mtimeMs;
			} catch {
				continue; // vanished between stat and open: retry immediately
			}
			if (age > LOCK_STALE_MS) {
				fs.rmSync(lockPath, { force: true });
				continue;
			}
			throw typedReadError(
				CONFLICT_CODE,
				"another admission for this artifact is in flight; the expected-head compare-and-swap lost the race",
			);
		}
	}
}

// Settlement journal reads fail closed (F035-S5 convention, matching the
// knowledge/audit ledgers): only an ABSENT journal is a legitimate empty
// state; a corrupt line throws the typed corruption error instead of letting
// a dropped record resurrect a stale head or reuse a consumed revision slot.
function readJournal(dir) {
	return readLedgerFailClosed(journalPath(dir), JOURNAL_CORRUPT_CODE, "artifact");
}

/** The Body's contentHash: sha256 of the verbatim Markdown text. */
function bodyHash(body) {
	return `sha256:${sha256Hex(body)}`;
}

/**
 * Deterministic canonical serialization of the Envelope: sorted keys, no
 * insignificant whitespace, self-referential envelopeHash field excluded —
 * the documented canonical form an external verifier recomputes to check
 * the stored hash. Reuses canonicalJson from context-hash (F049 constraint:
 * reuse existing canonical-hash primitives).
 */
function envelopeHash(envelope) {
	const { envelopeHash: _self, ...body } = envelope;
	return sha256Hex(canonicalJson(JSON.stringify(body)));
}

/**
 * The admission idempotency key (#219): sha256 over the canonical
 * serialization of every caller-determined Envelope field — schemaVersion,
 * type, identity, supersedes (the expected head), bodyHash, and provenance.
 * Assigned or volatile fields (revision, committedAt, envelopeHash) are
 * excluded, so a verbatim retry recomputes the same key while a retry that
 * changed ANY content — including provenance — does not. Ticket-01 review
 * finding F3: retries dedupe on the full canonical envelope content, never
 * on bodyHash alone.
 */
function admissionHash({
	schemaVersion,
	type,
	identity,
	supersedes,
	bodyHash: content,
	provenance,
}) {
	return sha256Hex(
		canonicalJson(
			JSON.stringify({
				schemaVersion,
				type,
				identity,
				supersedes: supersedes ?? null,
				bodyHash: content,
				provenance: provenance || null,
			}),
		),
	);
}

// The admission key of an already-stored Envelope (same field set).
function admissionHashOfEnvelope(envelope) {
	return admissionHash({
		schemaVersion: envelope.schemaVersion,
		type: envelope.type,
		identity: envelope.identity,
		supersedes: envelope.supersedes ?? null,
		bodyHash: envelope.bodyHash,
		provenance: envelope.provenance || null,
	});
}

function readEnvelope(dirPath, revision) {
	try {
		return JSON.parse(fs.readFileSync(path.join(dirPath, `rev-${revision}.envelope.json`), "utf8"));
	} catch {
		return null;
	}
}

function readBody(dirPath, revision) {
	try {
		return fs.readFileSync(path.join(dirPath, `rev-${revision}.md`), "utf8");
	} catch {
		return null;
	}
}

// Walk every existing artifact home directory and yield { dir }.
function walkArtifactHomes(cwd) {
	const root = statePathForCreate(cwd, "artifacts");
	if (!fs.existsSync(root)) return [];
	const out = [];
	for (const typeDir of fs.readdirSync(root)) {
		const homeRoot = path.join(root, typeDir);
		if (!fs.statSync(homeRoot).isDirectory()) continue;
		for (const slug of fs.readdirSync(homeRoot)) {
			const dir = path.join(homeRoot, slug);
			if (!fs.existsSync(journalPath(dir))) continue;
			out.push({ dir });
		}
	}
	return out;
}

// Current committed revision number for an artifact dir, or 0 when none.
function committedHead(journal) {
	return maxSettledRevision(journal, KIND_COMMITTED);
}

// Highest revision slot ever CLAIMED (prepared, committed, or aborted):
// settled slots are consumed, and so are dangling prepared slots — a
// crashed admission's half-written files must never be overwritten by a
// later admission reusing its slot.
function highestClaimedRevision(journal) {
	return maxSettledRevision(journal, KIND_PREPARED, KIND_COMMITTED, KIND_ABORTED);
}

function maxSettledRevision(journal, ...kinds) {
	let max = 0;
	for (const record of journal) {
		if (kinds.includes(record.kind) && typeof record.revision === "number") {
			max = Math.max(max, record.revision);
		}
	}
	return max;
}

// Unique committed revision numbers, newest first.
function committedRevisions(journal) {
	const seen = new Set();
	for (const record of [...journal].reverse()) {
		if (record.kind === KIND_COMMITTED && typeof record.revision === "number") {
			seen.add(record.revision);
		}
	}
	return [...seen];
}

// Latest committed record carrying a given caller idempotency key, or null.
function findKeyRecord(journal, idempotencyKey) {
	return (
		[...journal]
			.reverse()
			.find((r) => r.kind === KIND_COMMITTED && r.idempotencyKey === idempotencyKey) || null
	);
}

// Typed read failure: a real Error carrying .amberCode so CLI readFailure
// surfaces the stable code instead of its NOT_FOUND fallback (same contract
// as ledgerCorruptError in jsonl.js).
function typedReadError(code, message) {
	const error = new Error(codedError(code, message));
	error.amberCode = code;
	return error;
}

/**
 * Build the externally visible projection of one committed revision.
 * Verifies both halves of the binding before serving (ADR-0023): the stored
 * Body against its recorded contentHash, and the stored Envelope against its
 * own canonical envelopeHash. Either mismatch is corruption, not content.
 */
function committedProjection(type, identity, revision, body, envelope, committedAt) {
	const recordedHash = envelope.bodyHash || null;
	if (!recordedHash || bodyHash(body) !== recordedHash) {
		throw typedReadError(
			"AMBER_E_ARTIFACT_HASH_MISMATCH",
			`stored Body for "${identity}" revision ${revision} no longer matches its recorded contentHash`,
		);
	}
	if (envelope.envelopeHash !== envelopeHash(envelope)) {
		throw typedReadError(
			"AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH",
			`stored Envelope for "${identity}" revision ${revision} no longer matches its recorded envelopeHash`,
		);
	}
	return Object.freeze({
		type,
		identity,
		revision,
		status: "committed",
		body,
		envelope,
		contentHash: recordedHash,
		envelopeHash: envelope.envelopeHash || null,
		supersedes: envelope.supersedes ?? null,
		provenance: envelope.provenance || null,
		committedAt: committedAt || null,
	});
}

/**
 * Verify the settled pair for one revision and build its receipt. Returns
 * null when the pair is not readable on disk; throws the typed read error
 * when the stored binding fails verification. A duplicate retry must never
 * succeed against a tampered revision.
 */
function verifiedReceipt(dir, type, identity, revision, journal) {
	const body = readBody(dir, revision);
	const envelope = readEnvelope(dir, revision);
	if (!body || !envelope) return null;
	committedProjection(type, identity, revision, body, envelope, null);
	return receiptFor(type, identity, revision, envelope, journal);
}

/**
 * Replay the settlement journal and fail closed on any sequence admission
 * itself could never have written (#219):
 *   (a) a revision settled by more than one committed record,
 *   (b) a committed record without an earlier matching prepared record
 *       (revision + admissionHash; hashless legacy records match on revision),
 *   (c) a committed record whose recorded expected head was already stale
 *       when it landed — the replayed head at that point must equal it
 *       (hashless legacy records without expectedHead are not checkable),
 *   (d) revision slots that skip or start away from 1 (truncated or forged
 *       numbering).
 * @param {Array<object>} journal Parsed journal records, in append order.
 * @throws {Error} Typed AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT.
 */
function validateSettlement(journal) {
	const preparedHashes = new Set(); // "<revision>:<admissionHash>"
	const preparedRevisions = new Set(); // legacy: revision claimed by some prepared record
	const committed = new Set();
	const seenRevisions = new Set();
	let replayedHead = 0;
	let maxRevision = 0;
	for (const record of journal) {
		const revision = record.revision;
		if (typeof revision !== "number" || !Number.isInteger(revision)) continue;
		seenRevisions.add(revision);
		maxRevision = Math.max(maxRevision, revision);
		if (record.kind === KIND_PREPARED) {
			preparedRevisions.add(revision);
			if (typeof record.admissionHash === "string") {
				preparedHashes.add(`${revision}:${record.admissionHash}`);
			}
		} else if (record.kind === KIND_COMMITTED) {
			if (committed.has(revision)) {
				throw typedReadError(
					SETTLEMENT_CORRUPT_CODE,
					`artifact journal settles revision ${revision} with more than one committed record`,
				);
			}
			const hash = typeof record.admissionHash === "string" ? record.admissionHash : null;
			const prepared =
				hash !== null ? preparedHashes.has(`${revision}:${hash}`) : preparedRevisions.has(revision);
			if (!prepared) {
				throw typedReadError(
					SETTLEMENT_CORRUPT_CODE,
					`artifact journal commits revision ${revision} without a matching prepared record`,
				);
			}
			if (typeof record.expectedHead === "number" && record.expectedHead !== replayedHead) {
				throw typedReadError(
					SETTLEMENT_CORRUPT_CODE,
					`artifact journal commits revision ${revision} against expected head ${record.expectedHead} while the replayed head is ${replayedHead} (forked or forged settlement)`,
				);
			}
			committed.add(revision);
			replayedHead = Math.max(replayedHead, revision);
		}
	}
	for (let slot = 1; slot <= maxRevision; slot += 1) {
		if (!seenRevisions.has(slot)) {
			throw typedReadError(
				SETTLEMENT_CORRUPT_CODE,
				`artifact journal skips revision slot ${slot} (truncated or forged numbering)`,
			);
		}
	}
}

/**
 * Post-append settlement guard: re-read the journal, replay-validate it, and
 * confirm this attempt still owns its claimed slot against an unchanged
 * expected head. The journal — not the lock — is the durable serialization
 * point: even a stolen or stale lock cannot let two admissions fork history
 * silently, because the loser fails closed here and any residue is rejected
 * by validateSettlement on the next admission.
 * @throws {Error} Typed AMBER_E_ARTIFACT_CONFLICT / corruption codes.
 */
function settleGuard(dir, { revision, attemptId, expectedHead }) {
	const journal = readJournal(dir);
	validateSettlement(journal);
	const firstClaim = journal.find((r) => r.kind === KIND_PREPARED && r.revision === revision);
	if (!firstClaim || firstClaim.attemptId !== attemptId) {
		throw typedReadError(
			CONFLICT_CODE,
			`lost the compare-and-swap for revision ${revision}: another admission claimed the slot first`,
		);
	}
	if (committedHead(journal) !== expectedHead) {
		throw typedReadError(
			CONFLICT_CODE,
			`expected head ${expectedHead} is stale; current committed revision is ${committedHead(journal)}`,
		);
	}
	return journal;
}

/**
 * Read one artifact's current (or explicit) revision with journal-settled
 * visibility. Returns null when the identity has no committed revision or
 * the named revision is not committed — prepared/aborted stay invisible.
 * @throws {Error} Typed AMBER_E_ARTIFACT_JOURNAL_CORRUPT on a corrupt journal,
 *         AMBER_E_ARTIFACT_HASH_MISMATCH / AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH
 *         when a stored pair fails its binding.
 */
function showArtifact(cwd, identity, { type = "intent", revision = null } = {}) {
	const dir = artifactDir(cwd, type, identity);
	const journal = readJournal(dir);
	for (const record of [...journal].reverse()) {
		if (record.kind !== KIND_COMMITTED) continue;
		if (revision !== null && record.revision !== revision) continue;
		const body = readBody(dir, record.revision);
		const envelope = readEnvelope(dir, record.revision);
		if (!body || !envelope) continue; // orphaned half on disk: not readable
		return committedProjection(type, identity, record.revision, body, envelope, record.at);
	}
	return null;
}

// Latest committed revision per artifact, first-seen order.
function committedCurrents(cwd) {
	const currents = [];
	for (const { dir } of walkArtifactHomes(cwd)) {
		const journal = readJournal(dir);
		const head = committedHead(journal);
		if (!head) continue;
		const envelope = readEnvelope(dir, head);
		const body = readBody(dir, head);
		if (!envelope || !body) continue; // orphaned half: skip
		currents.push(
			committedProjection(envelope.type, envelope.identity, head, body, envelope, null),
		);
	}
	return currents;
}

/** List committed artifacts (current revision each). */
function listArtifacts(cwd) {
	return committedCurrents(cwd);
}

/**
 * Admit one Canonical Artifact revision: validate the Body/Envelope pair,
 * then settle it atomically through prepared → committed journal records as
 * a compare-and-swap transaction on the expected head (#219).
 *
 * Contract:
 * - `supersedes` / `expectedHead` name the same CAS precondition (they must
 *   agree when both are given): the revision the caller expects to build on.
 *   A stale expectation fails closed as AMBER_E_ARTIFACT_CONFLICT. When
 *   omitted, the artifact must have no committed head yet — different
 *   content at an existing head without an expected head fails closed as
 *   conflict too (no silent forking of history).
 * - `idempotencyKey` is optional caller retry metadata. Replaying the same
 *   canonical content under the same key returns the original receipt with
 *   no new revision; reusing the key with different content fails closed as
 *   AMBER_E_ARTIFACT_IDEMPOTENCY_CONFLICT. Without a key, retries are bound
 *   to canonical content directly: a verbatim re-admission of any committed
 *   revision returns its original receipt, while the same Body with a
 *   different envelope (e.g. changed provenance) at the head fails closed
 *   instead of silently discarding the difference.
 * - Tampered or inconsistent settlement state (impossible journal
 *   sequences, a committed pair missing or failing its binding) fails
 *   closed as corruption with stable codes instead of being served or
 *   overwritten.
 */
function admitArtifact(
	cwd,
	{
		type = "intent",
		identity,
		body,
		provenance = null,
		supersedes = null,
		expectedHead = null,
		idempotencyKey = null,
	},
) {
	const fail = (code, errors) => ({ ok: false, code, receipt: null, errors });

	if (!ARTIFACT_TYPES.includes(type)) {
		return fail("AMBER_E_ARTIFACT_UNKNOWN_TYPE", [
			`artifact type "${type}" is not registered; registered types: ${ARTIFACT_TYPES.join(", ")}`,
		]);
	}
	if (!isValidIdentity(identity)) {
		return fail("AMBER_E_ARTIFACT_INVALID_IDENTITY", [
			`artifact identity "${identity}" is not a usable directory name (empty and pure-dot segments are rejected)`,
		]);
	}
	// Pair binding (ADR-0023): both sides must arrive in one atomic call.
	if (typeof body !== "string" || body.length === 0) {
		return fail("AMBER_E_ARTIFACT_ORPHANED_HALF", [
			"admission received an Envelope without a readable Artifact Body",
		]);
	}

	// The expected head is a positive revision number or null (first
	// admission). Garbage never reaches the CAS comparison.
	const declared = [];
	for (const [value, label] of [
		[supersedes, "supersedes"],
		[expectedHead, "expectedHead"],
	]) {
		if (value === undefined || value === null) continue;
		if (!Number.isInteger(value) || value < 1) {
			return fail(INVALID_ARG_CODE, [
				`${label} must be a positive integer revision number or null; got ${JSON.stringify(value)}`,
			]);
		}
		declared.push([label, value]);
	}
	if (declared.length === 2 && declared[0][1] !== declared[1][1]) {
		return fail(CONFLICT_CODE, [
			`expectedHead ${expectedHead} contradicts supersedes ${supersedes}; one admission cannot claim two heads`,
		]);
	}
	const expected = declared.length > 0 ? declared[0][1] : null;

	const key =
		typeof idempotencyKey === "string" && idempotencyKey.length > 0 ? idempotencyKey : null;

	const dir = artifactDir(cwd, type, identity);
	let unlock;
	try {
		unlock = acquireAdmissionLock(dir);
	} catch (err) {
		return fail(err.amberCode || CONFLICT_CODE, [err.message]);
	}
	try {
		return admitUnderLock(dir, type, identity, body, provenance, expected, key, fail);
	} finally {
		unlock();
	}
}

function admitUnderLock(dir, type, identity, body, provenance, expected, idempotencyKey, fail) {
	const contentHashValue = bodyHash(body);
	const incomingKeyHash = admissionHash({
		schemaVersion: 1,
		type,
		identity,
		supersedes: expected,
		bodyHash: contentHashValue,
		provenance,
	});

	let journal;
	try {
		journal = readJournal(dir);
		validateSettlement(journal);
	} catch (err) {
		return fail(err.amberCode || JOURNAL_CORRUPT_CODE, [err.message]);
	}
	const head = committedHead(journal);

	// Caller-key idempotency: the key is retry metadata recorded on the
	// committed journal record. Replaying identical canonical content
	// returns the original receipt; reusing the key for different content
	// fails closed (the key never re-binds, and never determines identity).
	if (idempotencyKey !== null) {
		const prior = findKeyRecord(journal, idempotencyKey);
		if (prior) {
			let priorEnvelope = readEnvelope(dir, prior.revision);
			let priorBody = readBody(dir, prior.revision);
			if (!priorEnvelope || !priorBody) {
				return fail(SETTLEMENT_CORRUPT_CODE, [
					`revision ${prior.revision} settled under idempotency key "${idempotencyKey}" is missing its Body/Envelope pair on disk; refusing to serve inconsistent settlement state`,
				]);
			}
			try {
				committedProjection(type, identity, prior.revision, priorBody, priorEnvelope, null);
			} catch (err) {
				return fail(err.amberCode || SETTLEMENT_CORRUPT_CODE, [err.message]);
			}
			if (admissionHashOfEnvelope(priorEnvelope) !== incomingKeyHash) {
				return fail(IDEMPOTENCY_CONFLICT_CODE, [
					`idempotency key "${idempotencyKey}" was already settled by revision ${prior.revision} with different canonical content (Body, provenance, or expected head); a retry must replay the exact original admission — use a new key for new content`,
				]);
			}
			return {
				ok: true,
				duplicate: true,
				code: null,
				errors: [],
				receipt: receiptFor(type, identity, prior.revision, priorEnvelope, journal),
			};
		}
	}

	// Content-bound idempotency: any committed revision whose full canonical
	// admission content matches returns its original receipt — a retry after
	// a timeout, or a retry of a revision that was later superseded, never
	// creates a duplicate revision. The pair is verified before the receipt
	// is returned, so a retry can never succeed against a tampered revision.
	for (const revision of committedRevisions(journal)) {
		const envelope = readEnvelope(dir, revision);
		if (!envelope || admissionHashOfEnvelope(envelope) !== incomingKeyHash) continue;
		try {
			const receipt = verifiedReceipt(dir, type, identity, revision, journal);
			if (receipt) {
				return { ok: true, duplicate: true, code: null, errors: [], receipt };
			}
		} catch (err) {
			return fail(err.amberCode || JOURNAL_CORRUPT_CODE, [err.message]);
		}
	}

	// Expected-head compare-and-swap.
	if (head > 0) {
		const current = readEnvelope(dir, head);
		const currentBody = readBody(dir, head);
		if (!current || !currentBody) {
			return fail(SETTLEMENT_CORRUPT_CODE, [
				`committed revision ${head} of "${identity}" is missing its Body/Envelope pair on disk; refusing to admit on top of inconsistent settlement state`,
			]);
		}
		if (expected === null) {
			if (current.bodyHash === contentHashValue) {
				// F3: the same Body with a different canonical envelope
				// (provenance or anything else) is NOT a duplicate retry —
				// fail closed instead of silently discarding the difference.
				return fail(IDEMPOTENCY_CONFLICT_CODE, [
					`"${identity}" is at revision ${head} with the same Body but different canonical Envelope content; an idempotent retry must replay the original admission exactly (Body, provenance, and expected head) — pass --expected-head ${head} to admit the changed content as a new revision`,
				]);
			}
			return fail(CONFLICT_CODE, [
				`"${identity}" is at revision ${head} with different content; pass --expected-head ${head} (or --supersedes-revision ${head}) to supersede it`,
			]);
		}
		if (expected !== head) {
			return fail(CONFLICT_CODE, [
				`expected head ${expected} is stale; current committed revision is ${head}`,
			]);
		}
		// Building on the head: its pair must still hold its binding.
		try {
			committedProjection(type, identity, head, currentBody, current, null);
		} catch (err) {
			return fail(err.amberCode || SETTLEMENT_CORRUPT_CODE, [err.message]);
		}
	} else if (expected !== null) {
		return fail(CONFLICT_CODE, [
			`cannot supersede revision ${expected}: "${identity}" has no committed revisions`,
		]);
	}

	const revision = highestClaimedRevision(journal) + 1;
	const preparedAt = new Date().toISOString();
	const attemptId = randomUUID();
	const envelope = Object.freeze({
		schemaVersion: 1,
		type,
		identity,
		revision,
		supersedes: expected,
		bodyHash: contentHashValue,
		envelopeHash: envelopeHash({
			schemaVersion: 1,
			type,
			identity,
			revision,
			supersedes: expected,
			bodyHash: contentHashValue,
			provenance: provenance || null,
			committedAt: preparedAt,
		}),
		provenance: provenance || null,
		committedAt: preparedAt,
	});

	// Claim the slot, then re-validate through the journal after every
	// append: the prepared record is the durable CAS intent, and the guard
	// makes the journal itself the serialization point.
	appendJSONL(journalPath(dir), {
		kind: KIND_PREPARED,
		revision,
		at: preparedAt,
		expectedHead: head,
		admissionHash: incomingKeyHash,
		attemptId,
		...(idempotencyKey !== null ? { idempotencyKey } : {}),
	});
	try {
		settleGuard(dir, { revision, attemptId, expectedHead: head });
	} catch (err) {
		return fail(err.amberCode || JOURNAL_CORRUPT_CODE, [err.message]);
	}

	// Atomic pair write between prepared and committed: a crash in between
	// leaves the files present but the revision uncommitted (invisible), and
	// the consumed slot is never reused.
	fs.writeFileSync(path.join(dir, `rev-${revision}.md`), body, "utf8");
	fs.writeFileSync(
		path.join(dir, `rev-${revision}.envelope.json`),
		JSON.stringify(envelope, null, 2) + "\n",
		"utf8",
	);
	try {
		settleGuard(dir, { revision, attemptId, expectedHead: head });
	} catch (err) {
		return fail(err.amberCode || JOURNAL_CORRUPT_CODE, [err.message]);
	}

	appendJSONL(journalPath(dir), {
		kind: KIND_COMMITTED,
		revision,
		at: new Date().toISOString(),
		expectedHead: head,
		admissionHash: incomingKeyHash,
		contentHash: contentHashValue,
		...(idempotencyKey !== null ? { idempotencyKey } : {}),
	});

	return {
		ok: true,
		duplicate: false,
		code: null,
		errors: [],
		receipt: receiptFor(type, identity, revision, envelope, readJournal(dir)),
	};
}

function receiptFor(type, identity, revision, envelope, journal) {
	const commitRecord = [...journal]
		.reverse()
		.find((r) => r.kind === KIND_COMMITTED && r.revision === revision);
	return Object.freeze({
		type,
		identity,
		revision,
		contentHash: envelope.bodyHash,
		envelopeHash: envelope.envelopeHash,
		supersedes: envelope.supersedes ?? null,
		provenance: envelope.provenance,
		committedAt: commitRecord ? commitRecord.at : envelope.committedAt,
	});
}

module.exports = {
	ARTIFACT_TYPES,
	ARTIFACT_STATUSES,
	bodyHash,
	envelopeHash,
	admitArtifact,
	showArtifact,
	listArtifacts,
};
