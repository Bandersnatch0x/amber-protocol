"use strict";

// F050 ticket 2 (#227) — Evidence receipts & Assurance levels.
//
// A claim can no longer impersonate verification, and a Runner can no longer
// award itself proof. Evidence is admitted as an append-only receipt ledger
// under .amber/evidence/receipts.jsonl (hash-chained and write-locked through
// the shared registry-ledger disciplines), where every receipt binds
// identity, producer (a registry-verified principal snapshot), scope, subject,
// inputs, tools, environment, time, status, and outputs — enough for a
// reviewer to assess what actually ran.
//
// Assurance is a fixed four-level contract: unavailable | observed |
// replayable | verified. A recorded receipt carries at most `replayable`
// (deterministic replay must name what it replayed via `replayOf`); only an
// INDEPENDENT registered principal — one whose id differs from the producer's
// — can append a verification event, and only a verification event promotes
// the effective assurance to `verified`. A Runner naming itself as verifier,
// or a receipt claiming `verified` at record time, fails closed with its own
// stable code.
//
// The ledger never stores derived state: the effective assurance and the
// verifiedBy list are computed by the read seams (fold) — a later
// verification changes what a read returns without rewriting any event.

const { typedError } = require("./error-catalog");
const {
	GENESIS_HASH,
	chainHash,
	appendWithinCeiling: sharedAppendWithinCeiling,
} = require("./registry-ledger");
const { defineLedgerFamily } = require("./ledger-family");
const { resolveActivePrincipal } = require("./principal-registry");

const REGISTRY_CORRUPT_CODE = "AMBER_E_EVIDENCE_REGISTRY_CORRUPT";
const UNSUPPORTED_VERSION_CODE = "AMBER_E_EVIDENCE_UNSUPPORTED_VERSION";
const SIZE_CEILING_CODE = "AMBER_E_EVIDENCE_SIZE_CEILING";
const LOCK_CONFLICT_CODE = "AMBER_E_EVIDENCE_REGISTRY_LOCK";
const ALREADY_RECORDED_CODE = "AMBER_E_EVIDENCE_ALREADY_RECORDED";
const ALREADY_VERIFIED_CODE = "AMBER_E_EVIDENCE_ALREADY_VERIFIED";
const NOT_FOUND_CODE = "AMBER_E_EVIDENCE_NOT_FOUND";
const ASSURANCE_FORBIDDEN_CODE = "AMBER_E_EVIDENCE_ASSURANCE_FORBIDDEN";
const SELF_VERIFICATION_CODE = "AMBER_E_EVIDENCE_SELF_VERIFICATION";
const REPLAY_OF_CONFLICT_CODE = "AMBER_E_EVIDENCE_REPLAY_OF_CONFLICT";
const INVALID_ARG_CODE = "AMBER_E_INVALID_ARG";

/** Version of the receipt event contract this module writes and reads. */
const EVIDENCE_SCHEMA_VERSION = 1;

/** Every receipt event schemaVersion this reader can interpret, ascending. */
const SUPPORTED_EVIDENCE_SCHEMA_VERSIONS = Object.freeze([1]);

/** The fixed four-level Assurance contract (F050 AC2). */
const ASSURANCE_LEVELS = Object.freeze(["unavailable", "observed", "replayable", "verified"]);

/**
 * The levels a receipt may be RECORDED with. `verified` is not recordable:
 * only an independent verification event promotes effective assurance past
 * the producer's own claim (F050 AC3/AC4).
 */
const RECORDABLE_ASSURANCE = Object.freeze(["unavailable", "observed", "replayable"]);

/** The closed set of run statuses a receipt may carry. */
const EVIDENCE_STATUSES = Object.freeze(["pass", "fail"]);

/**
 * Ledger size ceiling in bytes (default 1 MiB; deliberate overrides via
 * AMBER_EVIDENCE_MAX_REGISTRY_BYTES). Checked before any durable state is
 * touched — first on the body, then under the lock on the exact chained line.
 */
const DEFAULT_MAX_EVIDENCE_BYTES = 1024 * 1024;

// Bounded receipt content: the ledger must stay small and reviewable, so the
// writers refuse (typed argument error, never silent truncation) a receipt
// that would smuggle unbounded output into governed state. Every string
// field and array entry is capped — the 1 MiB ledger ceiling is the last
// line of defense, not the only bound.
const MAX_INPUTS = 32;
const MAX_TOOLS = 16;
const MAX_ENV_KEYS = 32;
const MAX_OUTPUTS = 8;
const MAX_OUTPUT_CHARS = 2000;
const MAX_ENTRY_CHARS = 2000;
const MAX_SUBJECT_CHARS = 200;
const MAX_SCOPE_CHARS = 200;
const MAX_REPLAY_OF_CHARS = 200;
const MAX_ID_CHARS = 200;

// Closed field sets per event kind: an event carrying a top-level field
// outside its kind's contract is corruption on read, never silently dropped.
// Every event carries the hash chain (prevHash/hash) exactly like the
// principal registry.
const RECORDED_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"receipt",
	"prevHash",
	"hash",
]);
const VERIFIED_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"evidenceId",
	"verifier",
	"prevHash",
	"hash",
]);
const RECEIPT_FIELDS = Object.freeze([
	"id",
	"producer",
	"assurance",
	"scope",
	"subject",
	"inputs",
	"tools",
	"environment",
	"outputs",
	// Optional F062 execution digest.  It is deliberately optional so older
	// receipts remain byte-identical and continue to fold, while execution
	// receipts can bind their complete output envelope without smuggling it into
	// the bounded preview array.
	"outputDigest",
	"status",
	"replayOf",
	"recordedAt",
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

function evidenceCorrupt(message) {
	return typedError(REGISTRY_CORRUPT_CODE, message);
}

function isNullableNonEmptyString(value) {
	return value === null || (typeof value === "string" && value.length > 0);
}

function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Input-shape verdict for one receipt's arrays/object: bounded, closed
 * shapes only — arrays of non-empty strings within their cap, an environment
 * object of non-empty string keys to non-empty string values.
 * @returns {string|null} The argument problem, or null.
 */
function boundedStringArrayProblem(label, value, cap, charsCap = MAX_ENTRY_CHARS) {
	if (value === undefined || value === null) return null;
	if (!Array.isArray(value))
		return `${label} must be an array of non-empty strings; got ${JSON.stringify(value)}`;
	if (value.length > cap) {
		return `${label} must carry at most ${cap} entries; got ${value.length} — the receipt contract keeps the ledger bounded`;
	}
	for (const entry of value) {
		if (typeof entry !== "string" || entry.length === 0) {
			return `${label} must be an array of non-empty strings; got ${JSON.stringify(entry)}`;
		}
		if (entry.length > charsCap) {
			return `each ${label} entry must carry at most ${charsCap} characters; got ${entry.length} — the receipt contract keeps the ledger bounded`;
		}
	}
	return null;
}

function environmentProblem(environment) {
	if (environment === undefined || environment === null) return null;
	if (!isPlainObject(environment)) {
		return `environment must be an object mapping non-empty keys to non-empty string values; got ${JSON.stringify(environment)}`;
	}
	const keys = Object.keys(environment);
	if (keys.length > MAX_ENV_KEYS) {
		return `environment must carry at most ${MAX_ENV_KEYS} keys; got ${keys.length} — the receipt contract keeps the ledger bounded`;
	}
	for (const key of keys) {
		const value = environment[key];
		if (key.length === 0 || typeof value !== "string" || value.length === 0) {
			return `environment must map non-empty keys to non-empty string values; got ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
		}
		if (value.length > MAX_ENTRY_CHARS) {
			return `each environment value must carry at most ${MAX_ENTRY_CHARS} characters; key ${JSON.stringify(key)} carries ${value.length} — the receipt contract keeps the ledger bounded`;
		}
	}
	return null;
}

function boundedOutputProblem(outputs) {
	const base = boundedStringArrayProblem("outputs", outputs, MAX_OUTPUTS);
	if (base !== null) return base;
	if (Array.isArray(outputs)) {
		for (const entry of outputs) {
			if (entry.length > MAX_OUTPUT_CHARS) {
				return `each output must carry at most ${MAX_OUTPUT_CHARS} characters; got ${entry.length} — the receipt contract keeps the ledger bounded`;
			}
		}
	}
	return null;
}

function boundedScalarProblem(label, value, cap) {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string" || value.length === 0) {
		return `${label} must be a non-empty string; got ${JSON.stringify(value)}`;
	}
	if (value.length > cap) {
		return `${label} must carry at most ${cap} characters; got ${value.length} — the receipt contract keeps the ledger bounded`;
	}
	return null;
}

/**
 * The full input-shape verdict for one receipt admission (before any registry
 * or ledger state is touched). Semantic verdicts (forbidden assurance,
 * replayOf consistency) carry their own stable codes and are checked
 * separately.
 * @returns {string|null} The argument problem, or null.
 */
function receiptInputProblem({
	id,
	assurance,
	scope,
	subject,
	inputs,
	tools,
	environment,
	outputs,
	status,
	replayOf,
}) {
	if (typeof id !== "string" || id.trim().length === 0) {
		return `evidence id must be a non-empty string (e.g. --id evidence/test-run-42); got ${JSON.stringify(id)}`;
	}
	if (id.length > MAX_ID_CHARS) {
		return `evidence id must carry at most ${MAX_ID_CHARS} characters; got ${id.length}`;
	}
	if (!isNullableNonEmptyString(scope)) {
		return `scope must be a non-empty string or null; got ${JSON.stringify(scope)}`;
	}
	if (scope !== null && scope.length > MAX_SCOPE_CHARS) {
		return `scope must carry at most ${MAX_SCOPE_CHARS} characters; got ${scope.length} — the receipt contract keeps the ledger bounded`;
	}
	const subjectProblem = boundedScalarProblem("subject", subject, MAX_SUBJECT_CHARS);
	if (subjectProblem !== null) return subjectProblem;
	if (typeof subject !== "string" || subject.length === 0) {
		return `subject is required: the receipt must name the artifact, eval, or surface the evidence attests about (e.g. --subject spec/login@2); got ${JSON.stringify(subject)}`;
	}
	if (!EVIDENCE_STATUSES.includes(status)) {
		return `status must be one of the closed set (${EVIDENCE_STATUSES.join(", ")}); got ${JSON.stringify(status)}`;
	}
	for (const [label, value, cap] of [
		["inputs", inputs, MAX_INPUTS],
		["tools", tools, MAX_TOOLS],
	]) {
		const problem = boundedStringArrayProblem(label, value, cap);
		if (problem !== null) return problem;
	}
	const envProblem = environmentProblem(environment);
	if (envProblem !== null) return envProblem;
	const outputProblem = boundedOutputProblem(outputs);
	if (outputProblem !== null) return outputProblem;
	const replayOfProblem = boundedScalarProblem("replayOf", replayOf, MAX_REPLAY_OF_CHARS);
	if (replayOfProblem !== null) return replayOfProblem;
	if (assurance !== undefined && !ASSURANCE_LEVELS.includes(assurance)) {
		return `assurance must be one of the fixed four-level contract (${ASSURANCE_LEVELS.join(", ")}); got ${JSON.stringify(assurance)}`;
	}
	return null;
}

/**
 * Replay provenance (F050 AC3): `replayable` is the assurance level of a
 * deterministic replay, so a replayable receipt MUST name the definition it
 * replayed (an Eval id, a command definition, a suite version) and no other
 * level may carry one — otherwise a bare claim could wear the replayable
 * label without anything to replay.
 * @returns {{code: string, message: string}|null}
 */
function replayOfProblem(assurance, replayOf) {
	if (assurance === "replayable" && !(typeof replayOf === "string" && replayOf.length > 0)) {
		return {
			code: REPLAY_OF_CONFLICT_CODE,
			message: `a replayable receipt must name the deterministic definition it replayed via replayOf (e.g. --replay-of eval.instruction-surface) — otherwise "replayable" is a bare claim with nothing to replay; got ${JSON.stringify(replayOf)}`,
		};
	}
	if (assurance !== "replayable" && replayOf != null) {
		return {
			code: REPLAY_OF_CONFLICT_CODE,
			message: `replayOf is reserved for replayable receipts (deterministic replay provenance); an ${JSON.stringify(assurance)} receipt cannot carry replayOf ${JSON.stringify(replayOf)}`,
		};
	}
	return null;
}

// The pre-chain half of the fold (the declared `fold.preLink` step,
// ADR-0028 Amendment): the ledger's recorded contract adjudicates the
// event's shape, schemaVersion, and timestamp BEFORE the chain link, so an
// unchained or hand-edited event still gets the dedicated version verdict
// (AMBER_E_EVIDENCE_UNSUPPORTED_VERSION) instead of a generic chain problem.
function evidencePreLink(event, lineIndex) {
	if (event === null || typeof event !== "object" || Array.isArray(event)) {
		throw evidenceCorrupt(
			`evidence ledger event ${lineIndex} is not an object; got ${JSON.stringify(event)}`,
		);
	}
	const schemaVersion = event.schemaVersion;
	if (!Number.isInteger(schemaVersion)) {
		throw evidenceCorrupt(
			`evidence ledger event ${lineIndex} carries no integer schemaVersion; got ${JSON.stringify(schemaVersion)}`,
		);
	}
	if (!SUPPORTED_EVIDENCE_SCHEMA_VERSIONS.includes(schemaVersion)) {
		throw typedError(
			UNSUPPORTED_VERSION_CODE,
			`evidence ledger event ${lineIndex} declares schemaVersion ${JSON.stringify(schemaVersion)}, but this reader supports ${SUPPORTED_EVIDENCE_SCHEMA_VERSIONS.join(", ")}; an event this reader cannot interpret is rejected rather than reinterpreted — upgrade amber or rebuild the ledger under the supported schema version`,
		);
	}
	if (typeof event.at !== "string" || event.at.length === 0) {
		throw evidenceCorrupt(
			`evidence ledger event ${lineIndex} carries no timestamp ("at"); got ${JSON.stringify(event.at)}`,
		);
	}
}

// The domain half of the fold, applied to each chain-verified event.
// Fail-closed sequence invariants: the record/verify writers check the
// current state BEFORE appending, so the ledger can only ever hold, per
// id, one `recorded` event followed by at most one `verified` event per
// verifier — anything else was hand-edited. State is the byId map in
// first-recorded order; the fold's projection derives assurance.
function applyEvidenceEvent(byId, event, lineIndex) {
	if (event.kind === "recorded") {
		const unknown = Object.keys(event)
			.filter((key) => !RECORDED_EVENT_FIELDS.includes(key))
			.sort();
		if (unknown.length > 0) {
			throw evidenceCorrupt(
				`evidence ledger event ${lineIndex} is a recorded event carrying unknown field${unknown.length > 1 ? "s" : ""} ${unknown.map((field) => `"${field}"`).join(", ")}; the closed field set is ${RECORDED_EVENT_FIELDS.join(", ")}`,
			);
		}
		const receiptProblem = storedReceiptProblem(event.receipt, lineIndex);
		if (receiptProblem !== null) throw evidenceCorrupt(receiptProblem);
		if (byId.has(event.receipt.id)) {
			throw evidenceCorrupt(
				`evidence ledger event ${lineIndex} records "${event.receipt.id}" a second time; an evidence id is recorded exactly once (a re-run is a new receipt), so the writers can never append this — the ledger was edited in place`,
			);
		}
		byId.set(event.receipt.id, {
			...event.receipt,
			verifiedBy: [],
		});
	} else if (event.kind === "verified") {
		const unknown = Object.keys(event)
			.filter((key) => !VERIFIED_EVENT_FIELDS.includes(key))
			.sort();
		if (unknown.length > 0) {
			throw evidenceCorrupt(
				`evidence ledger event ${lineIndex} is a verified event carrying unknown field${unknown.length > 1 ? "s" : ""} ${unknown.map((field) => `"${field}"`).join(", ")}; the closed field set is ${VERIFIED_EVENT_FIELDS.join(", ")}`,
			);
		}
		if (typeof event.evidenceId !== "string" || event.evidenceId.length === 0) {
			throw evidenceCorrupt(
				`evidence ledger event ${lineIndex} is a verified event whose evidenceId is not a non-empty string; got ${JSON.stringify(event.evidenceId)}`,
			);
		}
		const snapshotProblem = storedSnapshotProblem(event.verifier, lineIndex, "verifier");
		if (snapshotProblem !== null) throw evidenceCorrupt(snapshotProblem);
		const record = byId.get(event.evidenceId);
		if (record === undefined) {
			throw evidenceCorrupt(
				`evidence ledger event ${lineIndex} verifies "${event.evidenceId}", which was never recorded; the verify writer only appends for a recorded receipt — the ledger was edited in place`,
			);
		}
		if (event.verifier.id === record.producer.id) {
			throw evidenceCorrupt(
				`evidence ledger event ${lineIndex} has "${event.verifier.id}" verifying its own evidence "${event.evidenceId}"; the verify writer refuses self-verification, so the writers can never append this — the ledger was edited in place`,
			);
		}
		if (record.verifiedBy.some((entry) => entry.verifier.id === event.verifier.id)) {
			throw evidenceCorrupt(
				`evidence ledger event ${lineIndex} has "${event.verifier.id}" verifying "${event.evidenceId}" a second time; the verify writer records a verification exactly once per verifier, so the writers can never append this — the ledger was edited in place`,
			);
		}
		record.verifiedBy.push({
			verifier: event.verifier,
			verifiedAt: event.at,
		});
	} else {
		throw evidenceCorrupt(
			`evidence ledger event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}; the closed kind set is recorded, verified`,
		);
	}
}

function evidenceChainWording(kind, event, lineIndex, label) {
	if (kind === "broken") {
		return `${label} event ${lineIndex} breaks the hash chain: its prevHash does not match the previous event's hash — the ledger was edited in place`;
	}
	if (kind === "mismatch") {
		return `${label} event ${lineIndex} carries a hash that does not match its content — the ledger was edited in place`;
	}
	return `${label} event ${lineIndex} is not an object; got ${JSON.stringify(event)}`;
}

function evidenceCeilingMessage(event, ceiling) {
	if (event.kind === "recorded") {
		return `appending the receipt for "${event.receipt.id}" would grow the evidence ledger beyond its size ceiling of ${ceiling} bytes (AMBER_EVIDENCE_MAX_REGISTRY_BYTES); the write is refused before any durable state is touched — keep outputs bounded or raise the ceiling deliberately`;
	}
	return `appending the verification for "${event.evidenceId}" would grow the evidence ledger beyond its size ceiling of ${ceiling} bytes (AMBER_EVIDENCE_MAX_REGISTRY_BYTES); the write is refused before any durable state is touched`;
}

function projectEvidenceRecord(record) {
	return {
		...record,
		assurance: record.verifiedBy.length > 0 ? "verified" : record.assurance,
		recordedAssurance: record.assurance,
	};
}

// F061 follow-up (#308) — the ledger ritual is assembled by
// `defineLedgerFamily` (ADR-0028), byte-identically to the hand-written
// ceremony it replaces: the same path (`.amber/evidence/receipts.jsonl`),
// lock name (`receipts.lock`; the 30s stale bound now rides the shared
// default), stable codes, and "evidence ledger" label in lock/read
// refusals and as the per-event problem prefix. This family declares the
// Amendment extensions: `fold.preLink` (pre-chain shape/version/at),
// `fold.chainWording` (recorded prevHash / edited-in-place chain text),
// and `ceiling.message` (AMBER_EVIDENCE_MAX_REGISTRY_BYTES wording).
const EVIDENCE_FAMILY = defineLedgerFamily({
	dir: "evidence",
	label: "evidence ledger",
	ledgers: [
		{
			name: "receipts",
			fileName: "receipts.jsonl",
			lockName: "receipts.lock",
			conflictCode: LOCK_CONFLICT_CODE,
			corruptCode: REGISTRY_CORRUPT_CODE,
			sizeCeilingCode: SIZE_CEILING_CODE,
			ceiling: {
				envName: "AMBER_EVIDENCE_MAX_REGISTRY_BYTES",
				defaultBytes: DEFAULT_MAX_EVIDENCE_BYTES,
				message: evidenceCeilingMessage,
			},
			label: "evidence ledger",
			eventLabel: "evidence ledger",
			fold: {
				init: () => new Map(),
				preLink: evidencePreLink,
				chainWording: evidenceChainWording,
				apply: applyEvidenceEvent,
				result: (byId) => [...byId.values()].map(projectEvidenceRecord),
			},
		},
	],
});

const EVIDENCE_LEDGER = EVIDENCE_FAMILY.ledgers.receipts;

/**
 * Fold the ledger: fail-closed raw read, preLink, chain walk, domain apply
 * — per event in ledger order. Returns the derived records — effective
 * assurance and verifiedBy computed, never stored.
 * @returns {Array<object>} The derived evidence records, in first-recorded order.
 * @throws {Error} Typed AMBER_E_* on any corruption.
 */
const foldEvidence = EVIDENCE_LEDGER.fold;

/**
 * The stored receipt contract on fold: closed field set, closed assurance and
 * status sets, replayOf consistency, bounded arrays, and the frozen producer
 * snapshot. A receipt only the writers could have produced satisfies every
 * clause; anything else is hand-edited state.
 * @returns {string|null} The corruption message, or null.
 */
function storedReceiptProblem(receipt, lineIndex) {
	if (!isPlainObject(receipt)) {
		return `evidence ledger event ${lineIndex} carries a receipt that is not an object; got ${JSON.stringify(receipt)}`;
	}
	const unknown = Object.keys(receipt)
		.filter((key) => !RECEIPT_FIELDS.includes(key))
		.sort();
	if (unknown.length > 0) {
		return `evidence ledger event ${lineIndex} carries a receipt with unknown field${unknown.length > 1 ? "s" : ""} ${unknown.map((field) => `"${field}"`).join(", ")}; the closed field set is ${RECEIPT_FIELDS.join(", ")}`;
	}
	const snapshotProblem = storedSnapshotProblem(receipt.producer, lineIndex, "producer");
	if (snapshotProblem !== null) return snapshotProblem;
	if (!RECORDABLE_ASSURANCE.includes(receipt.assurance)) {
		return `evidence ledger event ${lineIndex} carries a receipt whose assurance ${JSON.stringify(receipt.assurance)} is outside the recordable set (${RECORDABLE_ASSURANCE.join(", ")}); only an independent verification event can award verified — the writers can never append this, so the ledger was edited in place`;
	}
	if (!EVIDENCE_STATUSES.includes(receipt.status)) {
		return `evidence ledger event ${lineIndex} carries a receipt whose status ${JSON.stringify(receipt.status)} is outside the closed set (${EVIDENCE_STATUSES.join(", ")})`;
	}
	if (
		typeof receipt.id !== "string" ||
		receipt.id.length === 0 ||
		receipt.id.length > MAX_ID_CHARS
	) {
		return `evidence ledger event ${lineIndex} carries a receipt whose id is not a non-empty string of at most ${MAX_ID_CHARS} characters; got ${JSON.stringify(receipt.id)}`;
	}
	if (!isNullableNonEmptyString(receipt.scope)) {
		return `evidence ledger event ${lineIndex} carries a receipt whose scope is neither null nor a non-empty string; got ${JSON.stringify(receipt.scope)}`;
	}
	if (receipt.scope !== null && receipt.scope.length > MAX_SCOPE_CHARS) {
		return `evidence ledger event ${lineIndex} carries a receipt whose scope exceeds ${MAX_SCOPE_CHARS} characters; got ${receipt.scope.length}`;
	}
	if (
		typeof receipt.subject !== "string" ||
		receipt.subject.length === 0 ||
		receipt.subject.length > MAX_SUBJECT_CHARS
	) {
		return `evidence ledger event ${lineIndex} carries a receipt whose subject is not a non-empty string of at most ${MAX_SUBJECT_CHARS} characters; got ${JSON.stringify(receipt.subject)}`;
	}
	if (typeof receipt.recordedAt !== "string" || receipt.recordedAt.length === 0) {
		return `evidence ledger event ${lineIndex} carries a receipt with no recordedAt timestamp; got ${JSON.stringify(receipt.recordedAt)}`;
	}
	for (const [label, cap] of [
		["inputs", MAX_INPUTS],
		["tools", MAX_TOOLS],
	]) {
		const value = receipt[label];
		if (
			!Array.isArray(value) ||
			value.length > cap ||
			value.some(
				(entry) =>
					typeof entry !== "string" || entry.length === 0 || entry.length > MAX_ENTRY_CHARS,
			)
		) {
			return `evidence ledger event ${lineIndex} carries a receipt whose ${label} is not an array of at most ${cap} non-empty strings of at most ${MAX_ENTRY_CHARS} characters; got ${JSON.stringify(value)}`;
		}
	}
	if (
		!isPlainObject(receipt.environment) ||
		Object.keys(receipt.environment).length > MAX_ENV_KEYS ||
		Object.entries(receipt.environment).some(
			([key, value]) =>
				key.length === 0 ||
				typeof value !== "string" ||
				value.length === 0 ||
				value.length > MAX_ENTRY_CHARS,
		)
	) {
		return `evidence ledger event ${lineIndex} carries a receipt whose environment is not an object of at most ${MAX_ENV_KEYS} non-empty string keys to non-empty string values of at most ${MAX_ENTRY_CHARS} characters; got ${JSON.stringify(receipt.environment)}`;
	}
	if (
		!Array.isArray(receipt.outputs) ||
		receipt.outputs.length > MAX_OUTPUTS ||
		receipt.outputs.some(
			(entry) => typeof entry !== "string" || entry.length === 0 || entry.length > MAX_OUTPUT_CHARS,
		)
	) {
		return `evidence ledger event ${lineIndex} carries a receipt whose outputs is not an array of at most ${MAX_OUTPUTS} non-empty strings of at most ${MAX_OUTPUT_CHARS} characters; got ${JSON.stringify(receipt.outputs)}`;
	}
	if (
		receipt.outputDigest !== undefined &&
		(typeof receipt.outputDigest !== "string" ||
			!/^sha256:[0-9a-f]{64}$/.test(receipt.outputDigest))
	) {
		return `evidence ledger event ${lineIndex} carries a receipt whose outputDigest is not a sha256:<64-hex> string; got ${JSON.stringify(receipt.outputDigest)}`;
	}
	const replayOf = receipt.replayOf;
	if (
		!isNullableNonEmptyString(replayOf) ||
		(replayOf !== null && replayOf.length > MAX_REPLAY_OF_CHARS)
	) {
		return `evidence ledger event ${lineIndex} carries a receipt whose replayOf is neither null nor a non-empty string of at most ${MAX_REPLAY_OF_CHARS} characters; got ${JSON.stringify(replayOf)}`;
	}
	if (receipt.assurance === "replayable" && replayOf === null) {
		return `evidence ledger event ${lineIndex} carries a replayable receipt with no replayOf; the record writer refuses a bare replayable claim, so the ledger was edited in place`;
	}
	if (receipt.assurance !== "replayable" && replayOf !== null) {
		return `evidence ledger event ${lineIndex} carries a non-replayable receipt with replayOf ${JSON.stringify(replayOf)}; replayOf is reserved for replayable receipts, so the ledger was edited in place`;
	}
	return null;
}

/** The frozen 9-field principal snapshot contract (shared with decisions). */
function storedSnapshotProblem(snapshot, lineIndex, role) {
	if (!isPlainObject(snapshot)) {
		return `evidence ledger event ${lineIndex} carries a ${role} snapshot that is not an object; got ${JSON.stringify(snapshot)}`;
	}
	const keys = Object.keys(snapshot).sort();
	if (
		keys.length !== PRINCIPAL_SNAPSHOT_FIELDS.length ||
		keys.some((field) => !PRINCIPAL_SNAPSHOT_FIELDS.includes(field))
	) {
		return `evidence ledger event ${lineIndex} carries a ${role} snapshot that does not bind exactly the frozen registry record fields (${PRINCIPAL_SNAPSHOT_FIELDS.join(", ")}); got ${JSON.stringify(snapshot)}`;
	}
	if (typeof snapshot.id !== "string" || snapshot.id.length === 0) {
		return `evidence ledger event ${lineIndex} carries a ${role} snapshot whose id is not a non-empty string; got ${JSON.stringify(snapshot.id)}`;
	}
	if (snapshot.principalKind !== "human" && snapshot.principalKind !== "service") {
		return `evidence ledger event ${lineIndex} carries a ${role} snapshot whose principalKind ${JSON.stringify(snapshot.principalKind)} is outside the closed set (human, service)`;
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
			return `evidence ledger event ${lineIndex} carries a ${role} snapshot whose ${field} is neither null nor a non-empty string; got ${JSON.stringify(snapshot[field])}`;
		}
	}
	return null;
}

function appendWithinCeiling(cwd, event) {
	return sharedAppendWithinCeiling({
		ledgerPath: EVIDENCE_LEDGER.path(cwd),
		event,
		envName: "AMBER_EVIDENCE_MAX_REGISTRY_BYTES",
		defaultBytes: DEFAULT_MAX_EVIDENCE_BYTES,
		label: "evidence ledger",
	});
}

function fromAppend(result) {
	if (!result.ok) return { ok: false, code: result.code, receipt: null, errors: result.errors };
	return { ok: true, code: null, receipt: result.record, errors: [] };
}

/**
 * Record one Evidence receipt. The producer is verified against the Principal
 * registry and frozen into the receipt (the same binding discipline as
 * Decision admission); assurance is capped at `replayable`, and a replayable
 * receipt must name what it replayed.
 * @param {string} cwd - Repository root.
 * @param {object} input - The receipt fields ({ id, producer, assurance, scope,
 *        subject, inputs, tools, environment, outputs, status, replayOf }).
 * @param {object} [opts] - { now } clock injection for registry verification.
 * @returns {{ok: boolean, code: string|null, receipt: object|null, errors: string[]}}
 */
function recordEvidence(cwd, input, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, receipt: null, errors });
	const {
		id,
		producer,
		assurance,
		scope = null,
		subject,
		inputs = [],
		tools = [],
		environment = {},
		outputs = [],
		outputDigest,
		status,
		replayOf = null,
	} = input;
	// Explicit nulls are normalized to the stored defaults: the write-side
	// validators treat null as absent, but the destructuring defaults only
	// cover undefined — a stored null would read back as corruption and
	// brick the ledger, so the writer only ever stores fold-readable shapes.
	const storedInputs = inputs ?? [];
	const storedTools = tools ?? [];
	const storedEnvironment = environment ?? {};
	const storedOutputs = outputs ?? [];
	const storedOutputDigest = outputDigest ?? undefined;
	if (
		storedOutputDigest !== undefined &&
		(typeof storedOutputDigest !== "string" ||
			!/^sha256:[0-9a-f]{64}$/.test(storedOutputDigest))
	) {
		return fail(INVALID_ARG_CODE, [
			`outputDigest must be a sha256:<64-hex> string when provided; got ${JSON.stringify(storedOutputDigest)}`,
		]);
	}
	if (typeof producer !== "string" || producer.trim().length === 0) {
		return fail(INVALID_ARG_CODE, [
			`producer is required: the receipt must bind the Principal that produced the evidence, verified against the registry (e.g. --producer ci-bot); got ${JSON.stringify(producer)}`,
		]);
	}
	if (assurance === "verified") {
		return fail(ASSURANCE_FORBIDDEN_CODE, [
			`evidence "${id}" cannot be recorded with assurance "verified": a Runner can never award itself proof — only an independent registered principal can append a verification (amber evidence verify --id ${JSON.stringify(id)} --verifier <other-principal>), which promotes the effective assurance to verified`,
		]);
	}
	// assurance is required, not defaulted: an undefined assurance would
	// JSON-drop out of the stored receipt and the fold would then read that
	// same line as corruption — the writer must refuse what it cannot store.
	if (typeof assurance !== "string" || !RECORDABLE_ASSURANCE.includes(assurance)) {
		return fail(INVALID_ARG_CODE, [
			`assurance is required and must be one of the recordable levels (${RECORDABLE_ASSURANCE.join(", ")}); got ${JSON.stringify(assurance)} — "verified" is not recordable: only an independent verification event promotes effective assurance to verified`,
		]);
	}
	const inputProblem = receiptInputProblem({
		id,
		assurance,
		scope,
		subject,
		inputs: storedInputs,
		tools: storedTools,
		environment: storedEnvironment,
		outputs: storedOutputs,
		status,
		replayOf,
	});
	if (inputProblem !== null) return fail(INVALID_ARG_CODE, [inputProblem]);
	const replayProblem = replayOfProblem(assurance, replayOf);
	if (replayProblem !== null) return fail(replayProblem.code, [replayProblem.message]);

	// The producer binding is registry-verified exactly like a Decision's
	// principal: registered, unrevoked, inside its validity window at the
	// caller's clock. Registry failures propagate the registry's own codes.
	let resolvedProducer;
	try {
		resolvedProducer = resolveActivePrincipal(cwd, producer, { now: opts.now ?? new Date() });
	} catch (err) {
		return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
	}
	if (!resolvedProducer.ok) return fail(resolvedProducer.code, [resolvedProducer.message]);

	let current;
	try {
		current = foldEvidence(cwd);
	} catch (err) {
		return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
	}
	if (current.some((record) => record.id === id)) {
		return fail(ALREADY_RECORDED_CODE, [
			`evidence "${id}" is already recorded; an evidence id is recorded exactly once — record the re-run under a distinct id (e.g. --id ${JSON.stringify(`${id}-2`)})`,
		]);
	}

	const at = new Date().toISOString();
	const body = {
		kind: "recorded",
		schemaVersion: EVIDENCE_SCHEMA_VERSION,
		at,
		receipt: {
			id,
			producer: Object.freeze({ ...resolvedProducer.principal }),
			assurance,
			scope,
			subject,
			inputs: storedInputs,
			tools: storedTools,
			environment: storedEnvironment,
			outputs: storedOutputs,
			...(storedOutputDigest === undefined ? {} : { outputDigest: storedOutputDigest }),
			status,
			replayOf,
			recordedAt: at,
		},
	};
	let ceilingCheck;
	try {
		ceilingCheck = appendWithinCeiling(cwd, body);
	} catch (err) {
		return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
	}
	if (ceilingCheck.wouldExceed) {
		return fail(SIZE_CEILING_CODE, [evidenceCeilingMessage(body, ceilingCheck.ceiling)]);
	}
	return fromAppend(
		EVIDENCE_LEDGER.append(
			cwd,
			body,
			(fresh) =>
				fresh.some((record) => record.id === id)
					? fail(ALREADY_RECORDED_CODE, [
							`evidence "${id}" is already recorded; an evidence id is recorded exactly once — record the re-run under a distinct id`,
						])
					: null,
			(fold) => fold.find((record) => record.id === id),
		),
	);
}

/**
 * Append one independent verification event: the verifier must be a
 * registered, active principal whose id differs from the receipt's producer
 * (a Runner cannot award itself proof), and the evidence must be recorded.
 * The verification never rewrites the receipt — the effective assurance is
 * derived at read time.
 * @param {string} cwd - Repository root.
 * @param {object} input - { id, verifier }.
 * @param {object} [opts] - { now } clock injection for registry verification.
 * @returns {{ok: boolean, code: string|null, receipt: object|null, errors: string[]}}
 */
function verifyEvidence(cwd, { id, verifier }, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, receipt: null, errors });
	if (typeof id !== "string" || id.trim().length === 0) {
		return fail(INVALID_ARG_CODE, [
			`evidence id must be a non-empty string; got ${JSON.stringify(id)}`,
		]);
	}
	if (typeof verifier !== "string" || verifier.trim().length === 0) {
		return fail(INVALID_ARG_CODE, [
			`verifier is required: only an independent registered principal can verify evidence (e.g. --verifier alice@example.com); got ${JSON.stringify(verifier)}`,
		]);
	}
	let resolvedVerifier;
	try {
		resolvedVerifier = resolveActivePrincipal(cwd, verifier, { now: opts.now ?? new Date() });
	} catch (err) {
		return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
	}
	if (!resolvedVerifier.ok) return fail(resolvedVerifier.code, [resolvedVerifier.message]);

	let current;
	try {
		current = foldEvidence(cwd);
	} catch (err) {
		return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
	}
	const target = current.find((record) => record.id === id);
	if (!target) {
		return fail(NOT_FOUND_CODE, [
			`evidence "${id}" is not recorded; verification applies to a recorded receipt — record it first (amber evidence record)`,
		]);
	}
	if (resolvedVerifier.principal.id === target.producer.id) {
		return fail(SELF_VERIFICATION_CODE, [
			`principal "${verifier}" produced evidence "${id}" and cannot also verify it: a Runner can never award itself proof — verification requires an independent registered principal (a different id)`,
		]);
	}
	const priorVerification = target.verifiedBy.find(
		(entry) => entry.verifier.id === resolvedVerifier.principal.id,
	);
	if (priorVerification !== undefined) {
		return fail(ALREADY_VERIFIED_CODE, [
			`principal "${verifier}" already verified evidence "${id}" (at ${priorVerification.verifiedAt}); a verification is recorded exactly once per verifier — the effective assurance is already verified, and a second append would only grow the ledger`,
		]);
	}

	const at = new Date().toISOString();
	const body = {
		kind: "verified",
		schemaVersion: EVIDENCE_SCHEMA_VERSION,
		at,
		evidenceId: id,
		verifier: Object.freeze({ ...resolvedVerifier.principal }),
	};
	let ceilingCheck;
	try {
		ceilingCheck = appendWithinCeiling(cwd, body);
	} catch (err) {
		return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
	}
	if (ceilingCheck.wouldExceed) {
		return fail(SIZE_CEILING_CODE, [evidenceCeilingMessage(body, ceilingCheck.ceiling)]);
	}
	return fromAppend(
		EVIDENCE_LEDGER.append(
			cwd,
			body,
			(fresh) => {
				const freshTarget = fresh.find((record) => record.id === id);
				if (!freshTarget) {
					return fail(NOT_FOUND_CODE, [
						`evidence "${id}" is not recorded; verification applies to a recorded receipt`,
					]);
				}
				if (resolvedVerifier.principal.id === freshTarget.producer.id) {
					return fail(SELF_VERIFICATION_CODE, [
						`principal "${verifier}" produced evidence "${id}" and cannot also verify it: verification requires an independent registered principal`,
					]);
				}
				if (
					freshTarget.verifiedBy.some(
						(entry) => entry.verifier.id === resolvedVerifier.principal.id,
					)
				) {
					return fail(ALREADY_VERIFIED_CODE, [
						`principal "${verifier}" already verified evidence "${id}"; a verification is recorded exactly once per verifier`,
					]);
				}
				return null;
			},
			(fold) => fold.find((record) => record.id === id),
		),
	);
}

/**
 * Show one derived evidence record (or null when the id is not recorded).
 * @throws {Error} Typed AMBER_E_* on a corrupt ledger.
 */
function showEvidence(cwd, id) {
	return foldEvidence(cwd).find((record) => record.id === id) ?? null;
}

/**
 * List every derived evidence record in first-recorded order.
 * @throws {Error} Typed AMBER_E_* on a corrupt ledger.
 */
function listEvidence(cwd) {
	return foldEvidence(cwd);
}

module.exports = {
	EVIDENCE_SCHEMA_VERSION,
	SUPPORTED_EVIDENCE_SCHEMA_VERSIONS,
	ASSURANCE_LEVELS,
	RECORDABLE_ASSURANCE,
	EVIDENCE_STATUSES,
	DEFAULT_MAX_EVIDENCE_BYTES,
	GENESIS_HASH,
	chainHash,
	recordEvidence,
	verifyEvidence,
	showEvidence,
	listEvidence,
};
