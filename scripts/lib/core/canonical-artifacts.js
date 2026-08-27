"use strict";

/**
 * Canonical Planning Artifacts — admission, settlement, typed lineage
 * (F049, #218/#219/#220).
 *
 * A Canonical Artifact is a bound pair (ADR-0023): one human-readable
 * Artifact Body (Markdown) and one machine-actionable Artifact Envelope
 * (JSON). The pair is committed atomically through a durable
 * prepared/committed/aborted journal; only committed revisions are visible
 * to reads. Revisions are append-only and immutable — there is no in-place
 * mutation path for a committed revision's status or content.
 *
 * Ticket 03 (#220) registers Spec and Plan alongside Intent, each with a
 * closed lifecycle and named-transition contract, and adds the typed Trace
 * lineage (refines / realizes / supersedes; F050 #226 adds the decision
 * type and its decides trace; see canonical-artifact-contracts.js for the
 * registries):
 * - The Envelope carries `lifecycle` (the revision's lifecycle state),
 *   `transition` (the named transition this admission applied, if any),
 *   `scope` (an optional confinement tag), and its resolved `traces` with
 *   the trace contract version. A lifecycle change is admitted as a named
 *   transition producing a NEW revision — a manual Body or Envelope change
 *   is new admission input, never an in-place status mutation.
 * - Required planning lineage is enforced at admission: a Spec refines
 *   exactly one accepted Intent revision; a Plan realizes exactly one
 *   approved Spec revision. A Plan cannot realize an Intent directly
 *   (omitted-Spec policy), a generic or unregistered relation cannot
 *   satisfy required lineage, and Traces crossing scope boundaries are
 *   rejected.
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
 * Ticket 04 (#221) adds fail-closed read-side integrity: every verification
 * read (show/list) replays the settlement journal and fails closed on any
 * sequence admission could not have written (T2-review finding F1 — reads
 * previously served forged journals silently), sweeps both halves of every
 * committed revision (an orphaned half is corruption, never a silent skip:
 * `list` no longer hides an artifact whose head pair is missing while `show`
 * serves earlier revisions), cross-checks the committed record's contentHash,
 * and walks the trace graph for cyclic lineage (AMBER_E_ARTIFACT_TRACE_CYCLE
 * — impossible through admission, so always hand-edited state). A journal
 * that carries settlement hashes anywhere rejects hashless committed records
 * as corruption (T2-review finding F2: the legacy fallback was bypassable by
 * stripping the hash fields; only pure ticket-01 journals with zero
 * hash-bearing records stay readable — and admission refuses to extend those
 * in place, failing closed before any write rather than leaving a mixed
 * journal the strict policy must reject). Crashed admission attempts settle
 * deterministically: a prepared record with no committed/aborted outcome is
 * settled by appending one `aborted` journal record — recovery is
 * journal-only and never writes or rewrites a Body or Envelope (the pure
 * analysis lives in canonical-artifact-verify.js, which holds no I/O
 * capability at all).
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
const { typedError } = require("./error-catalog");
const { resolvePositiveIntCeiling } = require("./resource-ceilings");
const {
	TYPE_REGISTRY,
	ARTIFACT_TYPES,
	TRACE_REGISTRY_VERSION,
	ENVELOPE_SCHEMA_VERSION,
	SUPPORTED_ENVELOPE_SCHEMA_VERSIONS,
	EXTENSION_CARRIER_FIELD,
	DECISION_KINDS,
	envelopeVersionProblem,
	envelopeUnknownFieldProblem,
	decisionBindingProblem,
	extensionNamespaceProblem,
	isValidArtifactIdentity,
	transitionFor,
	registeredTransitionsOf,
	lifecycleForAdmission,
	transitionToState,
	traceContract,
	expectedToType,
	structuralTraceProblems,
	traceShapeProblem,
} = require("./canonical-artifact-contracts");
const { findTraceCycle, danglingPreparedRevisions } = require("./canonical-artifact-verify");
// F050 ticket 1 (#226): Decision admission binds the acting Principal against
// the Principal registry — the registry is the governed authority store, the
// artifact store the consumer (no cycle: principal-registry imports neither
// this module nor the contracts).
const { resolveActivePrincipal } = require("./principal-registry");

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
const TRANSITION_UNKNOWN_CODE = "AMBER_E_ARTIFACT_TRANSITION_UNKNOWN";
const TRANSITION_INVALID_CODE = "AMBER_E_ARTIFACT_TRANSITION_INVALID";
const TRACE_DIRECTION_CODE = "AMBER_E_ARTIFACT_TRACE_DIRECTION";
const TRACE_SCOPE_CODE = "AMBER_E_ARTIFACT_TRACE_SCOPE";
const TRACE_TARGET_NOT_FOUND_CODE = "AMBER_E_ARTIFACT_TRACE_TARGET_NOT_FOUND";
const TRACE_TARGET_LIFECYCLE_CODE = "AMBER_E_ARTIFACT_TRACE_TARGET_LIFECYCLE";
const TRACE_CYCLE_CODE = "AMBER_E_ARTIFACT_TRACE_CYCLE";
const IO_CODE = "AMBER_E_ARTIFACT_IO";
// Full-review follow-up finding 1: identity spelling is exact, so a
// case-variant of an existing artifact home is its own stable admission
// error (the read side reports the case-variant as plain NOT_FOUND).
const IDENTITY_CASE_COLLISION_CODE = "AMBER_E_ARTIFACT_IDENTITY_CASE_COLLISION";
const NOT_FOUND_CODE = "AMBER_E_ARTIFACT_NOT_FOUND";
// F049 ticket 06 (#223): version negotiation, extension namespaces, and
// admission size ceilings. (The unknown-field and extension-collision
// verdicts travel on their problem objects' own .code from
// canonical-artifact-contracts.js — the writer seam fails with
// problem.code, the read seam throws problem.code — so they need no local
// constant here.)
const UNSUPPORTED_VERSION_CODE = "AMBER_E_ARTIFACT_UNSUPPORTED_VERSION";
const SIZE_CEILING_CODE = "AMBER_E_ARTIFACT_SIZE_CEILING";
// F050 ticket 1 (#226): Decision admission codes — the Decision kind closed
// set, the acting-Principal binding, and the human-only authority slots.
const DECISION_KIND_INVALID_CODE = "AMBER_E_DECISION_KIND_INVALID";
const DECISION_PRINCIPAL_REQUIRED_CODE = "AMBER_E_DECISION_PRINCIPAL_REQUIRED";
const DECISION_HUMAN_SLOT_REQUIRED_CODE = "AMBER_E_DECISION_HUMAN_SLOT_REQUIRED";

/**
 * Admission size ceilings (F049 ticket 06, #223 — AC3), in bytes.
 * Documented defaults; deliberate overrides via the environment. Checked
 * BEFORE any durable state is touched, so an oversized artifact never
 * reaches the journal — the failure leaves no home, no lock, no record.
 */
const DEFAULT_MAX_BODY_BYTES = 512 * 1024;
const DEFAULT_MAX_ENVELOPE_BYTES = 256 * 1024;

function admissionSizeCeilings() {
	return {
		maxBodyBytes: resolvePositiveIntCeiling(
			"AMBER_ARTIFACT_MAX_BODY_BYTES",
			DEFAULT_MAX_BODY_BYTES,
			"artifact Body size ceiling",
		),
		maxEnvelopeBytes: resolvePositiveIntCeiling(
			"AMBER_ARTIFACT_MAX_ENVELOPE_BYTES",
			DEFAULT_MAX_ENVELOPE_BYTES,
			"artifact Envelope size ceiling",
		),
	};
}

// ponytail: exclusive-lock admission (open O_EXCL lock file → settle →
// unlink) instead of OS-level advisory locking; a crashed holder leaves the
// lock behind, so a stale lock older than LOCK_STALE_MS is stolen — and the
// journal serialization above still refuses to fork history even then.
const LOCK_STALE_MS = 30_000;

function slugFor(identity) {
	// ponytail: flat slug identity→dir; collisions across e.g. "a/b" vs "a_b"
	// would alias, acceptable for the registered-type registry's scope.
	return `${identity}`.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function artifactDir(cwd, type, identity) {
	return statePathForCreate(cwd, "artifacts", TYPE_REGISTRY[type]?.dir || type, slugFor(identity));
}

/**
 * Full-review follow-up finding 1: directory-name case folding (Windows,
 * default macOS) makes "Login-Bug" and "login-bug" resolve to ONE artifact
 * home while a case-sensitive filesystem keeps them distinct — the store's
 * semantics must not depend on the platform. Policy: identity spelling is
 * EXACT. Admission rejects an identity that differs only by case from an
 * existing home; reads and trace targets resolve the case-variant as
 * not-found with the stored spelling named — never as settlement corruption.
 *
 * The check is a directory scan of the type's sibling slugs (comparing
 * stored entry names, never touching the filesystem case-insensitively), so
 * the verdict is identical on both filesystem kinds: the variant home is
 * discovered by its stored spelling wherever it exists. An exact entry match
 * means the exact home exists and no ambiguity is possible (a case-sensitive
 * filesystem may legitimately hold both spellings — only the exact one is
 * served). Returns the stored sibling's identity spelling — read
 * best-effort from its highest-revision Envelope, so the hint names the
 * identity (e.g. "intent/Login-Bug"), degrading to the directory slug when
 * the home is unreadable — or null.
 * @param {string} cwd - Target repository root.
 * @param {string} type - Registered artifact type.
 * @param {string} identity - Identity spelling to resolve.
 * @returns {string|null} The case-variant sibling's stored spelling.
 */
function caseVariantSibling(cwd, type, identity) {
	const slug = slugFor(identity);
	const typeDir = statePathForCreate(cwd, "artifacts", TYPE_REGISTRY[type]?.dir || type);
	let entries;
	try {
		entries = fs.readdirSync(typeDir);
	} catch {
		return null; // no type directory: no siblings, no ambiguity
	}
	if (entries.includes(slug)) return null; // the exact home exists
	for (const entry of entries) {
		if (entry.toLowerCase() === slug.toLowerCase()) {
			return storedIdentityOf(path.join(typeDir, entry)) ?? entry;
		}
	}
	return null;
}

// Best-effort recovery of the identity SPELLING stored inside an artifact
// home: the highest-revision Envelope's identity field. This only feeds the
// exact-spelling hint, so it must never fail — unreadable state degrades to
// the directory name the scan already found.
function storedIdentityOf(dir) {
	try {
		const revisions = fs
			.readdirSync(dir)
			.map((name) => /^rev-(\d+)\.envelope\.json$/.exec(name))
			.filter(Boolean)
			.map((match) => Number.parseInt(match[1], 10));
		if (revisions.length === 0) return null;
		const envelope = readEnvelope(dir, Math.max(...revisions));
		return typeof envelope?.identity === "string" && envelope.identity.length > 0
			? envelope.identity
			: null;
	} catch {
		return null;
	}
}

function journalPath(dir) {
	return path.join(dir, "journal.jsonl");
}

// Per-artifact admission lock: O_EXCL create is the mutex. A crashed holder
// leaves the file behind, so a lock older than LOCK_STALE_MS is stolen.
// Returns an unlock function; throws a typed AMBER_E_ARTIFACT_CONFLICT when
// another admission holds a fresh lock (the live racing loser fails closed).
// Full-review follow-up finding 6: a genuine directory-create or lock-open
// failure is an I/O condition, never a compare-and-swap race — the mutex is
// the O_EXCL lock file, so a raw EPERM/EEXIST out of mkdirSync (an artifact
// home blocked by a regular file, say) surfaces as the typed
// AMBER_E_ARTIFACT_IO with the underlying message, not as CONFLICT advice to
// retry the CAS against a head that does not exist.
function acquireAdmissionLock(dir) {
	const lockPath = path.join(dir, "admit.lock");
	try {
		fs.mkdirSync(dir, { recursive: true });
	} catch (err) {
		throw typedReadError(
			IO_CODE,
			`cannot create the artifact home for admission (${dir}): ${err.message}`,
		);
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
				throw typedReadError(
					IO_CODE,
					`cannot create the admission lock (${lockPath}): ${err.message}`,
				);
			}
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

// A fresh admit.lock means a live admission owns the journal right now: its
// prepared records are in flight, not crashed, so settlement recovery must
// leave them alone. A lock older than LOCK_STALE_MS is a crashed holder.
function admissionInFlight(dir) {
	try {
		return Date.now() - fs.statSync(path.join(dir, "admit.lock")).mtimeMs <= LOCK_STALE_MS;
	} catch {
		return false; // no lock: nobody is mid-admission
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
 * type, identity, supersedes (the expected head), bodyHash, provenance, and
 * (ticket 03) the lifecycle content: the named `transition`, `scope`, and
 * the resolved Trace set, and (ticket 06, #223) the extension namespaces:
 * extensions are canonical content, so the same Body with different
 * extension data is a different admission, never a silent duplicate.
 * (F050, #226) the Decision binding — `decisionKind` and the verified
 * `principal` snapshot — is canonical content too: the same Body bound to a
 * different principal or kind is a different admission. Assigned, volatile,
 * or DERIVED fields are excluded: revision, committedAt, envelopeHash, and
 * the lifecycle STATE, which is a pure function of the type and the named
 * transition (a revision admitted without a transition carries the type's
 * initial state) — so two admissions cannot differ in lifecycle without
 * differing in `transition`, and retries against pre-lifecycle
 * (ticket-01/02) Envelopes still dedupe. Ticket-01 review finding F3:
 * retries dedupe on the full canonical envelope content, never on bodyHash
 * alone. Pre-F050 Envelopes hash with both decision fields null, exactly
 * like a non-decision admission does, so old stores stay retry-compatible.
 */
function admissionHash({
	schemaVersion,
	type,
	identity,
	supersedes,
	bodyHash: content,
	provenance,
	transition,
	scope,
	traces,
	extensions,
	decisionKind,
	principal,
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
				transition: transition ?? null,
				scope: scope ?? null,
				traces: canonicalTracesForHash(traces),
				extensions: extensions ?? null,
				decisionKind: decisionKind ?? null,
				principal: principal ?? null,
			}),
		),
	);
}

// Traces in hash-canonical form: one fixed shape regardless of which
// optional fields the caller omitted (derivation fills them before hashing).
function canonicalTracesForHash(traces) {
	return (Array.isArray(traces) ? traces : []).map((trace) => ({
		type: trace?.type ?? null,
		to: {
			type: trace?.to?.type ?? null,
			identity: trace?.to?.identity ?? null,
			revision: trace?.to?.revision ?? null,
		},
	}));
}

// The admission key of an already-stored Envelope (same field set; the
// lifecycle state stays excluded as a derived field, so pre-lifecycle
// Envelopes hash exactly like their transition-less retries). Pre-F050
// Envelopes carry no decision fields, which hash as null — identical to a
// non-decision admission.
function admissionHashOfEnvelope(envelope) {
	return admissionHash({
		schemaVersion: envelope.schemaVersion,
		type: envelope.type,
		identity: envelope.identity,
		supersedes: envelope.supersedes ?? null,
		bodyHash: envelope.bodyHash,
		provenance: envelope.provenance || null,
		transition: envelope.transition ?? null,
		scope: envelope.scope ?? null,
		traces: envelope.traces || [],
		extensions: envelope[EXTENSION_CARRIER_FIELD] ?? null,
		decisionKind: envelope.decisionKind ?? null,
		principal: envelope.principal ?? null,
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
// as ledgerCorruptError in jsonl.js). Delegates to the consolidated catalog
// constructor (ticket 06, #223 — one typed-error shape everywhere).
function typedReadError(code, message) {
	return typedError(code, message);
}

/**
 * Build the externally visible projection of one committed revision.
 * Verifies both halves of the binding before serving (ADR-0023): the stored
 * Body against its recorded contentHash, and the stored Envelope against its
 * own canonical envelopeHash. Either mismatch is corruption, not content.
 * Ticket 04: the Envelope must also agree with the identity it is stored
 * under — a revision whose Envelope binds a different type/identity is a
 * mismatched pair, never silently relabeled.
 *
 * Ticket 06 (#223 — AC1/AC2): version negotiation and the extension
 * namespace contract run FIRST, before the binding hashes — an Envelope
 * whose schemaVersion/traceContractVersion this reader cannot interpret, a
 * top-level field this reader does not know, or an extensions carrier that
 * violates the namespace contract is rejected with its own stable code,
 * never silently dropped and never misreported as a hash mismatch. Every
 * read seam (show, list, projection revisions) and every admission path that
 * validates stored state (idempotency retries, CAS head, trace binding)
 * funnels through here, so the negotiation verdict is identical everywhere.
 *
 * F050 ticket 1 (#226): the Decision binding contract runs in the same
 * pre-hash position — a decision Envelope must carry a kind from the closed
 * set and a well-formed principal snapshot, a non-decision Envelope must
 * carry neither, and acceptance/approval authority must never be bound to a
 * service principal (a binding admission can never write, so a stored
 * violation is hand-edited state).
 */
function committedProjection(type, identity, revision, body, envelope, committedAt) {
	const versionProblem = envelopeVersionProblem(envelope);
	if (versionProblem !== null) throw typedReadError(versionProblem.code, versionProblem.message);
	const unknownFieldProblem = envelopeUnknownFieldProblem(envelope);
	if (unknownFieldProblem !== null) {
		throw typedReadError(unknownFieldProblem.code, unknownFieldProblem.message);
	}
	const decisionProblem = decisionBindingProblem(envelope);
	if (decisionProblem !== null) {
		throw typedReadError(decisionProblem.code, decisionProblem.message);
	}
	const extensionProblem = extensionNamespaceProblem(
		envelope ? envelope[EXTENSION_CARRIER_FIELD] : undefined,
	);
	if (extensionProblem !== null) {
		throw typedReadError(extensionProblem.code, extensionProblem.message);
	}
	if (envelope.type !== type || envelope.identity !== identity) {
		throw typedReadError(
			SETTLEMENT_CORRUPT_CODE,
			`the Envelope stored for revision ${revision} of "${identity}" binds ${envelope.type}/"${envelope.identity}"; a revision stored under the wrong identity is settlement corruption, not content`,
		);
	}
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
		lifecycle: envelope.lifecycle ?? null,
		transition: envelope.transition ?? null,
		scope: envelope.scope ?? null,
		traces: envelope.traces || [],
		provenance: envelope.provenance || null,
		committedAt: committedAt || null,
		decisionKind: envelope.decisionKind ?? null,
		principal: envelope.principal ?? null,
	});
}

// The committed journal record settling a revision, or null.
function findCommitRecord(journal, revision) {
	return (
		[...journal].reverse().find((r) => r.kind === KIND_COMMITTED && r.revision === revision) || null
	);
}

// The committed record's contentHash must still agree with the Envelope's
// bodyHash (ticket-02 review finding F9): the field is cross-checked at
// every settlement validation, not just written.
function contentHashMismatch(record, envelope) {
	return (
		typeof record?.contentHash === "string" && record.contentHash !== (envelope?.bodyHash ?? null)
	);
}

function settlementContentHashMessage(identity, revision, record, envelope) {
	return `committed journal record for revision ${revision} of "${identity}" records contentHash ${record.contentHash} while the stored Envelope binds bodyHash ${envelope?.bodyHash ?? null}; the settlement no longer matches the revision it settled`;
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
 *       numbering),
 *   (e) ticket 04 (T2-review finding F2): a committed record stripped of
 *       its settlement hashes in a journal that carries them anywhere. The
 *       hashless fallback exists only for pure ticket-01 journals, whose
 *       records genuinely predate expectedHead/admissionHash; once any
 *       record is hash-bearing, a hashless committed record can only be an
 *       in-place edit of history that shed its verification anchors.
 * Runs at admission (under the lock, after every append via settleGuard)
 * and on every verification read (show/list — ticket 04).
 * @param {Array<object>} journal Parsed journal records, in append order.
 * @throws {Error} Typed AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT.
 */
function validateSettlement(journal) {
	const hashBearing = journal.some(
		(record) =>
			typeof record?.admissionHash === "string" || typeof record?.expectedHead === "number",
	);
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
			if (
				hashBearing &&
				(typeof record.admissionHash !== "string" || typeof record.expectedHead !== "number")
			) {
				throw typedReadError(
					SETTLEMENT_CORRUPT_CODE,
					`artifact journal commits revision ${revision} without its settlement hashes (admissionHash and expectedHead) while other records in the journal carry them; a hashless committed record in a hash-bearing journal is stripped provenance, not legacy state — only journals with zero hash-bearing records read as ticket-01 legacy`,
				);
			}
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
 * Deterministic settlement recovery for crashed admissions (ticket 04,
 * #221): a prepared record with no committed/aborted outcome is a crashed
 * attempt — settle it by appending one `aborted` journal record (the pure
 * analysis is danglingPreparedRevisions in canonical-artifact-verify.js).
 * Recovery writes ONLY journal settlement state: it never writes or rewrites
 * a Body or Envelope, never resurrects a half-written pair, and never
 * promotes uncommitted content to committed — the aborted revision stays
 * invisible and its slot stays consumed. The aborted record copies the
 * crashed attempt's own anchors (expectedHead, admissionHash, attemptId,
 * idempotencyKey) so the journal stays auditable.
 *
 * Reads call this with underLock=false: a fresh admit.lock means a live
 * admission owns its prepared records right now, and those are left alone.
 * Admission calls it with underLock=true (it holds the lock itself, so any
 * dangling prepared record is a crashed PRIOR attempt).
 * @param {string} dir - Artifact home directory.
 * @param {Array<object>} journal - Parsed journal records (already validated).
 * @param {object} [options]
 * @param {string} [options.identity] - Identity label for diagnostics.
 * @param {boolean} [options.underLock] - The caller holds the admission lock.
 * @returns {Array<object>} The journal after recovery (re-read when any
 *          record was appended).
 * @throws {Error} Typed AMBER_E_ARTIFACT_IO when an aborted record cannot be
 *         appended — recovery fails closed instead of skipping silently.
 */
function recoverDanglingPrepared(dir, journal, { identity = null, underLock = false } = {}) {
	if (!underLock && admissionInFlight(dir)) return journal;
	const dangling = danglingPreparedRevisions(journal);
	if (dangling.length === 0) return journal;
	for (const revision of dangling) {
		const claim =
			[...journal].reverse().find((r) => r.kind === KIND_PREPARED && r.revision === revision) ||
			null;
		try {
			appendJSONL(journalPath(dir), {
				kind: KIND_ABORTED,
				revision,
				at: new Date().toISOString(),
				recovered: true,
				...(claim && typeof claim.expectedHead === "number"
					? { expectedHead: claim.expectedHead }
					: {}),
				...(claim && typeof claim.admissionHash === "string"
					? { admissionHash: claim.admissionHash }
					: {}),
				...(claim && typeof claim.attemptId === "string" ? { attemptId: claim.attemptId } : {}),
				...(claim && typeof claim.idempotencyKey === "string"
					? { idempotencyKey: claim.idempotencyKey }
					: {}),
			});
		} catch (err) {
			throw typedReadError(
				IO_CODE,
				`failed to append the aborted recovery record for revision ${revision} of "${identity ?? "an artifact"}" to the settlement journal: ${err.message}`,
			);
		}
	}
	return readJournal(dir);
}

/**
 * Full committed-history sweep for one artifact home (full-review follow-up
 * findings 4/5): EVERY committed revision must have both halves of its pair
 * on disk AND still hold its binding — the stored Body against the recorded
 * contentHash (AMBER_E_ARTIFACT_HASH_MISMATCH), the stored Envelope against
 * its own canonical envelopeHash (AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH),
 * and the committed journal record against the Envelope it settled
 * (settlement corruption). Non-served revisions are no longer
 * presence-swept only: the projection seam already proved the cost
 * acceptable, so show/list, the trace-graph walk, and trace-target binding
 * all apply the same per-revision verification.
 *
 * The sweep is identity-agnostic — each pair is verified against its own
 * Envelope's declared type/identity — because the caller is the one that
 * knows the requested spelling; identity resolution (and its
 * case-insensitive filesystem policy, finding 1) stays at the seams that
 * resolve the identity. It is also recovery-free: settling crashed attempts
 * is verifyArtifactHomeForRead's job, never the walk's or the binder's.
 * @param {string} dir - Artifact home directory.
 * @param {Array<object>} journal - Parsed, already-replayed journal records.
 * @param {object} [options]
 * @param {string} [options.identity] - Identity label for diagnostics.
 * @throws {Error} Typed AMBER_E_ARTIFACT_UNSUPPORTED_VERSION /
 *         AMBER_E_ARTIFACT_UNKNOWN_FIELD / AMBER_E_ARTIFACT_EXTENSION_COLLISION
 *         (the version-negotiation and extension-contract verdicts the
 *         per-revision committedProjection check throws FIRST, ticket 06) /
 *         AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT / AMBER_E_ARTIFACT_HASH_MISMATCH /
 *         AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH.
 */
function sweepCommittedHistory(dir, journal, { identity = null } = {}) {
	for (const revision of committedRevisions(journal)) {
		const envelope = readEnvelope(dir, revision);
		const body = readBody(dir, revision);
		if (!envelope || !body) {
			throw typedReadError(
				SETTLEMENT_CORRUPT_CODE,
				`committed revision ${revision} of "${identity ?? "an artifact"}" is missing its ${envelope ? "Body" : "Envelope"} on disk; refusing to read inconsistent settlement state`,
			);
		}
		// Hash-verify both halves of every committed revision (finding 4) —
		// the sweep already held both in hand for the presence check.
		committedProjection(envelope.type, envelope.identity, revision, body, envelope, null);
		const commitRecord = findCommitRecord(journal, revision);
		if (contentHashMismatch(commitRecord, envelope)) {
			throw typedReadError(
				SETTLEMENT_CORRUPT_CODE,
				settlementContentHashMessage(envelope.identity, revision, commitRecord, envelope),
			);
		}
	}
}

/**
 * Read-side integrity gate for one artifact home (ticket 04, #221 — the
 * T2-review finding F1 fix: reads never validated settlement, so forged
 * journals were served silently). Every verification read (show/list):
 *   1. replays the settlement journal (impossible sequences, strict
 *      hashless policy),
 *   2. settles crashed attempts deterministically — journal-only aborted
 *      records, skipped while a live admission holds the lock,
 *   3. sweeps both halves of EVERY committed revision: a hole at any
 *      revision is corruption, never a silent skip (`list` no longer hides
 *      an artifact whose head pair is missing while `show` serves earlier
 *      revisions — both fail closed). Full-review follow-up finding 4: the
 *      sweep is a full hash verification of every committed revision, not a
 *      presence check — non-served revisions hold their binding too.
 * @param {string} dir - Artifact home directory.
 * @param {object} [options]
 * @param {string} [options.identity] - Identity label for diagnostics.
 * @returns {Array<object>} The (possibly recovered) journal, in append order.
 * @throws {Error} Typed AMBER_E_ARTIFACT_JOURNAL_CORRUPT /
 *         AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT / AMBER_E_ARTIFACT_IO /
 *         AMBER_E_ARTIFACT_HASH_MISMATCH / AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH.
 */
function verifyArtifactHomeForRead(dir, { identity = null } = {}) {
	let journal = readJournal(dir);
	validateSettlement(journal);
	journal = recoverDanglingPrepared(dir, journal, { identity });
	sweepCommittedHistory(dir, journal, { identity });
	return journal;
}

// Human-readable rendering of a trace-graph node for cycle diagnostics.
function renderTraceNode(node) {
	return `${node.type}/${node.identity}@${node.revision}`;
}

function traceCycleError(cycle) {
	return typedReadError(
		TRACE_CYCLE_CODE,
		`the trace lineage graph is cyclic: ${cycle.map(renderTraceNode).join(" -> ")}; every trace binds an already-committed revision and committed revisions are immutable, so admission can never produce a cycle — this is hand-edited state, not a lineage`,
	);
}

/**
 * Lazy outgoing-edge resolver for the committed trace graph: the resolved
 * traces of one committed revision, as structured target nodes. Every node
 * the walk reaches must be a committed revision with a readable Envelope
 * that agrees with the identity it is stored under — the walk fails closed
 * rather than guessing lineage through a hole (the pure walker lives in
 * canonical-artifact-verify.js; this side reads the store). Full-review
 * follow-up finding 4: the first touch of a home is a full verification —
 * settlement replay plus the hash sweep of every committed revision the
 * walk's target home carries, not only the walked node — so the lineage a
 * read vouches for is verified to the same standard `list` applies
 * store-wide. The resolver is still strictly read-only: it never settles
 * crashed attempts.
 * @param {string} cwd - Target repository root.
 * @returns {(node: {type: string, identity: string, revision: number}) =>
 *           Array<{type: string, identity: string, revision: number}>}
 */
function traceEdgesResolver(cwd) {
	const journalByDir = new Map();
	const verifiedDirs = new Set();
	const envelopeByKey = new Map();
	return (node) => {
		const dir = artifactDir(cwd, node.type, node.identity);
		let journal = journalByDir.get(dir);
		if (journal === undefined) {
			journal = readJournal(dir); // throws JOURNAL_CORRUPT on a corrupt ledger
			journalByDir.set(dir, journal);
		}
		if (!verifiedDirs.has(dir)) {
			validateSettlement(journal);
			sweepCommittedHistory(dir, journal, { identity: node.identity });
			verifiedDirs.add(dir);
		}
		if (!journal.some((r) => r.kind === KIND_COMMITTED && r.revision === node.revision)) {
			throw typedReadError(
				SETTLEMENT_CORRUPT_CODE,
				`the trace graph references ${renderTraceNode(node)}, which is not a committed revision; traces bind committed revisions only`,
			);
		}
		const key = JSON.stringify([node.type, node.identity, node.revision]);
		let envelope = envelopeByKey.get(key);
		if (envelope === undefined) {
			envelope = readEnvelope(dir, node.revision);
			envelopeByKey.set(key, envelope);
		}
		if (!envelope) {
			throw typedReadError(
				SETTLEMENT_CORRUPT_CODE,
				`committed revision ${node.revision} of "${node.identity}" is missing its Envelope on disk; the trace graph cannot be walked through a hole`,
			);
		}
		if (envelope.type !== node.type || envelope.identity !== node.identity) {
			throw typedReadError(
				SETTLEMENT_CORRUPT_CODE,
				`the Envelope stored for revision ${node.revision} of "${node.identity}" binds ${envelope.type}/"${envelope.identity}"; the trace graph cannot be walked through a mismatched revision`,
			);
		}
		const targets = [];
		for (const trace of envelope.traces || []) {
			const to = trace?.to;
			if (
				!to ||
				typeof to.type !== "string" ||
				typeof to.identity !== "string" ||
				!Number.isInteger(to.revision) ||
				to.revision < 1
			) {
				throw typedReadError(
					SETTLEMENT_CORRUPT_CODE,
					`committed revision ${node.revision} of "${node.identity}" carries a malformed trace ${JSON.stringify(trace)}; a resolved trace binds { type, identity, revision }`,
				);
			}
			targets.push({ type: to.type, identity: to.identity, revision: to.revision });
		}
		return targets;
	};
}

/**
 * Resolve one committed revision of a target artifact for Trace binding:
 * journal-settled visibility (prepared/aborted stay invisible), the pair
 * present on disk, and both binding hashes verified. Returns null when the
 * target has no such committed revision. Full-review follow-up finding 5:
 * the binding validates the target's ENTIRE committed history, not only the
 * bound revision — the sweep below fails admission when the target home is
 * holed or hash-broken at any committed revision, so a Trace never binds
 * onto lineage that `list`/`rebuild` would refuse a moment later (the
 * admission no longer succeeds against state the read seams classify as
 * corruption). The sweep is recovery-free: admission settles crashed
 * attempts only for the artifact it holds the lock of.
 * @throws {Error} Typed corruption/binding errors — a Trace never binds to
 *         inconsistent settlement state or a tampered pair.
 */
function readCommittedRevision(dir, type, identity, revision /* number|null for head */) {
	const journal = readJournal(dir);
	// Ticket 04: a Trace never binds to inconsistent settlement state — the
	// target's journal is replayed, not just read for its head (the JSDoc
	// contract above, now enforced on every binding).
	validateSettlement(journal);
	sweepCommittedHistory(dir, journal, { identity });
	const head = committedHead(journal);
	if (head === 0) return null;
	const target =
		revision === null || revision === undefined
			? head
			: journal.some((r) => r.kind === KIND_COMMITTED && r.revision === revision)
				? revision
				: null;
	if (target === null) return null;
	const envelope = readEnvelope(dir, target);
	const body = readBody(dir, target);
	if (!envelope || !body) {
		throw typedReadError(
			SETTLEMENT_CORRUPT_CODE,
			`committed revision ${target} of "${identity}" is missing its ${envelope ? "Body" : "Envelope"} on disk; refusing to bind a Trace to an incomplete pair`,
		);
	}
	committedProjection(type, identity, target, body, envelope, null);
	const record = findCommitRecord(journal, target);
	if (contentHashMismatch(record, envelope)) {
		throw typedReadError(
			SETTLEMENT_CORRUPT_CODE,
			settlementContentHashMessage(identity, target, record, envelope),
		);
	}
	return { revision: target, envelope, journal };
}

// Journal-level existence probe used to disambiguate a failed Trace target
// lookup (a wrong-type target names a real artifact of another type).
// Best-effort: a corrupt journal in an unrelated type directory leaves the
// plain not-found verdict unchanged — the scan only improves the message.
function committedRevisionExists(cwd, type, identity, revision /* number|null for head */) {
	let journal;
	try {
		journal = readJournal(artifactDir(cwd, type, identity));
	} catch {
		return false;
	}
	if (revision === null || revision === undefined) {
		return committedHead(journal) > 0;
	}
	return journal.some((r) => r.kind === KIND_COMMITTED && r.revision === revision);
}

/**
 * Resolve and validate one Trace against the registered contract and the
 * committed target state (ticket 03, #220):
 * - direction: the declared (or derived) target type must match the Trace
 *   contract; a derived lookup that finds the identity under a different
 *   registered type reports the direction violation — this is where the
 *   omitted-Spec policy (a Plan realizing its Intent directly) surfaces;
 * - lifecycle gate: required-lineage Traces must target a revision in the
 *   contract's required state (refines → accepted Intent, realizes →
 *   approved Spec);
 * - scope confinement: source and target must declare the same scope tag.
 * The revision defaults to the target's current committed head and is
 * resolved (and recorded) explicitly — Traces bind revisions, not heads.
 * @returns {{ok: true, to: {type: string, identity: string, revision: number}} |
 *           {ok: false, code: string, message: string}}
 */
function resolveTraceTarget(cwd, sourceType, sourceIdentity, sourceScope, trace) {
	const contract = traceContract(trace.type);
	const declaredType = trace.to.type === undefined || trace.to.type === null ? null : trace.to.type;
	let toType = expectedToType(trace.type, sourceType);
	if (toType === "any") {
		// F050 (#226): a decides Trace declares its own target type — the
		// registry cannot derive it from the source type. The structural
		// check already rejects an absent or unregistered declaration; this
		// guard keeps the resolver fail-closed when called directly.
		if (declaredType === null || !ARTIFACT_TYPES.includes(declaredType)) {
			return {
				ok: false,
				code: TRACE_DIRECTION_CODE,
				message: `"${trace.type}" Traces must declare a registered target artifact type; got ${JSON.stringify(declaredType)} (registered types: ${ARTIFACT_TYPES.join(", ")})`,
			};
		}
		toType = declaredType;
	}
	if (declaredType !== null && declaredType !== toType) {
		return {
			ok: false,
			code: TRACE_DIRECTION_CODE,
			message: `"${trace.type}" Traces must target ${toType} artifacts, but the Trace names target type "${declaredType}"${omittedSpecNoteFor(trace.type, declaredType)}`,
		};
	}
	const wantedRevision =
		trace.to.revision === undefined || trace.to.revision === null ? null : trace.to.revision;

	// Finding 1 (full-review follow-up): a case-variant trace target is a
	// misspelling, not corruption — on a case-folding filesystem the folded
	// directory would otherwise surface as settlement corruption in the
	// binding's identity-agreement checks. The target resolves like `show`
	// does: not-found, with the stored spelling named.
	const variantHome = caseVariantSibling(cwd, toType, trace.to.identity);
	if (variantHome !== null) {
		return {
			ok: false,
			code: TRACE_TARGET_NOT_FOUND_CODE,
			message: `the "${trace.type}" Trace target ${toType}/"${trace.to.identity}" matches no committed revision; the store has ${toType}/"${variantHome}" — identity spelling is exact, so trace the stored spelling`,
		};
	}

	let resolved;
	try {
		resolved = readCommittedRevision(
			artifactDir(cwd, toType, trace.to.identity),
			toType,
			trace.to.identity,
			wantedRevision,
		);
	} catch (err) {
		return { ok: false, code: err.amberCode || JOURNAL_CORRUPT_CODE, message: err.message };
	}
	if (!resolved) {
		if (declaredType === null && !committedRevisionExists(cwd, toType, trace.to.identity, null)) {
			for (const otherType of ARTIFACT_TYPES) {
				if (otherType === toType) continue;
				if (committedRevisionExists(cwd, otherType, trace.to.identity, wantedRevision)) {
					return {
						ok: false,
						code: TRACE_DIRECTION_CODE,
						message: `"${trace.type}" Traces must target ${toType} artifacts, but "${trace.to.identity}" resolves to a ${otherType} artifact${omittedSpecNoteFor(trace.type, otherType)}`,
					};
				}
			}
		}
		const revisionNote =
			wantedRevision !== null && committedRevisionExists(cwd, toType, trace.to.identity, null)
				? ` is not a committed revision of ${toType}/"${trace.to.identity}" (prepared and aborted revisions are invisible)`
				: ` matches no committed ${toType} artifact revision`;
		return {
			ok: false,
			code: TRACE_TARGET_NOT_FOUND_CODE,
			message: `the "${trace.type}" Trace target ${toType}/"${trace.to.identity}"${wantedRevision !== null ? ` at revision ${wantedRevision}` : ""}${revisionNote}; Traces bind to committed revisions only — admit the target first`,
		};
	}
	if (contract.targetLifecycle !== null) {
		const state = resolved.envelope.lifecycle ?? null;
		if (state !== contract.targetLifecycle) {
			const via = transitionToState(toType, contract.targetLifecycle);
			const stateNote =
				state === null
					? "carries no lifecycle state (admitted before lifecycle contracts)"
					: `is in lifecycle state "${state}"`;
			return {
				ok: false,
				code: TRACE_TARGET_LIFECYCLE_CODE,
				message: `the "${trace.type}" Trace targets ${toType}/"${trace.to.identity}" revision ${resolved.revision}, which ${stateNote}, but this Trace requires "${contract.targetLifecycle}"${via ? ` — admit the target revision through its "${via.name}" transition first` : ""}`,
			};
		}
	}
	const targetScope = resolved.envelope.scope ?? null;
	if (targetScope !== sourceScope) {
		return {
			ok: false,
			code: TRACE_SCOPE_CODE,
			message: `the "${trace.type}" Trace from ${sourceType}/"${sourceIdentity}" (scope ${JSON.stringify(sourceScope)}) crosses a scope boundary: ${toType}/"${trace.to.identity}" revision ${resolved.revision} is in scope ${JSON.stringify(targetScope)} — Traces are confined to one scope`,
		};
	}
	return {
		ok: true,
		to: Object.freeze({
			type: toType,
			identity: trace.to.identity,
			revision: resolved.revision,
		}),
	};
}

function omittedSpecNoteFor(traceType, declaredType) {
	if (traceType === "realizes" && declaredType === "intent") {
		return " — a Plan cannot realize an Intent directly (omitted-Spec policy): admit a Spec that refines the accepted Intent revision, then realize that Spec";
	}
	return "";
}

// Best-effort removal of an artifact home left empty by a failed admission
// (ticket-02 review finding F6): the admission lock creates the directory
// before the journal validates, so a first admission that fails before any
// durable write would otherwise strand an empty directory. Only a TRULY
// empty directory is removed — journals and revision pairs are settlement
// state and stay for fail-closed validation.
function removeDirIfEmpty(dir) {
	try {
		if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
	} catch {
		// best-effort only
	}
}

/**
 * Read one artifact's current (or explicit) revision with journal-settled
 * visibility. Returns null when the identity has no committed revision or
 * the named revision is not committed — prepared/aborted stay invisible.
 *
 * Ticket 04 (#221): this is a verification read. It replays the settlement
 * journal, sweeps and hash-verifies both halves of every committed revision
 * of the artifact (an orphaned or tampered half anywhere fails closed — the
 * read never guesses which revisions are still authoritative; full-review
 * follow-up finding 4), cross-checks the served revision's committed record
 * against its Envelope, and walks the outgoing trace graph from the
 * artifact's committed revisions across artifacts: the lineage this read
 * vouches for must be acyclic (AMBER_E_ARTIFACT_TRACE_CYCLE). A crashed
 * attempt (dangling prepared, no live lock) is settled as aborted on the way
 * through — journal-only, never an artifact write.
 * @throws {Error} Typed AMBER_E_ARTIFACT_JOURNAL_CORRUPT on a corrupt journal,
 *         AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT on impossible settlement, a
 *         holed or mismatched pair, or a forged lineage reference,
 *         AMBER_E_ARTIFACT_TRACE_CYCLE on cyclic lineage,
 *         AMBER_E_ARTIFACT_HASH_MISMATCH / AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH
 *         when a stored pair fails its binding,
 *         AMBER_E_ARTIFACT_IO when recovery cannot append its aborted record,
 *         AMBER_E_ARTIFACT_NOT_FOUND when the identity is a case-variant of a
 *         stored spelling (finding 1: spelling is exact; the message names
 *         the stored spelling).
 */
function showArtifact(cwd, identity, { type = "intent", revision = null } = {}) {
	// Finding 1 (full-review follow-up): resolve the identity's SPELLING
	// before any settlement read. On a case-folding filesystem the
	// case-variant directory resolves to the existing home, and the
	// identity-agreement checks downstream would misreport a misspelling as
	// settlement corruption with a restore-from-version-control remedy —
	// the worst possible advice for a typo. The variant is a plain
	// not-found that names the stored spelling instead.
	const variant = caseVariantSibling(cwd, type, identity);
	if (variant !== null) {
		throw typedReadError(
			NOT_FOUND_CODE,
			`no committed revision found for "${identity}": the store has "${variant}" — artifact identity spelling is exact (case-sensitive), so use the stored spelling`,
		);
	}
	const dir = artifactDir(cwd, type, identity);
	const journal = verifyArtifactHomeForRead(dir, { identity });
	// Cyclic Trace chains fail the read: walk outgoing trace edges from every
	// committed revision of THIS artifact, transitively across artifacts (the
	// walk only reads the lineage it reaches — a cycle in unrelated artifacts
	// is `list`'s verdict to deliver).
	const cycle = findTraceCycle(
		committedRevisions(journal).map((r) => ({ type, identity, revision: r })),
		traceEdgesResolver(cwd),
	);
	if (cycle) throw traceCycleError(cycle);
	for (const record of [...journal].reverse()) {
		if (record.kind !== KIND_COMMITTED) continue;
		if (revision !== null && record.revision !== revision) continue;
		const body = readBody(dir, record.revision);
		const envelope = readEnvelope(dir, record.revision);
		if (!body || !envelope) {
			// Unreachable after the pair sweep above; kept so the serving path
			// itself never depends on the sweep's diagnostics.
			throw typedReadError(
				SETTLEMENT_CORRUPT_CODE,
				`committed revision ${record.revision} of "${identity}" is missing its ${envelope ? "Body" : "Envelope"} on disk; refusing to serve an incomplete pair`,
			);
		}
		const projection = committedProjection(
			type,
			identity,
			record.revision,
			body,
			envelope,
			record.at,
		);
		const commitRecord = findCommitRecord(journal, record.revision);
		if (contentHashMismatch(commitRecord, envelope)) {
			throw typedReadError(
				SETTLEMENT_CORRUPT_CODE,
				settlementContentHashMessage(identity, record.revision, commitRecord, envelope),
			);
		}
		return projection;
	}
	return null;
}

// Latest committed revision per artifact, first-seen order.
//
// Ticket 04 (#221): the listing is a verification read of the WHOLE store.
// Granularity is wholesale per artifact home and fail-closed overall — one
// corrupt artifact fails the entire list rather than being skipped or
// served as a partial projection (the F035-S5 "never a partial projection"
// convention; a per-artifact error channel would let consumers parse around
// corruption). Every home's settlement is replayed, crashed attempts are
// settled as aborted, every committed pair is swept, and the trace graph of
// EVERY committed revision (not just heads) is walked for cycles.
function committedCurrents(cwd) {
	const currents = [];
	const startNodes = [];
	for (const { dir } of walkArtifactHomes(cwd)) {
		const slug = path.basename(dir);
		const journal = verifyArtifactHomeForRead(dir, { identity: slug });
		const head = committedHead(journal);
		if (head !== 0) {
			const envelope = readEnvelope(dir, head);
			const body = readBody(dir, head);
			if (!envelope || !body) {
				// Unreachable after the pair sweep in the gate; defensive.
				throw typedReadError(
					SETTLEMENT_CORRUPT_CODE,
					`committed revision ${head} of "${slug}" is missing its ${envelope ? "Body" : "Envelope"} on disk; refusing to list inconsistent settlement state`,
				);
			}
			currents.push(
				committedProjection(envelope.type, envelope.identity, head, body, envelope, null),
			);
			const commitRecord = findCommitRecord(journal, head);
			if (contentHashMismatch(commitRecord, envelope)) {
				throw typedReadError(
					SETTLEMENT_CORRUPT_CODE,
					settlementContentHashMessage(envelope.identity, head, commitRecord, envelope),
				);
			}
		}
		// Cycle detection covers every committed revision, not only heads: a
		// hand-crafted cycle through a superseded revision is as corrupt as
		// one through a head.
		for (const revision of committedRevisions(journal)) {
			const envelope = readEnvelope(dir, revision);
			if (!envelope || typeof envelope.type !== "string" || typeof envelope.identity !== "string") {
				throw typedReadError(
					SETTLEMENT_CORRUPT_CODE,
					`committed revision ${revision} of "${slug}" carries no usable Envelope identity; the trace graph cannot be walked`,
				);
			}
			startNodes.push({ type: envelope.type, identity: envelope.identity, revision });
		}
	}
	const cycle = findTraceCycle(startNodes, traceEdgesResolver(cwd));
	if (cycle) throw traceCycleError(cycle);
	return currents;
}

/** List committed artifacts (current revision each). A verification read of
 * the whole store: settlement replay, pair sweep, and trace-graph acyclicity
 * over every committed revision (ticket 04) — one corrupt artifact fails the
 * entire listing. */
function listArtifacts(cwd) {
	return committedCurrents(cwd);
}

// Canonical ordering of committed revisions for projections (F049 ticket 05):
// (type, identity, revision). The store's walk order is directory iteration
// order, which is not a contract — the projection layer needs an order that
// is a pure function of the committed content.
function compareArtifactRevisions(a, b) {
	if (a.type !== b.type) return a.type < b.type ? -1 : 1;
	if (a.identity !== b.identity) return a.identity < b.identity ? -1 : 1;
	return a.revision - b.revision;
}

/**
 * Every committed revision of the whole store as an externally visible
 * projection — the read seam the Governance Graph projection consumes
 * (F049 ticket 05, #222; ADR-0021: Canonical Artifacts remain the write
 * authority, the graph is a rebuildable read-only projection).
 *
 * This is a verification read with the same fail-closed guarantees as
 * show/list: every home's settlement journal is replayed, both halves of
 * every committed pair are swept, each served revision's committed record
 * is cross-checked against its Envelope, and the committed trace graph of
 * every revision is walked for cycles. One corrupt artifact fails the
 * entire read — the projection is never partial (F035-S5), so corrupt
 * revisions are excluded by refusal, never by silent skipping. Only fully
 * committed revisions are returned; prepared and aborted revisions are
 * invisible by design.
 *
 * Unlike show/list, this read is STRICTLY read-only: it never settles
 * crashed attempts, so not even a journal-only recovery record is appended
 * through the projection path. There is no code path from the projection
 * rebuild or query to a Canonical Artifact write of any kind.
 *
 * Ticket-05 review finding F-1 (determinism): every field of the returned
 * projections is covered by the source fingerprint the Governance Graph
 * checkpoints against (the Envelope hash). The revision's `committedAt`
 * therefore comes from the Envelope's own `committedAt` field — which the
 * envelopeHash covers — and NOT from the journal committed record's `at`,
 * which sits outside both the fingerprint and every integrity check. show
 * and list keep journal-record provenance (their pre-existing contract);
 * only the projection seam needs checkpoint-covered inputs, so a hand-edited
 * journal timestamp can no longer change a rebuild's result hash while
 * `projection status` still certifies "current".
 *
 * @param {string} cwd - Target repository root.
 * @returns {Array<object>} Committed revision projections, canonically
 *         ordered by (type, identity, revision).
 * @throws {Error} Typed AMBER_E_ARTIFACT_JOURNAL_CORRUPT /
 *         AMBER_E_ARTIFACT_UNSUPPORTED_VERSION / AMBER_E_ARTIFACT_UNKNOWN_FIELD /
 *         AMBER_E_ARTIFACT_EXTENSION_COLLISION (the version-negotiation and
 *         extension-contract verdicts each revision's committedProjection
 *         check throws before its binding hashes, ticket 06) /
 *         AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT / AMBER_E_ARTIFACT_TRACE_CYCLE /
 *         AMBER_E_ARTIFACT_HASH_MISMATCH / AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH.
 */
function listArtifactRevisions(cwd) {
	const revisions = [];
	const startNodes = [];
	for (const { dir } of walkArtifactHomes(cwd)) {
		const slug = path.basename(dir);
		const journal = readJournal(dir);
		validateSettlement(journal);
		for (const revision of committedRevisions(journal)) {
			const envelope = readEnvelope(dir, revision);
			const body = readBody(dir, revision);
			if (!envelope || !body) {
				throw typedReadError(
					SETTLEMENT_CORRUPT_CODE,
					`committed revision ${revision} of "${slug}" is missing its ${envelope ? "Body" : "Envelope"} on disk; refusing to project inconsistent settlement state`,
				);
			}
			const commitRecord = findCommitRecord(journal, revision);
			revisions.push(
				committedProjection(
					envelope.type,
					envelope.identity,
					revision,
					body,
					envelope,
					// F-1 (ticket-05 review): the projection seam sources
					// committedAt from the Envelope — the field the
					// envelopeHash covers — never from the journal record's
					// `at`, which the source fingerprint does not cover. The
					// commitRecord is still cross-checked below; only the
					// observable timestamp's origin changes.
					envelope.committedAt ?? null,
				),
			);
			if (contentHashMismatch(commitRecord, envelope)) {
				throw typedReadError(
					SETTLEMENT_CORRUPT_CODE,
					settlementContentHashMessage(envelope.identity, revision, commitRecord, envelope),
				);
			}
			startNodes.push({ type: envelope.type, identity: envelope.identity, revision });
		}
	}
	const cycle = findTraceCycle(startNodes, traceEdgesResolver(cwd));
	if (cycle) throw traceCycleError(cycle);
	return revisions.sort(compareArtifactRevisions);
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
 * - `transition` (ticket 03, #220) names a transition from the type's closed
 *   lifecycle table; the new revision carries the transition's target state.
 *   An unregistered name fails closed as AMBER_E_ARTIFACT_TRANSITION_UNKNOWN;
 *   a transition that does not apply from the current head's lifecycle state
 *   fails closed as AMBER_E_ARTIFACT_TRANSITION_INVALID. Admissions without
 *   a transition carry the type's initial state — changed content must pass
 *   the gate again; a lifecycle change is always a new revision.
 * - `scope` is an optional confinement tag; Traces are confined to one scope
 *   (source and target tags must match; null counts as a scope).
 * - `traces` is the typed lineage of the revision: each record is validated
 *   against the registered, versioned Trace contract (refines / realizes /
 *   supersedes / decides) with direction, scope, and cardinality. Required
 *   planning lineage is enforced: a Spec refines exactly one accepted Intent
 *   revision and a Plan realizes exactly one approved Spec revision, or
 *   admission fails closed with stable trace errors. Trace revisions default
 *   to the target's current committed head and are recorded resolved.
 * - (F050, #226) `decisionKind` + `principal` bind a Decision: the kind must
 *   come from the closed set (acceptance / approval / review — distinct,
 *   non-interchangeable authorities; one record exercises one kind), and the
 *   principal id is verified against the Principal registry BEFORE any
 *   durable state is touched — unregistered, revoked, expired, and
 *   not-yet-valid principals all fail closed with their own stable codes.
 *   The verified principal snapshot is frozen into the Envelope. The
 *   acceptance and approval kinds are human-only slots: a service principal
 *   in one is rejected (AMBER_E_DECISION_HUMAN_SLOT_REQUIRED); review is the
 *   only kind a service principal may carry. Both flags are decision-only:
 *   a non-decision admission carrying either fails closed as an argument
 *   error.
 * - Tampered or inconsistent settlement state (impossible journal
 *   sequences, a committed pair missing or failing its binding, a hashless
 *   committed record in a hash-bearing journal) fails closed as corruption
 *   with stable codes instead of being served or overwritten.
 * - Ticket 04 (#221): a crashed prior attempt (a dangling prepared record)
 *   is settled deterministically before this admission claims its slot —
 *   one `aborted` journal record is appended; recovery never writes or
 *   rewrites a Body or Envelope, and the aborted revision stays invisible.
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
		transition = null,
		scope = null,
		traces = [],
		schemaVersion = ENVELOPE_SCHEMA_VERSION,
		extensions = null,
		decisionKind = null,
		principal = null,
	},
) {
	const fail = (code, errors) => ({ ok: false, code, receipt: null, errors });

	if (!ARTIFACT_TYPES.includes(type)) {
		return fail("AMBER_E_ARTIFACT_UNKNOWN_TYPE", [
			`artifact type "${type}" is not registered; registered types: ${ARTIFACT_TYPES.join(", ")}`,
		]);
	}
	// F050 ticket 1 (#226): Decision bindings are decision-only envelope
	// content. Flags on a non-decision admission are malformed input, never a
	// silently dropped extra — the stored contract would then differ from the
	// declared one.
	if (type !== "decision" && (decisionKind !== null || principal !== null)) {
		return fail(INVALID_ARG_CODE, [
			`decisionKind/principal are decision-only admission inputs, but this admission is a "${type}" artifact; drop them, or admit --type decision`,
		]);
	}
	let principalSnapshot = null;
	if (type === "decision") {
		if (!DECISION_KINDS.includes(decisionKind)) {
			return fail(DECISION_KIND_INVALID_CODE, [
				`decisionKind must be one of the closed kind set (${DECISION_KINDS.join(", ")}) — Acceptance, Approval, and Review are distinct authorities and never interchangeable; got ${JSON.stringify(decisionKind)}`,
			]);
		}
		if (typeof principal !== "string" || principal.trim().length === 0) {
			return fail(DECISION_PRINCIPAL_REQUIRED_CODE, [
				`every Decision binds the Principal that acted; pass the acting principal id (got ${JSON.stringify(principal)}) — the binding is verified against the Principal registry at admission`,
			]);
		}
	}
	// Ticket 06 (#223 — AC1): version negotiation at the WRITER seam. This
	// amber only ever admits a supported schemaVersion; anything else is
	// refused before any durable state is touched, so an unsupported version
	// never reaches the journal.
	if (
		!Number.isInteger(schemaVersion) ||
		!SUPPORTED_ENVELOPE_SCHEMA_VERSIONS.includes(schemaVersion)
	) {
		return fail(UNSUPPORTED_VERSION_CODE, [
			`this amber writes Envelope schemaVersion ${ENVELOPE_SCHEMA_VERSION} and cannot admit schemaVersion ${JSON.stringify(schemaVersion)}; supported schema versions: ${SUPPORTED_ENVELOPE_SCHEMA_VERSIONS.join(", ")} — upgrade amber to write the newer Envelope`,
		]);
	}
	// Ticket 06 (#223 — AC2): the extension namespace contract runs before
	// any durable state is touched, so an Envelope the read side would
	// refuse a moment later can never be written.
	const extensionProblem = extensionNamespaceProblem(extensions);
	if (extensionProblem !== null) {
		return fail(extensionProblem.code, [extensionProblem.message]);
	}
	const extensionCarrier =
		extensions === undefined || extensions === null || Object.keys(extensions).length === 0
			? null
			: extensions;
	if (!isValidArtifactIdentity(identity)) {
		return fail("AMBER_E_ARTIFACT_INVALID_IDENTITY", [
			`artifact identity "${identity}" is not a usable directory name (empty and pure-dot segments are rejected)`,
		]);
	}
	// Finding 1 (full-review follow-up): a case-variant of an existing
	// artifact home is rejected BEFORE any durable state is touched (the
	// admission lock would otherwise mkdir the folded path of the existing
	// home on a case-folding filesystem, and a case-sensitive one would fork
	// the store into platform-dependent spellings). The scan compares stored
	// directory entries, so the verdict is identical on both filesystem
	// kinds; two racing first admissions of case variants still degrade to
	// the lock's CONFLICT, never to corruption.
	const variantHome = caseVariantSibling(cwd, type, identity);
	if (variantHome !== null) {
		return fail(IDENTITY_CASE_COLLISION_CODE, [
			`artifact identity "${identity}" differs only by letter case from the existing ${type} home "${variantHome}"; identity spelling is exact — re-admit with the stored spelling "${variantHome}" or choose an identity that differs by more than case`,
		]);
	}
	// Pair binding (ADR-0023): both sides must arrive in one atomic call.
	if (typeof body !== "string" || body.length === 0) {
		return fail("AMBER_E_ARTIFACT_ORPHANED_HALF", [
			"admission received an Envelope without a readable Artifact Body",
		]);
	}

	// Ticket 06 (#223 — AC3): admission size ceilings. The Body is measured
	// in bytes (UTF-8) BEFORE any durable state is touched — an oversized
	// artifact never reaches the journal, never creates a home, never takes
	// the lock. A garbage ceiling override is an argument error, never a
	// silent default: an operator who set the variable meant a bound.
	let ceilings;
	try {
		ceilings = admissionSizeCeilings();
	} catch (err) {
		return fail(err.amberCode || INVALID_ARG_CODE, [err.message]);
	}
	const bodyBytes = Buffer.byteLength(body, "utf8");
	if (bodyBytes > ceilings.maxBodyBytes) {
		return fail(SIZE_CEILING_CODE, [
			`the Body is ${bodyBytes} bytes, above the admission ceiling of ${ceilings.maxBodyBytes} bytes (AMBER_ARTIFACT_MAX_BODY_BYTES); an oversized artifact is refused at admission and never reaches the journal — split the artifact or raise the ceiling deliberately`,
		]);
	}

	// Scope is an optional confinement tag for Traces: null or a non-empty
	// string. Garbage never becomes a silent default scope.
	if (scope !== undefined && scope !== null) {
		if (typeof scope !== "string" || scope.trim().length === 0) {
			return fail(INVALID_ARG_CODE, [
				`scope must be a non-empty string scope tag or null; got ${JSON.stringify(scope)}`,
			]);
		}
	}
	const scopeTag = scope === undefined || scope === null ? null : scope;

	// An explicitly passed-but-empty idempotency key is a malformed
	// invocation, never a silent "no key" (ticket-02 review finding F5): the
	// caller meant to bind a retry, so the flag must carry one.
	if (idempotencyKey !== undefined && idempotencyKey !== null) {
		if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
			return fail(INVALID_ARG_CODE, [
				`idempotencyKey must be a non-empty string when provided; got ${JSON.stringify(idempotencyKey)}`,
			]);
		}
	}
	const key = typeof idempotencyKey === "string" ? idempotencyKey : null;

	// Named lifecycle transition: the name must come from the type's closed
	// transition table. The from-state check runs under the lock against the
	// current head (where the CAS precondition is also validated).
	if (transition !== undefined && transition !== null) {
		if (typeof transition !== "string" || transition.length === 0) {
			return fail(INVALID_ARG_CODE, [
				`transition must be a named transition of ${type} artifacts or null; got ${JSON.stringify(transition)}`,
			]);
		}
		if (transitionFor(type, transition) === null) {
			const registered = registeredTransitionsOf(type);
			return fail(TRANSITION_UNKNOWN_CODE, [
				`transition "${transition}" is not registered for ${type} artifacts; registered transitions: ${registered.length > 0 ? registered.join(", ") : "(none)"}`,
			]);
		}
	}
	const transitionName = transition === undefined || transition === null ? null : transition;

	// Typed Trace lineage: shape first (argument errors never masquerade as
	// registry violations), then the registered contract (unknown relation,
	// direction, cardinality), then resolution against the committed target
	// state (existence, lifecycle gate, scope confinement). Traces bind to
	// other artifacts' committed revisions, so resolution reads those homes
	// before this artifact's lock is taken.
	const traceList = traces === undefined || traces === null ? [] : traces;
	if (!Array.isArray(traceList)) {
		return fail(INVALID_ARG_CODE, [
			`traces must be an array of Trace records { type, to: { type?, identity, revision? } }; got ${typeof traceList}`,
		]);
	}
	for (const trace of traceList) {
		const shapeProblem = traceShapeProblem(trace);
		if (shapeProblem !== null) return fail(INVALID_ARG_CODE, [shapeProblem]);
	}
	const structural = structuralTraceProblems(type, identity, traceList);
	if (structural.length > 0) {
		return fail(structural[0].code, [structural[0].message]);
	}
	const resolvedTraces = [];
	for (const trace of traceList) {
		const resolved = resolveTraceTarget(cwd, type, identity, scopeTag, trace);
		if (!resolved.ok) return fail(resolved.code, [resolved.message]);
		resolvedTraces.push(Object.freeze({ type: trace.type, to: resolved.to }));
	}

	// F050 ticket 1 (#226): the acting Principal is verified against the
	// registry BEFORE any durable state is touched (this artifact's lock is
	// not yet taken), exactly like trace targets: an unregistered, revoked,
	// expired, or not-yet-valid principal fails closed with its own stable
	// code, and the human-only slots (acceptance/approval) reject a service
	// principal. The verified snapshot is frozen into the envelope as the
	// binding evidence.
	if (type === "decision") {
		let resolvedPrincipal;
		try {
			resolvedPrincipal = resolveActivePrincipal(cwd, principal, { now: new Date() });
		} catch (err) {
			return fail(err.amberCode || "AMBER_E_PRINCIPAL_REGISTRY_CORRUPT", [err.message]);
		}
		if (!resolvedPrincipal.ok) {
			return fail(resolvedPrincipal.code, [resolvedPrincipal.message]);
		}
		if (
			(decisionKind === "acceptance" || decisionKind === "approval") &&
			resolvedPrincipal.principal.principalKind !== "human"
		) {
			return fail(DECISION_HUMAN_SLOT_REQUIRED_CODE, [
				`${decisionKind === "acceptance" ? "an" : "a"} ${decisionKind} Decision is a human-only authority slot, but principal "${principal}" is a ${resolvedPrincipal.principal.principalKind} identity; formal acceptance and approval require an independently authenticated human — agents and service identities cannot occupy a human approval slot (a review Decision is the only kind a service principal may carry)`,
			]);
		}
		principalSnapshot = Object.freeze(resolvedPrincipal.principal);
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

	const dir = artifactDir(cwd, type, identity);
	let unlock;
	try {
		unlock = acquireAdmissionLock(dir);
	} catch (err) {
		return fail(err.amberCode || CONFLICT_CODE, [err.message]);
	}
	let result;
	try {
		// F050 review F-6: the principal was verified pre-lock; the registry
		// writers append under their own lock, so a revocation (or expiry
		// boundary) can land between that verify and this append. Re-verify
		// under the artifact lock so the frozen snapshot never claims an
		// authority the registry no longer grants at append time.
		if (type === "decision") {
			let reverified;
			try {
				reverified = resolveActivePrincipal(cwd, principal, { now: new Date() });
			} catch (err) {
				return fail(err.amberCode || "AMBER_E_PRINCIPAL_REGISTRY_CORRUPT", [err.message]);
			}
			if (!reverified.ok) {
				return fail(reverified.code, [reverified.message]);
			}
			if (
				(decisionKind === "acceptance" || decisionKind === "approval") &&
				reverified.principal.principalKind !== "human"
			) {
				return fail(DECISION_HUMAN_SLOT_REQUIRED_CODE, [
					`${decisionKind === "acceptance" ? "an" : "a"} ${decisionKind} Decision is a human-only authority slot, but principal "${principal}" is a ${reverified.principal.principalKind} identity; formal acceptance and approval require an independently authenticated human — agents and service identities cannot occupy a human approval slot (a review Decision is the only kind a service principal may carry)`,
				]);
			}
			principalSnapshot = Object.freeze(reverified.principal);
		}
		result = admitUnderLock(dir, type, identity, body, provenance, expected, key, fail, {
			transition: transitionName,
			scope: scopeTag,
			traces: resolvedTraces,
			schemaVersion,
			extensions: extensionCarrier,
			decisionKind: type === "decision" ? decisionKind : null,
			principal: type === "decision" ? principalSnapshot : null,
			maxEnvelopeBytes: ceilings.maxEnvelopeBytes,
		});
	} finally {
		unlock();
	}
	// A failed admission leaves nothing behind when it never wrote durable
	// state (ticket-02 review finding F6): the lock created the artifact
	// home, so remove it again — but only when it is truly empty.
	if (result && !result.ok) removeDirIfEmpty(dir);
	return result;
}

function admitUnderLock(
	dir,
	type,
	identity,
	body,
	provenance,
	expected,
	idempotencyKey,
	fail,
	{
		transition = null,
		scope = null,
		traces = [],
		schemaVersion = ENVELOPE_SCHEMA_VERSION,
		extensions = null,
		decisionKind = null,
		principal = null,
		maxEnvelopeBytes = DEFAULT_MAX_ENVELOPE_BYTES,
	} = {},
) {
	const contentHashValue = bodyHash(body);
	const lifecycle = lifecycleForAdmission(type, transition);
	const incomingKeyHash = admissionHash({
		schemaVersion,
		type,
		identity,
		supersedes: expected,
		bodyHash: contentHashValue,
		provenance,
		transition,
		scope,
		traces,
		extensions,
		decisionKind,
		principal,
	});

	let journal;
	try {
		journal = readJournal(dir);
		validateSettlement(journal);
		// Ticket 04: deterministic settlement recovery. We hold the admission
		// lock, so any prepared record still lacking a committed/aborted
		// outcome is a crashed PRIOR attempt — settle it as aborted
		// (journal-only; the crashed attempt's files are never touched)
		// before this admission claims its own slot.
		journal = recoverDanglingPrepared(dir, journal, { identity, underLock: true });
	} catch (err) {
		return fail(err.amberCode || JOURNAL_CORRUPT_CODE, [err.message]);
	}
	const head = committedHead(journal);

	// Pair-completeness sweep over the committed history (ticket-02 review
	// finding F8 opened the Envelope half; ticket-03 review F-2 closes the
	// Body half): every committed revision must still have BOTH halves of
	// its pair on disk before any idempotency path can confirm a retry or
	// any admission can build on the store — a hole at ANY revision is
	// settlement corruption, never a silent skip the dedupe scan works
	// around. The sweep reads each pair once, ahead of the keyed and
	// content-bound paths below, which reuse the reads.
	const committedPairs = new Map();
	for (const revision of committedRevisions(journal)) {
		const envelope = readEnvelope(dir, revision);
		if (!envelope) {
			return fail(SETTLEMENT_CORRUPT_CODE, [
				`committed revision ${revision} of "${identity}" is missing its Envelope on disk; refusing to scan inconsistent settlement state`,
			]);
		}
		const bodyText = readBody(dir, revision);
		if (!bodyText) {
			return fail(SETTLEMENT_CORRUPT_CODE, [
				`committed revision ${revision} of "${identity}" is missing its Body on disk; refusing to scan inconsistent settlement state`,
			]);
		}
		committedPairs.set(revision, { envelope, bodyText });
	}

	// Caller-key idempotency: the key is retry metadata recorded on the
	// committed journal record. Replaying identical canonical content
	// returns the original receipt; reusing the key for different content
	// fails closed (the key never re-binds, and never determines identity).
	if (idempotencyKey !== null) {
		const prior = findKeyRecord(journal, idempotencyKey);
		if (prior) {
			const priorPair = committedPairs.get(prior.revision) || null;
			const priorEnvelope = priorPair ? priorPair.envelope : null;
			const priorBody = priorPair ? priorPair.bodyText : null;
			if (!priorEnvelope || !priorBody) {
				return fail(SETTLEMENT_CORRUPT_CODE, [
					`revision ${prior.revision} settled under idempotency key "${idempotencyKey}" is missing its Body/Envelope pair on disk; refusing to serve inconsistent settlement state`,
				]);
			}
			try {
				committedProjection(type, identity, prior.revision, priorBody, priorEnvelope, null);
				// Ticket-02 review finding F9: the committed record's
				// contentHash is cross-checked against the Envelope's bodyHash —
				// the field proves settlement integrity, not decoration.
				const record = findCommitRecord(journal, prior.revision);
				if (contentHashMismatch(record, priorEnvelope)) {
					throw typedReadError(
						SETTLEMENT_CORRUPT_CODE,
						settlementContentHashMessage(identity, prior.revision, record, priorEnvelope),
					);
				}
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
	// creates a duplicate revision. F9: the committed record's contentHash is
	// cross-checked against the matched Envelope's bodyHash before the receipt
	// is served, so a retry can never confirm a tampered revision. Both halves
	// of every scanned revision were already established present by the
	// pair-completeness sweep above.
	for (const revision of committedRevisions(journal)) {
		const { envelope, bodyText } = committedPairs.get(revision);
		if (admissionHashOfEnvelope(envelope) !== incomingKeyHash) continue;
		try {
			committedProjection(type, identity, revision, bodyText, envelope, null);
			const record = findCommitRecord(journal, revision);
			if (contentHashMismatch(record, envelope)) {
				throw typedReadError(
					SETTLEMENT_CORRUPT_CODE,
					settlementContentHashMessage(identity, revision, record, envelope),
				);
			}
		} catch (err) {
			return fail(err.amberCode || SETTLEMENT_CORRUPT_CODE, [err.message]);
		}
		return {
			ok: true,
			duplicate: true,
			code: null,
			errors: [],
			receipt: receiptFor(type, identity, revision, envelope, journal),
		};
	}

	// Expected-head compare-and-swap.
	let headEnvelope = null;
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
		// Building on the head: its pair must still hold its binding, and its
		// committed record must still agree with the Envelope it settled (F9).
		try {
			committedProjection(type, identity, head, currentBody, current, null);
			const record = findCommitRecord(journal, head);
			if (contentHashMismatch(record, current)) {
				throw typedReadError(
					SETTLEMENT_CORRUPT_CODE,
					settlementContentHashMessage(identity, head, record, current),
				);
			}
		} catch (err) {
			return fail(err.amberCode || SETTLEMENT_CORRUPT_CODE, [err.message]);
		}
		headEnvelope = current;
	} else if (expected !== null) {
		return fail(CONFLICT_CODE, [
			`cannot supersede revision ${expected}: "${identity}" has no committed revisions`,
		]);
	}

	// Named transition applies from the current lifecycle state (ticket 03):
	// the head revision's state when one exists — a legacy revision without
	// the lifecycle field reads as the type's initial state, since it was
	// admitted without a transition — and the type's initial state for a
	// first admission. A transition that does not apply fails closed instead
	// of producing a state the type's closed lifecycle cannot reach.
	if (transition !== null) {
		const contract = transitionFor(type, transition);
		const currentState = headEnvelope
			? (headEnvelope.lifecycle ?? TYPE_REGISTRY[type].lifecycle.initial)
			: TYPE_REGISTRY[type].lifecycle.initial;
		if (currentState !== contract.from) {
			return fail(TRANSITION_INVALID_CODE, [
				`transition "${transition}" of ${type} artifacts applies from lifecycle state "${contract.from}", but ${
					head > 0
						? `revision ${head} of "${identity}" is in lifecycle state "${currentState}"`
						: `"${identity}" has no committed revisions yet and starts from "${currentState}"`
				}; a lifecycle change is always a new admission — supersede with a transition that applies from "${currentState}"`,
			]);
		}
	}

	const revision = highestClaimedRevision(journal) + 1;
	// Ticket 04 strict policy (T2-review finding F2): a journal whose
	// committed records are hashless is pure ticket-01 legacy — validation
	// only lets that state pass when ZERO records carry settlement hashes,
	// and the prepared record this admission is about to append would be the
	// first. Extending hashless history with hash-bearing records would
	// leave a journal the strict policy must then read as stripped
	// provenance, so the admission fails closed BEFORE writing anything: the
	// legacy store stays readable (verbatim retries above still dedupe
	// without appending); rebuild it by re-admitting the content instead of
	// migrating the journal in place.
	if (journal.some((r) => r.kind === KIND_COMMITTED && typeof r.admissionHash !== "string")) {
		return fail(SETTLEMENT_CORRUPT_CODE, [
			`"${identity}" has a pure ticket-01 legacy journal (none of its records carry settlement hashes); the strict integrity policy refuses to extend hashless history — re-admit the content as a fresh store instead of migrating the journal in place`,
		]);
	}
	const preparedAt = new Date().toISOString();
	const attemptId = randomUUID();
	const envelopeContent = {
		schemaVersion,
		type,
		identity,
		revision,
		supersedes: expected,
		bodyHash: contentHashValue,
		lifecycle,
		transition,
		scope,
		traces: traces.map((trace) => ({ type: trace.type, to: { ...trace.to } })),
		...(traces.length > 0 ? { traceContractVersion: TRACE_REGISTRY_VERSION } : {}),
		...(extensions !== null ? { [EXTENSION_CARRIER_FIELD]: extensions } : {}),
		// F050 (#226): the Decision binding is core Envelope content (never
		// extension data — that carrier is contractually opaque), carried
		// only by decision Envelopes.
		...(decisionKind !== null ? { decisionKind } : {}),
		...(principal !== null ? { principal } : {}),
		provenance: provenance || null,
		committedAt: preparedAt,
	};
	const envelope = Object.freeze({
		...envelopeContent,
		envelopeHash: envelopeHash(envelopeContent),
	});

	// Ticket 06 (#223 — AC3): the Envelope ceiling bounds the serialized
	// Envelope (the durable, hash-covered form). Checked after the envelope
	// is built but BEFORE the prepared record is appended, so an oversized
	// Envelope never reaches the journal; the lock created the (still empty)
	// home, which admitArtifact removes again below.
	const envelopeBytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
	if (envelopeBytes > maxEnvelopeBytes) {
		return fail(SIZE_CEILING_CODE, [
			`the Envelope serializes to ${envelopeBytes} bytes, above the admission ceiling of ${maxEnvelopeBytes} bytes (AMBER_ARTIFACT_MAX_ENVELOPE_BYTES); an oversized artifact is refused at admission and never reaches the journal — carry less provenance/extension data or raise the ceiling deliberately`,
		]);
	}

	// Claim the slot, then re-validate through the journal after every
	// append: the prepared record is the durable CAS intent, and the guard
	// makes the journal itself the serialization point. Ticket-02 review
	// finding F7: every durable write of the admission surfaces an I/O
	// failure as the typed AMBER_E_ARTIFACT_IO result, never a raw fs
	// exception — the write sequence itself is unchanged.
	try {
		appendJSONL(journalPath(dir), {
			kind: KIND_PREPARED,
			revision,
			at: preparedAt,
			expectedHead: head,
			admissionHash: incomingKeyHash,
			attemptId,
			...(idempotencyKey !== null ? { idempotencyKey } : {}),
		});
	} catch (err) {
		return fail(IO_CODE, [
			`failed to append the prepared record for revision ${revision} of "${identity}" to the settlement journal: ${err.message}`,
		]);
	}
	try {
		settleGuard(dir, { revision, attemptId, expectedHead: head });
	} catch (err) {
		return fail(err.amberCode || JOURNAL_CORRUPT_CODE, [err.message]);
	}

	// Atomic pair write between prepared and committed: a crash in between
	// leaves the files present but the revision uncommitted (invisible), and
	// the consumed slot is never reused.
	try {
		fs.writeFileSync(path.join(dir, `rev-${revision}.md`), body, "utf8");
		fs.writeFileSync(
			path.join(dir, `rev-${revision}.envelope.json`),
			JSON.stringify(envelope, null, 2) + "\n",
			"utf8",
		);
	} catch (err) {
		return fail(IO_CODE, [
			`failed to write the Body/Envelope pair for revision ${revision} of "${identity}": ${err.message}`,
		]);
	}
	try {
		settleGuard(dir, { revision, attemptId, expectedHead: head });
	} catch (err) {
		return fail(err.amberCode || JOURNAL_CORRUPT_CODE, [err.message]);
	}

	try {
		appendJSONL(journalPath(dir), {
			kind: KIND_COMMITTED,
			revision,
			at: new Date().toISOString(),
			expectedHead: head,
			admissionHash: incomingKeyHash,
			contentHash: contentHashValue,
			...(idempotencyKey !== null ? { idempotencyKey } : {}),
		});
	} catch (err) {
		return fail(IO_CODE, [
			`failed to append the committed record for revision ${revision} of "${identity}" to the settlement journal: ${err.message}`,
		]);
	}

	return {
		ok: true,
		duplicate: false,
		code: null,
		errors: [],
		receipt: receiptFor(type, identity, revision, envelope, readJournal(dir)),
	};
}

function receiptFor(type, identity, revision, envelope, journal) {
	const commitRecord = findCommitRecord(journal, revision);
	return Object.freeze({
		type,
		identity,
		revision,
		contentHash: envelope.bodyHash,
		envelopeHash: envelope.envelopeHash,
		supersedes: envelope.supersedes ?? null,
		lifecycle: envelope.lifecycle ?? null,
		transition: envelope.transition ?? null,
		scope: envelope.scope ?? null,
		traces: envelope.traces || [],
		// Ticket 06 (#223 — AC2): extension namespaces ride in the receipt
		// exactly as they were admitted — opaque, never interpreted.
		extensions: envelope[EXTENSION_CARRIER_FIELD] ?? null,
		provenance: envelope.provenance,
		committedAt: commitRecord ? commitRecord.at : envelope.committedAt,
		// F050 (#226): the Decision binding rides in the receipt exactly as
		// verified at admission — the kind and the principal snapshot.
		decisionKind: envelope.decisionKind ?? null,
		principal: envelope.principal ?? null,
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
	listArtifactRevisions,
};
