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

const path = require("node:path");

const { readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { typedError } = require("./error-catalog");
const { listArtifactRevisions, ARTIFACT_TYPES } = require("./canonical-artifacts");
const {
	GENESIS_HASH,
	chainHash,
	acquireLedgerLock,
	appendLedgerEvent,
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
const RETENTION_NOT_FOUND_CODE = "AMBER_E_RETENTION_NOT_FOUND";
const RETENTION_CORRUPT_CODE = "AMBER_E_RETENTION_CORRUPT";
const RETENTION_LOCK_CODE = "AMBER_E_RETENTION_LOCK";
const RETENTION_SIZE_CEILING_CODE = "AMBER_E_RETENTION_SIZE_CEILING";
const HOLD_CORRUPT_CODE = "AMBER_E_RETENTION_HOLD_CORRUPT";
const HOLD_LOCK_CODE = "AMBER_E_RETENTION_HOLD_LOCK";
const HOLD_SIZE_CEILING_CODE = "AMBER_E_RETENTION_HOLD_SIZE_CEILING";

// Human-only authority slots, mirroring the F050/F052/F054 contract.
const RETENTION_DECISION_KINDS = Object.freeze(["acceptance", "approval"]);
const HOLD_STATUSES = Object.freeze(["active", "released"]);

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
		if (!isPlainObject(event))
			throw retentionCorrupt(`retention classification event ${lineIndex} is not an object`);
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash)
			throw retentionCorrupt(`retention classification event ${lineIndex} breaks the hash chain`);
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash)
			throw retentionCorrupt(
				`retention classification event ${lineIndex} carries a hash that does not match its content`,
			);
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
const DECISION_PIN_FIELDS = Object.freeze(["identity", "revision"]);
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
		if (!isPlainObject(event))
			throw holdCorrupt(`retention hold event ${lineIndex} is not an object`);
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash)
			throw holdCorrupt(`retention hold event ${lineIndex} breaks the hash chain`);
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash)
			throw holdCorrupt(
				`retention hold event ${lineIndex} carries a hash that does not match its content`,
			);
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

function decisionPinProblem(value) {
	if (!isPlainObject(value)) return "decision must be an object carrying identity and revision";
	const unknown = unknownFieldProblem(value, DECISION_PIN_FIELDS, "decision");
	if (unknown !== null) return unknown;
	if (!isNonEmptyString(value.identity)) return "decision.identity must be a non-empty string";
	if (!Number.isInteger(value.revision) || value.revision < 1)
		return "decision.revision must be a positive integer";
	return null;
}

// Hold authority mirrors the F052/F054 contract: a committed, unscoped,
// human acceptance/approval Decision with a verified principal snapshot.
function resolveHoldDecision(revisions, decision, label) {
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
	if (!RETENTION_DECISION_KINDS.includes(match.decisionKind))
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
};
