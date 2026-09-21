"use strict";

// F064 Slice 3 — the `suggestion-review` ledger family (trusted-control
// evolution contract §8, docs/specs/trusted-control-evolution-contract.md).
//
// One ledger under `.amber/suggestions/review.jsonl` is the DURABLE AUDIT
// TRAIL of the F064 suggestion review surface, beside the gitignored runtime
// overlay (`state.json`) which stays the persistent current-state owner
// (status, snooze windows, applied byte-records) — the same split ADR-0018 D4
// draws between event ledger (audit) and registry (state). If the overlay is
// deleted or corrupted, review history survives here; snooze windows and
// in-flight card status are overlay-only by contract (§8.1) and are
// deliberately NOT ledger-recorded.
//
// The family is declared through `defineLedgerFamily` (ADR-0028) — the single
// admission path; no hand-written chain code (0045's conclusion). Closed event
// kind set of five (§8.2), each payload closing the fingerprint correlation
// chain `proposed → validated → (rejected | applied)` plus `undone` (F064's
// Undo otherwise leaves an `applied` event misstating the current world):
//
//   proposed   fingerprint, evidence digest, hosts, planned-operations digest,
//              attribution block (a generation record rides only when a host
//              generated the text under a Distillation Contract — the current
//              planner is deterministic, so no record is written today)
//   validated  fingerprint, V1–V3 pass summary — the fingerprint closes the
//              correlation chain
//   rejected   fingerprint, reason (`validity:*` code or operator dismiss
//              reason), redacted evaluation summary
//   applied    fingerprint, applied-record digest (paths, before/after hashes)
//   undone     fingerprint, restored-hashes digest
//
// Read side (§8.3): `suggestionReviewHistory` is the informative
// rejection-history hint — a prior `rejected` yields a notice, a missing,
// unreadable, or corrupt ledger reports `unknown` (never "no prior
// rejection"), and the hint NEVER blocks admission (E7: read side only).
// Write side (§8.6/E12): every append is a mandatory governed write —
// corruption, lock, or ceiling refuses rather than degrading to a hint, and
// `precheckSuggestionReviewAppend` lets Apply/Undo/Dismiss walk the chain and
// probe appendability BEFORE any target mutation. Promotion/validated/
// validity-rejection are audit-only writes (§8.6): the governed append is the
// first and only durable write, so the family append's own lock/chain/ceiling
// refusals are the fail-closed gate — there is no target mutation to precheck.
//
// Proposal rounds (§8.2 amendment): a retry whose cluster evidence changed
// (different evidence digest or host set) opens a new round — a second
// `proposed` event followed by that round's own outcome events. An unchanged
// re-surface rides the existing record, so rescans of a stable rejected
// cluster never grow the ledger. `validated` belongs to the current round
// only; validity rejections dedupe once per round. Operations/attribution are
// derived surfaces and never open a round by themselves (the planner's wiki
// body embeds the plan date), but a new round records their current digests.

const fs = require("node:fs");
const path = require("node:path");

const { typedError } = require("./error-catalog");
const {
	acquireLedgerLock,
	appendWithinCeiling,
	canonicalHashOf,
	closedFieldProblem,
	credentialLeakProblem,
	isNonEmptyString,
	isPlainObject,
} = require("./registry-ledger");
const { defineLedgerFamily } = require("./ledger-family");
const findingAttribution = require("./finding-attribution");
const { VALIDITY_REASON_CODES } = require("./evolution-validity");

const CORRUPT_CODE = "AMBER_E_SUGGESTION_REVIEW_CORRUPT";
const LOCK_CODE = "AMBER_E_SUGGESTION_REVIEW_LOCK";
const CEILING_CODE = "AMBER_E_SUGGESTION_REVIEW_SIZE_CEILING";
const STATE_CODE = "AMBER_E_SUGGESTION_REVIEW_STATE";
const INVALID_ARG_CODE = "AMBER_E_INVALID_ARG";

/** Version of the suggestion-review event contract this module writes/reads. */
const SCHEMA_VERSION = 1;

/** Ledger size ceiling in bytes (default 1 MiB; deliberate overrides via env). */
const DEFAULT_MAX_REVIEW_BYTES = 1024 * 1024;
const CEILING_ENV_NAME = "AMBER_SUGGESTION_REVIEW_MAX_BYTES";

const LOCK_NAME = "review.lock";
const LABEL = "suggestion review ledger";
const EVENT_LABEL = "suggestion review event";

/** The closed event-kind set (§8.2). Extensions require a contract change. */
const SUGGESTION_REVIEW_KINDS = Object.freeze([
	"proposed",
	"validated",
	"rejected",
	"applied",
	"undone",
]);

/** The V1–V3 pass summary a `validated` event carries (all three passed). */
const VALIDATED_CHECKS = Object.freeze({ v1: "pass", v2: "pass", v3: "pass" });

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const HASH64_PATTERN = /^[0-9a-f]{64}$/;

// Bounded payload contract: the ledger stays small and reviewable, and never
// carries raw transcripts or unredacted excerpts (§8.4 minimal provenance —
// digests and the redacted summary only).
const MAX_FINGERPRINT_CHARS = 200;
const MAX_HOSTS = 16;
const MAX_HOST_CHARS = 60;
const MAX_DIGEST_INPUTS = 64;
const MAX_REASON_CHARS = 200;
const MAX_SUMMARY_CHARS = 500;
const MAX_PATH_CHARS = 300;
const MAX_APPLIED_RECORDS = 64;

const EVENT_BASE_FIELDS = Object.freeze(["kind", "schemaVersion", "at"]);
const CHAIN_FIELDS = Object.freeze(["prevHash", "hash"]);
const KIND_FIELDS = Object.freeze({
	proposed: ["fingerprint", "evidenceDigest", "hosts", "operationsDigest", "attribution"],
	validated: ["fingerprint", "checks"],
	rejected: ["fingerprint", "reason", "summary"],
	applied: ["fingerprint", "appliedDigest"],
	undone: ["fingerprint", "restoredDigest"],
});
const APPLIED_RECORD_FIELDS = Object.freeze(["path", "beforeHash", "afterHash"]);
const RESTORED_RECORD_FIELDS = Object.freeze(["path", "hash"]);

function reviewCorrupt(message) {
	return typedError(CORRUPT_CODE, message);
}

function fail(code, errors) {
	return { ok: false, code, record: null, errors };
}

function argProblem(message) {
	return fail(INVALID_ARG_CODE, [message]);
}

// ── Input-shape validation (writer side; untrusted text is never echoed) ──

function fingerprintProblem(value) {
	if (!isNonEmptyString(value) || value.length > MAX_FINGERPRINT_CHARS) {
		return `fingerprint must be a non-empty string of at most ${MAX_FINGERPRINT_CHARS} characters`;
	}
	return null;
}

function hostsProblem(value) {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_HOSTS) {
		return `hosts must be a non-empty array of at most ${MAX_HOSTS} entries`;
	}
	for (const host of value) {
		if (!isNonEmptyString(host) || host.length > MAX_HOST_CHARS) {
			return `each host must be a non-empty string of at most ${MAX_HOST_CHARS} characters`;
		}
	}
	return null;
}

function digestInputProblem(label, value) {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DIGEST_INPUTS) {
		return `${label} must be a non-empty array of at most ${MAX_DIGEST_INPUTS} entries`;
	}
	for (const entry of value) {
		if (!isPlainObject(entry)) return `${label} entries must be objects`;
	}
	return null;
}

function hashFieldProblem(label, value) {
	if (value !== null && (typeof value !== "string" || !HASH64_PATTERN.test(value))) {
		return `${label} must be a 64-hex sha256 string or null`;
	}
	return null;
}

function appliedRecordsProblem(value) {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_APPLIED_RECORDS) {
		return `applied must be a non-empty array of at most ${MAX_APPLIED_RECORDS} records`;
	}
	for (let index = 0; index < value.length; index += 1) {
		const record = value[index];
		if (!isPlainObject(record)) return `applied record #${index + 1} must be an object`;
		const closed = closedFieldProblem(
			record,
			APPLIED_RECORD_FIELDS,
			`applied record #${index + 1}`,
		);
		if (closed !== null) return closed;
		if (!isNonEmptyString(record.path) || record.path.length > MAX_PATH_CHARS) {
			return `applied record #${index + 1} path must be a non-empty string of at most ${MAX_PATH_CHARS} characters`;
		}
		const before = hashFieldProblem(`applied record #${index + 1} beforeHash`, record.beforeHash);
		if (before !== null) return before;
		const after = hashFieldProblem(`applied record #${index + 1} afterHash`, record.afterHash);
		if (after !== null) return after;
	}
	return null;
}

function restoredRecordsProblem(value) {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_APPLIED_RECORDS) {
		return `restored must be a non-empty array of at most ${MAX_APPLIED_RECORDS} records`;
	}
	for (let index = 0; index < value.length; index += 1) {
		const record = value[index];
		if (!isPlainObject(record)) return `restored record #${index + 1} must be an object`;
		const closed = closedFieldProblem(
			record,
			RESTORED_RECORD_FIELDS,
			`restored record #${index + 1}`,
		);
		if (closed !== null) return closed;
		if (!isNonEmptyString(record.path) || record.path.length > MAX_PATH_CHARS) {
			return `restored record #${index + 1} path must be a non-empty string of at most ${MAX_PATH_CHARS} characters`;
		}
		const hash = hashFieldProblem(`restored record #${index + 1} hash`, record.hash);
		if (hash !== null) return hash;
	}
	return null;
}

function textProblem(label, value, cap) {
	if (!isNonEmptyString(value) || value.length > cap) {
		return `${label} must be a non-empty string of at most ${cap} characters`;
	}
	return credentialLeakProblem(value, label);
}

/**
 * Validate one writer input and build its event body (without chain fields).
 * Returns `{ body }` or `{ problem }` with a non-echoing refusal message.
 * @param {object} input - Discriminated by `kind`, mirroring §8.2 payloads.
 */
function eventBodyFor(input) {
	if (!isPlainObject(input) || !SUGGESTION_REVIEW_KINDS.includes(input.kind)) {
		return {
			problem: `kind must be one of the closed set ${SUGGESTION_REVIEW_KINDS.join(" | ")}`,
		};
	}
	const fingerprint = fingerprintProblem(input.fingerprint);
	if (fingerprint !== null) return { problem: fingerprint };
	const at = new Date().toISOString();
	if (input.kind === "proposed") {
		const evidence = digestInputProblem("evidence", input.evidence);
		if (evidence !== null) return { problem: evidence };
		const hosts = hostsProblem(input.hosts);
		if (hosts !== null) return { problem: hosts };
		const operations = digestInputProblem("operations", input.operations);
		if (operations !== null) return { problem: operations };
		if (!isPlainObject(input.attribution)) {
			return { problem: "attribution must be the finding-attribution block (contract §3)" };
		}
		const attribution = findingAttribution.attributionProblem(input.attribution);
		if (attribution !== null) return { problem: `attribution: ${attribution}` };
		return {
			body: {
				kind: "proposed",
				schemaVersion: SCHEMA_VERSION,
				at,
				fingerprint: input.fingerprint,
				evidenceDigest: canonicalHashOf(input.evidence),
				hosts: [...input.hosts],
				operationsDigest: canonicalHashOf(input.operations),
				attribution: { ...input.attribution },
			},
		};
	}
	if (input.kind === "validated") {
		return {
			body: {
				kind: "validated",
				schemaVersion: SCHEMA_VERSION,
				at,
				fingerprint: input.fingerprint,
				checks: { ...VALIDATED_CHECKS },
			},
		};
	}
	if (input.kind === "rejected") {
		const reason = textProblem("reason", input.reason, MAX_REASON_CHARS);
		if (reason !== null) return { problem: reason };
		const summary = textProblem("summary", input.summary, MAX_SUMMARY_CHARS);
		if (summary !== null) return { problem: summary };
		return {
			body: {
				kind: "rejected",
				schemaVersion: SCHEMA_VERSION,
				at,
				fingerprint: input.fingerprint,
				reason: input.reason,
				summary: input.summary,
			},
		};
	}
	if (input.kind === "applied") {
		const applied = appliedRecordsProblem(input.applied);
		if (applied !== null) return { problem: applied };
		return {
			body: {
				kind: "applied",
				schemaVersion: SCHEMA_VERSION,
				at,
				fingerprint: input.fingerprint,
				appliedDigest: canonicalHashOf(input.applied),
			},
		};
	}
	const restored = restoredRecordsProblem(input.restored);
	if (restored !== null) return { problem: restored };
	return {
		body: {
			kind: "undone",
			schemaVersion: SCHEMA_VERSION,
			at,
			fingerprint: input.fingerprint,
			restoredDigest: canonicalHashOf(input.restored),
		},
	};
}

// ── Fold domain half: per-kind shape + sequence integrity (§8.2) ──
// Every clause below is a constraint the writers above can never violate —
// anything else on a chain-verified event is hand-edited state.

function eventShapeProblem(event, lineIndex) {
	const kind = event.kind;
	if (!SUGGESTION_REVIEW_KINDS.includes(kind)) {
		return (
			`${EVENT_LABEL} ${lineIndex} carries unknown kind ${JSON.stringify(kind)}; ` +
			`the closed kind set is ${SUGGESTION_REVIEW_KINDS.join(", ")}`
		);
	}
	if (event.schemaVersion !== SCHEMA_VERSION) {
		return (
			`${EVENT_LABEL} ${lineIndex} declares schemaVersion ${JSON.stringify(event.schemaVersion)}; ` +
			`this reader supports only ${SCHEMA_VERSION}`
		);
	}
	if (!isNonEmptyString(event.at)) {
		return `${EVENT_LABEL} ${lineIndex} carries no timestamp`;
	}
	const closed = closedFieldProblem(
		event,
		[...EVENT_BASE_FIELDS, ...KIND_FIELDS[kind], ...CHAIN_FIELDS],
		`${EVENT_LABEL} ${lineIndex}`,
	);
	if (closed !== null) return closed;
	const fingerprint = fingerprintProblem(event.fingerprint);
	if (fingerprint !== null) return `${EVENT_LABEL} ${lineIndex}: ${fingerprint}`;
	if (kind === "proposed") {
		const hosts = hostsProblem(event.hosts);
		if (hosts !== null) return `${EVENT_LABEL} ${lineIndex}: ${hosts}`;
		for (const field of ["evidenceDigest", "operationsDigest"]) {
			if (!DIGEST_PATTERN.test(event[field])) {
				return `${EVENT_LABEL} ${lineIndex} carries a ${field} that is not a sha256:<64-hex> digest`;
			}
		}
		const attribution = findingAttribution.attributionProblem(event.attribution);
		if (attribution !== null) {
			return `${EVENT_LABEL} ${lineIndex} carries an attribution block the core validator refuses: ${attribution}`;
		}
	}
	if (kind === "validated") {
		const checks = event.checks;
		if (!isPlainObject(checks) || JSON.stringify(checks) !== JSON.stringify(VALIDATED_CHECKS)) {
			return (
				`${EVENT_LABEL} ${lineIndex} carries a V1–V3 pass summary that is not exactly ` +
				`{v1: "pass", v2: "pass", v3: "pass"}; the admission validator only appends all-pass`
			);
		}
	}
	if (kind === "rejected") {
		const reason = textProblem("reason", event.reason, MAX_REASON_CHARS);
		if (reason !== null) return `${EVENT_LABEL} ${lineIndex}: ${reason}`;
		const summary = textProblem("summary", event.summary, MAX_SUMMARY_CHARS);
		if (summary !== null) return `${EVENT_LABEL} ${lineIndex}: ${summary}`;
	}
	if (kind === "applied" && !DIGEST_PATTERN.test(event.appliedDigest)) {
		return `${EVENT_LABEL} ${lineIndex} carries an appliedDigest that is not a sha256:<64-hex> digest`;
	}
	if (kind === "undone" && !DIGEST_PATTERN.test(event.restoredDigest)) {
		return `${EVENT_LABEL} ${lineIndex} carries a restoredDigest that is not a sha256:<64-hex> digest`;
	}
	return null;
}

// Round-opening conditions (§8.2 proposal rounds): a second `proposed` event
// is a legal retry only when the current round is closed by a rejection, the
// fingerprint is not currently applied, and the cluster evidence changed. The
// same predicate guards the writer (reviewGuard) and judges the fold, so a
// violation on a chain-verified event is hand-edited state. Hosts compare as
// sets (sorted, deduplicated) so an order-only or duplicate-entry difference
// never opens a spurious round.
function hostSetKey(hosts) {
	return JSON.stringify(Array.isArray(hosts) ? [...new Set(hosts)].sort() : []);
}

function roundOpeningProblem(record, event) {
	if (record.appliedCount !== record.undoneCount) {
		return "the fingerprint is currently applied";
	}
	if (record.rejectionsSinceLastProposal === 0) {
		return "the current proposal round is still open";
	}
	const evidenceChanged = event.evidenceDigest !== record.evidenceDigest;
	const hostsChanged = hostSetKey(event.hosts) !== hostSetKey(record.hosts);
	if (!evidenceChanged && !hostsChanged) {
		return "the cluster evidence is unchanged (an unchanged re-surface rides the existing round)";
	}
	return null;
}

function applyReviewEvent(byFingerprint, event, lineIndex) {
	const shape = eventShapeProblem(event, lineIndex);
	if (shape !== null) throw reviewCorrupt(shape);
	const record = byFingerprint.get(event.fingerprint);
	const impossible = (message) =>
		reviewCorrupt(
			`${EVENT_LABEL} ${lineIndex} ${message}; the review writers can never append this — the ledger was edited in place`,
		);
	if (event.kind === "proposed") {
		if (record !== undefined) {
			const opening = roundOpeningProblem(record, event);
			if (opening !== null) {
				throw impossible(
					`proposes fingerprint "${event.fingerprint}" a second time while ${opening}`,
				);
			}
			// A legal retry opens a new round: the current-round fields move to
			// the retry's proposal; the rejection history and applied/undone
			// counters stay cumulative across rounds.
			record.proposalCount += 1;
			record.rejectionsSinceLastProposal = 0;
			record.proposedAt = event.at;
			record.evidenceDigest = event.evidenceDigest;
			record.hosts = [...event.hosts];
			record.operationsDigest = event.operationsDigest;
			record.attribution = { ...event.attribution };
			record.validatedAt = null;
			return;
		}
		byFingerprint.set(event.fingerprint, {
			fingerprint: event.fingerprint,
			proposedAt: event.at,
			evidenceDigest: event.evidenceDigest,
			hosts: [...event.hosts],
			operationsDigest: event.operationsDigest,
			attribution: { ...event.attribution },
			validatedAt: null,
			rejections: [],
			proposalCount: 1,
			rejectionsSinceLastProposal: 0,
			appliedCount: 0,
			undoneCount: 0,
			lastAppliedAt: null,
			lastAppliedDigest: null,
			lastUndoneAt: null,
			lastRestoredDigest: null,
		});
		return;
	}
	if (record === undefined) {
		throw impossible(
			`carries kind "${event.kind}" for fingerprint "${event.fingerprint}" that was never proposed`,
		);
	}
	if (event.kind === "validated") {
		if (record.validatedAt !== null) {
			throw impossible(`validates fingerprint "${event.fingerprint}" a second time`);
		}
		if (record.rejectionsSinceLastProposal > 0) {
			throw impossible(
				`validates fingerprint "${event.fingerprint}" in a round that was already rejected — a retry is a new proposal (§8.2 rounds)`,
			);
		}
		record.validatedAt = event.at;
		return;
	}
	if (event.kind === "rejected") {
		record.rejectionsSinceLastProposal += 1;
		record.rejections.push({ reason: event.reason, summary: event.summary, at: event.at });
		return;
	}
	if (event.kind === "applied") {
		if (record.validatedAt === null) {
			throw impossible(
				`applies fingerprint "${event.fingerprint}" that was never validated at admission`,
			);
		}
		if (record.appliedCount !== record.undoneCount) {
			throw impossible(`applies fingerprint "${event.fingerprint}" that is already applied`);
		}
		record.appliedCount += 1;
		record.lastAppliedAt = event.at;
		record.lastAppliedDigest = event.appliedDigest;
		return;
	}
	if (record.appliedCount !== record.undoneCount + 1) {
		throw impossible(`undoes fingerprint "${event.fingerprint}" that is not currently applied`);
	}
	record.undoneCount += 1;
	record.lastUndoneAt = event.at;
	record.lastRestoredDigest = event.restoredDigest;
}

// F061/ADR-0028 — the ledger ritual is assembled by `defineLedgerFamily`; the
// family owns path resolution, the fail-closed chain walk, the governed
// append (lock + guard + chain + ceiling), and this fold's domain half.
const SUGGESTION_REVIEW_FAMILY = defineLedgerFamily({
	dir: "suggestions",
	label: LABEL,
	ledgers: [
		{
			name: "review",
			fileName: "review.jsonl",
			lockName: LOCK_NAME,
			conflictCode: LOCK_CODE,
			corruptCode: CORRUPT_CODE,
			sizeCeilingCode: CEILING_CODE,
			ceiling: { envName: CEILING_ENV_NAME, defaultBytes: DEFAULT_MAX_REVIEW_BYTES },
			label: LABEL,
			eventLabel: EVENT_LABEL,
			fold: {
				init: () => new Map(),
				apply: applyReviewEvent,
				result: (byFingerprint) => [...byFingerprint.values()],
			},
		},
	],
});

const REVIEW_LEDGER = SUGGESTION_REVIEW_FAMILY.ledgers.review;

function findRecord(records, fingerprint) {
	return records.find((record) => record.fingerprint === fingerprint) ?? null;
}

// ── Writer policy: the per-kind guard evaluated against a fresh fold inside
// the append lock. Any non-null result is returned verbatim by the family
// append without writing. Sequence rules mirror the fold's integrity clauses,
// including the §8.2 proposal-round rules for re-proposals.
function reviewGuard(input) {
	const fingerprint = input.fingerprint;
	if (input.kind === "proposed") {
		return (records) => {
			const record = findRecord(records, fingerprint);
			if (record === null) return null;
			const opening = roundOpeningProblem(record, {
				evidenceDigest: canonicalHashOf(input.evidence),
				hosts: input.hosts,
			});
			if (opening !== null) {
				return fail(STATE_CODE, [
					`fingerprint "${fingerprint}" cannot be re-proposed while ${opening}; a retry opens a new proposal round only when the current round is closed by a rejection, the fingerprint is not currently applied, and the cluster evidence changed (§8.2 rounds)`,
				]);
			}
			return null;
		};
	}
	if (input.kind === "validated") {
		return (records) => {
			const record = findRecord(records, fingerprint);
			if (record === null) {
				return fail(STATE_CODE, [
					`fingerprint "${fingerprint}" was never proposed; validation follows promotion`,
				]);
			}
			if (record.validatedAt !== null) {
				return fail(STATE_CODE, [
					`fingerprint "${fingerprint}" is already validated; the admission outcome is recorded exactly once per proposal round`,
				]);
			}
			if (record.rejectionsSinceLastProposal > 0) {
				return fail(STATE_CODE, [
					`fingerprint "${fingerprint}" was already rejected this round; a retry is a new proposal — re-propose with changed evidence before validating (§8.2 rounds)`,
				]);
			}
			return null;
		};
	}
	if (input.kind === "rejected") {
		return (records) =>
			findRecord(records, fingerprint) === null
				? fail(STATE_CODE, [
						`fingerprint "${fingerprint}" was never proposed; a rejection follows promotion`,
					])
				: null;
	}
	if (input.kind === "applied") {
		return (records) => {
			const record = findRecord(records, fingerprint);
			if (record === null) {
				return fail(STATE_CODE, [`fingerprint "${fingerprint}" was never proposed`]);
			}
			if (record.validatedAt === null) {
				return fail(STATE_CODE, [
					`fingerprint "${fingerprint}" was never validated at admission; Apply applies exposed cards only`,
				]);
			}
			if (record.appliedCount !== record.undoneCount) {
				return fail(STATE_CODE, [`fingerprint "${fingerprint}" is already applied`]);
			}
			return null;
		};
	}
	return (records) => {
		const record = findRecord(records, fingerprint);
		if (record === null) {
			return fail(STATE_CODE, [`fingerprint "${fingerprint}" was never proposed`]);
		}
		if (record.appliedCount !== record.undoneCount + 1) {
			return fail(STATE_CODE, [
				`fingerprint "${fingerprint}" is not currently applied; nothing to undo`,
			]);
		}
		return null;
	};
}

function appendReviewEvent(cwd, input) {
	const { body, problem } = eventBodyFor(input);
	if (problem !== undefined) return argProblem(problem);
	return REVIEW_LEDGER.append(cwd, body, reviewGuard(input), (records) =>
		findRecord(records, input.fingerprint),
	);
}

function foldOrFailure(cwd) {
	try {
		return { folded: REVIEW_LEDGER.fold(cwd) };
	} catch (err) {
		return { failure: fail(err.amberCode || CORRUPT_CODE, [err.message]) };
	}
}

// An ensure-style append that hits its guard usually means a concurrent
// writer appended between our pre-fold and the append — re-fold and treat the
// now-present state as satisfied (the outcome is what matters, not who wrote
// it). A genuinely impossible state (or a corrupt re-fold) still fails.
function racedToState(failure, cwd, stateSatisfied) {
	if (failure.code !== STATE_CODE) return failure;
	try {
		const refolded = REVIEW_LEDGER.fold(cwd);
		if (stateSatisfied(refolded)) return { ok: true, appended: false, record: null };
	} catch {
		// fall through to the original failure
	}
	return failure;
}

/**
 * Record the promotion of one suggestion card (§8.2 `proposed`): fingerprint,
 * evidence digest, hosts, planned-operations digest, attribution block.
 * Never stores raw evidence or operation contents (digests only).
 *
 * Per §8.2 proposal rounds: an unchanged re-surface rides the existing record
 * (skip, append nothing — rescans of a stable cluster never grow the ledger),
 * and so does a currently-applied fingerprint (past its admission decision) or
 * an open round whose proposal must not be silently replaced. A retry whose
 * cluster evidence changed (different evidence digest or host set) after the
 * current round was closed by a rejection opens a new round with its own
 * `proposed` event.
 *
 * @param {string} cwd - Repository root.
 * @param {{ fingerprint: string, evidence: object[], hosts: string[], operations: object[], attribution: object }} input
 * @returns {{ ok: true, appended: boolean, record: object | null } | { ok: false, code: string, record: null, errors: string[] }}
 */
function ensureSuggestionProposed(cwd, input) {
	const pre = foldOrFailure(cwd);
	if (pre.failure !== undefined) return pre.failure;
	const existing = findRecord(pre.folded, input.fingerprint);
	if (existing !== null) {
		const roundOpenable = roundOpeningProblem(existing, {
			evidenceDigest: canonicalHashOf(input.evidence),
			hosts: input.hosts,
		});
		if (roundOpenable !== null) return { ok: true, appended: false, record: null };
	}
	const result = appendReviewEvent(cwd, { ...input, kind: "proposed" });
	if (result.ok) return { ok: true, appended: true, record: result.record };
	return racedToState(result, cwd, (records) => findRecord(records, input.fingerprint) !== null);
}

/**
 * Record that admission passed V1–V3 for one fingerprint (§8.2 `validated`).
 * The fingerprint payload closes the correlation chain. Idempotent per
 * proposal round: a scan that re-validates an already-validated round skips,
 * and the guard refuses to validate a round that was already rejected — that
 * retry must re-propose first (§8.2 rounds).
 *
 * @param {string} cwd - Repository root.
 * @param {{ fingerprint: string }} input
 * @returns {{ ok: true, appended: boolean, record: object | null } | { ok: false, code: string, record: null, errors: string[] }}
 */
function recordSuggestionValidated(cwd, input) {
	const pre = foldOrFailure(cwd);
	if (pre.failure !== undefined) return pre.failure;
	const existing = findRecord(pre.folded, input.fingerprint);
	if (existing !== null && existing.validatedAt !== null) {
		return { ok: true, appended: false, record: null };
	}
	const result = appendReviewEvent(cwd, { ...input, kind: "validated" });
	if (result.ok) return { ok: true, appended: true, record: result.record };
	return racedToState(
		result,
		cwd,
		(records) => findRecord(records, input.fingerprint)?.validatedAt != null,
	);
}

/**
 * Record an admission-time validity rejection (§8.2 `rejected` with a
 * `validity:*` reason code). Durable once per proposal round (§8.2 rounds):
 * repeated scans of the same failing round do not grow the ledger — the
 * round's first rejection is its durable record — while a retry that opens a
 * new round records its own rejection (the reason may differ).
 *
 * @param {string} cwd - Repository root.
 * @param {{ fingerprint: string, reason: string, summary: string }} input
 * @returns {{ ok: true, appended: boolean, record: object | null } | { ok: false, code: string, record: null, errors: string[] }}
 */
function recordSuggestionValidityRejection(cwd, input) {
	if (!VALIDITY_REASON_CODES.includes(input && input.reason)) {
		return argProblem(
			`reason must be one of the closed validity set ${VALIDITY_REASON_CODES.join(" | ")}`,
		);
	}
	const pre = foldOrFailure(cwd);
	if (pre.failure !== undefined) return pre.failure;
	const existing = findRecord(pre.folded, input.fingerprint);
	if (existing !== null && existing.rejectionsSinceLastProposal > 0) {
		return { ok: true, appended: false, record: null };
	}
	const result = appendReviewEvent(cwd, { ...input, kind: "rejected" });
	if (result.ok) return { ok: true, appended: true, record: result.record };
	return racedToState(
		result,
		cwd,
		(records) => (findRecord(records, input.fingerprint)?.rejectionsSinceLastProposal ?? 0) > 0,
	);
}

/**
 * Record an operator Dismiss (§8.2 `rejected` with the operator dismiss
 * reason). Every dismiss action appends — a dismissal is an operator review
 * decision, never deduplicated away.
 *
 * @param {string} cwd - Repository root.
 * @param {{ fingerprint: string, reason: string, summary: string }} input
 * @returns {{ ok: true, appended: boolean, record: object | null } | { ok: false, code: string, record: null, errors: string[] }}
 */
function recordSuggestionDismissal(cwd, input) {
	const result = appendReviewEvent(cwd, { ...input, kind: "rejected" });
	if (result.ok) return { ok: true, appended: true, record: result.record };
	return result;
}

/**
 * Record a successful Apply (§8.2 `applied`): fingerprint plus the digest of
 * the applied records (paths, before/after hashes). The applied bytes never
 * ride the ledger — Undo reads them from the overlay's applied record.
 *
 * @param {string} cwd - Repository root.
 * @param {{ fingerprint: string, applied: Array<{ path: string, beforeHash: string | null, afterHash: string | null }> }} input
 * @returns {{ ok: true, appended: boolean, record: object | null } | { ok: false, code: string, record: null, errors: string[] }}
 */
function recordSuggestionApplied(cwd, input) {
	const result = appendReviewEvent(cwd, { ...input, kind: "applied" });
	if (result.ok) return { ok: true, appended: true, record: result.record };
	return result;
}

/**
 * Record a successful Undo (§8.2 `undone`): fingerprint plus the digest of
 * the restored hashes, so an `applied` event can never misstate the current
 * world after the operator undid it.
 *
 * @param {string} cwd - Repository root.
 * @param {{ fingerprint: string, restored: Array<{ path: string, hash: string | null }> }} input
 * @returns {{ ok: true, appended: boolean, record: object | null } | { ok: false, code: string, record: null, errors: string[] }}
 */
function recordSuggestionUndone(cwd, input) {
	const result = appendReviewEvent(cwd, { ...input, kind: "undone" });
	if (result.ok) return { ok: true, appended: true, record: result.record };
	return result;
}

/**
 * Fold the ledger: fail-closed raw read, chain walk, then this family's
 * domain fold (per-kind shapes and sequence integrity). A missing ledger
 * reads as empty; corruption throws the typed corrupt code.
 *
 * @param {string} cwd - Repository root.
 * @returns {Array<object>} One review record per fingerprint, first-proposed order.
 * @throws {Error} Typed AMBER_E_SUGGESTION_REVIEW_CORRUPT on any corruption.
 */
function foldSuggestionReview(cwd) {
	return REVIEW_LEDGER.fold(cwd);
}

/**
 * The rejection-history hint (§8.3) — informative, read-side only, never
 * blocking. A prior `rejected` event yields the last rejection's reason,
 * summary, and time. A missing, unreadable, or corrupt ledger reports
 * `unknown` — never "no prior rejection" (unknown ≠ empty, F055 discipline).
 *
 * @param {string} cwd - Repository root.
 * @param {string} fingerprint
 * @returns {{ status: "none" } | { status: "unknown" } | { status: "rejected", reason: string, summary: string, at: string }}
 */
function suggestionReviewHistory(cwd, fingerprint) {
	if (!isNonEmptyString(fingerprint)) return { status: "unknown" };
	if (!fs.existsSync(REVIEW_LEDGER.path(cwd))) return { status: "unknown" };
	let folded;
	try {
		folded = REVIEW_LEDGER.fold(cwd);
	} catch {
		return { status: "unknown" };
	}
	const record = findRecord(folded, fingerprint);
	if (record === null || record.rejections.length === 0) return { status: "none" };
	const last = record.rejections[record.rejections.length - 1];
	return { status: "rejected", reason: last.reason, summary: last.summary, at: last.at };
}

/**
 * The §8.6 write-side precheck for Apply/Undo/Dismiss: BEFORE any target
 * mutation, walk the ledger chain (fold), evaluate the writer guard against
 * the fresh fold, probe the append lock, and probe the size ceiling with the
 * projected event body. Nothing is written; a refusal here must leave file,
 * overlay, and ledger untouched.
 *
 * @param {string} cwd - Repository root.
 * @param {object} input - The same discriminated shape the record functions take.
 * @returns {{ ok: true } | { ok: false, code: string, errors: string[] }}
 */
function precheckSuggestionReviewAppend(cwd, input) {
	const { body, problem } = eventBodyFor(input);
	if (problem !== undefined) return { ok: false, code: INVALID_ARG_CODE, errors: [problem] };
	const pre = foldOrFailure(cwd);
	if (pre.failure !== undefined) {
		return { ok: false, code: pre.failure.code, errors: pre.failure.errors };
	}
	const guardFailure = reviewGuard(input)(pre.folded);
	if (guardFailure !== null) {
		return { ok: false, code: guardFailure.code, errors: guardFailure.errors };
	}
	// Lock probe: acquire-and-release through the shared primitive. A fresh
	// lock held by a live writer refuses here instead of after the mutation.
	try {
		const release = acquireLedgerLock({
			dirPath: path.dirname(REVIEW_LEDGER.path(cwd)),
			lockName: LOCK_NAME,
			conflictCode: LOCK_CODE,
			corruptCode: CORRUPT_CODE,
			label: LABEL,
		});
		release();
	} catch (err) {
		return { ok: false, code: err.amberCode || CORRUPT_CODE, errors: [err.message] };
	}
	// Ceiling probe with the projected body (the governed append re-checks
	// under the lock on the exact chained event).
	try {
		const ceiling = appendWithinCeiling({
			ledgerPath: REVIEW_LEDGER.path(cwd),
			event: body,
			envName: CEILING_ENV_NAME,
			defaultBytes: DEFAULT_MAX_REVIEW_BYTES,
			label: LABEL,
		});
		if (ceiling.wouldExceed) {
			return {
				ok: false,
				code: CEILING_CODE,
				errors: [
					`appending this ${input.kind} event would grow the suggestion review ledger beyond its size ceiling of ${ceiling.ceiling} bytes (${CEILING_ENV_NAME}); the write is refused before any durable state is touched`,
				],
			};
		}
	} catch (err) {
		return { ok: false, code: err.amberCode || CORRUPT_CODE, errors: [err.message] };
	}
	return { ok: true };
}

module.exports = {
	SUGGESTION_REVIEW_KINDS,
	VALIDATED_CHECKS,
	CEILING_ENV_NAME,
	reviewLedgerPath: REVIEW_LEDGER.path,
	ensureSuggestionProposed,
	recordSuggestionValidated,
	recordSuggestionValidityRejection,
	recordSuggestionDismissal,
	recordSuggestionApplied,
	recordSuggestionUndone,
	foldSuggestionReview,
	suggestionReviewHistory,
	precheckSuggestionReviewAppend,
};
