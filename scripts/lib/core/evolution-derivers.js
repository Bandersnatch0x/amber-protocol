"use strict";

// Behavior-surface deterministic derivers (trusted-control evolution contract
// §5 stage 2 / §7; plan Slice 5, docs/plans/trusted-control-evolution.md).
//
// One seam, four destinations. A deriver consumes structured evolution
// findings (the `findings` array from `extractStructuredFindings`) and emits
// a DECLARATIVE DRAFT for its destination's existing Decision-bound
// typed-mutation surface. The contract's generation boundary (§7) is
// deterministic: same findings in, same drafts out — no model wording, no
// wall-clock, no randomness.
//
//   - capability-registry (F052): registration-request drafts for the runner
//     registry surface (`registerRunner` / `registerRunnerCapability` inputs,
//     human Decision required at that surface).
//   - route: route-definition drafts for the `routes/` typed-mutation surface
//     (`schemas/route.schema.json`).
//   - loop-contract: contract drafts for the loop typed-mutation surface
//     (`schemas/loop-contract.schema.json`; manual + disabled trigger — a
//     draft never schedules anything).
//   - rules: rules.json v2 rule skeletons (unblocked 2026-09-20 — governance
//     G-5 landed the v2 typed-mutation surface; the draft's decision is
//     require_approval and the owner completes the match dimensions).
//
// Drafts never mutate anything: this module performs no writes and the draft
// is an in-memory object the destination owner reviews and completes through
// its own typed mutation. Admission runs the shared V1–V3 invariant
// (evolution-validity.js) per finding: a finding that fails admission yields
// an in-memory refusal carrying the closed reason code and the invariant's
// non-echoing detail — never a draft, never a persisted record. The durable
// per-destination rejection RECORD (spec §8.5) does not exist on any of the
// three surfaces today; the exact missing shape is named in
// REJECTION_RECORD_DEPENDENCIES (open dependency, not silently invented).

const { EVOLUTION_FINDING_MIN_COUNT } = require("./evolution-findings");
const { canonicalHashOf } = require("./registry-ledger");
const { validateEvolutionAdmission } = require("./evolution-validity");

const DERIVER_DESTINATIONS = Object.freeze([
	"rules",
	"capability-registry",
	"route",
	"loop-contract",
]);

const DRAFT_KINDS = Object.freeze({
	rules: "rules-v2-rule-draft",
	"capability-registry": "registration-request-draft",
	route: "route-definition-draft",
	"loop-contract": "loop-contract-draft",
});

// The rules deriver is IMPLEMENTED (unblocked 2026-09-20: governance G-5
// landed the rules.json v2 typed-mutation surface — schemas/loop-policy.schema.json
// + loop-policy.js v2 capability face). The draft is a v2 rule skeleton with
// explicit nulls the owner completes through the 0051 Decision-bound typed
// mutation — a draft never enters rules.json by itself and never auto-allows:
// its decision is `require_approval` until a human narrows it.
function rulesDraftBody(failureMode, fingerprint) {
	return Object.freeze({
		surface: "0051 rules.json v2 typed mutation (Decision-gated)",
		ruleId: slugFromFinding(failureMode, fingerprint),
		schemaVersion: 2,
		decision: "require_approval",
		match: Object.freeze({
			capability: null,
			target: null,
			effect: null,
			constraints: Object.freeze({
				maxClassification: null,
			}),
		}),
		ownerCompletes: Object.freeze([
			"match.capability",
			"match.target.pathPrefix",
			"match.effect",
			"match.constraints",
		]),
	});
}

// The exact rejection-record shape the contract §8.5 requires every
// destination to carry for refused proposals — four correlation fields, no
// more. No surface below HAS such a record shape today (verified against
// HEAD): the F052 registry records `denied` events for execution requests
// only, distinct from registration proposals; the route stage ledger records
// `approved`/`executed` only; the loop ledger records approvals/executions
// only. Each entry names the precise missing shape as an open dependency for
// its owning ticket — persistence is not invented here.
const REJECTION_RECORD_FIELDS = Object.freeze([
	"attributionFingerprint",
	"reasonCode",
	"recordedAt",
	"summary",
]);

const REJECTION_RECORD_DEPENDENCIES = Object.freeze({
	"capability-registry": Object.freeze({
		hasRecordPath: false,
		missing:
			'F052 runner-registry ledger lacks a registration-refusal record: a frozen event kind (e.g. "registration-refused") carrying exactly ' +
			"attributionFingerprint, reasonCode, recordedAt, summary (non-echoing), appended to .amber/runner/registry.jsonl behind the registry lock — distinct from runner/capability registration events and from execution-request `denied` events. Owner: F052 (open dependency).",
	}),
	route: Object.freeze({
		hasRecordPath: false,
		missing:
			'The route stage ledger (.amber/routes/<routeId>/ledger.jsonl) records only approved/executed; a route-definition refusal has no record shape: a frozen record kind (e.g. "definition-refused") carrying exactly attributionFingerprint, reasonCode, recordedAt, summary (non-echoing), appended to the route-scoped ledger. Owner: route typed-mutation surface (open dependency).',
	}),
	"loop-contract": Object.freeze({
		hasRecordPath: false,
		missing:
			'The loop governance ledger records approvals/executions only; a loop-contract refusal has no record shape: a frozen record kind (e.g. "contract-refused") carrying exactly attributionFingerprint, reasonCode, recordedAt, summary (non-echoing), appended to the loop ledger. Owner: loop typed-mutation surface (open dependency).',
	}),
	rules: Object.freeze({
		hasRecordPath: false,
		missing:
			'0051 rules v2 has landed (schemas/loop-policy.schema.json + the typed mutation), but no proposal-refusal record shape exists on the surface yet: a frozen record kind (e.g. "rule-refused") carrying exactly attributionFingerprint, reasonCode, recordedAt, summary (non-echoing) is the 0051 owner\'s decision (open dependency).',
	}),
});

function isPlainObject(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

// The attribution block is this contract's deterministic correlation key
// (spec §8.5, same discipline as the maintenance correlation hash): the
// canonical hash of the §3 block re-derives in any consumer.
function attributionFingerprintOf(finding) {
	return canonicalHashOf(finding.findingAttribution);
}

// Deterministic identifier slug: failure-mode text folded to [a-z0-9-] (a
// route id / loop contract id is a NAME, never free text) plus a bounded
// attribution-fingerprint suffix for cross-finding uniqueness. Non-ASCII
// failure modes collapse to the "finding" base — still deterministic.
function slugFromFinding(failureMode, fingerprint) {
	const base = failureMode
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)
		.replace(/-+$/g, "");
	const suffix = fingerprint.slice("sha256:".length, "sha256:".length + 12);
	return `${base || "finding"}-${suffix}`;
}

// Destination-shaped draft bodies. Fields the finding cannot determine are
// explicit nulls the destination owner completes through its Decision-bound
// typed mutation — a draft never invents registration, stage, or scheduling
// semantics.
function capabilityRegistryDraftBody() {
	return Object.freeze({
		surface: "F052 runner registry (registerRunner / registerRunnerCapability)",
		runner: Object.freeze({
			id: null,
			version: null,
			integrityDigest: null,
			owner: null,
			decision: null,
		}),
		capability: Object.freeze({
			runnerId: null,
			runnerVersion: null,
			name: null,
			capabilityVersion: null,
			effects: Object.freeze([]),
			pathPrefixes: null,
			timeoutMsMax: null,
			credentialRequirement: null,
			rollback: null,
			decision: null,
		}),
	});
}

function routeDraftBody(failureMode, fingerprint) {
	return Object.freeze({
		routeId: slugFromFinding(failureMode, fingerprint),
		schemaVersion: "1.0.0",
		version: "0.1.0",
		displayName: failureMode,
		description: failureMode,
		trigger: Object.freeze({}),
		stages: Object.freeze([]),
		gates: Object.freeze([]),
	});
}

function loopContractDraftBody(failureMode, fingerprint) {
	return Object.freeze({
		id: slugFromFinding(failureMode, fingerprint),
		title: failureMode,
		goal: failureMode,
		trigger: Object.freeze({ type: "manual", enabled: false }),
		stateSpine: null,
		hardStops: Object.freeze({ maxIterations: null }),
	});
}

const DRAFT_BODY_BUILDERS = Object.freeze({
	rules: rulesDraftBody,
	"capability-registry": () => capabilityRegistryDraftBody(),
	route: routeDraftBody,
	"loop-contract": loopContractDraftBody,
});

/**
 * Derive behavior-surface drafts from structured evolution findings.
 *
 * @param {string} destination one of DERIVER_DESTINATIONS
 * @param {Array} findings structured findings (extractStructuredFindings shape)
 * @param {{ targetRoot: string, minCluster?: number }} options
 *   `targetRoot` is required: each candidate finding passes the shared V1–V3
 *   admission invariant against the real target before it can produce a draft.
 * @returns {{
 *   destination: string,
 *   blocked: object | null,
 *   drafts: Array<object>,
 *   refusals: Array<{ attributionFingerprint: string, clusterCount: number, reasonCode: string, summary: string }>,
 * }}
 *   Deterministic: the same findings and options always produce the same
 *   result. `summary` is the admission invariant's non-echoing detail —
 *   untrusted finding text is never reproduced in it.
 */
function deriveEvolutionDrafts(destination, findings, options) {
	if (!DERIVER_DESTINATIONS.includes(destination)) {
		throw new Error(
			`unknown deriver destination ${JSON.stringify(destination)}; the closed set is ${DERIVER_DESTINATIONS.join(", ")}`,
		);
	}
	const targetRoot = options && options.targetRoot;
	if (typeof targetRoot !== "string" || targetRoot.trim() === "") {
		throw new Error(
			"deriveEvolutionDrafts requires options.targetRoot (V1–V3 admission needs the owning target)",
		);
	}
	const minCluster =
		options && Number.isInteger(options.minCluster) && options.minCluster >= 1
			? options.minCluster
			: EVOLUTION_FINDING_MIN_COUNT;

	const candidates = [];
	for (const finding of Array.isArray(findings) ? findings : []) {
		if (!isPlainObject(finding)) continue;
		if (!isPlainObject(finding.findingAttribution)) continue;
		if (finding.findingAttribution.responsibleArtifact !== destination) continue;
		const count = finding.count;
		if (!Number.isInteger(count) || count < minCluster) continue;
		candidates.push(finding);
	}
	// Sort by (fingerprint, failure mode) so the derivation is independent of
	// the caller's input order.
	candidates.sort((left, right) => {
		const leftFingerprint = attributionFingerprintOf(left);
		const rightFingerprint = attributionFingerprintOf(right);
		return (
			leftFingerprint.localeCompare(rightFingerprint) ||
			String(left.finding).localeCompare(String(right.finding))
		);
	});

	const drafts = [];
	const refusals = [];
	for (const finding of candidates) {
		const fingerprint = attributionFingerprintOf(finding);
		const admission = validateEvolutionAdmission({
			targetRoot,
			evidenceReferences: finding.evidenceReferences,
			operations: finding.operations,
			expectedEffect: finding.expectedEffect,
		});
		if (!admission.ok) {
			refusals.push({
				attributionFingerprint: fingerprint,
				clusterCount: finding.count,
				reasonCode: admission.code,
				summary: admission.detail,
			});
			continue;
		}
		const failureMode = String(finding.finding);
		drafts.push({
			destination,
			kind: DRAFT_KINDS[destination],
			attributionFingerprint: fingerprint,
			clusterCount: finding.count,
			finding: failureMode,
			findingAttribution: finding.findingAttribution,
			evidenceReferences: finding.evidenceReferences,
			expectedEffect: finding.expectedEffect,
			draft: DRAFT_BODY_BUILDERS[destination](failureMode, fingerprint),
		});
	}
	return { destination, blocked: null, drafts, refusals };
}

module.exports = {
	DERIVER_DESTINATIONS,
	DRAFT_KINDS,
	REJECTION_RECORD_FIELDS,
	REJECTION_RECORD_DEPENDENCIES,
	attributionFingerprintOf,
	deriveEvolutionDrafts,
};
