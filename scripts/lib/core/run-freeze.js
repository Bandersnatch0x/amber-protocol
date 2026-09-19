"use strict";

// Trusted-control run contract (docs/specs/trusted-control-run-contract.md) —
// the ONE home of the frozen-admission value + hash derivations, shared by the
// session-stage capture (plan Slice 1) and the governed-runner gate path
// (Slice 3) so the two can never drift.
//
// Layered hashing (spec §4):
//   Layer 0  scopeHash / policyHash / capabilityHash / contextHash /
//            executionProfileHash — each from raw values or existing hashes only
//   Layer 1  contractHash — consumes Layer 0 + route identity, written last,
//            never an input of any hash including its own (R-HA-1..R-HA-4)
// plus the request binding (R-FR-0): inputDigest over the evaluated request.
//
// Set-like vs sequence-sensitive (R-HA-2): scopeInputs.capabilities,
// scopeInputs.targets, and the capability-record aggregation are SORTED before
// hashing; policy rule arrays and argv sequences are preserved verbatim —
// reordering a sequence-sensitive array changes its hash, reordering a
// set-like one must not (canonicalJson sorts keys, never arrays).

const { canonicalJson, sha256Hex } = require("./context-hash");

function canonicalHashOf(value) {
	return sha256Hex(canonicalJson(JSON.stringify(value)));
}

// The closed six-field scopeInputs set (spec §3). `constraints` and
// `context_scope` are `null` on surfaces whose owning contracts (0053 context
// runtime) have not landed their fields yet — an explicit recorded absence,
// never default-filled (R-AU-1, R-FR-4 discipline).
const SCOPE_INPUT_FIELDS = Object.freeze([
	"capabilities",
	"targets",
	"constraints",
	"context_scope",
	"side_effect_policy",
	"expiration",
]);

// The registered capability-record field set the capabilityHash binds (§3
// R-FR-3): registered semantics, not a digest label. A registry change to any
// of these is capability drift at the gate.
const CAPABILITY_PINNED_FIELDS = Object.freeze([
	"runnerId",
	"runnerVersion",
	"name",
	"capabilityVersion",
	"effects",
	"pathPrefixes",
	"timeoutMsMax",
	"credentialRequirement",
	"rollback",
	// §7.3 field extensions (governance contract): registered semantics whose
	// change is capability drift. Pre-runtime records read them as null.
	"targetSchema",
	"constraints",
	"idempotency",
	"evidenceContract",
]);

/**
 * Project one folded registry capability record onto the pinned field set.
 * @param {object} record
 */
function projectCapabilityRecord(record) {
	const projected = {};
	for (const field of CAPABILITY_PINNED_FIELDS) {
		projected[field] = record[field] === undefined ? null : record[field];
	}
	return projected;
}

/**
 * scopeHash over the six-field scopeInputs with the set-like arrays sorted
 * (R-HA-2).
 * @param {object} scopeInputs
 */
function scopeHashOf(scopeInputs) {
	return canonicalHashOf({
		...scopeInputs,
		capabilities: [...(scopeInputs.capabilities ?? [])].sort(),
		targets: [...(scopeInputs.targets ?? [])].sort(),
	});
}

/**
 * policyHash over the complete parsed rules object, order preserved.
 * @param {object|null} rules
 */
function policyHashOf(rules) {
	return canonicalHashOf(rules ?? null);
}

/**
 * capabilityHash over the full registered capability records, set-sorted.
 * @param {Array<object>} records - folded capability records (full bodies)
 */
function capabilityHashOf(records) {
	const projected = (records ?? []).map(projectCapabilityRecord).map((record) =>
		JSON.stringify(canonicalJson(JSON.stringify(record))),
	);
	projected.sort();
	return sha256Hex(`[${projected.join(",")}]`);
}

/**
 * executionProfileHash over the execution_context values.
 * @param {object|null} executionContext
 */
function executionProfileHashOf(executionContext) {
	return canonicalHashOf(executionContext ?? null);
}

/**
 * contractHash (Layer 1, computed last): Layer 0 + route identity only. Does
 * not include attempt identity (R-HA-4) and is never written back into any
 * hashed object.
 */
function contractHashOf({ routeId, routeVersion, hashes }) {
	return canonicalHashOf({
		route: { id: routeId, version: routeVersion },
		scopeHash: hashes.scopeHash,
		policyHash: hashes.policyHash,
		capabilityHash: hashes.capabilityHash,
		contextHash: hashes.contextHash,
		executionProfileHash: hashes.executionProfileHash,
	});
}

/**
 * The R-FR-0 request binding: the evaluated request's own integrity digest,
 * separate from policyHash (rules) and contractHash (Layer 0 + route).
 * `attemptNumber` and `fence` are numbers; `argv` is the ordered verbatim
 * vector ([] for a shell-string command — the honest value, there is none).
 */
function inputDigestOf({ resolvedCommand, argv, capabilityPin, routeHash, stageName, attemptNumber, fence }) {
	return canonicalHashOf({
		resolvedCommand: resolvedCommand ?? null,
		argv: argv ?? null,
		capabilityPin: capabilityPin ?? null,
		routeHash: routeHash ?? null,
		stageName: stageName ?? null,
		attemptNumber: attemptNumber ?? null,
		fence: fence ?? null,
	});
}

/**
 * R-ID-1: runId is a lossless derivation of the full (sessionId, attemptId)
 * tuple — complete UUIDs, no truncation, no timestamp, no randomness.
 * @param {string} sessionId
 * @param {string} attemptId
 */
function runIdOf(sessionId, attemptId) {
	return `run-${sessionId}-${attemptId}`;
}

// The F052 capability-pin grammar (`runnerId@version#capability@version`), the
// same shape route-commands' VERB_TARGET_GRAMMAR pins; duplicated here as a
// pure string op so the gate path can resolve the pin without importing the
// route surface (cycle safety). Pinned by tests on both sides.
const CAPABILITY_PIN_PATTERN = /^([^@#\s]+)@([^@#\s]+)#([^@#\s]+)@([^@#\s]+)$/;

/**
 * Parse a capability pin into its four identity parts, or null when it does
 * not match the closed grammar.
 * @param {string} pin
 */
function parseCapabilityPin(pin) {
	if (typeof pin !== "string") return null;
	const match = CAPABILITY_PIN_PATTERN.exec(pin);
	if (!match) return null;
	return {
		runnerId: match[1],
		runnerVersion: match[2],
		name: match[3],
		capabilityVersion: match[4],
	};
}

/**
 * R2 metrics fold over one session ledger's records (spec §7): attempt
 * counters count the full capture population with explicit inclusion —
 * `requested = admitted + denied + still-open (requested-not-yet-gated or
 * expired)`; `settled ⊆ admitted`; session terminal states are counted
 * separately, never merged into one `completed`. A gate-refused retry counts
 * in `requested` and `denied`, never in `admitted`.
 *
 * `attempts_settled_total` counts a settlement only when its request carries
 * an `attempt_admitted` event, so `settled ⊆ admitted` holds by construction:
 * a `rejected` settlement is the denial artifact of the F062 closed settle
 * contract (the attempt is denied, never admitted) and is counted in
 * `attempts_denied_total`; windows settled outside this contract's admission
 * flow (host-agent turns, legacy records) stay visible in their primary
 * events and in `attempts_still_open`, never silently merged.
 * @param {Array<object>} records - one session ledger's records
 */
function attemptMetricsOf(records) {
	const all = records ?? [];
	const requested = all.filter((record) => record.kind === "stage_attempt_requested");
	const admitted = all.filter((record) => record.kind === "attempt_admitted");
	const denied = all.filter((record) => record.kind === "attempt_denied");
	const admittedIds = new Set(admitted.map((record) => record.requestId));
	const deniedIds = new Set(denied.map((record) => record.requestId));
	const settledTotal = {};
	for (const record of all) {
		if (
			record.kind === "stage_attempt_settled" &&
			record.status !== "rejected" &&
			admittedIds.has(record.requestId)
		) {
			settledTotal[record.status] = (settledTotal[record.status] ?? 0) + 1;
		}
	}
	return {
		attempts_requested_total: requested.length,
		attempts_admitted_total: admitted.length,
		attempts_denied_total: denied.length,
		attempts_settled_total: settledTotal,
		attempts_still_open:
			requested.filter(
				(record) => !admittedIds.has(record.requestId) && !deniedIds.has(record.requestId),
			).length,
	};
}

module.exports = {
	SCOPE_INPUT_FIELDS,
	CAPABILITY_PINNED_FIELDS,
	canonicalHashOf,
	projectCapabilityRecord,
	scopeHashOf,
	policyHashOf,
	capabilityHashOf,
	executionProfileHashOf,
	contractHashOf,
	inputDigestOf,
	runIdOf,
	parseCapabilityPin,
	attemptMetricsOf,
};
