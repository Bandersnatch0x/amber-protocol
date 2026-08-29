"use strict";

// F050 ticket 3 (#228) — Gate Contracts & deterministic evaluation.
//
// A Gate is the reviewable contract admission is decided against, never
// hidden weights or model confidence (F050: "Admission through a Gate is
// decided by a reviewable contract"). The contract itself is ordinary
// canonical-artifact content: a `gate`-type artifact whose machine-
// actionable shape rides the Envelope's existing extensions carrier under
// the `gate` namespace (`--extension gate.require=...` at admission). The
// artifact registry deliberately adds no type-specific envelope validation —
// THIS module is that content's first shape consumer and owns the contract
// verdicts, so a malformed contract fails here with a stable code instead
// of being silently admitted as unvalidated payload.
//
// Evaluation is deterministic and fail-closed by construction:
//   - allOf over gate.require plus bounded explicit anyOf (at most 8
//     alternative sets of at most 8 entries) — every alternative is spelled
//     out, nothing is scored, weighted, or inferred;
//   - a requirement is satisfied only by a receipt that is subject-joined,
//     status "pass", at or above the required Assurance level, fresh at the
//     evaluation clock, and (when the requirement carries a threshold) whose
//     LAST output parses and compares true under the registered comparator;
//   - v1 failure behavior is deny-only: a failing gate denies, and no model
//     confidence can soften the verdict.
//
// Every completed evaluation appends one immutable `evaluated` event to the
// hash-chained outcome ledger under .amber/gates/outcomes.jsonl — a pass is
// never silently revised and a fail is never silently dropped: the record IS
// the audit trail. An in-place edit breaks the chain and fails every read
// closed as AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT. The ledger is serialized
// by the shared registry-ledger disciplines (write lock, size ceiling
// AMBER_GATE_MAX_OUTCOME_BYTES, closed field set) exactly like the principal,
// evidence, and approval registries.
//
// CONVENTION — the evidence join key. The evidence ledger has no separate
// "type" field: a receipt identifies what it attests about through its
// single `subject` field, so a Gate requirement's `evidenceType` is matched
// against the receipt's `subject`. Because the evaluation is also scoped
// (the input subject, overridable per requirement), a receipt is a candidate
// for a requirement only when its subject equals BOTH the required
// `evidenceType` and the effective subject (`requirement.subject ?? input
// .subject`): both joins are equalities on the same receipt field, so a
// satisfiable requirement's `evidenceType` names the subject its receipts
// carry. A requirement whose `evidenceType` differs from its effective
// subject therefore matches nothing and fails closed with empty candidates —
// explicit and reviewable, never guessed.
//
// CONVENTION — threshold value routing. The threshold's declared value type
// selects the comparison family: a number compares numerically against a
// strict base-10 decimal output; a string compares exactly under eq/ne and as
// a substring under contains, while the ordering operators (lt/le/gt/ge) on a
// string are version compares (dot-numeric segment order, "1.2" < "1.10",
// missing segments pad to zero). The compared value is always parsed from the
// receipt's LAST output: as a decimal for numeric comparators, verbatim for
// exact string comparators, and dot-numerically for version ordering. A parse
// failure (no outputs, a non-decimal numeric string, a non-dot-numeric version)
// leaves the requirement unsatisfied — the detail's threshold.actual reads
// null, which is the recorded "why not".
//
// v1 records but does not evaluate `gate.owners` and `gate.dependsOn`: they
// are declared contract content for review (F050: Gate Contracts declare
// owners and dependencies), with no v1 semantics attached — the evaluator
// never invents authority the contract does not spell out.

const path = require("node:path");
const { appendJSONL, readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { typedError } = require("./error-catalog");
const { deletionTombstones } = require("./retention-registry");
const {
	GENESIS_HASH,
	chainHash,
	acquireLedgerLock,
	appendWithinCeiling: sharedAppendWithinCeiling,
} = require("./registry-ledger");
const { parseTimestamp } = require("./principal-registry");
const { ASSURANCE_LEVELS, listEvidence } = require("./evidence-receipts");
const { showArtifact } = require("./canonical-artifacts");

const OUTCOME_REGISTRY_CORRUPT_CODE = "AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT";
const OUTCOME_SIZE_CEILING_CODE = "AMBER_E_GATE_OUTCOME_SIZE_CEILING";
const OUTCOME_REGISTRY_LOCK_CODE = "AMBER_E_GATE_OUTCOME_REGISTRY_LOCK";
const GATE_NOT_FOUND_CODE = "AMBER_E_GATE_NOT_FOUND";
const CONTRACT_INVALID_CODE = "AMBER_E_GATE_CONTRACT_INVALID";
const EXPIRED_CODE = "AMBER_E_GATE_EXPIRED";
const UNSUPPORTED_COMPARATOR_CODE = "AMBER_E_GATE_UNSUPPORTED_COMPARATOR";
const FAIL_BEHAVIOR_UNSUPPORTED_CODE = "AMBER_E_GATE_FAIL_BEHAVIOR_UNSUPPORTED";
const INVALID_ARG_CODE = "AMBER_E_INVALID_ARG";

const LOCK_STALE_MS = 30_000;

/** Version of the outcome event contract this module writes and reads. */
const GATE_EVALUATION_SCHEMA_VERSION = 1;

/** Every outcome event schemaVersion this reader can interpret, ascending. */
const SUPPORTED_GATE_EVALUATION_SCHEMA_VERSIONS = Object.freeze([1]);

/**
 * The recorded skew policy: NO tolerance is applied at the expiry boundary —
 * the recorded time is authoritative (mirrors the approval registry).
 */
const SKEW_POLICY = "no-tolerance";

/** The closed set of clock sources an outcome may record. */
const CLOCK_SOURCES = Object.freeze(["injected", "system"]);

/**
 * Outcome ledger size ceiling in bytes (default 1 MiB; deliberate overrides
 * via AMBER_GATE_MAX_OUTCOME_BYTES). Checked under the write lock on the
 * exact chained event, before any durable state is touched.
 */
const DEFAULT_MAX_OUTCOME_BYTES = 1024 * 1024;

/**
 * The registered comparison operators per family (F050: comparison rules are
 * part of the reviewable contract). An operator outside this registry makes
 * the contract invalid — an unregistered comparator can never be satisfied
 * by construction, never by interpretation.
 */
const COMPARATORS = Object.freeze({
	numeric: Object.freeze(["eq", "ne", "lt", "le", "gt", "ge"]),
	string: Object.freeze(["eq", "ne", "contains"]),
	version: Object.freeze(["lt", "le", "gt", "ge"]),
});

/** v1 failure behavior is deny-only: a failing gate denies. */
const FAIL_BEHAVIORS = Object.freeze(["deny"]);

// Bounded explicit anyOf (F050: "bounded explicit anyOf (every alternative
// spelled out, no scoring)"): the contract must stay small enough to review
// line by line, so the evaluator refuses a contract whose alternative space
// would smuggle combinatorial weight in through quantity.
const MAX_ANYOF_SETS = 8;
const MAX_ANYOF_ENTRIES = 8;

// The gate contract's closed key set under the `gate` extension namespace.
const GATE_CONTRACT_KEYS = Object.freeze([
	"require",
	"anyOf",
	"owners",
	"expires",
	"dependsOn",
	"maxEvidenceAgeMs",
	"failBehavior",
]);

// A requirement's closed key set.
const REQUIREMENT_KEYS = Object.freeze([
	"evidenceType",
	"subject",
	"assurance",
	"threshold",
	"maxAgeMs",
]);

// A threshold's closed key set.
const THRESHOLD_KEYS = Object.freeze(["value", "comparator"]);

// The evaluated event's closed top-level field set: an event carrying a
// field outside the contract (or missing one) is corruption on read, never
// silently dropped — exactly like the approval and evidence event sets.
const OUTCOME_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"clockSource",
	"skewPolicy",
	"gate",
	"gateRevision",
	"subject",
	"verdict",
	"gateContentHash",
	"details",
	"prevHash",
	"hash",
]);

const VERDICTS = Object.freeze(["pass", "fail"]);
const REQUIREMENT_DETAIL_FIELDS = Object.freeze([
	"evidenceType",
	"subject",
	"satisfied",
	"evidenceId",
	"effectiveAssurance",
	"recordedAt",
	"stale",
	"threshold",
]);
const REQUIRED_REQUIREMENT_DETAIL_FIELDS = Object.freeze(
	REQUIREMENT_DETAIL_FIELDS.filter((field) => field !== "threshold"),
);
const THRESHOLD_DETAIL_FIELDS = Object.freeze(["value", "comparator", "actual"]);
const ANYOF_DETAIL_FIELDS = Object.freeze(["satisfied", "entries"]);

const ALL_COMPARATORS = new Set([
	...COMPARATORS.numeric,
	...COMPARATORS.string,
	...COMPARATORS.version,
]);

// Dot-numeric version shape: "1", "1.2", "1.10", "2.0.1" — semver-ish, no
// pre-release/build suffixes (the comparator contract is order, not flavor).
const DOT_NUMERIC_PATTERN = /^\d+(?:\.\d+)*$/;
const DECIMAL_NUMBER_PATTERN = /^-?(?:\d+|\d+\.\d+|\.\d+)$/;

function outcomeLedgerPath(cwd) {
	return statePathForCreate(cwd, "gates", "outcomes.jsonl");
}

function outcomeCorrupt(message) {
	return typedError(OUTCOME_REGISTRY_CORRUPT_CODE, message);
}

function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
	return typeof value === "string" && value.length > 0;
}

function isPositiveInt(value) {
	return Number.isInteger(value) && value > 0;
}

function quotedList(values) {
	return values.map((value) => `"${value}"`).join(", ");
}

function evaluationClockValue(input, opts) {
	const injected = input.now !== undefined ? input.now : opts.now;
	if (injected === undefined) {
		const now = new Date();
		return { ok: true, date: now, ms: now.getTime(), clockSource: "system" };
	}
	if (injected instanceof Date) {
		const ms = injected.getTime();
		if (Number.isNaN(ms)) {
			return {
				ok: false,
				message: "now must be a valid Date or ISO-8601 timestamp; got an invalid Date",
			};
		}
		return { ok: true, date: new Date(ms), ms, clockSource: "injected" };
	}
	if (typeof injected === "string") {
		const ms = parseTimestamp(injected);
		if (ms === null) {
			return {
				ok: false,
				message: `now must be an ISO-8601 date, or a date-time carrying an explicit zone (Z or ±hh:mm), when injected; got ${JSON.stringify(injected)}`,
			};
		}
		return { ok: true, date: new Date(ms), ms, clockSource: "injected" };
	}
	return {
		ok: false,
		message: `now must be a valid Date or ISO-8601 timestamp when injected; got ${JSON.stringify(injected)}`,
	};
}

// ── Contract validation (the first shape consumer's verdicts) ──

/**
 * The shape verdict for one requirement object, shared by gate.require and
 * every gate.anyOf alternative set entry.
 * @param {object} requirement - The requirement object to validate.
 * @param {string} label - Where the requirement lives (e.g. "gate.require[0]").
 * @returns {{code: string, message: string}|null} The problem, or null.
 */
function requirementProblem(requirement, label) {
	if (!isPlainObject(requirement)) {
		return {
			code: CONTRACT_INVALID_CODE,
			message: `${label} must be an object; got ${JSON.stringify(requirement)}`,
		};
	}
	const unknown = Object.keys(requirement)
		.filter((key) => !REQUIREMENT_KEYS.includes(key))
		.sort();
	if (unknown.length > 0) {
		return {
			code: CONTRACT_INVALID_CODE,
			message: `${label} carries unknown key${unknown.length > 1 ? "s" : ""} ${quotedList(unknown)}; the closed key set is ${REQUIREMENT_KEYS.join(", ")}`,
		};
	}
	if (!isNonEmptyString(requirement.evidenceType)) {
		return {
			code: CONTRACT_INVALID_CODE,
			message: `${label}.evidenceType must be a non-empty string naming the evidence this requirement joins on (the receipt subject it must match); got ${JSON.stringify(requirement.evidenceType)}`,
		};
	}
	if (requirement.subject !== undefined && !isNonEmptyString(requirement.subject)) {
		return {
			code: CONTRACT_INVALID_CODE,
			message: `${label}.subject must be a non-empty string when present; got ${JSON.stringify(requirement.subject)}`,
		};
	}
	if (requirement.assurance !== undefined && !ASSURANCE_LEVELS.includes(requirement.assurance)) {
		return {
			code: CONTRACT_INVALID_CODE,
			message: `${label}.assurance must be one of the fixed four-level contract (${ASSURANCE_LEVELS.join(", ")}) when present; got ${JSON.stringify(requirement.assurance)}`,
		};
	}
	if (requirement.maxAgeMs !== undefined && !isPositiveInt(requirement.maxAgeMs)) {
		return {
			code: CONTRACT_INVALID_CODE,
			message: `${label}.maxAgeMs must be a positive integer (milliseconds) when present; got ${JSON.stringify(requirement.maxAgeMs)}`,
		};
	}
	return thresholdProblem(requirement.threshold, label);
}

/**
 * The shape verdict for one requirement threshold. The declared value's
 * TYPE routes the comparison family: a number compares numerically; a
 * string compares exactly (eq/ne) or as a substring (contains), while the
 * ordering operators on a string are dot-numeric version compares. A
 * comparator outside the registered operator set carries its own stable
 * code so the contract author can tell "unknown operator" from "known
 * operator, malformed operands".
 * @returns {{code: string, message: string}|null} The problem, or null.
 */
function thresholdProblem(threshold, label) {
	if (threshold === undefined) return null;
	if (!isPlainObject(threshold)) {
		return {
			code: CONTRACT_INVALID_CODE,
			message: `${label}.threshold must be an object { value, comparator }; got ${JSON.stringify(threshold)}`,
		};
	}
	const unknown = Object.keys(threshold)
		.filter((key) => !THRESHOLD_KEYS.includes(key))
		.sort();
	if (unknown.length > 0) {
		return {
			code: CONTRACT_INVALID_CODE,
			message: `${label}.threshold carries unknown key${unknown.length > 1 ? "s" : ""} ${quotedList(unknown)}; the closed key set is ${THRESHOLD_KEYS.join(", ")}`,
		};
	}
	if (typeof threshold.comparator !== "string" || !ALL_COMPARATORS.has(threshold.comparator)) {
		return {
			code: UNSUPPORTED_COMPARATOR_CODE,
			message: `${label}.threshold.comparator must be a registered comparison operator — numeric: ${COMPARATORS.numeric.join(", ")}; string: ${COMPARATORS.string.join(", ")}; version: ${COMPARATORS.version.join(", ")}; got ${JSON.stringify(threshold.comparator)}`,
		};
	}
	if (typeof threshold.value === "number") {
		if (!COMPARATORS.numeric.includes(threshold.comparator)) {
			return {
				code: CONTRACT_INVALID_CODE,
				message: `${label}.threshold declares a numeric value (${JSON.stringify(threshold.value)}) with comparator "${threshold.comparator}", but that operator is not a numeric one (numeric: ${COMPARATORS.numeric.join(", ")}); a number only compares numerically`,
			};
		}
		if (!Number.isFinite(threshold.value)) {
			return {
				code: CONTRACT_INVALID_CODE,
				message: `${label}.threshold.value must be a finite number for a numeric comparison; got ${JSON.stringify(threshold.value)}`,
			};
		}
		return null;
	}
	if (typeof threshold.value === "string") {
		// String values: eq/ne/contains compare exactly; the ordering
		// operators are version compares (the string family has no order).
		if (COMPARATORS.string.includes(threshold.comparator)) return null;
		if (COMPARATORS.version.includes(threshold.comparator)) {
			if (!DOT_NUMERIC_PATTERN.test(threshold.value)) {
				return {
					code: CONTRACT_INVALID_CODE,
					message: `${label}.threshold.value must be a dot-numeric version (e.g. "1.2", "1.10") for the version comparator "${threshold.comparator}"; got ${JSON.stringify(threshold.value)}`,
				};
			}
			return null;
		}
		return {
			code: CONTRACT_INVALID_CODE,
			message: `${label}.threshold declares a string value (${JSON.stringify(threshold.value)}) with comparator "${threshold.comparator}", but that operator takes no string operand (string: ${COMPARATORS.string.join(", ")}; version: ${COMPARATORS.version.join(", ")})`,
		};
	}
	return {
		code: CONTRACT_INVALID_CODE,
		message: `${label}.threshold.value must be a number (numeric comparison) or a string (string/version comparison); got ${JSON.stringify(threshold.value)}`,
	};
}

/**
 * The full shape verdict for the gate contract carried under
 * envelope.extensions.gate. Pure validation — no evaluation semantics.
 * @returns {{code: string, message: string}|null} The problem, or null.
 */
function gateContractProblem(contract) {
	const unknown = Object.keys(contract)
		.filter((key) => !GATE_CONTRACT_KEYS.includes(key))
		.sort();
	if (unknown.length > 0) {
		return {
			code: CONTRACT_INVALID_CODE,
			message: `the gate contract carries unknown key${unknown.length > 1 ? "s" : ""} ${quotedList(unknown)}; the closed key set is ${GATE_CONTRACT_KEYS.join(", ")}`,
		};
	}
	if (!Array.isArray(contract.require) || contract.require.length === 0) {
		return {
			code: CONTRACT_INVALID_CODE,
			message: `gate.require is required and must be a non-empty array of requirement objects (e.g. [{"evidenceType":"spec/login@2","assurance":"observed"}]); got ${JSON.stringify(contract.require)}`,
		};
	}
	for (let index = 0; index < contract.require.length; index += 1) {
		const problem = requirementProblem(contract.require[index], `gate.require[${index}]`);
		if (problem !== null) return problem;
	}
	if (contract.anyOf !== undefined) {
		if (!Array.isArray(contract.anyOf)) {
			return {
				code: CONTRACT_INVALID_CODE,
				message: `gate.anyOf must be an array of alternative requirement SETS when present (bounded explicit anyOf: at most ${MAX_ANYOF_SETS} sets of at most ${MAX_ANYOF_ENTRIES} entries each); got ${JSON.stringify(contract.anyOf)}`,
			};
		}
		if (contract.anyOf.length > MAX_ANYOF_SETS) {
			return {
				code: CONTRACT_INVALID_CODE,
				message: `gate.anyOf declares ${contract.anyOf.length} alternative sets, but the bounded explicit anyOf contract allows at most ${MAX_ANYOF_SETS} — every alternative is spelled out for review, never generated`,
			};
		}
		for (let setIndex = 0; setIndex < contract.anyOf.length; setIndex += 1) {
			const set = contract.anyOf[setIndex];
			if (!Array.isArray(set)) {
				return {
					code: CONTRACT_INVALID_CODE,
					message: `gate.anyOf[${setIndex}] must be an array of requirement objects (one alternative SET); got ${JSON.stringify(set)}`,
				};
			}
			if (set.length > MAX_ANYOF_ENTRIES) {
				return {
					code: CONTRACT_INVALID_CODE,
					message: `gate.anyOf[${setIndex}] declares ${set.length} entries, but a bounded explicit alternative set allows at most ${MAX_ANYOF_ENTRIES}`,
				};
			}
			for (let entryIndex = 0; entryIndex < set.length; entryIndex += 1) {
				const problem = requirementProblem(
					set[entryIndex],
					`gate.anyOf[${setIndex}][${entryIndex}]`,
				);
				if (problem !== null) return problem;
			}
		}
	}
	if (contract.owners !== undefined) {
		if (
			!Array.isArray(contract.owners) ||
			contract.owners.some((owner) => !isNonEmptyString(owner))
		) {
			return {
				code: CONTRACT_INVALID_CODE,
				message: `gate.owners must be an array of principal-id strings when present (the accountable Decision owners; declared for review — v1 evaluates no owner semantics); got ${JSON.stringify(contract.owners)}`,
			};
		}
	}
	if (contract.expires !== undefined) {
		if (typeof contract.expires !== "string" || parseTimestamp(contract.expires) === null) {
			return {
				code: CONTRACT_INVALID_CODE,
				message: `gate.expires must be an ISO-8601 date, or a date-time carrying an explicit zone (Z or ±hh:mm), when present — e.g. 2027-01-31 or 2027-01-31T09:00:00Z; got ${JSON.stringify(contract.expires)}`,
			};
		}
	}
	if (contract.dependsOn !== undefined) {
		if (
			!Array.isArray(contract.dependsOn) ||
			contract.dependsOn.some((dep) => !isNonEmptyString(dep))
		) {
			return {
				code: CONTRACT_INVALID_CODE,
				message: `gate.dependsOn must be an array of strings when present (the declared dependencies; v1 evaluates no dependency semantics); got ${JSON.stringify(contract.dependsOn)}`,
			};
		}
	}
	if (contract.maxEvidenceAgeMs !== undefined && !isPositiveInt(contract.maxEvidenceAgeMs)) {
		return {
			code: CONTRACT_INVALID_CODE,
			message: `gate.maxEvidenceAgeMs must be a positive integer (milliseconds) when present; got ${JSON.stringify(contract.maxEvidenceAgeMs)}`,
		};
	}
	if (contract.failBehavior !== undefined && !FAIL_BEHAVIORS.includes(contract.failBehavior)) {
		return {
			code: FAIL_BEHAVIOR_UNSUPPORTED_CODE,
			message: `gate.failBehavior must be "deny" when present (v1 is deny-only: a failing gate denies — no warn, quorum, or weighted pass, and no model confidence); got ${JSON.stringify(contract.failBehavior)}`,
		};
	}
	return null;
}

// ── Deterministic comparison semantics ──

/**
 * Parse a receipt's compared value under one threshold: the LAST output,
 * parsed per the family the threshold's declared VALUE type routes to (the
 * same routing the contract validation applies — a number compares
 * numerically; a string compares exactly, or dot-numerically under the
 * ordering operators). Returns null on parse failure (no outputs, a
 * non-string output, a non-decimal numeric string, or a non-dot-numeric version) —
 * the requirement then stays unsatisfied and the detail records the
 * failure as threshold.actual = null.
 * @returns {{actual: number|string|null}}
 */
function parseThresholdActual(outputs, threshold) {
	if (!Array.isArray(outputs) || outputs.length === 0) {
		return { actual: null };
	}
	const last = outputs[outputs.length - 1];
	if (typeof last !== "string") return { actual: null };
	if (typeof threshold.value === "number") {
		if (!DECIMAL_NUMBER_PATTERN.test(last)) return { actual: null };
		const parsed = Number(last);
		return { actual: Number.isFinite(parsed) ? parsed : null };
	}
	// eq/ne live in BOTH the string and version families; a string value
	// routes them to exact comparison (the ordering operators lt/le/gt/ge
	// are version-only for strings). Checking version membership alone
	// would misroute eq/ne onto the dot-numeric pattern and reject every
	// non-version string output.
	if (
		COMPARATORS.version.includes(threshold.comparator) &&
		!COMPARATORS.string.includes(threshold.comparator)
	) {
		return { actual: DOT_NUMERIC_PATTERN.test(last) ? last : null };
	}
	return { actual: last };
}

/**
 * Dot-numeric version compare ("semver-ish"): compare segment by segment,
 * missing segments pad to zero, so "1.2" == "1.2.0" and "1.2" < "1.10".
 * @returns {number} Negative when a < b, positive when a > b, 0 when equal.
 */
function compareVersions(a, b) {
	const segmentsOf = (value) => value.split(".").map(Number);
	const sa = segmentsOf(a);
	const sb = segmentsOf(b);
	const length = Math.max(sa.length, sb.length);
	for (let index = 0; index < length; index += 1) {
		const da = sa[index] ?? 0;
		const db = sb[index] ?? 0;
		if (da !== db) return da < db ? -1 : 1;
	}
	return 0;
}

/**
 * Apply one registered comparator. Both operands are already family-typed
 * and parsed — the threshold's declared value routes the family exactly as
 * the contract validation routed it (a numeric value with a numeric
 * comparator, or a string with a string/version comparator) — and the
 * comparison itself is total and deterministic: no locale, no coercion.
 * @param {object} threshold - The validated { value, comparator }.
 * @param {number|string} actual - The parsed compared value.
 * @returns {boolean}
 */
function applyComparator(threshold, actual) {
	const { value, comparator } = threshold;
	if (typeof value === "number") {
		switch (comparator) {
			case "eq":
				return actual === value;
			case "ne":
				return actual !== value;
			case "lt":
				return actual < value;
			case "le":
				return actual <= value;
			case "gt":
				return actual > value;
			case "ge":
				return actual >= value;
			default:
				return false;
		}
	}
	switch (comparator) {
		case "eq":
			return actual === value;
		case "ne":
			return actual !== value;
		case "contains":
			return actual.includes(value);
		case "lt":
			return compareVersions(actual, value) < 0;
		case "le":
			return compareVersions(actual, value) <= 0;
		case "gt":
			return compareVersions(actual, value) > 0;
		case "ge":
			return compareVersions(actual, value) >= 0;
		default:
			// Unreachable: the contract validation only admits registered
			// comparators, and the writer never builds a threshold it did
			// not validate. Fail closed anyway — never satisfied.
			return false;
	}
}

// ── Requirement evaluation ──

function assuranceIndex(level) {
	const index = ASSURANCE_LEVELS.indexOf(level);
	return index >= 0 ? index : -1;
}

function recordedAtMillis(record) {
	const parsed = parseTimestamp(record.recordedAt);
	return parsed === null ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Evaluate one requirement against the folded evidence records at the
 * evaluation clock. Deterministic: candidates are the receipts joined on
 * the receipt's subject (both the required evidenceType and the effective
 * subject — see the module header's join convention), and the recorded
 * candidate is the best one (highest effective assurance, then freshest).
 * @param {object} requirement - A validated requirement object.
 * @param {string} effectiveSubject - requirement.subject ?? the input subject.
 * @param {Array<object>} records - Folded evidence records (derived assurance).
 * @param {number} evalNowMs - The evaluation clock in epoch milliseconds.
 * @param {number|null} gateMaxAgeMs - The gate-level freshness bound.
 * @returns {{satisfied: boolean, detail: object}} The verdict and its detail.
 */
function evaluateRequirement(requirement, effectiveSubject, records, evalNowMs, gateMaxAgeMs) {
	const candidates = records.filter(
		(record) => record.subject === requirement.evidenceType && record.subject === effectiveSubject,
	);
	const maxAgeMs = requirement.maxAgeMs ?? gateMaxAgeMs ?? null;
	const requiredIndex = assuranceIndex(requirement.assurance ?? "unavailable");
	const threshold = requirement.threshold ?? null;

	const ageOf = (record) => evalNowMs - recordedAtMillis(record);
	const hasParseableRecordedAt = (record) => Number.isFinite(recordedAtMillis(record));
	const isFresh = (record) =>
		hasParseableRecordedAt(record) && (maxAgeMs === null || ageOf(record) <= maxAgeMs);
	const isStale = (record) =>
		!hasParseableRecordedAt(record) || (maxAgeMs !== null && ageOf(record) > maxAgeMs);

	// One candidate satisfies the requirement when it passed, meets the
	// required assurance level, is fresh at the evaluation clock, and (when
	// a threshold is declared) its LAST output parses and compares true.
	const satisfies = (record) => {
		if (record.status !== "pass") return false;
		if (assuranceIndex(record.assurance) < requiredIndex) return false;
		if (!isFresh(record)) return false;
		if (threshold !== null) {
			const { actual } = parseThresholdActual(record.outputs, threshold);
			if (actual === null) return false;
			if (!applyComparator(threshold, actual)) return false;
		}
		return true;
	};

	// Best-first ordering: highest effective assurance, then freshest —
	// the audit trail names one receipt per requirement, never a pile.
	const bestFirst = (a, b) => {
		const byAssurance = assuranceIndex(b.assurance) - assuranceIndex(a.assurance);
		if (byAssurance !== 0) return byAssurance;
		return recordedAtMillis(b) - recordedAtMillis(a);
	};

	const ordered = candidates.slice().sort(bestFirst);
	// The recorded receipt is the best SATISFYING candidate; when none
	// satisfies, it is the best candidate overall — the why-not evidence
	// (or nulls when the requirement matched nothing at all).
	const chosen = ordered.find(satisfies) ?? (ordered.length > 0 ? ordered[0] : null);

	const detail = {
		evidenceType: requirement.evidenceType,
		subject: effectiveSubject,
		satisfied: chosen !== null && satisfies(chosen),
		evidenceId: chosen !== null ? chosen.id : null,
		effectiveAssurance: chosen !== null ? chosen.assurance : null,
		recordedAt: chosen !== null ? chosen.recordedAt : null,
		stale: chosen !== null ? isStale(chosen) : false,
	};
	if (threshold !== null) {
		// threshold.actual is the parsed comparison value: null means the
		// parse failed (no output, non-finite number, or non-dot-numeric
		// version) — the recorded "why not" for an unsatisfied threshold.
		const { actual } =
			chosen !== null ? parseThresholdActual(chosen.outputs, threshold) : { actual: null };
		detail.threshold = {
			value: threshold.value,
			comparator: threshold.comparator,
			actual,
		};
	}
	return { satisfied: detail.satisfied, detail };
}

// ── Outcome ledger (append-only, hash-chained, write-locked) ──

function acquireOutcomeLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(outcomeLedgerPath(cwd)),
		lockName: "outcomes.lock",
		conflictCode: OUTCOME_REGISTRY_LOCK_CODE,
		corruptCode: OUTCOME_REGISTRY_CORRUPT_CODE,
		label: "gate outcome ledger",
		staleMs: LOCK_STALE_MS,
	});
}

function appendWithinCeiling(cwd, event) {
	return sharedAppendWithinCeiling({
		ledgerPath: outcomeLedgerPath(cwd),
		event,
		envName: "AMBER_GATE_MAX_OUTCOME_BYTES",
		defaultBytes: DEFAULT_MAX_OUTCOME_BYTES,
		label: "gate outcome ledger",
	});
}

function thresholdDetailProblem(threshold, label) {
	if (!isPlainObject(threshold))
		return `${label} is not an object; got ${JSON.stringify(threshold)}`;
	const unknown = Object.keys(threshold)
		.filter((key) => !THRESHOLD_DETAIL_FIELDS.includes(key))
		.sort();
	if (unknown.length > 0) {
		return `${label} carries unknown key${unknown.length > 1 ? "s" : ""} ${quotedList(unknown)}; the closed key set is ${THRESHOLD_DETAIL_FIELDS.join(", ")}`;
	}
	const missing = THRESHOLD_DETAIL_FIELDS.filter((field) => !(field in threshold));
	if (missing.length > 0) {
		return `${label} is missing field${missing.length > 1 ? "s" : ""} ${quotedList(missing)}; the closed key set is ${THRESHOLD_DETAIL_FIELDS.join(", ")}`;
	}
	if (!(typeof threshold.value === "number" || typeof threshold.value === "string")) {
		return `${label}.value is not a number or string; got ${JSON.stringify(threshold.value)}`;
	}
	if (typeof threshold.comparator !== "string" || !ALL_COMPARATORS.has(threshold.comparator)) {
		return `${label}.comparator is not a registered comparator; got ${JSON.stringify(threshold.comparator)}`;
	}
	if (
		threshold.actual !== null &&
		!(typeof threshold.actual === "number" || typeof threshold.actual === "string")
	) {
		return `${label}.actual is not null, a number, or a string; got ${JSON.stringify(threshold.actual)}`;
	}
	return null;
}

function requirementDetailProblem(detail, label) {
	if (!isPlainObject(detail)) return `${label} is not an object; got ${JSON.stringify(detail)}`;
	const unknown = Object.keys(detail)
		.filter((key) => !REQUIREMENT_DETAIL_FIELDS.includes(key))
		.sort();
	if (unknown.length > 0) {
		return `${label} carries unknown key${unknown.length > 1 ? "s" : ""} ${quotedList(unknown)}; the closed key set is ${REQUIREMENT_DETAIL_FIELDS.join(", ")}`;
	}
	const missing = REQUIRED_REQUIREMENT_DETAIL_FIELDS.filter((field) => !(field in detail));
	if (missing.length > 0) {
		return `${label} is missing field${missing.length > 1 ? "s" : ""} ${quotedList(missing)}; the closed key set is ${REQUIREMENT_DETAIL_FIELDS.join(", ")}`;
	}
	if (!isNonEmptyString(detail.evidenceType)) {
		return `${label}.evidenceType is not a non-empty string; got ${JSON.stringify(detail.evidenceType)}`;
	}
	if (!isNonEmptyString(detail.subject)) {
		return `${label}.subject is not a non-empty string; got ${JSON.stringify(detail.subject)}`;
	}
	if (typeof detail.satisfied !== "boolean") {
		return `${label}.satisfied is not a boolean; got ${JSON.stringify(detail.satisfied)}`;
	}
	if (detail.evidenceId !== null && !isNonEmptyString(detail.evidenceId)) {
		return `${label}.evidenceId is not null or a non-empty string; got ${JSON.stringify(detail.evidenceId)}`;
	}
	if (detail.effectiveAssurance !== null && !ASSURANCE_LEVELS.includes(detail.effectiveAssurance)) {
		return `${label}.effectiveAssurance is not null or one of ${ASSURANCE_LEVELS.join(", ")}; got ${JSON.stringify(detail.effectiveAssurance)}`;
	}
	if (detail.recordedAt !== null && !isNonEmptyString(detail.recordedAt)) {
		return `${label}.recordedAt is not null or a non-empty string; got ${JSON.stringify(detail.recordedAt)}`;
	}
	if (typeof detail.stale !== "boolean") {
		return `${label}.stale is not a boolean; got ${JSON.stringify(detail.stale)}`;
	}
	if ("threshold" in detail) return thresholdDetailProblem(detail.threshold, `${label}.threshold`);
	return null;
}

function anyOfDetailProblem(set, label) {
	if (!isPlainObject(set)) return `${label} is not an object; got ${JSON.stringify(set)}`;
	const unknown = Object.keys(set)
		.filter((key) => !ANYOF_DETAIL_FIELDS.includes(key))
		.sort();
	if (unknown.length > 0) {
		return `${label} carries unknown key${unknown.length > 1 ? "s" : ""} ${quotedList(unknown)}; the closed key set is ${ANYOF_DETAIL_FIELDS.join(", ")}`;
	}
	const missing = ANYOF_DETAIL_FIELDS.filter((field) => !(field in set));
	if (missing.length > 0) {
		return `${label} is missing field${missing.length > 1 ? "s" : ""} ${quotedList(missing)}; the closed key set is ${ANYOF_DETAIL_FIELDS.join(", ")}`;
	}
	if (typeof set.satisfied !== "boolean") {
		return `${label}.satisfied is not a boolean; got ${JSON.stringify(set.satisfied)}`;
	}
	if (!Array.isArray(set.entries)) {
		return `${label}.entries is not an array; got ${JSON.stringify(set.entries)}`;
	}
	for (let index = 0; index < set.entries.length; index += 1) {
		const problem = requirementDetailProblem(set.entries[index], `${label}.entries[${index}]`);
		if (problem !== null) return problem;
	}
	return null;
}

/**
 * Fold the outcome ledger: verify the hash chain, the closed event field
 * set (unknown AND missing fields are corruption), the closed kind/verdict/
 * clock-source/skew-policy sets, and the schema version. Returns the stored
 * events with their derived 0-based line index.
 * @returns {Array<object>} The outcome records, in append order.
 * @throws {Error} Typed AMBER_E_* on any corruption.
 */
function foldOutcomes(cwd) {
	const events = readLedgerFailClosed(
		outcomeLedgerPath(cwd),
		OUTCOME_REGISTRY_CORRUPT_CODE,
		"gate outcome ledger",
	);
	const records = [];
	let prevHash = GENESIS_HASH;
	for (let index = 0; index < events.length; index += 1) {
		const lineIndex = index + 1;
		const event = events[index];
		if (!isPlainObject(event)) {
			throw outcomeCorrupt(
				`gate outcome ledger event ${lineIndex} is not an object; got ${JSON.stringify(event)}`,
			);
		}
		if (!Number.isInteger(event.schemaVersion)) {
			throw outcomeCorrupt(
				`gate outcome ledger event ${lineIndex} carries no integer schemaVersion; got ${JSON.stringify(event.schemaVersion)}`,
			);
		}
		if (!SUPPORTED_GATE_EVALUATION_SCHEMA_VERSIONS.includes(event.schemaVersion)) {
			throw outcomeCorrupt(
				`gate outcome ledger event ${lineIndex} declares schemaVersion ${JSON.stringify(event.schemaVersion)}, but this reader supports ${SUPPORTED_GATE_EVALUATION_SCHEMA_VERSIONS.join(", ")}; an event this reader cannot interpret is rejected rather than reinterpreted`,
			);
		}
		// The tamper-evident chain runs before any content is trusted (the
		// shared registry-ledger discipline).
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash) {
			throw outcomeCorrupt(
				`gate outcome ledger event ${lineIndex} breaks the hash chain: its prevHash does not match the previous event's hash — the ledger was edited in place`,
			);
		}
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash) {
			throw outcomeCorrupt(
				`gate outcome ledger event ${lineIndex} carries a hash that does not match its content — the ledger was edited in place`,
			);
		}
		const unknown = Object.keys(event)
			.filter((key) => !OUTCOME_EVENT_FIELDS.includes(key))
			.sort();
		if (unknown.length > 0) {
			throw outcomeCorrupt(
				`gate outcome ledger event ${lineIndex} carries unknown field${unknown.length > 1 ? "s" : ""} ${quotedList(unknown)}; the closed field set is ${OUTCOME_EVENT_FIELDS.join(", ")}`,
			);
		}
		const missing = OUTCOME_EVENT_FIELDS.filter((field) => !(field in event));
		if (missing.length > 0) {
			throw outcomeCorrupt(
				`gate outcome ledger event ${lineIndex} is missing field${missing.length > 1 ? "s" : ""} ${quotedList(missing)}; the closed field set is ${OUTCOME_EVENT_FIELDS.join(", ")}`,
			);
		}
		if (event.kind !== "evaluated") {
			throw outcomeCorrupt(
				`gate outcome ledger event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}; the closed kind set is evaluated`,
			);
		}
		if (!CLOCK_SOURCES.includes(event.clockSource)) {
			throw outcomeCorrupt(
				`gate outcome ledger event ${lineIndex} carries clockSource ${JSON.stringify(event.clockSource)} outside the closed set (${CLOCK_SOURCES.join(", ")})`,
			);
		}
		if (event.skewPolicy !== SKEW_POLICY) {
			throw outcomeCorrupt(
				`gate outcome ledger event ${lineIndex} carries skewPolicy ${JSON.stringify(event.skewPolicy)}, but the recorded policy is fixed (${SKEW_POLICY})`,
			);
		}
		if (!VERDICTS.includes(event.verdict)) {
			throw outcomeCorrupt(
				`gate outcome ledger event ${lineIndex} carries verdict ${JSON.stringify(event.verdict)} outside the closed set (${VERDICTS.join(", ")})`,
			);
		}
		if (!isNonEmptyString(event.at)) {
			throw outcomeCorrupt(
				`gate outcome ledger event ${lineIndex} carries no timestamp ("at"); got ${JSON.stringify(event.at)}`,
			);
		}
		for (const field of ["gate", "subject", "gateContentHash"]) {
			if (!isNonEmptyString(event[field])) {
				throw outcomeCorrupt(
					`gate outcome ledger event ${lineIndex} carries a ${field} that is not a non-empty string; got ${JSON.stringify(event[field])}`,
				);
			}
		}
		if (!isPositiveInt(event.gateRevision)) {
			throw outcomeCorrupt(
				`gate outcome ledger event ${lineIndex} carries a gateRevision that is not a positive integer; got ${JSON.stringify(event.gateRevision)}`,
			);
		}
		if (
			!isPlainObject(event.details) ||
			!Array.isArray(event.details.requirements) ||
			!Array.isArray(event.details.anyOf)
		) {
			throw outcomeCorrupt(
				`gate outcome ledger event ${lineIndex} carries a details object that is not { requirements: [...], anyOf: [...] }; got ${JSON.stringify(event.details)}`,
			);
		}
		for (let detailIndex = 0; detailIndex < event.details.requirements.length; detailIndex += 1) {
			const problem = requirementDetailProblem(
				event.details.requirements[detailIndex],
				`details.requirements[${detailIndex}]`,
			);
			if (problem !== null) {
				throw outcomeCorrupt(`gate outcome ledger event ${lineIndex} carries ${problem}`);
			}
		}
		for (let setIndex = 0; setIndex < event.details.anyOf.length; setIndex += 1) {
			const problem = anyOfDetailProblem(
				event.details.anyOf[setIndex],
				`details.anyOf[${setIndex}]`,
			);
			if (problem !== null) {
				throw outcomeCorrupt(`gate outcome ledger event ${lineIndex} carries ${problem}`);
			}
		}
		records.push({ ...event, index });
		prevHash = event.hash;
	}
	return records;
}

// ── Public seams ──

/**
 * Evaluate one gate artifact against the folded Evidence receipts and
 * append the immutable outcome record. The evaluation clock may be injected
 * (input.now or opts.now — recorded as clockSource "injected"; "system"
 * otherwise). A FAIL verdict is still a completed evaluation: the outcome
 * is appended (verdict "fail") and returned with ok true — the record is
 * the audit trail; only contract/expiry/resolution failures refuse to run.
 *
 * @param {string} cwd - The repository root.
 * @param {object} input - { gate, revision?, subject, now? }.
 * @param {object} [opts] - { now? } — an alternative injection point for the clock.
 * @returns {{ok: boolean, code: string|null, outcome: object|null, errors: string[]}}
 */
function evaluateGate(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, outcome: null, errors });
	const { gate, revision = null, subject } = input;
	if (!isNonEmptyString(gate)) {
		return fail(INVALID_ARG_CODE, [
			`gate is required: the evaluation names the gate artifact to evaluate (e.g. --gate gate/login-gate); got ${JSON.stringify(gate)}`,
		]);
	}
	if (!isNonEmptyString(subject)) {
		return fail(INVALID_ARG_CODE, [
			`subject is required: the evaluation is scoped to the subject being gated (e.g. --subject spec/login@2); got ${JSON.stringify(subject)}`,
		]);
	}
	if (revision !== null && !isPositiveInt(revision)) {
		return fail(INVALID_ARG_CODE, [
			`revision must be a positive integer when provided (the committed gate revision to evaluate; defaults to the current committed head); got ${JSON.stringify(revision)}`,
		]);
	}
	// F055 T4 (#286): a tombstoned subject cannot be re-proven. Deleted or
	// deletion-pending records refuse Gate evaluation instead of letting
	// historical existence satisfy content, replay, or freshness Gates.
	// The guard binds at the SUBJECT seam because Evidence receipts carry
	// free-text subjects with no record linkage — refusing a subject blocks
	// every receipt about it. It covers the evaluation's input subject HERE
	// (before the gate artifact resolves) and every per-requirement subject
	// override AFTER contract resolution below; a receipt recorded under an
	// unrelated free-text phrasing stays out of reach because requirements
	// join evidence on these same subject strings. The match is
	// deliberately type-agnostic (identity@revision): over-blocking is
	// fail-safe.
	let tombstones;
	try {
		tombstones = deletionTombstones(cwd);
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_RETENTION_TX_CORRUPT", [err.message || String(err)]);
	}
	const tombstoneOf = (value) =>
		tombstones.find((entry) => `${entry.record.identity}@${entry.record.revision}` === value) ??
		null;
	{
		const tombstone = tombstoneOf(subject);
		if (tombstone) {
			return fail("AMBER_E_RETENTION_TOMBSTONE", [
				`subject ${JSON.stringify(subject)} is ${tombstone.status} under deletion transaction ${JSON.stringify(tombstone.transactionId)}; historical existence is not current proof — a deleted record cannot satisfy content, replay, or freshness Gates`,
			]);
		}
	}
	const clock = evaluationClockValue(input, opts);
	if (!clock.ok) return fail(INVALID_ARG_CODE, [clock.message]);
	const evalNow = clock.date;
	const evalNowMs = clock.ms;
	const clockSource = clock.clockSource;
	const at = evalNow.toISOString();

	// Resolve the gate artifact through the canonical store's READ seam —
	// never a direct file read: the store's verification (settlement
	// journal replay, hash cross-checks, cycle walk) is part of the
	// evaluation's fail-closed contract. Store failures propagate the
	// store's own codes.
	let projection;
	try {
		projection = showArtifact(cwd, gate, { type: "gate", revision });
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_ARTIFACT_NOT_FOUND", [err.message || String(err)]);
	}
	if (projection === null) {
		return fail(GATE_NOT_FOUND_CODE, [
			`no committed revision found for gate "${gate}"${revision !== null ? ` at revision ${revision}` : ""}; admit the Gate Contract first (amber artifact admit --type gate ...) or evaluate the stored spelling`,
		]);
	}

	// The contract rides the Envelope's extensions carrier; this evaluator
	// is its first shape consumer.
	const extensions = projection.envelope ? projection.envelope.extensions : undefined;
	const contract = isPlainObject(extensions) ? extensions.gate : undefined;
	if (!isPlainObject(contract)) {
		return fail(CONTRACT_INVALID_CODE, [
			`gate "${gate}" revision ${projection.revision} carries no gate contract: the machine-actionable contract must ride the Envelope's extensions carrier under the "gate" namespace (admit it with --extension gate.require='[...]' and the other gate.* keys)`,
		]);
	}
	const problem = gateContractProblem(contract);
	if (problem !== null) return fail(problem.code, [problem.message]);

	// Expiry: the gate refuses to run — no outcome is appended (mirrors the
	// approval window: at exactly gate.expires the gate is already expired).
	if (contract.expires !== undefined) {
		const expiresMs = parseTimestamp(contract.expires);
		if (expiresMs !== null && evalNowMs >= expiresMs) {
			return fail(EXPIRED_CODE, [
				`gate "${gate}" revision ${projection.revision} expired at ${contract.expires} and the evaluation clock is ${at}; an expired contract declines to run (no outcome is appended) — admit a fresh revision`,
			]);
		}
	}

	// The evidence read seam is the fold's derived records (effective
	// assurance, verified promotion included); its failures propagate its
	// own codes.
	// Per-requirement subject overrides join evidence exactly like the
	// input subject does, so they pass the same tombstone guard: a gate
	// naming a deleted record in requirement.subject cannot pull its
	// Evidence while the input subject differs.
	for (const requirement of [...contract.require, ...(contract.anyOf ?? []).flat()]) {
		if (requirement.subject === undefined) continue;
		const tombstone = tombstoneOf(requirement.subject);
		if (tombstone) {
			return fail("AMBER_E_RETENTION_TOMBSTONE", [
				`requirement subject ${JSON.stringify(requirement.subject)} of gate "${gate}" is ${tombstone.status} under deletion transaction ${JSON.stringify(tombstone.transactionId)}; historical existence is not current proof — a deleted record cannot satisfy content, replay, or freshness Gates`,
			]);
		}
	}
	let records;
	try {
		records = listEvidence(cwd);
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_EVIDENCE_REGISTRY_CORRUPT", [err.message || String(err)]);
	}

	// allOf: every gate.require entry must be satisfied.
	const requirements = contract.require.map((requirement) =>
		evaluateRequirement(
			requirement,
			requirement.subject ?? subject,
			records,
			evalNowMs,
			contract.maxEvidenceAgeMs ?? null,
		),
	);
	// Bounded explicit anyOf: at least one alternative set fully satisfied
	// (when the contract declares any at all).
	const anyOfSets = (contract.anyOf ?? []).map((set) => {
		const entries = set.map((requirement) =>
			evaluateRequirement(
				requirement,
				requirement.subject ?? subject,
				records,
				evalNowMs,
				contract.maxEvidenceAgeMs ?? null,
			),
		);
		return { satisfied: entries.every((entry) => entry.satisfied), entries };
	});
	const verdict =
		requirements.every((entry) => entry.satisfied) &&
		(anyOfSets.length === 0 || anyOfSets.some((set) => set.satisfied))
			? "pass"
			: "fail";

	const eventBody = {
		kind: "evaluated",
		schemaVersion: GATE_EVALUATION_SCHEMA_VERSION,
		at,
		clockSource,
		skewPolicy: SKEW_POLICY,
		gate,
		gateRevision: projection.revision,
		subject,
		verdict,
		gateContentHash: projection.contentHash,
		details: {
			requirements: requirements.map((entry) => entry.detail),
			anyOf: anyOfSets.map((set) => ({
				satisfied: set.satisfied,
				entries: set.entries.map((entry) => entry.detail),
			})),
		},
	};

	let release;
	try {
		release = acquireOutcomeLock(cwd);
	} catch (err) {
		return fail(err.amberCode || OUTCOME_REGISTRY_CORRUPT_CODE, [err.message || String(err)]);
	}
	try {
		// Fold under the lock: the chain head and the line count both come
		// from one verified read, so a racing append cannot slip between
		// them (the shared lock is the only serializer).
		let folded;
		try {
			folded = foldOutcomes(cwd);
		} catch (err) {
			return fail(err.amberCode || OUTCOME_REGISTRY_CORRUPT_CODE, [err.message || String(err)]);
		}
		const prevHash = folded.length > 0 ? folded[folded.length - 1].hash : GENESIS_HASH;
		const index = folded.length;
		const event = { ...eventBody, prevHash, hash: chainHash(eventBody, prevHash) };
		// The event is fully known before the append (nothing depends on a
		// nested admission), so the ceiling probe runs on the exact chained
		// event — a probe that passes cannot hide a line that would refuse.
		const ceiling = appendWithinCeiling(cwd, event);
		if (ceiling.wouldExceed) {
			return fail(OUTCOME_SIZE_CEILING_CODE, [
				`appending the outcome for gate "${gate}" would grow the gate outcome ledger beyond its size ceiling of ${ceiling.ceiling} bytes (AMBER_GATE_MAX_OUTCOME_BYTES); the write is refused before any durable state is touched — raise the ceiling deliberately or keep the contract bounded`,
			]);
		}
		try {
			appendJSONL(outcomeLedgerPath(cwd), event);
		} catch (err) {
			return fail(OUTCOME_REGISTRY_CORRUPT_CODE, [
				`failed to append the outcome for gate "${gate}" to the gate outcome ledger: ${err.message || String(err)}`,
			]);
		}
		return { ok: true, code: null, outcome: { ...event, index }, errors: [] };
	} finally {
		release();
	}
}

/**
 * List the outcome records in append order, optionally filtered. Derived
 * records carry their 0-based line index.
 * @param {string} cwd - The repository root.
 * @param {object} [filters] - { gate?, subject?, verdict? } (null/undefined = no filter).
 * @returns {Array<object>} The matching outcome records.
 * @throws {Error} Typed AMBER_E_* on a corrupt ledger.
 */
function listGateOutcomes(cwd, { gate = null, subject = null, verdict = null } = {}) {
	return foldOutcomes(cwd).filter(
		(record) =>
			(gate === null || record.gate === gate) &&
			(subject === null || record.subject === subject) &&
			(verdict === null || record.verdict === verdict),
	);
}

/**
 * Show one outcome record: by 0-based ledger line index (--index), or the
 * LATEST record matching --gate (optionally narrowed by --subject). With
 * neither key, the latest record overall. Returns null when nothing
 * matches (the CLI maps that to AMBER_E_GATE_NOT_FOUND).
 * @param {string} cwd - The repository root.
 * @param {object} [query] - { index?, gate?, subject? }.
 * @returns {object|null} The outcome record, or null.
 * @throws {Error} Typed AMBER_E_* on a corrupt ledger.
 */
function showGateOutcome(cwd, { index = null, gate = null, subject = null } = {}) {
	if (index !== null) {
		if (!Number.isInteger(index) || index < 0) {
			throw typedError(INVALID_ARG_CODE, [
				`index must be a non-negative integer (the 0-based gate outcome ledger line); got ${JSON.stringify(index)}`,
			]);
		}
		return foldOutcomes(cwd).find((record) => record.index === index) ?? null;
	}
	const matching = listGateOutcomes(cwd, { gate, subject });
	return matching.length > 0 ? matching[matching.length - 1] : null;
}

module.exports = {
	GATE_EVALUATION_SCHEMA_VERSION,
	SUPPORTED_GATE_EVALUATION_SCHEMA_VERSIONS,
	COMPARATORS,
	FAIL_BEHAVIORS,
	SKEW_POLICY,
	CLOCK_SOURCES,
	DEFAULT_MAX_OUTCOME_BYTES,
	MAX_ANYOF_SETS,
	MAX_ANYOF_ENTRIES,
	GENESIS_HASH,
	chainHash,
	evaluateGate,
	showGateOutcome,
	listGateOutcomes,
};
