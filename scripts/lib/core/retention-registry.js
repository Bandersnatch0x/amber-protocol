"use strict";

// F055 T1 (#283) — retention classes & deterministic expiry evaluation.
// F055 T2 (#284) — Legal Hold registry with human-only lifecycle.
//
// Report-only eligibility becomes governed classification: each admitted
// record binds one protocol-defined retention class whose TTL and legal
// basis resolve from a committed, versioned tenant retention Policy at
// classification time — never from a live re-interpretation. Expiry
// evaluation is deterministic and read-only against an injected clock.
// Declared secret or personal raw content refuses classification unless
// an explicit minimization marker rides the event: deletion is not the
// first privacy control, and unsafe raw content never enters a ledger.
//
// A Legal Hold binds scope, reason, and issuer behind single-use
// committed human Decisions for both creation and release. Holds have
// priority over TTL: evaluation reports a held record as retained-by-hold
// regardless of expiry, naming the hold — no silent bypass, no invisible
// permanent exception, and a released hold stays listable forever.
//
// Deletion (F055 T3, #285) starts as review, never as action: a
// registered Holder declares one copy-holding surface with its Adapter
// capability pin, and a deletion candidate is a governance-write that
// enumerates exact expired-eligible records, their retention basis, the
// Legal Hold exclusions, every registered Holder, and the proposed
// per-Holder effects — content is never touched. Authorization consumes
// one scoped Approval bound to the candidate's canonical hash; any drift
// in what was reviewed refuses the authorization.
//
// Settlement (F055 T4, #286) can never overclaim: an authorized candidate
// opens one deletion transaction, every registered Holder settles
// independently through a declared receipt, and the transaction reads
// deletion-pending while ANY Holder is unsettled. A retry re-targets only
// unsettled Holders — a settled Holder's effects can never repeat. The
// minimal Deletion Proof derives read-only from full coverage and carries
// a controlled salted fingerprint, never a reconstructable public content
// hash and never deleted content. Deleted records project as tombstones,
// and a tombstoned subject refuses Gate evaluation: historical existence
// is not current proof.

const crypto = require("node:crypto");
const path = require("node:path");

const { readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { typedError } = require("./error-catalog");
const { listArtifactRevisions, ARTIFACT_TYPES } = require("./canonical-artifacts");
const { canonicalJson } = require("./context-hash");
const { showAdapter } = require("./adapter-registry");
const { consumeSubjectBoundApproval } = require("./approval-registry");
const {
	GENESIS_HASH,
	chainHash,
	acquireLedgerLock,
	appendLedgerEvent,
	credentialLeakProblem,
	chainLinkProblem,
	isPlainObject,
	isNonEmptyString,
	closedFieldProblem,
	unknownFieldProblem,
	decisionPinProblem,
	resolveRegistrationDecision,
} = require("./registry-ledger");

const RETENTION_SCHEMA_VERSION = 1;
const SUPPORTED_RETENTION_SCHEMA_VERSIONS = Object.freeze([1]);
const DEFAULT_MAX_RETENTION_BYTES = 1024 * 1024;
// TTLs are bounded (100 years) so classifiedAt + ttlMs can never overflow
// the Date range and crash evaluation instead of failing closed.
const MAX_RETENTION_TTL_MS = 100 * 365 * 24 * 3_600_000;
const LOCK_STALE_MS = 30_000;

// Protocol-defined retention classes with fixed semantics; TTL and legal
// basis are NOT defined here — they resolve from the pinned tenant Policy.
//   ephemeral   — short-lived working data, expected to expire quickly
//   operational — day-to-day operational records
//   governance  — governance records (decisions, evidence, ledgers)
//   audit       — audit-trail records retained for accountability
const RETENTION_CLASSES = Object.freeze(["ephemeral", "operational", "governance", "audit"]);
// Declared content sensitivity: anything above "none" must be minimized
// before it may be classified for storage.
const RETENTION_SENSITIVITIES = Object.freeze(["none", "secret", "personal"]);

const RETENTION_INVALID_CODE = "AMBER_E_RETENTION_INVALID";
const RETENTION_LEAK_CODE = "AMBER_E_RETENTION_CREDENTIAL_LEAK";
const RETENTION_NOT_FOUND_CODE = "AMBER_E_RETENTION_NOT_FOUND";
const RETENTION_CORRUPT_CODE = "AMBER_E_RETENTION_CORRUPT";
const RETENTION_LOCK_CODE = "AMBER_E_RETENTION_LOCK";
const RETENTION_SIZE_CEILING_CODE = "AMBER_E_RETENTION_SIZE_CEILING";
const HOLD_CORRUPT_CODE = "AMBER_E_RETENTION_HOLD_CORRUPT";
const HOLD_LOCK_CODE = "AMBER_E_RETENTION_HOLD_LOCK";
const HOLD_SIZE_CEILING_CODE = "AMBER_E_RETENTION_HOLD_SIZE_CEILING";
const HOLDER_CORRUPT_CODE = "AMBER_E_RETENTION_HOLDER_CORRUPT";
const HOLDER_LOCK_CODE = "AMBER_E_RETENTION_HOLDER_LOCK";
const HOLDER_SIZE_CEILING_CODE = "AMBER_E_RETENTION_HOLDER_SIZE_CEILING";
const CANDIDATE_CORRUPT_CODE = "AMBER_E_RETENTION_CANDIDATE_CORRUPT";
const CANDIDATE_LOCK_CODE = "AMBER_E_RETENTION_CANDIDATE_LOCK";
const CANDIDATE_SIZE_CEILING_CODE = "AMBER_E_RETENTION_CANDIDATE_SIZE_CEILING";
const RETENTION_DRIFT_CODE = "AMBER_E_RETENTION_DRIFT";
const TX_CORRUPT_CODE = "AMBER_E_RETENTION_TX_CORRUPT";
const TX_LOCK_CODE = "AMBER_E_RETENTION_TX_LOCK";
const TX_SIZE_CEILING_CODE = "AMBER_E_RETENTION_TX_SIZE_CEILING";

// Human-only authority slots, mirroring the F050/F052/F054 contract.
const RETENTION_DECISION_KINDS = Object.freeze(["acceptance", "approval"]);
const HOLD_STATUSES = Object.freeze(["active", "released"]);
// The closed copy-holding surface vocabulary a Holder may declare.
const HOLDER_SURFACES = Object.freeze([
	"canonical-body",
	"raw-output",
	"cache",
	"index",
	"export",
	"subscription",
	"external",
]);
const CANDIDATE_STATUSES = Object.freeze(["prepared", "authorized"]);
// A Holder settles independently; only "settled" counts toward coverage.
const SETTLEMENT_STATUSES = Object.freeze(["settled", "refused", "failed", "unavailable"]);
const TRANSACTION_STATUSES = Object.freeze(["deletion-pending", "completed"]);

const CLASSIFY_INPUT_FIELDS = Object.freeze([
	"record",
	"retentionClass",
	"policy",
	"sensitivity",
	"minimized",
]);
const RECORD_FIELDS = Object.freeze(["type", "identity", "revision"]);
const POLICY_PIN_FIELDS = Object.freeze(["identity", "revision"]);
const CLASSIFICATION_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"record",
	"retentionClass",
	"ttlMs",
	"legalBasis",
	"policy",
	"sensitivity",
	"minimized",
	"prevHash",
	"hash",
]);

function classificationsPath(cwd) {
	return statePathForCreate(cwd, "retention", "classifications.jsonl");
}

function retentionCorrupt(message) {
	return typedError(RETENTION_CORRUPT_CODE, message);
}

function acquireClassificationLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(classificationsPath(cwd)),
		lockName: "classifications.lock",
		conflictCode: RETENTION_LOCK_CODE,
		corruptCode: RETENTION_CORRUPT_CODE,
		label: "retention classification ledger",
		staleMs: LOCK_STALE_MS,
	});
}

function recordPinProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, RECORD_FIELDS, label);
	if (closed !== null) return closed;
	if (!ARTIFACT_TYPES.includes(value.type))
		return `${label}.type must be one of ${ARTIFACT_TYPES.join(", ")}`;
	if (!isNonEmptyString(value.identity)) return `${label}.identity must be a non-empty string`;
	if (!Number.isInteger(value.revision) || value.revision < 1)
		return `${label}.revision must be a positive integer`;
	return null;
}

function policyPinProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object carrying identity and revision`;
	const closed = closedFieldProblem(value, POLICY_PIN_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(value.identity)) return `${label}.identity must be a non-empty string`;
	if (!Number.isInteger(value.revision) || value.revision < 1)
		return `${label}.revision must be a positive integer`;
	return null;
}

function classificationEventProblem(event, lineIndex) {
	const label = `retention classification event ${lineIndex}`;
	const closed = closedFieldProblem(event, CLASSIFICATION_EVENT_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at) || Number.isNaN(Date.parse(event.at)))
		return `${label}.at must be an ISO-8601 timestamp`;
	const record = recordPinProblem(event.record, `${label}.record`);
	if (record !== null) return record;
	if (!RETENTION_CLASSES.includes(event.retentionClass))
		return `${label}.retentionClass must be one of ${RETENTION_CLASSES.join(", ")}`;
	if (!Number.isInteger(event.ttlMs) || event.ttlMs < 1 || event.ttlMs > MAX_RETENTION_TTL_MS)
		return `${label}.ttlMs must be a positive integer no greater than ${MAX_RETENTION_TTL_MS}`;
	if (!isNonEmptyString(event.legalBasis)) return `${label}.legalBasis must be a non-empty string`;
	const policy = policyPinProblem(event.policy, `${label}.policy`);
	if (policy !== null) return policy;
	if (!RETENTION_SENSITIVITIES.includes(event.sensitivity))
		return `${label}.sensitivity must be one of ${RETENTION_SENSITIVITIES.join(", ")}`;
	if (typeof event.minimized !== "boolean") return `${label}.minimized must be a boolean`;
	if (event.sensitivity !== "none" && event.minimized !== true)
		return `${label} declares ${event.sensitivity} content without a minimization marker`;
	if (event.sensitivity === "none" && event.minimized !== false)
		return `${label} carries a minimization marker without declared sensitive content`;
	return null;
}

function recordKey(record) {
	return `${record.type}:${record.identity}@${record.revision}`;
}

function foldClassifications(cwd) {
	const events = readLedgerFailClosed(
		classificationsPath(cwd),
		RETENTION_CORRUPT_CODE,
		"retention classification ledger",
	);
	let prevHash = GENESIS_HASH;
	const classifications = [];
	events.forEach((event, index) => {
		const lineIndex = index + 1;
		const link = chainLinkProblem(event, prevHash, lineIndex, "retention classification");
		if (link !== null) throw retentionCorrupt(link);
		if (!SUPPORTED_RETENTION_SCHEMA_VERSIONS.includes(event.schemaVersion))
			throw retentionCorrupt(
				`retention classification event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		if (event.kind !== "classification")
			throw retentionCorrupt(
				`retention classification event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
			);
		const problem = classificationEventProblem(event, lineIndex);
		if (problem !== null) throw retentionCorrupt(problem);
		const { prevHash: _prev, hash: _hash, ...body } = event;
		classifications.push({ ...body, index });
		prevHash = event.hash;
	});
	return classifications;
}

const CLASSIFICATION_LEDGER = Object.freeze({
	acquire: acquireClassificationLock,
	fold: foldClassifications,
	path: classificationsPath,
	corruptCode: RETENTION_CORRUPT_CODE,
	sizeCeilingCode: RETENTION_SIZE_CEILING_CODE,
	envName: "AMBER_RETENTION_MAX_CLASSIFICATIONS_BYTES",
	defaultBytes: DEFAULT_MAX_RETENTION_BYTES,
	label: "retention classification ledger",
});

// The effective retention basis a committed tenant Policy declares for one
// class, carried in the Policy revision's extensions carrier under the
// `retention` namespace: { classes: { <class>: { ttlMs, legalBasis } } }.
function resolvePolicyBasis(revisions, pin, retentionClass) {
	const match = revisions.find(
		(revision) =>
			revision.type === "policy" &&
			revision.identity === pin.identity &&
			revision.revision === pin.revision,
	);
	if (!match)
		return {
			problem: `policy ${JSON.stringify(pin.identity)}@${pin.revision} does not resolve to a committed policy artifact revision`,
		};
	const declared = match.envelope?.extensions?.retention?.classes ?? null;
	if (!isPlainObject(declared))
		return {
			problem: `policy ${JSON.stringify(pin.identity)}@${pin.revision} declares no retention classes in its extensions carrier`,
		};
	const basis = declared[retentionClass];
	if (!isPlainObject(basis))
		return {
			problem: `policy ${JSON.stringify(pin.identity)}@${pin.revision} declares no basis for retention class ${JSON.stringify(retentionClass)}`,
		};
	if (!Number.isInteger(basis.ttlMs) || basis.ttlMs < 1 || basis.ttlMs > MAX_RETENTION_TTL_MS)
		return {
			problem: `policy ${JSON.stringify(pin.identity)}@${pin.revision} declares an out-of-range ttlMs for ${JSON.stringify(retentionClass)}; it must be a positive integer no greater than ${MAX_RETENTION_TTL_MS}`,
		};
	if (!isNonEmptyString(basis.legalBasis))
		return {
			problem: `policy ${JSON.stringify(pin.identity)}@${pin.revision} declares no legalBasis for ${JSON.stringify(retentionClass)}`,
		};
	return { basis: { ttlMs: basis.ttlMs, legalBasis: basis.legalBasis } };
}

/**
 * Classify one committed record: the effective class, TTL, and legal
 * basis bind at classification time from the pinned committed tenant
 * Policy. Re-classification appends a new event — the latest
 * classification per record is effective; nothing is ever edited.
 * Deliberate T1 latitude: the governing authority is the committed
 * versioned Policy pin (per the AC), not a per-event human Decision —
 * the actor-bound retention writes (Legal Hold, deletion authorization)
 * arrive in T2/T3 with the F052-style Decision contract.
 */
function classify(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(RETENTION_INVALID_CODE, ["classify input must be an object"]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(RETENTION_INVALID_CODE, ["now must be a valid clock"]);
	const inputClosed = unknownFieldProblem(input, CLASSIFY_INPUT_FIELDS, "classify input");
	if (inputClosed !== null) return fail(RETENTION_INVALID_CODE, [inputClosed]);
	const recordProblem = recordPinProblem(input.record, "record");
	if (recordProblem !== null) return fail(RETENTION_INVALID_CODE, [recordProblem]);
	if (!RETENTION_CLASSES.includes(input.retentionClass))
		return fail(RETENTION_INVALID_CODE, [
			`retentionClass must be one of ${RETENTION_CLASSES.join(", ")}`,
		]);
	const policyProblem = policyPinProblem(input.policy, "policy");
	if (policyProblem !== null) return fail(RETENTION_INVALID_CODE, [policyProblem]);
	const sensitivity = input.sensitivity ?? "none";
	if (!RETENTION_SENSITIVITIES.includes(sensitivity))
		return fail(RETENTION_INVALID_CODE, [
			`sensitivity must be one of ${RETENTION_SENSITIVITIES.join(", ")}`,
		]);
	const minimized = input.minimized ?? false;
	if (typeof minimized !== "boolean")
		return fail(RETENTION_INVALID_CODE, ["minimized must be a boolean"]);
	// Deletion is not the first privacy control: declared secret or
	// personal content refuses classification unless it was minimized
	// before storage, and the marker is meaningless without sensitivity.
	if (sensitivity !== "none" && !minimized)
		return fail(RETENTION_INVALID_CODE, [
			`declared ${sensitivity} content must be minimized before classification; unsafe raw content never rides a ledger`,
		]);
	if (sensitivity === "none" && minimized)
		return fail(RETENTION_INVALID_CODE, [
			"a minimization marker requires declared secret or personal sensitivity",
		]);
	let revisions;
	try {
		revisions = listArtifactRevisions(cwd);
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_ARTIFACT_JOURNAL_CORRUPT", [err.message || String(err)]);
	}
	const committed = revisions.find(
		(revision) =>
			revision.type === input.record.type &&
			revision.identity === input.record.identity &&
			revision.revision === input.record.revision,
	);
	if (!committed)
		return fail(RETENTION_NOT_FOUND_CODE, [
			`record ${JSON.stringify(recordKey(input.record))} does not resolve to a committed artifact revision`,
		]);
	const resolved = resolvePolicyBasis(revisions, input.policy, input.retentionClass);
	if (resolved.problem) return fail(RETENTION_INVALID_CODE, [resolved.problem]);
	const at = now.toISOString();
	return appendLedgerEvent(
		cwd,
		CLASSIFICATION_LEDGER,
		{
			kind: "classification",
			schemaVersion: RETENTION_SCHEMA_VERSION,
			at,
			record: {
				type: input.record.type,
				identity: input.record.identity,
				revision: input.record.revision,
			},
			retentionClass: input.retentionClass,
			ttlMs: resolved.basis.ttlMs,
			legalBasis: resolved.basis.legalBasis,
			policy: { identity: input.policy.identity, revision: input.policy.revision },
			sensitivity,
			minimized,
		},
		() => null,
		(fold) =>
			[...fold].reverse().find((entry) => recordKey(entry.record) === recordKey(input.record)),
	);
}

// The effective (latest) classification per record key, in ledger order.
function effectiveClassifications(fold) {
	const byKey = new Map();
	for (const entry of fold) byKey.set(recordKey(entry.record), entry);
	return [...byKey.values()];
}

/**
 * Deterministic, read-only expiry evaluation: each record's verdict is a
 * pure function of its latest recorded classification and the injected
 * clock. Report-only — nothing is deleted and nothing is written.
 */
function evaluateRetention(cwd, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(RETENTION_INVALID_CODE, ["now must be a valid clock"]);
	let fold;
	let holds;
	try {
		fold = foldClassifications(cwd);
		holds = foldHolds(cwd);
	} catch (err) {
		return fail(err.amberCode || RETENTION_CORRUPT_CODE, [err.message || String(err)]);
	}
	const entries = effectiveClassifications(fold).map((entry) => {
		const expiresAt = new Date(Date.parse(entry.at) + entry.ttlMs).toISOString();
		const heldBy = activeHoldsFor(holds, entry.record);
		// Legal Hold has priority over TTL; otherwise the window is
		// half-open like Approval validity: expiry at exactly expiresAt.
		const verdict =
			heldBy.length > 0
				? "retained-by-hold"
				: now.getTime() >= Date.parse(expiresAt)
					? "expired-eligible"
					: "retained";
		return {
			record: entry.record,
			retentionClass: entry.retentionClass,
			ttlMs: entry.ttlMs,
			legalBasis: entry.legalBasis,
			policy: entry.policy,
			sensitivity: entry.sensitivity,
			minimized: entry.minimized,
			classifiedAt: entry.at,
			expiresAt,
			heldBy,
			verdict,
		};
	});
	return {
		ok: true,
		code: null,
		record: { at: now.toISOString(), entries },
		errors: [],
	};
}

function listClassifications(cwd, { type = null, identity = null } = {}) {
	const fold = foldClassifications(cwd);
	const currentIndexes = new Set(effectiveClassifications(fold).map((entry) => entry.index));
	return fold
		.filter(
			(entry) =>
				(type === null || entry.record.type === type) &&
				(identity === null || entry.record.identity === identity),
		)
		.map((entry) => ({ ...entry, current: currentIndexes.has(entry.index) }));
}

function holdsPath(cwd) {
	return statePathForCreate(cwd, "retention", "holds.jsonl");
}

function holdCorrupt(message) {
	return typedError(HOLD_CORRUPT_CODE, message);
}

function acquireHoldLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(holdsPath(cwd)),
		lockName: "holds.lock",
		conflictCode: HOLD_LOCK_CODE,
		corruptCode: HOLD_CORRUPT_CODE,
		label: "retention hold ledger",
		staleMs: LOCK_STALE_MS,
	});
}

// A hold scope names EITHER one exact record pin or one subject identity
// (every revision of that identity) — never both, never free text.
const HOLD_SCOPE_FIELDS = Object.freeze(["record", "subject"]);
const HOLD_INPUT_FIELDS = Object.freeze(["id", "scope", "reason", "decision"]);
const RELEASE_INPUT_FIELDS = Object.freeze(["id", "decision"]);
const DECISION_SNAPSHOT_FIELDS = Object.freeze([
	"identity",
	"revision",
	"decisionKind",
	"principal",
]);
const HOLD_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"scope",
	"reason",
	"decision",
	"prevHash",
	"hash",
]);
const RELEASE_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"decision",
	"prevHash",
	"hash",
]);

function holdScopeProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const unknown = unknownFieldProblem(value, HOLD_SCOPE_FIELDS, label);
	if (unknown !== null) return unknown;
	const hasRecord = "record" in value;
	const hasSubject = "subject" in value;
	if (hasRecord === hasSubject) return `${label} must name exactly one of record or subject`;
	if (hasRecord) return recordPinProblem(value.record, `${label}.record`);
	if (!isNonEmptyString(value.subject)) return `${label}.subject must be a non-empty string`;
	return null;
}

function decisionSnapshotProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, DECISION_SNAPSHOT_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(value.identity)) return `${label}.identity must be a non-empty string`;
	if (!Number.isInteger(value.revision) || value.revision < 1)
		return `${label}.revision must be a positive integer`;
	if (!RETENTION_DECISION_KINDS.includes(value.decisionKind))
		return `${label}.decisionKind must be one of ${RETENTION_DECISION_KINDS.join(", ")}`;
	if (!isNonEmptyString(value.principal)) return `${label}.principal must be a non-empty string`;
	return null;
}

function holdEventProblem(event, lineIndex) {
	const label = `retention hold event ${lineIndex}`;
	if (event.kind === "hold") {
		const closed = closedFieldProblem(event, HOLD_EVENT_FIELDS, label);
		if (closed !== null) return closed;
		if (!isNonEmptyString(event.at) || Number.isNaN(Date.parse(event.at)))
			return `${label}.at must be an ISO-8601 timestamp`;
		if (!isNonEmptyString(event.id)) return `${label}.id must be a non-empty string`;
		const scope = holdScopeProblem(event.scope, `${label}.scope`);
		if (scope !== null) return scope;
		if (!isNonEmptyString(event.reason)) return `${label}.reason must be a non-empty string`;
		const leak = credentialLeakProblem(event.reason, `${label}.reason`);
		if (leak !== null) return leak;
		return decisionSnapshotProblem(event.decision, `${label}.decision`);
	}
	const closed = closedFieldProblem(event, RELEASE_EVENT_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at) || Number.isNaN(Date.parse(event.at)))
		return `${label}.at must be an ISO-8601 timestamp`;
	if (!isNonEmptyString(event.id)) return `${label}.id must be a non-empty string`;
	return decisionSnapshotProblem(event.decision, `${label}.decision`);
}

function foldHolds(cwd) {
	const events = readLedgerFailClosed(holdsPath(cwd), HOLD_CORRUPT_CODE, "retention hold ledger");
	let prevHash = GENESIS_HASH;
	const holds = [];
	const byId = new Map();
	events.forEach((event, index) => {
		const lineIndex = index + 1;
		const link = chainLinkProblem(event, prevHash, lineIndex, "retention hold");
		if (link !== null) throw holdCorrupt(link);
		if (!SUPPORTED_RETENTION_SCHEMA_VERSIONS.includes(event.schemaVersion))
			throw holdCorrupt(
				`retention hold event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		if (event.kind !== "hold" && event.kind !== "release")
			throw holdCorrupt(
				`retention hold event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
			);
		const problem = holdEventProblem(event, lineIndex);
		if (problem !== null) throw holdCorrupt(problem);
		if (event.kind === "hold") {
			if (byId.has(event.id))
				throw holdCorrupt(
					`retention hold event ${lineIndex} reuses hold id ${JSON.stringify(event.id)}`,
				);
			const { prevHash: _prev, hash: _hash, at, decision, ...body } = event;
			const hold = {
				...body,
				issuer: decision,
				effectiveAt: at,
				status: "active",
				release: null,
				index,
			};
			holds.push(hold);
			byId.set(event.id, hold);
		} else {
			const hold = byId.get(event.id);
			if (!hold)
				throw holdCorrupt(
					`retention hold event ${lineIndex} releases unknown hold ${JSON.stringify(event.id)}`,
				);
			if (hold.status !== "active")
				throw holdCorrupt(`retention hold event ${lineIndex} releases an already-released hold`);
			hold.status = "released";
			hold.release = { at: event.at, decision: event.decision };
		}
		prevHash = event.hash;
	});
	return holds;
}

const HOLD_LEDGER = Object.freeze({
	acquire: acquireHoldLock,
	fold: foldHolds,
	path: holdsPath,
	corruptCode: HOLD_CORRUPT_CODE,
	sizeCeilingCode: HOLD_SIZE_CEILING_CODE,
	envName: "AMBER_RETENTION_MAX_HOLDS_BYTES",
	defaultBytes: DEFAULT_MAX_RETENTION_BYTES,
	label: "retention hold ledger",
});

// Hold authority mirrors the F052/F054 contract: a committed, unscoped,
// human acceptance/approval Decision with a verified principal snapshot.
function resolveHoldDecision(revisions, decision, label) {
	return resolveRegistrationDecision(revisions, decision, RETENTION_DECISION_KINDS, label);
}

// A Decision is single-use across the hold ledger: creation and release
// events both spend one.
function holdDecisionSpender(holds, decision) {
	for (const hold of holds) {
		if (hold.issuer.identity === decision.identity && hold.issuer.revision === decision.revision)
			return `hold ${JSON.stringify(hold.id)}`;
		if (
			hold.release !== null &&
			hold.release.decision.identity === decision.identity &&
			hold.release.decision.revision === decision.revision
		)
			return `the release of hold ${JSON.stringify(hold.id)}`;
	}
	return null;
}

/**
 * Create one Legal Hold: scope, preserved reason, issuer (the verified
 * principal of a single-use committed human Decision), and effective
 * time, appended immutably. A hold can never be edited — only released
 * by a second human Decision.
 */
function hold(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input)) return fail(RETENTION_INVALID_CODE, ["hold input must be an object"]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(RETENTION_INVALID_CODE, ["now must be a valid clock"]);
	const inputClosed = unknownFieldProblem(input, HOLD_INPUT_FIELDS, "hold input");
	if (inputClosed !== null) return fail(RETENTION_INVALID_CODE, [inputClosed]);
	if (!isNonEmptyString(input.id))
		return fail(RETENTION_INVALID_CODE, ["id must be a non-empty string"]);
	const scopeProblem = holdScopeProblem(input.scope, "scope");
	if (scopeProblem !== null) return fail(RETENTION_INVALID_CODE, [scopeProblem]);
	if (!isNonEmptyString(input.reason))
		return fail(RETENTION_INVALID_CODE, ["reason must be a preserved non-empty string"]);
	const reasonLeak = credentialLeakProblem(input.reason, "reason");
	if (reasonLeak !== null) return fail(RETENTION_LEAK_CODE, [reasonLeak]);
	const pinProblem = decisionPinProblem(input.decision);
	if (pinProblem !== null) return fail(RETENTION_INVALID_CODE, [pinProblem]);
	let revisions;
	try {
		revisions = listArtifactRevisions(cwd);
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_ARTIFACT_JOURNAL_CORRUPT", [err.message || String(err)]);
	}
	const resolved = resolveHoldDecision(revisions, input.decision, "a Legal Hold");
	if (resolved.problem) return fail(RETENTION_INVALID_CODE, [resolved.problem]);
	return appendLedgerEvent(
		cwd,
		HOLD_LEDGER,
		{
			kind: "hold",
			schemaVersion: RETENTION_SCHEMA_VERSION,
			at: now.toISOString(),
			id: input.id,
			scope: input.scope.record
				? {
						record: {
							type: input.scope.record.type,
							identity: input.scope.record.identity,
							revision: input.scope.record.revision,
						},
					}
				: { subject: input.scope.subject },
			reason: input.reason,
			decision: resolved.decision,
		},
		(fold) => {
			if (fold.some((entry) => entry.id === input.id))
				return fail(RETENTION_INVALID_CODE, [
					`hold ${JSON.stringify(input.id)} already exists; holds are immutable and release is a separate Decision`,
				]);
			const spender = holdDecisionSpender(fold, input.decision);
			if (spender !== null)
				return fail(RETENTION_INVALID_CODE, [
					`decision ${JSON.stringify(input.decision.identity)}@${input.decision.revision} already authorized ${spender}; a Decision is single-use across the hold ledger`,
				]);
			return null;
		},
		(fold) => fold.find((entry) => entry.id === input.id),
	);
}

/**
 * Release one active Legal Hold behind its own single-use committed
 * human Decision. The released hold stays listable forever — a hold can
 * end, but it can never disappear.
 */
function releaseHold(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(RETENTION_INVALID_CODE, ["release input must be an object"]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(RETENTION_INVALID_CODE, ["now must be a valid clock"]);
	const inputClosed = unknownFieldProblem(input, RELEASE_INPUT_FIELDS, "release input");
	if (inputClosed !== null) return fail(RETENTION_INVALID_CODE, [inputClosed]);
	if (!isNonEmptyString(input.id))
		return fail(RETENTION_INVALID_CODE, ["id must be a non-empty string"]);
	const pinProblem = decisionPinProblem(input.decision);
	if (pinProblem !== null) return fail(RETENTION_INVALID_CODE, [pinProblem]);
	let revisions;
	try {
		revisions = listArtifactRevisions(cwd);
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_ARTIFACT_JOURNAL_CORRUPT", [err.message || String(err)]);
	}
	const resolved = resolveHoldDecision(revisions, input.decision, "a Legal Hold release");
	if (resolved.problem) return fail(RETENTION_INVALID_CODE, [resolved.problem]);
	return appendLedgerEvent(
		cwd,
		HOLD_LEDGER,
		{
			kind: "release",
			schemaVersion: RETENTION_SCHEMA_VERSION,
			at: now.toISOString(),
			id: input.id,
			decision: resolved.decision,
		},
		(fold) => {
			const existing = fold.find((entry) => entry.id === input.id) ?? null;
			if (existing === null)
				return fail(RETENTION_NOT_FOUND_CODE, [`hold ${JSON.stringify(input.id)} does not exist`]);
			if (existing.status !== "active")
				return fail(RETENTION_INVALID_CODE, [
					`hold ${JSON.stringify(input.id)} is already released; a release cannot repeat`,
				]);
			const spender = holdDecisionSpender(fold, input.decision);
			if (spender !== null)
				return fail(RETENTION_INVALID_CODE, [
					`decision ${JSON.stringify(input.decision.identity)}@${input.decision.revision} already authorized ${spender}; a Decision is single-use across the hold ledger`,
				]);
			return null;
		},
		(fold) => fold.find((entry) => entry.id === input.id),
	);
}

function listHolds(cwd, { status = null } = {}) {
	return foldHolds(cwd).filter((entry) => status === null || entry.status === status);
}

// The active holds whose scope covers one record: an exact record pin or
// a subject naming the record's identity. Subject matching is deliberately
// type-agnostic and revision-agnostic — over-matching is fail-safe for a
// hold, which can only ever retain more.
function activeHoldsFor(holds, record) {
	return holds
		.filter(
			(entry) =>
				entry.status === "active" &&
				(entry.scope.record
					? entry.scope.record.type === record.type &&
						entry.scope.record.identity === record.identity &&
						entry.scope.record.revision === record.revision
					: entry.scope.subject === record.identity),
		)
		.map((entry) => entry.id);
}

function canonicalHashOf(value) {
	return `sha256:${crypto
		.createHash("sha256")
		.update(Buffer.from(canonicalJson(JSON.stringify(value))))
		.digest("hex")}`;
}

function holdersPath(cwd) {
	return statePathForCreate(cwd, "retention", "holders.jsonl");
}

function holderCorrupt(message) {
	return typedError(HOLDER_CORRUPT_CODE, message);
}

function acquireHolderLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(holdersPath(cwd)),
		lockName: "holders.lock",
		conflictCode: HOLDER_LOCK_CODE,
		corruptCode: HOLDER_CORRUPT_CODE,
		label: "retention holder registry",
		staleMs: LOCK_STALE_MS,
	});
}

const HOLDER_INPUT_FIELDS = Object.freeze(["id", "version", "surface", "adapter", "decision"]);
const ADAPTER_PIN_FIELDS = Object.freeze(["id", "version"]);
const HOLDER_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"version",
	"surface",
	"adapter",
	"decision",
	"prevHash",
	"hash",
]);

function adapterPinProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object carrying id and version`;
	const closed = closedFieldProblem(value, ADAPTER_PIN_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(value.id)) return `${label}.id must be a non-empty string`;
	if (!isNonEmptyString(value.version)) return `${label}.version must be a non-empty string`;
	return null;
}

function holderEventProblem(event, lineIndex) {
	const label = `retention holder event ${lineIndex}`;
	const closed = closedFieldProblem(event, HOLDER_EVENT_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at) || Number.isNaN(Date.parse(event.at)))
		return `${label}.at must be an ISO-8601 timestamp`;
	for (const field of ["id", "version"]) {
		if (!isNonEmptyString(event[field])) return `${label}.${field} must be a non-empty string`;
	}
	if (!HOLDER_SURFACES.includes(event.surface))
		return `${label}.surface must be one of ${HOLDER_SURFACES.join(", ")}`;
	const adapter = adapterPinProblem(event.adapter, `${label}.adapter`);
	if (adapter !== null) return adapter;
	return decisionSnapshotProblem(event.decision, `${label}.decision`);
}

function holderKey(id, version) {
	return `${id}@${version}`;
}

function foldHolders(cwd) {
	const events = readLedgerFailClosed(
		holdersPath(cwd),
		HOLDER_CORRUPT_CODE,
		"retention holder registry",
	);
	let prevHash = GENESIS_HASH;
	const keys = new Set();
	const holders = [];
	events.forEach((event, index) => {
		const lineIndex = index + 1;
		const link = chainLinkProblem(event, prevHash, lineIndex, "retention holder");
		if (link !== null) throw holderCorrupt(link);
		if (!SUPPORTED_RETENTION_SCHEMA_VERSIONS.includes(event.schemaVersion))
			throw holderCorrupt(
				`retention holder event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		if (event.kind !== "holder")
			throw holderCorrupt(
				`retention holder event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
			);
		const problem = holderEventProblem(event, lineIndex);
		if (problem !== null) throw holderCorrupt(problem);
		const key = holderKey(event.id, event.version);
		if (keys.has(key))
			throw holderCorrupt(`retention holder ${JSON.stringify(key)} is registered more than once`);
		keys.add(key);
		const { prevHash: _prev, hash: _hash, ...body } = event;
		holders.push({ ...body, index });
		prevHash = event.hash;
	});
	return holders;
}

const HOLDER_LEDGER = Object.freeze({
	acquire: acquireHolderLock,
	fold: foldHolders,
	path: holdersPath,
	corruptCode: HOLDER_CORRUPT_CODE,
	sizeCeilingCode: HOLDER_SIZE_CEILING_CODE,
	envName: "AMBER_RETENTION_MAX_HOLDERS_BYTES",
	defaultBytes: DEFAULT_MAX_RETENTION_BYTES,
	label: "retention holder registry",
});

function holderDecisionSpender(holders, decision) {
	const spender = holders.find(
		(entry) =>
			entry.decision.identity === decision.identity &&
			entry.decision.revision === decision.revision,
	);
	return spender ? holderKey(spender.id, spender.version) : null;
}

/**
 * Register one copy-holding surface: a Holder binds one closed surface
 * kind to its registered Adapter pin behind a single-use committed human
 * Decision. Registered versions are immutable — a changed declaration
 * registers a new version.
 */
function registerHolder(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(RETENTION_INVALID_CODE, ["holder input must be an object"]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(RETENTION_INVALID_CODE, ["now must be a valid clock"]);
	const inputClosed = unknownFieldProblem(input, HOLDER_INPUT_FIELDS, "holder input");
	if (inputClosed !== null) return fail(RETENTION_INVALID_CODE, [inputClosed]);
	for (const field of ["id", "version"]) {
		if (!isNonEmptyString(input[field]))
			return fail(RETENTION_INVALID_CODE, [`${field} must be a non-empty string`]);
	}
	if (!HOLDER_SURFACES.includes(input.surface))
		return fail(RETENTION_INVALID_CODE, [`surface must be one of ${HOLDER_SURFACES.join(", ")}`]);
	const adapterProblem = adapterPinProblem(input.adapter, "adapter");
	if (adapterProblem !== null) return fail(RETENTION_INVALID_CODE, [adapterProblem]);
	const pinProblem = decisionPinProblem(input.decision);
	if (pinProblem !== null) return fail(RETENTION_INVALID_CODE, [pinProblem]);
	let adapter;
	try {
		adapter = showAdapter(cwd, input.adapter.id);
	} catch (err) {
		return fail(err.amberCode || HOLDER_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (adapter === null)
		return fail(RETENTION_INVALID_CODE, [
			`adapter ${JSON.stringify(input.adapter.id)} is not registered; a Holder binds a registered Adapter capability`,
		]);
	if (adapter.adapterVersion !== input.adapter.version)
		return fail(RETENTION_INVALID_CODE, [
			`adapter ${JSON.stringify(input.adapter.id)} is registered at version ${JSON.stringify(adapter.adapterVersion)}, not the pinned ${JSON.stringify(input.adapter.version)}`,
		]);
	let revisions;
	try {
		revisions = listArtifactRevisions(cwd);
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_ARTIFACT_JOURNAL_CORRUPT", [err.message || String(err)]);
	}
	const resolved = resolveHoldDecision(revisions, input.decision, "Holder registration");
	if (resolved.problem) return fail(RETENTION_INVALID_CODE, [resolved.problem]);
	return appendLedgerEvent(
		cwd,
		HOLDER_LEDGER,
		{
			kind: "holder",
			schemaVersion: RETENTION_SCHEMA_VERSION,
			at: now.toISOString(),
			id: input.id,
			version: input.version,
			surface: input.surface,
			adapter: { id: input.adapter.id, version: input.adapter.version },
			decision: resolved.decision,
		},
		(fold) => {
			const key = holderKey(input.id, input.version);
			if (fold.some((entry) => holderKey(entry.id, entry.version) === key))
				return fail(RETENTION_INVALID_CODE, [
					`holder ${JSON.stringify(key)} is already registered; a changed declaration registers a new version`,
				]);
			const spender = holderDecisionSpender(fold, input.decision);
			if (spender !== null)
				return fail(RETENTION_INVALID_CODE, [
					`decision ${JSON.stringify(input.decision.identity)}@${input.decision.revision} already authorized holder ${JSON.stringify(spender)}; a registration Decision is single-use`,
				]);
			return null;
		},
		(fold) =>
			fold.find(
				(entry) => holderKey(entry.id, entry.version) === holderKey(input.id, input.version),
			),
	);
}

function listHolders(cwd) {
	return foldHolders(cwd);
}

function candidatesPath(cwd) {
	return statePathForCreate(cwd, "retention", "candidates.jsonl");
}

function candidateCorrupt(message) {
	return typedError(CANDIDATE_CORRUPT_CODE, message);
}

function acquireCandidateLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(candidatesPath(cwd)),
		lockName: "candidates.lock",
		conflictCode: CANDIDATE_LOCK_CODE,
		corruptCode: CANDIDATE_CORRUPT_CODE,
		label: "retention candidate ledger",
		staleMs: LOCK_STALE_MS,
	});
}

const CANDIDATE_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"records",
	"excludedHeld",
	"holders",
	"effects",
	"candidateHash",
	"prevHash",
	"hash",
]);
const CANDIDATE_AUTHORIZED_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"approvalId",
	"decision",
	"prevHash",
	"hash",
]);

function candidateEventProblem(event, lineIndex) {
	const label = `retention candidate event ${lineIndex}`;
	if (event.kind === "candidate") {
		const closed = closedFieldProblem(event, CANDIDATE_EVENT_FIELDS, label);
		if (closed !== null) return closed;
		if (!isNonEmptyString(event.at) || Number.isNaN(Date.parse(event.at)))
			return `${label}.at must be an ISO-8601 timestamp`;
		if (!isNonEmptyString(event.id)) return `${label}.id must be a non-empty string`;
		for (const field of ["records", "excludedHeld", "holders", "effects"]) {
			if (!Array.isArray(event[field])) return `${label}.${field} must be an array`;
		}
		if (!/^sha256:[0-9a-f]{64}$/.test(event.candidateHash ?? ""))
			return `${label}.candidateHash must be a sha256:<64-hex> string`;
		return null;
	}
	const closed = closedFieldProblem(event, CANDIDATE_AUTHORIZED_EVENT_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at) || Number.isNaN(Date.parse(event.at)))
		return `${label}.at must be an ISO-8601 timestamp`;
	if (!isNonEmptyString(event.id)) return `${label}.id must be a non-empty string`;
	if (!isNonEmptyString(event.approvalId)) return `${label}.approvalId must be a non-empty string`;
	if (!isPlainObject(event.decision)) return `${label}.decision must be an object`;
	const decisionClosed = closedFieldProblem(
		event.decision,
		["identity", "revision"],
		`${label}.decision`,
	);
	if (decisionClosed !== null) return decisionClosed;
	if (!isNonEmptyString(event.decision.identity))
		return `${label}.decision.identity must be a non-empty string`;
	if (!Number.isInteger(event.decision.revision) || event.decision.revision < 1)
		return `${label}.decision.revision must be a positive integer`;
	return null;
}

function foldCandidates(cwd) {
	const events = readLedgerFailClosed(
		candidatesPath(cwd),
		CANDIDATE_CORRUPT_CODE,
		"retention candidate ledger",
	);
	let prevHash = GENESIS_HASH;
	const candidates = [];
	const byId = new Map();
	events.forEach((event, index) => {
		const lineIndex = index + 1;
		const link = chainLinkProblem(event, prevHash, lineIndex, "retention candidate");
		if (link !== null) throw candidateCorrupt(link);
		if (!SUPPORTED_RETENTION_SCHEMA_VERSIONS.includes(event.schemaVersion))
			throw candidateCorrupt(
				`retention candidate event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		if (event.kind !== "candidate" && event.kind !== "authorized")
			throw candidateCorrupt(
				`retention candidate event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
			);
		const problem = candidateEventProblem(event, lineIndex);
		if (problem !== null) throw candidateCorrupt(problem);
		if (event.kind === "candidate") {
			if (byId.has(event.id))
				throw candidateCorrupt(
					`retention candidate event ${lineIndex} reuses candidate id ${JSON.stringify(event.id)}`,
				);
			const { prevHash: _prev, hash: _hash, at, ...body } = event;
			const candidate = {
				...body,
				preparedAt: at,
				status: "prepared",
				authorization: null,
				index,
			};
			candidates.push(candidate);
			byId.set(event.id, candidate);
		} else {
			const candidate = byId.get(event.id);
			if (!candidate)
				throw candidateCorrupt(
					`retention candidate event ${lineIndex} authorizes unknown candidate ${JSON.stringify(event.id)}`,
				);
			if (candidate.status !== "prepared")
				throw candidateCorrupt(
					`retention candidate event ${lineIndex} authorizes an already-authorized candidate`,
				);
			candidate.status = "authorized";
			candidate.authorization = {
				at: event.at,
				approvalId: event.approvalId,
				decision: event.decision,
			};
		}
		prevHash = event.hash;
	});
	return candidates;
}

const CANDIDATE_LEDGER = Object.freeze({
	acquire: acquireCandidateLock,
	fold: foldCandidates,
	path: candidatesPath,
	corruptCode: CANDIDATE_CORRUPT_CODE,
	sizeCeilingCode: CANDIDATE_SIZE_CEILING_CODE,
	envName: "AMBER_RETENTION_MAX_CANDIDATES_BYTES",
	defaultBytes: DEFAULT_MAX_RETENTION_BYTES,
	label: "retention candidate ledger",
});

// The deterministic candidate content: exactly what a reviewer sees and
// exactly what the authorization hash binds.
function deriveCandidateContent(cwd, now) {
	const evaluated = evaluateRetention(cwd, { now });
	if (!evaluated.ok) return { problem: evaluated };
	let holders;
	try {
		holders = foldHolders(cwd);
	} catch (err) {
		return {
			problem: {
				ok: false,
				code: err.amberCode || HOLDER_CORRUPT_CODE,
				record: null,
				errors: [err.message || String(err)],
			},
		};
	}
	const records = evaluated.record.entries
		.filter((entry) => entry.verdict === "expired-eligible")
		.map((entry) => ({
			record: entry.record,
			retentionClass: entry.retentionClass,
			ttlMs: entry.ttlMs,
			legalBasis: entry.legalBasis,
			policy: entry.policy,
			classifiedAt: entry.classifiedAt,
			expiresAt: entry.expiresAt,
		}));
	const excludedHeld = evaluated.record.entries
		.filter((entry) => entry.verdict === "retained-by-hold")
		.map((entry) => ({ record: entry.record, heldBy: entry.heldBy }));
	const holderPins = holders.map((entry) => ({
		id: entry.id,
		version: entry.version,
		surface: entry.surface,
		adapter: entry.adapter,
	}));
	const effects = holderPins.map((holder) => ({
		holder: { id: holder.id, version: holder.version },
		surface: holder.surface,
		effect: "delete",
		records: records.map((entry) => entry.record),
	}));
	const evaluatedAt = now.toISOString();
	const candidateHash = canonicalHashOf({
		records,
		excludedHeld,
		holders: holderPins,
		effects,
		evaluatedAt,
	});
	return {
		content: { records, excludedHeld, holders: holderPins, effects, evaluatedAt, candidateHash },
	};
}

/**
 * Prepare one deletion candidate: a governance-write that enumerates the
 * exact expired-eligible records with their retention basis, names the
 * Legal Hold exclusions, lists every registered Holder, and proposes the
 * per-Holder effects — content is never touched. The closed content
 * hashes into candidateHash, the exact thing an authorization later
 * binds.
 */
function prepareDeletionCandidate(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(RETENTION_INVALID_CODE, ["candidate input must be an object"]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(RETENTION_INVALID_CODE, ["now must be a valid clock"]);
	const inputClosed = unknownFieldProblem(input, ["id"], "candidate input");
	if (inputClosed !== null) return fail(RETENTION_INVALID_CODE, [inputClosed]);
	if (!isNonEmptyString(input.id))
		return fail(RETENTION_INVALID_CODE, ["id must be a non-empty string"]);
	const derived = deriveCandidateContent(cwd, now);
	if (derived.problem) return derived.problem;
	const { content } = derived;
	if (content.records.length === 0)
		return fail(RETENTION_INVALID_CODE, [
			"no record is expired-eligible at the declared clock; a deletion candidate reviews something",
		]);
	// Zero Holders would let a deletion transaction complete instantly
	// without deleting anywhere — an unsafe overclaim by construction.
	if (content.holders.length === 0)
		return fail(RETENTION_INVALID_CODE, [
			"no Holder is registered; register the copy-holding surfaces before proposing deletion",
		]);
	return appendLedgerEvent(
		cwd,
		CANDIDATE_LEDGER,
		{
			kind: "candidate",
			schemaVersion: RETENTION_SCHEMA_VERSION,
			at: content.evaluatedAt,
			id: input.id,
			records: content.records,
			excludedHeld: content.excludedHeld,
			holders: content.holders,
			effects: content.effects,
			candidateHash: content.candidateHash,
		},
		(fold) => {
			if (fold.some((entry) => entry.id === input.id))
				return fail(RETENTION_INVALID_CODE, [
					`candidate ${JSON.stringify(input.id)} already exists; prepare a new candidate id for a new review`,
				]);
			return null;
		},
		(fold) => fold.find((entry) => entry.id === input.id),
	);
}

/**
 * Authorize one prepared candidate: consumes a single-use Approval whose
 * subject binds the candidate's canonical hash, after re-deriving the
 * candidate content at its recorded clock — records, holds, Holders, or
 * effects that drifted since review refuse the authorization.
 */
function authorizeDeletion(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(RETENTION_INVALID_CODE, ["authorize input must be an object"]);
	const inputClosed = unknownFieldProblem(
		input,
		["id", "approval", "decisionIdentity", "body", "traces", "scope"],
		"authorize input",
	);
	if (inputClosed !== null) return fail(RETENTION_INVALID_CODE, [inputClosed]);
	for (const field of ["id", "approval", "decisionIdentity", "body"]) {
		if (!isNonEmptyString(input[field]))
			return fail(RETENTION_INVALID_CODE, [`${field} must be a non-empty string`]);
	}
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	let consumed = null;
	// The guard completes this object from the consumption receipt before
	// the append hashes the event body.
	const decision = { identity: input.decisionIdentity, revision: 1 };
	const appended = appendLedgerEvent(
		cwd,
		CANDIDATE_LEDGER,
		{
			kind: "authorized",
			schemaVersion: RETENTION_SCHEMA_VERSION,
			at,
			id: input.id,
			approvalId: input.approval,
			decision,
		},
		(fold) => {
			const candidate = fold.find((entry) => entry.id === input.id) ?? null;
			if (candidate === null)
				return fail(RETENTION_NOT_FOUND_CODE, [
					`candidate ${JSON.stringify(input.id)} does not exist`,
				]);
			if (candidate.status !== "prepared")
				return fail(RETENTION_INVALID_CODE, [
					`candidate ${JSON.stringify(input.id)} is already authorized; an authorization is single-use`,
				]);
			const derived = deriveCandidateContent(cwd, new Date(candidate.preparedAt));
			if (derived.problem) return derived.problem;
			if (derived.content.candidateHash !== candidate.candidateHash)
				return fail(RETENTION_DRIFT_CODE, [
					`candidate ${JSON.stringify(input.id)} no longer matches what was reviewed (records, holds, Holders, or effects changed); prepare and review a fresh candidate`,
				]);
			const binding = `retention-deletion:${candidate.candidateHash}`;
			// Consumption is the point of no return: it settles the human
			// Decision atomically under the approval ledger's own lock. A
			// ceiling/write failure AFTER this point leaves the consumed
			// approval and settled Decision as the auditable source of
			// truth for manual recovery — the candidate stays prepared.
			const settled = consumeSubjectBoundApproval(
				cwd,
				{
					id: input.approval,
					binding,
					decision,
					fail,
					corruptCode: CANDIDATE_CORRUPT_CODE,
					invalidCode: RETENTION_INVALID_CODE,
					subjectMismatch: (approval) =>
						`approval ${JSON.stringify(input.approval)} authorizes subject ${JSON.stringify(approval.subject)}, not this candidate's binding ${JSON.stringify(binding)}; one authorization binds one reviewed candidate hash`,
					decisionIdentity: input.decisionIdentity,
					body: input.body,
					traces: input.traces ?? [],
					scope: input.scope ?? null,
				},
				opts,
			);
			if (settled.verdict !== null) return settled.verdict;
			consumed = settled.consumption;
			return null;
		},
		(fold) => fold.find((entry) => entry.id === input.id),
	);
	if (!appended.ok) return appended;
	return { ...appended, consumption: consumed };
}

function showDeletionCandidate(cwd, id) {
	return foldCandidates(cwd).find((entry) => entry.id === id) ?? null;
}

function listDeletionCandidates(cwd, { status = null } = {}) {
	return foldCandidates(cwd).filter((entry) => status === null || entry.status === status);
}

function transactionsPath(cwd) {
	return statePathForCreate(cwd, "retention", "transactions.jsonl");
}

function transactionCorrupt(message) {
	return typedError(TX_CORRUPT_CODE, message);
}

function acquireTransactionLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(transactionsPath(cwd)),
		lockName: "transactions.lock",
		conflictCode: TX_LOCK_CODE,
		corruptCode: TX_CORRUPT_CODE,
		label: "retention transaction ledger",
		staleMs: LOCK_STALE_MS,
	});
}

const EXECUTION_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"candidateId",
	"candidateHash",
	"holders",
	"prevHash",
	"hash",
]);
const SETTLEMENT_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"transactionId",
	"holder",
	"status",
	"adapter",
	"receiptHash",
	"prevHash",
	"hash",
]);
const HOLDER_PIN_FIELDS = Object.freeze(["id", "version"]);

function transactionEventProblem(event, lineIndex) {
	const label = `retention transaction event ${lineIndex}`;
	if (event.kind === "execution") {
		const closed = closedFieldProblem(event, EXECUTION_EVENT_FIELDS, label);
		if (closed !== null) return closed;
		if (!isNonEmptyString(event.at) || Number.isNaN(Date.parse(event.at)))
			return `${label}.at must be an ISO-8601 timestamp`;
		for (const field of ["id", "candidateId"]) {
			if (!isNonEmptyString(event[field])) return `${label}.${field} must be a non-empty string`;
		}
		if (!/^sha256:[0-9a-f]{64}$/.test(event.candidateHash ?? ""))
			return `${label}.candidateHash must be a sha256:<64-hex> string`;
		if (!Array.isArray(event.holders) || event.holders.length === 0)
			return `${label}.holders must be a non-empty array`;
		for (let position = 0; position < event.holders.length; position += 1) {
			const entry = event.holders[position];
			const entryLabel = `${label}.holders[${position}]`;
			if (!isPlainObject(entry)) return `${entryLabel} must be an object`;
			const entryClosed = closedFieldProblem(
				entry,
				["id", "version", "surface", "adapter"],
				entryLabel,
			);
			if (entryClosed !== null) return entryClosed;
			for (const field of ["id", "version"]) {
				if (!isNonEmptyString(entry[field]))
					return `${entryLabel}.${field} must be a non-empty string`;
			}
			if (!HOLDER_SURFACES.includes(entry.surface))
				return `${entryLabel}.surface must be one of ${HOLDER_SURFACES.join(", ")}`;
			const entryAdapter = adapterPinProblem(entry.adapter, `${entryLabel}.adapter`);
			if (entryAdapter !== null) return entryAdapter;
		}
		return null;
	}
	const closed = closedFieldProblem(event, SETTLEMENT_EVENT_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at) || Number.isNaN(Date.parse(event.at)))
		return `${label}.at must be an ISO-8601 timestamp`;
	if (!isNonEmptyString(event.transactionId))
		return `${label}.transactionId must be a non-empty string`;
	if (!isPlainObject(event.holder)) return `${label}.holder must be an object`;
	const holderClosed = closedFieldProblem(event.holder, HOLDER_PIN_FIELDS, `${label}.holder`);
	if (holderClosed !== null) return holderClosed;
	if (!SETTLEMENT_STATUSES.includes(event.status))
		return `${label}.status must be one of ${SETTLEMENT_STATUSES.join(", ")}`;
	const adapter = adapterPinProblem(event.adapter, `${label}.adapter`);
	if (adapter !== null) return adapter;
	if (!/^sha256:[0-9a-f]{64}$/.test(event.receiptHash ?? ""))
		return `${label}.receiptHash must be a sha256:<64-hex> string`;
	return null;
}

// Projects one entry per transaction: `settlements` maps each covered
// Holder to its LATEST declared receipt, and `status` derives from full
// coverage — deletion-pending while any Holder is unsettled.
function foldTransactions(cwd) {
	const events = readLedgerFailClosed(
		transactionsPath(cwd),
		TX_CORRUPT_CODE,
		"retention transaction ledger",
	);
	let prevHash = GENESIS_HASH;
	const transactions = [];
	const byId = new Map();
	const byCandidate = new Set();
	events.forEach((event, index) => {
		const lineIndex = index + 1;
		const link = chainLinkProblem(event, prevHash, lineIndex, "retention transaction");
		if (link !== null) throw transactionCorrupt(link);
		if (!SUPPORTED_RETENTION_SCHEMA_VERSIONS.includes(event.schemaVersion))
			throw transactionCorrupt(
				`retention transaction event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		if (event.kind !== "execution" && event.kind !== "settlement")
			throw transactionCorrupt(
				`retention transaction event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
			);
		const problem = transactionEventProblem(event, lineIndex);
		if (problem !== null) throw transactionCorrupt(problem);
		if (event.kind === "execution") {
			if (byId.has(event.id))
				throw transactionCorrupt(
					`retention transaction event ${lineIndex} reuses transaction id ${JSON.stringify(event.id)}`,
				);
			if (byCandidate.has(event.candidateId))
				throw transactionCorrupt(
					`retention transaction event ${lineIndex} re-executes candidate ${JSON.stringify(event.candidateId)}`,
				);
			const { prevHash: _prev, hash, at, ...body } = event;
			const transaction = {
				...body,
				executedAt: at,
				executionHash: hash,
				settlements: {},
				index,
			};
			transactions.push(transaction);
			byId.set(event.id, transaction);
			byCandidate.add(event.candidateId);
		} else {
			const transaction = byId.get(event.transactionId);
			if (!transaction)
				throw transactionCorrupt(
					`retention transaction event ${lineIndex} settles unknown transaction ${JSON.stringify(event.transactionId)}`,
				);
			const key = holderKey(event.holder.id, event.holder.version);
			const covered = transaction.holders.find(
				(entry) => holderKey(entry.id, entry.version) === key,
			);
			if (!covered)
				throw transactionCorrupt(
					`retention transaction event ${lineIndex} settles Holder ${JSON.stringify(key)} outside the transaction's declared coverage`,
				);
			const prior = transaction.settlements[key];
			if (prior && prior.status === "settled")
				throw transactionCorrupt(
					`retention transaction event ${lineIndex} re-settles Holder ${JSON.stringify(key)}; a completed deletion effect can never repeat`,
				);
			transaction.settlements[key] = {
				at: event.at,
				status: event.status,
				adapter: event.adapter,
				receiptHash: event.receiptHash,
			};
		}
		prevHash = event.hash;
	});
	for (const transaction of transactions) {
		const allSettled = transaction.holders.every((entry) => {
			const settlement = transaction.settlements[holderKey(entry.id, entry.version)];
			return settlement !== undefined && settlement.status === "settled";
		});
		transaction.status = allSettled ? "completed" : "deletion-pending";
	}
	return transactions;
}

const TRANSACTION_LEDGER = Object.freeze({
	acquire: acquireTransactionLock,
	fold: foldTransactions,
	path: transactionsPath,
	corruptCode: TX_CORRUPT_CODE,
	sizeCeilingCode: TX_SIZE_CEILING_CODE,
	envName: "AMBER_RETENTION_MAX_TRANSACTIONS_BYTES",
	defaultBytes: DEFAULT_MAX_RETENTION_BYTES,
	label: "retention transaction ledger",
});

/**
 * Open one deletion transaction from one AUTHORIZED candidate: the
 * transaction snapshots the reviewed Holder coverage, and a candidate
 * executes at most once — a retry never re-opens completed deletion
 * effects, it settles the same transaction's unsettled Holders.
 */
function executeDeletion(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(RETENTION_INVALID_CODE, ["execute input must be an object"]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(RETENTION_INVALID_CODE, ["now must be a valid clock"]);
	const inputClosed = unknownFieldProblem(input, ["id", "candidateId"], "execute input");
	if (inputClosed !== null) return fail(RETENTION_INVALID_CODE, [inputClosed]);
	for (const field of ["id", "candidateId"]) {
		if (!isNonEmptyString(input[field]))
			return fail(RETENTION_INVALID_CODE, [`${field} must be a non-empty string`]);
	}
	let candidate;
	try {
		candidate = showDeletionCandidate(cwd, input.candidateId);
	} catch (err) {
		return fail(err.amberCode || CANDIDATE_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (candidate === null)
		return fail(RETENTION_NOT_FOUND_CODE, [
			`candidate ${JSON.stringify(input.candidateId)} does not exist`,
		]);
	if (candidate.status !== "authorized")
		return fail(RETENTION_INVALID_CODE, [
			`candidate ${JSON.stringify(input.candidateId)} is not authorized; deletion executes only what a human authorized`,
		]);
	return appendLedgerEvent(
		cwd,
		TRANSACTION_LEDGER,
		{
			kind: "execution",
			schemaVersion: RETENTION_SCHEMA_VERSION,
			at: now.toISOString(),
			id: input.id,
			candidateId: candidate.id,
			candidateHash: candidate.candidateHash,
			holders: candidate.holders,
		},
		(fold) => {
			if (fold.some((entry) => entry.id === input.id))
				return fail(RETENTION_INVALID_CODE, [
					`transaction ${JSON.stringify(input.id)} already exists`,
				]);
			if (fold.some((entry) => entry.candidateId === input.candidateId))
				return fail(RETENTION_INVALID_CODE, [
					`candidate ${JSON.stringify(input.candidateId)} already executed; duplicate execution refuses — retry settles the existing transaction's unsettled Holders`,
				]);
			return null;
		},
		(fold) => fold.find((entry) => entry.id === input.id),
	);
}

/**
 * Settle one covered Holder with a declared receipt. Every Holder settles
 * independently; a settled Holder refuses re-settlement so a retry can
 * never repeat a completed deletion effect, while refused, failed, and
 * unavailable Holders stay retryable.
 */
function settleHolder(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(RETENTION_INVALID_CODE, ["settle input must be an object"]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(RETENTION_INVALID_CODE, ["now must be a valid clock"]);
	const inputClosed = unknownFieldProblem(
		input,
		["transactionId", "holder", "status", "receiptHash"],
		"settle input",
	);
	if (inputClosed !== null) return fail(RETENTION_INVALID_CODE, [inputClosed]);
	if (!isNonEmptyString(input.transactionId))
		return fail(RETENTION_INVALID_CODE, ["transactionId must be a non-empty string"]);
	if (!isPlainObject(input.holder))
		return fail(RETENTION_INVALID_CODE, ["holder must be an object carrying id and version"]);
	const holderClosed = closedFieldProblem(input.holder, HOLDER_PIN_FIELDS, "holder");
	if (holderClosed !== null) return fail(RETENTION_INVALID_CODE, [holderClosed]);
	for (const field of ["id", "version"]) {
		if (!isNonEmptyString(input.holder[field]))
			return fail(RETENTION_INVALID_CODE, [`holder.${field} must be a non-empty string`]);
	}
	if (!SETTLEMENT_STATUSES.includes(input.status))
		return fail(RETENTION_INVALID_CODE, [
			`status must be one of ${SETTLEMENT_STATUSES.join(", ")}`,
		]);
	if (!/^sha256:[0-9a-f]{64}$/.test(input.receiptHash ?? ""))
		return fail(RETENTION_INVALID_CODE, ["receiptHash must be a sha256:<64-hex> string"]);
	const key = holderKey(input.holder.id, input.holder.version);
	return appendLedgerEvent(
		cwd,
		TRANSACTION_LEDGER,
		// Adapter provenance copies from the transaction's reviewed Holder
		// coverage — a settlement can never declare a different executor.
		// The guard ran first on this same fold, so both lookups succeed; a
		// null fallback fails event validation closed if that ever changes.
		(fold) => {
			const transaction = fold.find((entry) => entry.id === input.transactionId) ?? null;
			const covered =
				transaction === null
					? null
					: (transaction.holders.find((entry) => holderKey(entry.id, entry.version) === key) ??
						null);
			return {
				kind: "settlement",
				schemaVersion: RETENTION_SCHEMA_VERSION,
				at: now.toISOString(),
				transactionId: input.transactionId,
				holder: { id: input.holder.id, version: input.holder.version },
				status: input.status,
				adapter: covered === null ? null : covered.adapter,
				receiptHash: input.receiptHash,
			};
		},
		(fold) => {
			const transaction = fold.find((entry) => entry.id === input.transactionId) ?? null;
			if (transaction === null)
				return fail(RETENTION_NOT_FOUND_CODE, [
					`transaction ${JSON.stringify(input.transactionId)} does not exist`,
				]);
			const covered = transaction.holders.find(
				(entry) => holderKey(entry.id, entry.version) === key,
			);
			if (!covered)
				return fail(RETENTION_INVALID_CODE, [
					`Holder ${JSON.stringify(key)} is outside the transaction's declared coverage; a settlement binds a reviewed Holder`,
				]);
			const prior = transaction.settlements[key];
			if (prior && prior.status === "settled")
				return fail(RETENTION_INVALID_CODE, [
					`Holder ${JSON.stringify(key)} already settled; a completed deletion effect can never repeat — retry targets only unsettled Holders`,
				]);
			return null;
		},
		(fold) => fold.find((entry) => entry.id === input.transactionId),
	);
}

function deletionStatus(cwd, id) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	let transaction;
	try {
		transaction = foldTransactions(cwd).find((entry) => entry.id === id) ?? null;
	} catch (err) {
		return fail(err.amberCode || TX_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (transaction === null)
		return fail(RETENTION_NOT_FOUND_CODE, [`transaction ${JSON.stringify(id)} does not exist`]);
	const holders = transaction.holders.map((entry) => ({
		holder: { id: entry.id, version: entry.version },
		surface: entry.surface,
		adapter: entry.adapter,
		settlement: transaction.settlements[holderKey(entry.id, entry.version)] ?? null,
	}));
	return {
		ok: true,
		code: null,
		record: {
			id: transaction.id,
			candidateId: transaction.candidateId,
			candidateHash: transaction.candidateHash,
			executedAt: transaction.executedAt,
			status: transaction.status,
			holders,
			unsettled: holders
				.filter((entry) => entry.settlement === null || entry.settlement.status !== "settled")
				.map((entry) => holderKey(entry.holder.id, entry.holder.version)),
		},
		errors: [],
	};
}

/**
 * The minimal Deletion Proof, derived read-only and ONLY from full
 * coverage: transaction identity, declared coverage, per-Holder receipts,
 * policy and legal-basis pins, settlement time, and a controlled salted
 * proof fingerprint (salted with the ledger-internal execution hash — not
 * reconstructable from public content, and never a content hash). It
 * states declared, settled coverage — never universal physical erasure.
 */
function deletionProof(cwd, id) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	const status = deletionStatus(cwd, id);
	if (!status.ok) return status;
	if (status.record.status !== "completed")
		return fail(RETENTION_INVALID_CODE, [
			`transaction ${JSON.stringify(id)} is deletion-pending; the Proof states only settled coverage and can never overclaim`,
		]);
	let candidate;
	try {
		candidate = showDeletionCandidate(cwd, status.record.candidateId);
	} catch (err) {
		return fail(err.amberCode || CANDIDATE_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (candidate === null)
		return fail(RETENTION_NOT_FOUND_CODE, [
			`candidate ${JSON.stringify(status.record.candidateId)} does not exist`,
		]);
	let transaction;
	try {
		transaction = foldTransactions(cwd).find((entry) => entry.id === id) ?? null;
	} catch (err) {
		return fail(err.amberCode || TX_CORRUPT_CODE, [err.message || String(err)]);
	}
	// The append-only ledger cannot lose the transaction between the two
	// folds; fail closed anyway rather than dereference a hole.
	if (transaction === null)
		return fail(TX_CORRUPT_CODE, [`transaction ${JSON.stringify(id)} vanished between reads`]);
	const settledAt = status.record.holders
		.map((entry) => entry.settlement.at)
		.sort()
		.at(-1);
	return {
		ok: true,
		code: null,
		record: {
			transactionId: id,
			candidateId: candidate.id,
			candidateHash: candidate.candidateHash,
			declaredCoverage: {
				records: candidate.records.map((entry) => ({
					record: entry.record,
					retentionClass: entry.retentionClass,
					legalBasis: entry.legalBasis,
					policy: entry.policy,
				})),
				holders: status.record.holders.map((entry) => ({
					holder: entry.holder,
					surface: entry.surface,
				})),
			},
			receipts: status.record.holders.map((entry) => ({
				holder: entry.holder,
				adapter: entry.adapter,
				status: entry.settlement.status,
				receiptHash: entry.settlement.receiptHash,
				at: entry.settlement.at,
			})),
			authorization: candidate.authorization,
			settledAt,
			proofFingerprint: canonicalHashOf({
				salt: transaction.executionHash,
				transactionId: id,
				candidateHash: candidate.candidateHash,
			}),
		},
		errors: [],
	};
}

// Deleted records project as tombstones: minimal stable identity plus the
// proof reference, never content — pending transactions read as pending.
// Cross-ledger integrity fails closed: a transaction whose candidate does
// not resolve (candidates ledger removed, emptied, or truncated) throws
// instead of silently dropping the tombstone — otherwise a deleted record
// would project live with content hashes and the Gate guard would stop
// firing.
function deletionTombstones(cwd) {
	const transactions = foldTransactions(cwd);
	if (transactions.length === 0) return [];
	const candidates = foldCandidates(cwd);
	const tombstones = [];
	for (const transaction of transactions) {
		const candidate = candidates.find((entry) => entry.id === transaction.candidateId);
		if (!candidate)
			throw typedError(
				TX_CORRUPT_CODE,
				`deletion transaction ${JSON.stringify(transaction.id)} references candidate ${JSON.stringify(transaction.candidateId)} that does not resolve in the candidate ledger; tombstone derivation fails closed — restore .amber/retention/candidates.jsonl (a missing ledger half never reads as empty)`,
			);
		for (const entry of candidate.records) {
			tombstones.push({
				record: entry.record,
				transactionId: transaction.id,
				status: transaction.status === "completed" ? "deleted" : "deletion-pending",
			});
		}
	}
	return tombstones;
}

module.exports = {
	RETENTION_SCHEMA_VERSION,
	SUPPORTED_RETENTION_SCHEMA_VERSIONS,
	DEFAULT_MAX_RETENTION_BYTES,
	MAX_RETENTION_TTL_MS,
	RETENTION_CLASSES,
	RETENTION_SENSITIVITIES,
	GENESIS_HASH,
	chainHash,
	classificationsPath,
	classify,
	evaluateRetention,
	listClassifications,
	RETENTION_DECISION_KINDS,
	HOLD_STATUSES,
	holdsPath,
	hold,
	releaseHold,
	listHolds,
	HOLDER_SURFACES,
	CANDIDATE_STATUSES,
	holdersPath,
	registerHolder,
	listHolders,
	candidatesPath,
	prepareDeletionCandidate,
	authorizeDeletion,
	showDeletionCandidate,
	listDeletionCandidates,
	SETTLEMENT_STATUSES,
	TRANSACTION_STATUSES,
	transactionsPath,
	executeDeletion,
	settleHolder,
	deletionStatus,
	deletionProof,
	deletionTombstones,
};
