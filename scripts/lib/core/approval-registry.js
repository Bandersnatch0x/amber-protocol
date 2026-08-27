"use strict";

// F050 ticket 4 (#229) — Approval records: atomicity & lifecycle.
//
// An Approval is the human authorization a Decision settles under: scoped,
// expiring, revocable, and single-use. It lives as an append-only receipt
// ledger under .amber/approvals/registry.jsonl (hash-chained and write-locked
// through the shared registry-ledger disciplines), where every event binds
// the acting human (a registry-verified Principal snapshot frozen at grant
// or revoke time), the confinement scope, the subject that may be decided,
// and the half-open validity window [validAt, validUntil).
//
// Consumption is atomic with the authorized Decision's settlement: the
// consume writer takes the approvals lock, re-verifies every lifecycle
// invariant under it (granted, not revoked, not consumed, inside the window
// at the evaluation clock), admits the Decision artifact (decisionKind
// "approval", principal = the approval's frozen approver), and only then
// appends the `consumed` event binding the Decision's identity and revision
// from the admission receipt. If the admission fails, no consumed event is
// written and the authorization stays unconsumed; one authorization can
// therefore never be replayed — a second consumer fails closed with the
// stable AMBER_E_APPROVAL_ALREADY_CONSUMED code (checked pre-lock AND under
// the lock, exactly like the evidence duplicate-id discipline).
//
// The lock ordering is fixed and deadlock-free: the approvals lock is only
// ever taken BEFORE the artifact admission lock (consume), never the
// reverse — no artifact-store path takes the approvals lock.
//
// The ledger never stores derived state: the effective status
// (granted | revoked | consumed | expired) is computed by the read seams
// against their own clock — "expired" is a verdict about the reader's
// present, never a frozen fact. Every event records its clock source
// ("injected" when the caller injected a clock, "system" otherwise) and the
// fixed skew policy "no-tolerance": the recorded time is authoritative and
// no tolerance window is applied at either boundary (the validity window is
// half-open, validAt <= now < validUntil — at exactly validUntil the
// authorization is expired, mirroring principalStatus's `at >= to`).

const path = require("node:path");
const { appendJSONL, readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { typedError } = require("./error-catalog");
const {
	GENESIS_HASH,
	chainHash,
	chainHeadHash: sharedChainHeadHash,
	acquireLedgerLock,
	appendWithinCeiling: sharedAppendWithinCeiling,
} = require("./registry-ledger");
const { resolveActivePrincipal, parseTimestamp } = require("./principal-registry");
const { admitArtifact } = require("./canonical-artifacts");

const REGISTRY_CORRUPT_CODE = "AMBER_E_APPROVAL_REGISTRY_CORRUPT";
const UNSUPPORTED_VERSION_CODE = "AMBER_E_APPROVAL_UNSUPPORTED_VERSION";
const SIZE_CEILING_CODE = "AMBER_E_APPROVAL_SIZE_CEILING";
const LOCK_CONFLICT_CODE = "AMBER_E_APPROVAL_REGISTRY_LOCK";
const NOT_FOUND_CODE = "AMBER_E_APPROVAL_NOT_FOUND";
const ALREADY_GRANTED_CODE = "AMBER_E_APPROVAL_ALREADY_GRANTED";
const ALREADY_REVOKED_CODE = "AMBER_E_APPROVAL_ALREADY_REVOKED";
const ALREADY_CONSUMED_CODE = "AMBER_E_APPROVAL_ALREADY_CONSUMED";
const EXPIRED_CODE = "AMBER_E_APPROVAL_EXPIRED";
const REVOKED_CODE = "AMBER_E_APPROVAL_REVOKED";
const NOT_YET_VALID_CODE = "AMBER_E_APPROVAL_NOT_YET_VALID";
const HUMAN_SLOT_REQUIRED_CODE = "AMBER_E_APPROVAL_HUMAN_SLOT_REQUIRED";
const INVALID_ARG_CODE = "AMBER_E_INVALID_ARG";

const LOCK_STALE_MS = 30_000;

/** Version of the approval event contract this module writes and reads. */
const APPROVAL_SCHEMA_VERSION = 1;

/** Every approval event schemaVersion this reader can interpret, ascending. */
const SUPPORTED_APPROVAL_SCHEMA_VERSIONS = Object.freeze([1]);

/**
 * The recorded skew policy: NO tolerance is applied at either validity
 * boundary — the recorded time is authoritative (F050: "expiry is evaluated
 * using a half-open interval under a recorded clock source and skew
 * policy").
 */
const SKEW_POLICY = "no-tolerance";

/** The closed set of clock sources an event may record. */
const CLOCK_SOURCES = Object.freeze(["injected", "system"]);

/**
 * Ledger size ceiling in bytes (default 1 MiB; deliberate overrides via
 * AMBER_APPROVAL_MAX_REGISTRY_BYTES). Checked before any durable state is
 * touched — first on the body, then under the lock on the exact chained
 * line.
 */
const DEFAULT_MAX_APPROVAL_BYTES = 1024 * 1024;

// Bounded approval content: the ledger must stay small and reviewable, so
// the writers refuse (typed argument error, never silent truncation) an
// approval that would smuggle unbounded content into governed state.
const MAX_ID_CHARS = 200;
const MAX_SCOPE_CHARS = 200;
const MAX_SUBJECT_CHARS = 200;

// Closed field sets per event kind: an event carrying a top-level field
// outside its kind's contract is corruption on read, never silently dropped.
// Every event carries the hash chain (prevHash/hash) exactly like the
// principal and evidence registries.
const GRANTED_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"approvalId",
	"approver",
	"scope",
	"subject",
	"validAt",
	"validUntil",
	"recordedAt",
	"clockSource",
	"skewPolicy",
	"prevHash",
	"hash",
]);
const REVOKED_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"approvalId",
	"revoker",
	"clockSource",
	"skewPolicy",
	"prevHash",
	"hash",
]);
const CONSUMED_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"approvalId",
	"decisionIdentity",
	"decisionRevision",
	"clockSource",
	"skewPolicy",
	"prevHash",
	"hash",
]);
const PRINCIPAL_SNAPSHOT_FIELDS = Object.freeze([
	"id",
	"principalKind",
	"role",
	"membership",
	"capability",
	"scope",
	"validFrom",
	"validTo",
	"issuer",
]);

function approvalLedgerPath(cwd) {
	return statePathForCreate(cwd, "approvals", "registry.jsonl");
}

function approvalCorrupt(message) {
	return typedError(REGISTRY_CORRUPT_CODE, message);
}

function chainHeadHashOf(cwd) {
	return sharedChainHeadHash(approvalLedgerPath(cwd), REGISTRY_CORRUPT_CODE, "approval registry");
}

function acquireApprovalLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(approvalLedgerPath(cwd)),
		lockName: "approvals.lock",
		conflictCode: LOCK_CONFLICT_CODE,
		corruptCode: REGISTRY_CORRUPT_CODE,
		label: "approval registry",
		staleMs: LOCK_STALE_MS,
	});
}

function isNullableNonEmptyString(value) {
	return value === null || (typeof value === "string" && value.length > 0);
}

function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The recorded clock source for one write: "injected" when the caller
 * injected a clock ({@code opts.now} present), "system" otherwise. Derived,
 * never a caller claim — the writer knows which clock it used.
 * @returns {"injected"|"system"}
 */
function clockSourceOf(opts) {
	return opts.now !== undefined ? "injected" : "system";
}

/** The write clock as a Date, whatever its source. */
function writeClockOf(opts) {
	return opts.now ?? new Date();
}

function clockMillis(now) {
	return now instanceof Date ? now.getTime() : new Date(now).getTime();
}

/**
 * The input-shape verdict for one grant (argument level — malformed input is
 * rejected as AMBER_E_INVALID_ARG before any registry or ledger state is
 * touched).
 * @returns {string|null} The problem message, or null.
 */
function grantInputProblem({ id, approver, scope, subject, validUntil }) {
	if (typeof id !== "string" || id.trim().length === 0) {
		return `approval id must be a non-empty string (e.g. --id approval/login-42); got ${JSON.stringify(id)}`;
	}
	if (id.length > MAX_ID_CHARS) {
		return `approval id must carry at most ${MAX_ID_CHARS} characters; got ${id.length}`;
	}
	if (typeof approver !== "string" || approver.trim().length === 0) {
		return `approver is required: an Approval is a human-only authorization slot, verified against the Principal registry (e.g. --approver alice@example.com); got ${JSON.stringify(approver)}`;
	}
	if (!isNullableNonEmptyString(scope)) {
		return `scope must be a non-empty string or null; got ${JSON.stringify(scope)}`;
	}
	if (scope !== null && scope.length > MAX_SCOPE_CHARS) {
		return `scope must carry at most ${MAX_SCOPE_CHARS} characters; got ${scope.length} — the approval contract keeps the ledger bounded`;
	}
	if (typeof subject !== "string" || subject.trim().length === 0) {
		return `subject is required: the approval must name what may be decided under this authorization (e.g. --subject spec/login@2); got ${JSON.stringify(subject)}`;
	}
	if (subject.length > MAX_SUBJECT_CHARS) {
		return `subject must carry at most ${MAX_SUBJECT_CHARS} characters; got ${subject.length} — the approval contract keeps the ledger bounded`;
	}
	if (typeof validUntil !== "string" || parseTimestamp(validUntil) === null) {
		return `validUntil is required and must be an ISO-8601 date, or a date-time carrying an explicit zone (Z or ±hh:mm) — e.g. 2027-01-31 or 2027-01-31T09:00:00Z; got ${JSON.stringify(validUntil)} (the expiry instant; the window is half-open [validAt, validUntil))`;
	}
	return null;
}

/**
 * The consumption verdict for one approval against a clock, shared by the
 * pre-lock and under-lock checks: the approval must exist, be unconsumed,
 * unrevoked, and sit inside its half-open validity window
 * (validAt <= now < validUntil) at the evaluation time.
 * @param {Array<object>} records - Folded approval records.
 * @param {string} id - Approval id.
 * @param {Date|number} now - The evaluation clock.
 * @returns {{ok: true, target: object} | {ok: false, code: string, message: string}}
 */
function consumptionVerdict(records, id, now) {
	const target = records.find((record) => record.id === id);
	if (target === undefined) {
		return {
			ok: false,
			code: NOT_FOUND_CODE,
			message: `approval "${id}" is not recorded; consumption applies to a granted approval — grant it first (amber approval grant)`,
		};
	}
	if (target.consumedAt !== null) {
		return {
			ok: false,
			code: ALREADY_CONSUMED_CODE,
			message: `approval "${id}" was already consumed at ${target.consumedAt} by decision "${target.decisionIdentity}" (revision ${target.decisionRevision}); an authorization is single-use — one authorization can never be replayed, so a second consumption is refused rather than recorded`,
		};
	}
	if (target.revokedAt !== null) {
		return {
			ok: false,
			code: REVOKED_CODE,
			message: `approval "${id}" was revoked at ${target.revokedAt}; a revoked authorization holds no force, so it cannot be consumed`,
		};
	}
	const at = clockMillis(now);
	const from = parseTimestamp(target.validAt);
	const until = parseTimestamp(target.validUntil);
	if (until !== null && at >= until) {
		return {
			ok: false,
			code: EXPIRED_CODE,
			message: `approval "${id}" expired: its validity window [${target.validAt}, ${target.validUntil}) ended at ${target.validUntil} (half-open: at exactly validUntil the authorization is already expired, ${SKEW_POLICY} skew); re-grant a fresh authorization`,
		};
	}
	if (from !== null && at < from) {
		return {
			ok: false,
			code: NOT_YET_VALID_CODE,
			message: `approval "${id}" is not valid yet: its validity window opens at ${target.validAt}; consumption is evaluated at the caller's clock and no skew tolerance moves the boundary`,
		};
	}
	return { ok: true, target };
}

/**
 * Fold the ledger: verify the hash chain, the closed event field sets, the
 * stored shapes (approver/revoker snapshots, bounded strings, parseable
 * timestamps, recorded clock source and skew policy), and the sequencing
 * invariants (one granted per id; revoked/consumed only after granted and at
 * most once each; consumed implies not-revoked — a revoked-then-consumed
 * sequence is one the writers can never produce). Returns the stored-state
 * records in grant order; the derived status is computed by the read seams.
 * @returns {Array<object>} The stored approval records, in grant order.
 * @throws {Error} Typed AMBER_E_* on any corruption.
 */
function foldApprovals(cwd) {
	const events = readLedgerFailClosed(
		approvalLedgerPath(cwd),
		REGISTRY_CORRUPT_CODE,
		"approval registry",
	);
	const byId = new Map();
	let prevHash = GENESIS_HASH;
	for (let index = 0; index < events.length; index += 1) {
		const lineIndex = index + 1;
		const event = events[index];
		if (event === null || typeof event !== "object" || Array.isArray(event)) {
			throw approvalCorrupt(
				`approval registry event ${lineIndex} is not an object; got ${JSON.stringify(event)}`,
			);
		}
		const schemaVersion = event.schemaVersion;
		if (!Number.isInteger(schemaVersion)) {
			throw approvalCorrupt(
				`approval registry event ${lineIndex} carries no integer schemaVersion; got ${JSON.stringify(schemaVersion)}`,
			);
		}
		if (!SUPPORTED_APPROVAL_SCHEMA_VERSIONS.includes(schemaVersion)) {
			throw typedError(
				UNSUPPORTED_VERSION_CODE,
				`approval registry event ${lineIndex} declares schemaVersion ${JSON.stringify(schemaVersion)}, but this reader supports ${SUPPORTED_APPROVAL_SCHEMA_VERSIONS.join(", ")}; an event this reader cannot interpret is rejected rather than reinterpreted — upgrade amber or rebuild the ledger under the supported schema version`,
			);
		}
		if (typeof event.at !== "string" || event.at.length === 0) {
			throw approvalCorrupt(
				`approval registry event ${lineIndex} carries no timestamp ("at"); got ${JSON.stringify(event.at)}`,
			);
		}
		// The tamper-evident chain runs before any content is trusted (the
		// shared F-5 discipline): an in-place edit of any stored event breaks
		// the chain on fold.
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash) {
			throw approvalCorrupt(
				`approval registry event ${lineIndex} breaks the hash chain: its prevHash does not match the previous event's hash — the ledger was edited in place`,
			);
		}
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash) {
			throw approvalCorrupt(
				`approval registry event ${lineIndex} carries a hash that does not match its content — the ledger was edited in place`,
			);
		}
		if (event.kind === "granted") {
			const unknown = Object.keys(event)
				.filter((key) => !GRANTED_EVENT_FIELDS.includes(key))
				.sort();
			if (unknown.length > 0) {
				throw approvalCorrupt(
					`approval registry event ${lineIndex} is a granted event carrying unknown field${unknown.length > 1 ? "s" : ""} ${unknown.map((field) => `"${field}"`).join(", ")}; the closed field set is ${GRANTED_EVENT_FIELDS.join(", ")}`,
				);
			}
			const snapshotProblem = storedSnapshotProblem(event.approver, lineIndex, "approver");
			if (snapshotProblem !== null) throw approvalCorrupt(snapshotProblem);
			if (
				typeof event.approvalId !== "string" ||
				event.approvalId.length === 0 ||
				event.approvalId.length > MAX_ID_CHARS
			) {
				throw approvalCorrupt(
					`approval registry event ${lineIndex} carries an approvalId that is not a non-empty string of at most ${MAX_ID_CHARS} characters; got ${JSON.stringify(event.approvalId)}`,
				);
			}
			if (
				!isNullableNonEmptyString(event.scope) ||
				(event.scope !== null && event.scope.length > MAX_SCOPE_CHARS)
			) {
				throw approvalCorrupt(
					`approval registry event ${lineIndex} carries a scope that is neither null nor a non-empty string of at most ${MAX_SCOPE_CHARS} characters; got ${JSON.stringify(event.scope)}`,
				);
			}
			if (
				typeof event.subject !== "string" ||
				event.subject.length === 0 ||
				event.subject.length > MAX_SUBJECT_CHARS
			) {
				throw approvalCorrupt(
					`approval registry event ${lineIndex} carries a subject that is not a non-empty string of at most ${MAX_SUBJECT_CHARS} characters; got ${JSON.stringify(event.subject)}`,
				);
			}
			for (const field of ["validAt", "validUntil", "recordedAt"]) {
				if (typeof event[field] !== "string" || parseTimestamp(event[field]) === null) {
					throw approvalCorrupt(
						`approval registry event ${lineIndex} carries a ${field} that is not an ISO-8601 date or zoned date-time; got ${JSON.stringify(event[field])}`,
					);
				}
			}
			const clockProblem = storedClockProblem(event, lineIndex, "granted");
			if (clockProblem !== null) throw approvalCorrupt(clockProblem);
			if (byId.has(event.approvalId)) {
				throw approvalCorrupt(
					`approval registry event ${lineIndex} grants "${event.approvalId}" a second time; an approval id is granted exactly once (a re-grant is a new id), so the writers can never append this — the ledger was edited in place`,
				);
			}
			byId.set(event.approvalId, {
				id: event.approvalId,
				approver: event.approver,
				scope: event.scope,
				subject: event.subject,
				validAt: event.validAt,
				validUntil: event.validUntil,
				recordedAt: event.recordedAt,
				revokedAt: null,
				revoker: null,
				consumedAt: null,
				decisionIdentity: null,
				decisionRevision: null,
			});
		} else if (event.kind === "revoked") {
			const unknown = Object.keys(event)
				.filter((key) => !REVOKED_EVENT_FIELDS.includes(key))
				.sort();
			if (unknown.length > 0) {
				throw approvalCorrupt(
					`approval registry event ${lineIndex} is a revoked event carrying unknown field${unknown.length > 1 ? "s" : ""} ${unknown.map((field) => `"${field}"`).join(", ")}; the closed field set is ${REVOKED_EVENT_FIELDS.join(", ")}`,
				);
			}
			const snapshotProblem = storedSnapshotProblem(event.revoker, lineIndex, "revoker");
			if (snapshotProblem !== null) throw approvalCorrupt(snapshotProblem);
			if (typeof event.approvalId !== "string" || event.approvalId.length === 0) {
				throw approvalCorrupt(
					`approval registry event ${lineIndex} is a revoked event whose approvalId is not a non-empty string; got ${JSON.stringify(event.approvalId)}`,
				);
			}
			const clockProblem = storedClockProblem(event, lineIndex, "revoked");
			if (clockProblem !== null) throw approvalCorrupt(clockProblem);
			const record = byId.get(event.approvalId);
			if (record === undefined) {
				throw approvalCorrupt(
					`approval registry event ${lineIndex} revokes "${event.approvalId}", which was never granted; the revoke writer only appends for a granted approval — the ledger was edited in place`,
				);
			}
			if (record.revokedAt !== null) {
				throw approvalCorrupt(
					`approval registry event ${lineIndex} revokes "${event.approvalId}" a second time; revocation is append-once per approval, so the writers can never append this — the ledger was edited in place`,
				);
			}
			if (record.consumedAt !== null) {
				throw approvalCorrupt(
					`approval registry event ${lineIndex} revokes "${event.approvalId}", which was already consumed at ${record.consumedAt}; consumption is terminal (history is not rewritten), so the revoke writer refuses it — the ledger was edited in place`,
				);
			}
			record.revokedAt = event.at;
			record.revoker = event.revoker;
		} else if (event.kind === "consumed") {
			const unknown = Object.keys(event)
				.filter((key) => !CONSUMED_EVENT_FIELDS.includes(key))
				.sort();
			if (unknown.length > 0) {
				throw approvalCorrupt(
					`approval registry event ${lineIndex} is a consumed event carrying unknown field${unknown.length > 1 ? "s" : ""} ${unknown.map((field) => `"${field}"`).join(", ")}; the closed field set is ${CONSUMED_EVENT_FIELDS.join(", ")}`,
				);
			}
			if (typeof event.approvalId !== "string" || event.approvalId.length === 0) {
				throw approvalCorrupt(
					`approval registry event ${lineIndex} is a consumed event whose approvalId is not a non-empty string; got ${JSON.stringify(event.approvalId)}`,
				);
			}
			if (typeof event.decisionIdentity !== "string" || event.decisionIdentity.length === 0) {
				throw approvalCorrupt(
					`approval registry event ${lineIndex} is a consumed event whose decisionIdentity is not a non-empty string; got ${JSON.stringify(event.decisionIdentity)} — a consumption binds the Decision it settled`,
				);
			}
			if (!Number.isInteger(event.decisionRevision) || event.decisionRevision < 1) {
				throw approvalCorrupt(
					`approval registry event ${lineIndex} is a consumed event whose decisionRevision is not a positive integer; got ${JSON.stringify(event.decisionRevision)} — a consumption binds the Decision revision from its admission receipt`,
				);
			}
			const clockProblem = storedClockProblem(event, lineIndex, "consumed");
			if (clockProblem !== null) throw approvalCorrupt(clockProblem);
			const record = byId.get(event.approvalId);
			if (record === undefined) {
				throw approvalCorrupt(
					`approval registry event ${lineIndex} consumes "${event.approvalId}", which was never granted; the consume writer only appends for a granted approval — the ledger was edited in place`,
				);
			}
			if (record.consumedAt !== null) {
				throw approvalCorrupt(
					`approval registry event ${lineIndex} consumes "${event.approvalId}" a second time; an authorization is single-use, so the writers can never append this — the ledger was edited in place`,
				);
			}
			if (record.revokedAt !== null) {
				throw approvalCorrupt(
					`approval registry event ${lineIndex} consumes "${event.approvalId}", which was revoked at ${record.revokedAt}; the consume writer refuses a revoked approval, so the writers can never append this — the ledger was edited in place`,
				);
			}
			record.consumedAt = event.at;
			record.decisionIdentity = event.decisionIdentity;
			record.decisionRevision = event.decisionRevision;
		} else {
			throw approvalCorrupt(
				`approval registry event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}; the closed kind set is granted, revoked, consumed`,
			);
		}
		prevHash = event.hash;
	}
	return [...byId.values()];
}

/**
 * The stored clock-source/skew-policy contract on fold: the closed clock
 * source set and the fixed skew policy. A record only the writers could have
 * produced satisfies both clauses.
 * @returns {string|null} The corruption message, or null.
 */
function storedClockProblem(event, lineIndex, kind) {
	if (!CLOCK_SOURCES.includes(event.clockSource)) {
		return `approval registry event ${lineIndex} is a ${kind} event carrying a clockSource ${JSON.stringify(event.clockSource)} outside the closed set (${CLOCK_SOURCES.join(", ")})`;
	}
	if (event.skewPolicy !== SKEW_POLICY) {
		return `approval registry event ${lineIndex} is a ${kind} event carrying skewPolicy ${JSON.stringify(event.skewPolicy)}, but this ledger records exactly "${SKEW_POLICY}" (no tolerance at either validity boundary — the recorded time is authoritative)`;
	}
	return null;
}

/** The frozen 9-field principal snapshot contract (shared with decisions). */
function storedSnapshotProblem(snapshot, lineIndex, role) {
	if (!isPlainObject(snapshot)) {
		return `approval registry event ${lineIndex} carries a ${role} snapshot that is not an object; got ${JSON.stringify(snapshot)}`;
	}
	const keys = Object.keys(snapshot).sort();
	if (
		keys.length !== PRINCIPAL_SNAPSHOT_FIELDS.length ||
		keys.some((field) => !PRINCIPAL_SNAPSHOT_FIELDS.includes(field))
	) {
		return `approval registry event ${lineIndex} carries a ${role} snapshot that does not bind exactly the frozen registry record fields (${PRINCIPAL_SNAPSHOT_FIELDS.join(", ")}); got ${JSON.stringify(snapshot)}`;
	}
	if (typeof snapshot.id !== "string" || snapshot.id.length === 0) {
		return `approval registry event ${lineIndex} carries a ${role} snapshot whose id is not a non-empty string; got ${JSON.stringify(snapshot.id)}`;
	}
	if (snapshot.principalKind !== "human" && snapshot.principalKind !== "service") {
		return `approval registry event ${lineIndex} carries a ${role} snapshot whose principalKind ${JSON.stringify(snapshot.principalKind)} is outside the closed set (human, service)`;
	}
	for (const field of [
		"role",
		"membership",
		"capability",
		"scope",
		"validFrom",
		"validTo",
		"issuer",
	]) {
		if (!isNullableNonEmptyString(snapshot[field])) {
			return `approval registry event ${lineIndex} carries a ${role} snapshot whose ${field} is neither null nor a non-empty string; got ${JSON.stringify(snapshot[field])}`;
		}
	}
	return null;
}

// The ledger append ceiling: refuse an event that would grow the ledger past
// its bound BEFORE any durable state is touched (shared discipline with the
// principal and evidence registries through registry-ledger).
function appendWithinCeiling(cwd, event) {
	return sharedAppendWithinCeiling({
		ledgerPath: approvalLedgerPath(cwd),
		event,
		envName: "AMBER_APPROVAL_MAX_REGISTRY_BYTES",
		defaultBytes: DEFAULT_MAX_APPROVAL_BYTES,
		label: "approval registry",
	});
}

/**
 * Resolve one acting human (grant approver or revoke revoker) against the
 * Principal registry: registered, unrevoked, inside its validity window at
 * the caller's clock, and HUMAN — an Approval and its revocation are
 * human-only acts (mirroring the Decision human-slot discipline). Registry
 * failures propagate the registry's own codes; a non-human principal fails
 * with AMBER_E_APPROVAL_HUMAN_SLOT_REQUIRED.
 * @returns {{ok: true, principal: object} | {ok: false, code: string, message: string}}
 */
function resolveActingHuman(cwd, principalId, label, now) {
	let resolved;
	try {
		resolved = resolveActivePrincipal(cwd, principalId, { now });
	} catch (err) {
		return { ok: false, code: err.amberCode || REGISTRY_CORRUPT_CODE, message: err.message };
	}
	if (!resolved.ok) return { ok: false, code: resolved.code, message: resolved.message };
	if (resolved.principal.principalKind !== "human") {
		return {
			ok: false,
			code: HUMAN_SLOT_REQUIRED_CODE,
			message: `${label} must be a human principal, but "${principalId}" is a ${resolved.principal.principalKind} identity; an Approval is a human-only authorization slot — agents and service identities cannot grant, revoke, or hold one (mirroring the acceptance/approval Decision discipline)`,
		};
	}
	return { ok: true, principal: resolved.principal };
}

/**
 * Grant one Approval: validate the input, verify the approver against the
 * Principal registry (human-only), freeze the snapshot, and append one
 * immutable `granted` event with the half-open validity window
 * [validAt, validUntil) — validAt opens at the grant instant, validUntil is
 * the caller-declared expiry, and recordedAt is the write instant (distinct
 * fields, one clock). An approval id is granted at most once.
 * @param {string} cwd - Repository root.
 * @param {object} input - { id, approver, scope, subject, validUntil }.
 * @param {object} [opts] - { now } clock injection.
 * @returns {{ok: boolean, code: string|null, approval: object|null, errors: string[]}}
 */
function grantApproval(cwd, { id, approver, scope = null, subject, validUntil }, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, approval: null, errors });
	const now = writeClockOf(opts);
	const inputProblem = grantInputProblem({ id, approver, scope, subject, validUntil });
	if (inputProblem !== null) return fail(INVALID_ARG_CODE, [inputProblem]);
	// The half-open window must be non-empty: validUntil strictly after the
	// grant instant (validAt is the write instant). A born-expired or
	// inverted grant is malformed input, never a silently dead
	// authorization — the same window contract as the principal registry
	// (review F-2).
	const until = parseTimestamp(validUntil);
	if (until !== null && until <= now.getTime()) {
		return fail(INVALID_ARG_CODE, [
			`validUntil must fall strictly after the grant instant (${now.toISOString()}); the validity window is half-open [validAt, validUntil) and must be non-empty — got ${JSON.stringify(validUntil)}, which is already expired at grant time`,
		]);
	}

	const acting = resolveActingHuman(cwd, approver, "an Approval's approver", now);
	if (!acting.ok) return fail(acting.code, [acting.message]);

	let current;
	try {
		current = foldApprovals(cwd);
	} catch (err) {
		return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
	}
	if (current.some((record) => record.id === id)) {
		return fail(ALREADY_GRANTED_CODE, [
			`approval "${id}" is already granted; an approval id is granted exactly once (a re-grant is a new id) — grant a distinct id instead`,
		]);
	}

	const at = now.toISOString();
	const body = {
		kind: "granted",
		schemaVersion: APPROVAL_SCHEMA_VERSION,
		at,
		approvalId: id,
		approver: Object.freeze({ ...acting.principal }),
		scope,
		subject,
		// F050: validAt (when the window opens) and recordedAt (when the
		// record was written) are distinct, semantically separate fields —
		// both are stored, both from the one write clock.
		validAt: at,
		validUntil,
		recordedAt: at,
		clockSource: clockSourceOf(opts),
		skewPolicy: SKEW_POLICY,
	};
	let ceilingCheck;
	try {
		ceilingCheck = appendWithinCeiling(cwd, body);
	} catch (err) {
		return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
	}
	if (ceilingCheck.wouldExceed) {
		return fail(SIZE_CEILING_CODE, [
			`appending the grant for "${id}" would grow the approval registry beyond its size ceiling of ${ceilingCheck.ceiling} bytes (AMBER_APPROVAL_MAX_REGISTRY_BYTES); the write is refused before any durable state is touched — raise the ceiling deliberately`,
		]);
	}
	let release;
	try {
		release = acquireApprovalLock(cwd);
	} catch (err) {
		return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
	}
	let granted;
	try {
		// Under the lock, re-check the exact invariants the fold enforces: the
		// duplicate id (a racing writer appended between the pre-check and the
		// lock) and the ledger's integrity.
		let fresh;
		try {
			fresh = foldApprovals(cwd);
		} catch (err) {
			return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
		}
		if (fresh.some((record) => record.id === id)) {
			return fail(ALREADY_GRANTED_CODE, [
				`approval "${id}" is already granted; an approval id is granted exactly once — grant a distinct id instead`,
			]);
		}
		const prevHash = chainHeadHashOf(cwd);
		const event = { ...body, prevHash, hash: chainHash(body, prevHash) };
		// The real event carries the chain fields the pre-lock check could not
		// count (and the file may have grown while waiting for the lock).
		const underLockCeiling = appendWithinCeiling(cwd, event);
		if (underLockCeiling.wouldExceed) {
			return fail(SIZE_CEILING_CODE, [
				`appending the grant for "${id}" would grow the approval registry beyond its size ceiling of ${underLockCeiling.ceiling} bytes (AMBER_APPROVAL_MAX_REGISTRY_BYTES); the write is refused before any durable state is touched — raise the ceiling deliberately`,
			]);
		}
		try {
			appendJSONL(approvalLedgerPath(cwd), event);
		} catch (err) {
			return fail(REGISTRY_CORRUPT_CODE, [
				`failed to append the granted event for "${id}" to the approval registry: ${err.message}`,
			]);
		}
		granted = {
			id,
			approver: body.approver,
			scope,
			subject,
			validAt: body.validAt,
			validUntil,
			recordedAt: body.recordedAt,
			revokedAt: null,
			revoker: null,
			consumedAt: null,
			decisionIdentity: null,
			decisionRevision: null,
		};
	} finally {
		release();
	}
	return { ok: true, code: null, approval: withStatus(granted, now), errors: [] };
}

/**
 * Revoke one Approval: append one immutable `revoked` event carrying the
 * revoker (a registry-verified human snapshot). Revocation is terminal and
 * history is never rewritten: revoking an already-revoked or already-consumed
 * approval fails with its own stable code (consumption is terminal).
 * @param {string} cwd - Repository root.
 * @param {object} input - { id, revoker }.
 * @param {object} [opts] - { now } clock injection.
 * @returns {{ok: boolean, code: string|null, approval: object|null, errors: string[]}}
 */
function revokeApproval(cwd, { id, revoker }, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, approval: null, errors });
	const now = writeClockOf(opts);
	if (typeof id !== "string" || id.trim().length === 0) {
		return fail(INVALID_ARG_CODE, [
			`approval id must be a non-empty string; got ${JSON.stringify(id)}`,
		]);
	}
	if (typeof revoker !== "string" || revoker.trim().length === 0) {
		return fail(INVALID_ARG_CODE, [
			`revoker is required: a revocation is a human act, verified against the Principal registry (e.g. --revoker alice@example.com); got ${JSON.stringify(revoker)}`,
		]);
	}
	const acting = resolveActingHuman(cwd, revoker, "an Approval's revoker", now);
	if (!acting.ok) return fail(acting.code, [acting.message]);

	let current;
	try {
		current = foldApprovals(cwd);
	} catch (err) {
		return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
	}
	const existing = current.find((record) => record.id === id);
	if (!existing) {
		return fail(NOT_FOUND_CODE, [
			`approval "${id}" is not recorded; revocation applies to a granted approval — grant it first (amber approval grant)`,
		]);
	}
	if (existing.revokedAt !== null) {
		return fail(ALREADY_REVOKED_CODE, [
			`approval "${id}" was already revoked at ${existing.revokedAt}; revocation is terminal`,
		]);
	}
	if (existing.consumedAt !== null) {
		return fail(ALREADY_CONSUMED_CODE, [
			`approval "${id}" was already consumed at ${existing.consumedAt} by decision "${existing.decisionIdentity}" (revision ${existing.decisionRevision}); consumption is terminal and history is not rewritten — the spent authorization cannot be revoked afterwards`,
		]);
	}

	const at = now.toISOString();
	const body = {
		kind: "revoked",
		schemaVersion: APPROVAL_SCHEMA_VERSION,
		at,
		approvalId: id,
		revoker: Object.freeze({ ...acting.principal }),
		clockSource: clockSourceOf(opts),
		skewPolicy: SKEW_POLICY,
	};
	let ceilingCheck;
	try {
		ceilingCheck = appendWithinCeiling(cwd, body);
	} catch (err) {
		return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
	}
	if (ceilingCheck.wouldExceed) {
		return fail(SIZE_CEILING_CODE, [
			`appending the revocation for "${id}" would grow the approval registry beyond its size ceiling of ${ceilingCheck.ceiling} bytes (AMBER_APPROVAL_MAX_REGISTRY_BYTES); the write is refused before any durable state is touched`,
		]);
	}
	let release;
	try {
		release = acquireApprovalLock(cwd);
	} catch (err) {
		return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
	}
	try {
		// Under the lock, re-check the invariants the fold enforces: the
		// target still exists and has not been revoked or consumed by a
		// racing writer that appended between the pre-check and the lock.
		let fresh;
		try {
			fresh = foldApprovals(cwd);
		} catch (err) {
			return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
		}
		const target = fresh.find((record) => record.id === id);
		if (!target) {
			return fail(NOT_FOUND_CODE, [
				`approval "${id}" is not recorded; revocation applies to a granted approval — grant it first (amber approval grant)`,
			]);
		}
		if (target.revokedAt !== null) {
			return fail(ALREADY_REVOKED_CODE, [
				`approval "${id}" was already revoked at ${target.revokedAt}; revocation is terminal`,
			]);
		}
		if (target.consumedAt !== null) {
			return fail(ALREADY_CONSUMED_CODE, [
				`approval "${id}" was already consumed at ${target.consumedAt}; consumption is terminal and history is not rewritten`,
			]);
		}
		const prevHash = chainHeadHashOf(cwd);
		const event = { ...body, prevHash, hash: chainHash(body, prevHash) };
		const underLockCeiling = appendWithinCeiling(cwd, event);
		if (underLockCeiling.wouldExceed) {
			return fail(SIZE_CEILING_CODE, [
				`appending the revocation for "${id}" would grow the approval registry beyond its size ceiling of ${underLockCeiling.ceiling} bytes (AMBER_APPROVAL_MAX_REGISTRY_BYTES); the write is refused before any durable state is touched`,
			]);
		}
		try {
			appendJSONL(approvalLedgerPath(cwd), event);
		} catch (err) {
			return fail(REGISTRY_CORRUPT_CODE, [
				`failed to append the revoked event for "${id}" to the approval registry: ${err.message}`,
			]);
		}
	} finally {
		release();
	}
	return {
		ok: true,
		code: null,
		approval: withStatus(
			{
				...existing,
				revokedAt: at,
				revoker: Object.freeze({ ...acting.principal }),
			},
			now,
		),
		errors: [],
	};
}

/**
 * Consume one Approval: the atomic settlement of the authorization and its
 * authorized Decision. Under the approvals registry lock the approval is
 * re-verified (granted, unrevoked, unconsumed, inside its half-open window
 * at the evaluation clock), the Decision artifact is admitted
 * (decisionKind "approval", principal = the approval's frozen approver —
 * the approval IS the human authorization, so the caller passes no
 * principal), and only then is the single-use `consumed` event appended,
 * binding the Decision's identity and revision from the admission receipt.
 *
 * If the Decision admission fails, NO consumed event is written and the
 * authorization stays unconsumed (the admission's own code is reported). A
 * second consumer — racing or serial — fails closed with
 * AMBER_E_APPROVAL_ALREADY_CONSUMED, checked both pre-lock and under the
 * lock: one authorization can never be replayed.
 *
 * Scope confinement: when the approval carries a scope, the Decision is
 * admitted with that scope (an explicitly passed conflicting scope is an
 * argument error).
 *
 * Lock ordering: approvals lock THEN the artifact admission lock, never the
 * reverse — no artifact-store path takes the approvals lock, so the
 * nested admission cannot deadlock.
 *
 * @param {string} cwd - Repository root.
 * @param {object} input - { id, decisionIdentity, body, traces, scope }.
 * @param {object} [opts] - { now } clock injection.
 * @returns {{ok: boolean, code: string|null, approval: object|null,
 *           receipt: object|null, errors: string[]}}
 */
function consumeApproval(
	cwd,
	{ id, decisionIdentity, body, traces = [], scope = null },
	opts = {},
) {
	const fail = (code, errors) => ({ ok: false, code, approval: null, receipt: null, errors });
	const now = writeClockOf(opts);
	if (typeof id !== "string" || id.trim().length === 0) {
		return fail(INVALID_ARG_CODE, [
			`approval id must be a non-empty string; got ${JSON.stringify(id)}`,
		]);
	}
	if (typeof decisionIdentity !== "string" || decisionIdentity.trim().length === 0) {
		return fail(INVALID_ARG_CODE, [
			`decisionIdentity is required: consumption settles one named Decision artifact (e.g. --decision-identity decision/login-approved); got ${JSON.stringify(decisionIdentity)}`,
		]);
	}
	if (typeof body !== "string" || body.trim().length === 0) {
		return fail(INVALID_ARG_CODE, [
			`body is required: the settled Decision carries a human-readable Body; got ${JSON.stringify(body)}`,
		]);
	}

	// Pre-lock: the lifecycle verdict and the scope confinement — before any
	// durable state is touched. (The ceiling probe deliberately does NOT run
	// here: only the under-lock probe below is authoritative, because a
	// pre-lock probe cannot account for appends racing it onto the ledger.)
	let current;
	try {
		current = foldApprovals(cwd);
	} catch (err) {
		return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
	}
	const verdict = consumptionVerdict(current, id, now);
	if (!verdict.ok) return fail(verdict.code, [verdict.message]);
	const scopeVerdict = decisionScopeOf(verdict.target, scope);
	if (scopeVerdict.error !== null) return fail(INVALID_ARG_CODE, [scopeVerdict.error]);

	const at = now.toISOString();

	let release;
	try {
		release = acquireApprovalLock(cwd);
	} catch (err) {
		return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
	}
	try {
		// Under the lock, re-fold and re-verify every invariant: a racing
		// consumer (or revocation) may have appended between the pre-check
		// and the lock.
		let fresh;
		try {
			fresh = foldApprovals(cwd);
		} catch (err) {
			return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
		}
		const locked = consumptionVerdict(fresh, id, now);
		if (!locked.ok) return fail(locked.code, [locked.message]);
		const target = locked.target;
		const lockedScope = decisionScopeOf(target, scope);
		if (lockedScope.error !== null) return fail(INVALID_ARG_CODE, [lockedScope.error]);

		// The consumed line's exact length depends on the admission's revision
		// and on the chain fields — all of which exist only after the Decision
		// settles. The ceiling probe therefore runs UNDER the lock and BEFORE
		// the admission, padded with structurally dominating dummies: a
		// 10-digit revision (every realistic head) and 64-char hex chain
		// placeholders exactly as long as the real prevHash/hash. A probe that
		// passes cannot hide an exact line that would refuse, so the Decision
		// is never admitted into an approval whose consumption cannot be
		// recorded (review F-1: the pre-fix probe omitted the chain fields and
		// could orphan a settled Decision into a near-saturated ledger).
		const ceilingProbe = {
			kind: "consumed",
			schemaVersion: APPROVAL_SCHEMA_VERSION,
			at,
			approvalId: id,
			decisionIdentity,
			decisionRevision: 9_999_999_999,
			clockSource: clockSourceOf(opts),
			skewPolicy: SKEW_POLICY,
			prevHash: "0".repeat(64),
			hash: "0".repeat(64),
		};
		let probe;
		try {
			probe = appendWithinCeiling(cwd, ceilingProbe);
		} catch (err) {
			return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
		}
		if (probe.wouldExceed) {
			return fail(SIZE_CEILING_CODE, [
				`appending the consumption event for "${id}" would grow the approval registry beyond its size ceiling of ${probe.ceiling} bytes (AMBER_APPROVAL_MAX_REGISTRY_BYTES); the write is refused before any durable state is touched — raise the ceiling deliberately`,
			]);
		}

		// The Decision admission runs UNDER the approvals lock: consumption
		// and settlement are one transaction. The artifact store takes only
		// its own admission lock (never the approvals lock), so this nesting
		// is deadlock-free. The approver id from the frozen grant snapshot is
		// the acting principal — the approval IS the human authorization, and
		// admitArtifact re-verifies it against the registry (double
		// verification; both must pass).
		const admission = admitArtifact(cwd, {
			type: "decision",
			identity: decisionIdentity,
			body,
			decisionKind: "approval",
			principal: target.approver.id,
			scope: lockedScope.value,
			traces,
		});
		if (!admission.ok) {
			// No consumed event is written; the approval stays unconsumed.
			return fail(admission.code, admission.errors);
		}
		const decisionRevision = admission.receipt.revision;

		const eventBody = {
			kind: "consumed",
			schemaVersion: APPROVAL_SCHEMA_VERSION,
			at,
			approvalId: id,
			decisionIdentity,
			decisionRevision,
			clockSource: clockSourceOf(opts),
			skewPolicy: SKEW_POLICY,
		};
		const prevHash = chainHeadHashOf(cwd);
		const event = { ...eventBody, prevHash, hash: chainHash(eventBody, prevHash) };
		// Belt-and-braces on the exact chained event. Structurally
		// unreachable: the dominating probe above already refused a ledger
		// that could not hold a line at least this long, and both run under
		// the lock against the same file size. If it ever fires after a
		// successful admission, the Decision is orphaned — surfaced by name,
		// never silently dropped.
		const underLockCeiling = appendWithinCeiling(cwd, event);
		if (underLockCeiling.wouldExceed) {
			return fail(SIZE_CEILING_CODE, [
				`appending the consumption event for "${id}" would grow the approval registry beyond its size ceiling of ${underLockCeiling.ceiling} bytes (AMBER_APPROVAL_MAX_REGISTRY_BYTES); decision "${decisionIdentity}" (revision ${decisionRevision}) was admitted but its consumption could not be recorded — the approval reads as unconsumed: raise the ceiling and settle a fresh Decision under a new approval id`,
			]);
		}
		try {
			appendJSONL(approvalLedgerPath(cwd), event);
		} catch (err) {
			return fail(REGISTRY_CORRUPT_CODE, [
				`failed to append the consumed event for "${id}" to the approval registry: ${err.message}; decision "${decisionIdentity}" (revision ${decisionRevision}) was admitted but its consumption could not be recorded — the approval reads as unconsumed`,
			]);
		}
		return {
			ok: true,
			code: null,
			approval: withStatus(
				{
					...target,
					consumedAt: at,
					decisionIdentity,
					decisionRevision,
				},
				now,
			),
			receipt: admission.receipt,
			errors: [],
		};
	} finally {
		release();
	}
}

/**
 * The scope-confinement verdict for one consumption: when the approval
 * carries a scope, the Decision is admitted with that same scope — an
 * explicitly conflicting scope is an argument error (a scoped authorization
 * cannot decide outside its scope). An unscoped approval leaves the Decision
 * scope to the caller.
 * @returns {{value: string|null, error: string|null}}
 */
function decisionScopeOf(target, scope) {
	if (target.scope === null) return { value: scope ?? null, error: null };
	if (scope !== null && scope !== target.scope) {
		return {
			value: null,
			error: `approval "${target.id}" is scoped to ${JSON.stringify(target.scope)}, but the Decision was to be admitted with scope ${JSON.stringify(scope)}; a scoped authorization cannot decide outside its scope — admit the Decision with the approval's scope or not at all`,
		};
	}
	return { value: target.scope, error: null };
}

/**
 * The current status of one approval record against a clock: consumption is
 * terminal, revocation wins over the validity window, and the window is
 * half-open [validAt, validUntil) — "expired" is derived at read time and
 * never stored.
 * @param {object} record - A folded approval record.
 * @param {Date|number} [now] - Clock to evaluate against.
 * @returns {"granted"|"revoked"|"consumed"|"expired"}
 */
function approvalStatus(record, now = new Date()) {
	if (record.consumedAt !== null) return "consumed";
	if (record.revokedAt !== null) return "revoked";
	const at = clockMillis(now);
	const until = parseTimestamp(record.validUntil);
	if (until !== null && at >= until) return "expired";
	return "granted";
}

function withStatus(record, now) {
	return { ...record, status: approvalStatus(record, now) };
}

/**
 * Show one derived approval record (or null when the id is not recorded).
 * The status is derived against the read clock (an optional injected one).
 * @throws {Error} Typed AMBER_E_* on a corrupt ledger.
 */
function showApproval(cwd, id, opts = {}) {
	for (const record of foldApprovals(cwd)) {
		if (record.id === id) return withStatus(record, opts.now ?? new Date());
	}
	return null;
}

/**
 * List every derived approval record in grant order, statuses derived
 * against the read clock (an optional injected one).
 * @throws {Error} Typed AMBER_E_* on a corrupt ledger.
 */
function listApprovals(cwd, opts = {}) {
	return foldApprovals(cwd).map((record) => withStatus(record, opts.now ?? new Date()));
}

module.exports = {
	APPROVAL_SCHEMA_VERSION,
	SUPPORTED_APPROVAL_SCHEMA_VERSIONS,
	SKEW_POLICY,
	CLOCK_SOURCES,
	DEFAULT_MAX_APPROVAL_BYTES,
	GENESIS_HASH,
	chainHash,
	grantApproval,
	revokeApproval,
	consumeApproval,
	showApproval,
	listApprovals,
};
