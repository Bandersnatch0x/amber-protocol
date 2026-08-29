"use strict";

// F050 ticket 5 (#230) — Policy ceiling & separation of duties.
//
// A Policy Contract is a canonical artifact of type `policy` whose
// machine-actionable content rides the Artifact Envelope's opaque extensions
// carrier under `policy`. The artifact store admits that content opaquely; this
// evaluator is the first shape consumer. Strict consumption requires an org and
// tenant policy and may add repo/play/gate policies. Evaluation is deny-wins:
// lower layers can only add denials, never relax an upper layer, and the
// completed policy outcome is appended to its own tamper-evident ledger.

const path = require("node:path");
const { appendJSONL, readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { typedError } = require("./error-catalog");
const {
	GENESIS_HASH,
	chainHash,
	acquireLedgerLock,
	appendWithinCeiling: sharedAppendWithinCeiling,
} = require("./registry-ledger");
const { hashText, canonicalJson } = require("./context-hash");
const { parseTimestamp, resolveActivePrincipal } = require("./principal-registry");
const { showApproval } = require("./approval-registry");
const { showEvidence } = require("./evidence-receipts");
const { showGateOutcome } = require("./gate-evaluation");
const { showArtifact } = require("./canonical-artifacts");

const POLICY_EVALUATION_SCHEMA_VERSION = 1;
const SUPPORTED_POLICY_EVALUATION_SCHEMA_VERSIONS = Object.freeze([1]);
const POLICY_SCHEMA_VERSION = 1;
const POLICY_LAYERS = Object.freeze(["org", "tenant", "repo", "play", "gate"]);
const REQUIRED_POLICY_LAYERS = Object.freeze(["org", "tenant"]);
const SKEW_POLICY = "no-tolerance";
const CLOCK_SOURCES = Object.freeze(["injected", "system"]);
const DEFAULT_MAX_OUTCOME_BYTES = 1024 * 1024;
const MAX_OUTCOME_ENV = "AMBER_POLICY_MAX_OUTCOME_BYTES";
const LOCK_STALE_MS = 30_000;

const POLICY_MISSING_CODE = "AMBER_E_POLICY_MISSING";
const POLICY_INVALID_CODE = "AMBER_E_POLICY_INVALID";
const POLICY_UNSUPPORTED_VERSION_CODE = "AMBER_E_POLICY_UNSUPPORTED_VERSION";
const POLICY_STALE_CODE = "AMBER_E_POLICY_STALE";
const POLICY_CONFLICT_CODE = "AMBER_E_POLICY_CONFLICT";
const POLICY_DENIED_CODE = "AMBER_E_POLICY_DENIED";
const POLICY_SEPARATION_CODE = "AMBER_E_POLICY_SEPARATION_OF_DUTIES";
const POLICY_DELEGATION_REQUIRED_CODE = "AMBER_E_POLICY_DELEGATION_REQUIRED";
const OUTCOME_REGISTRY_CORRUPT_CODE = "AMBER_E_POLICY_OUTCOME_REGISTRY_CORRUPT";
const OUTCOME_SIZE_CEILING_CODE = "AMBER_E_POLICY_OUTCOME_SIZE_CEILING";
const OUTCOME_REGISTRY_LOCK_CODE = "AMBER_E_POLICY_OUTCOME_REGISTRY_LOCK";
const INVALID_ARG_CODE = "AMBER_E_INVALID_ARG";

const POLICY_CONTRACT_FIELDS = Object.freeze([
	"policyVersion",
	"layer",
	"validUntil",
	"maxPolicyAgeMs",
	"rules",
	"delegations",
]);
const POLICY_RULE_FIELDS = Object.freeze([
	"requireSeparationOfDuties",
	"denyBreakGlassOverdueReview",
	"denyPrincipals",
	"denyCapabilities",
	"denyScopes",
]);
const POLICY_DELEGATION_FIELDS = Object.freeze([
	"delegator",
	"delegate",
	"capability",
	"scope",
	"validFrom",
	"validUntil",
]);
const OUTCOME_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"clockSource",
	"skewPolicy",
	"subject",
	"submitter",
	"capability",
	"policies",
	"approval",
	"gateOutcome",
	"verdict",
	"reasons",
	"delegation",
	"prevHash",
	"hash",
]);
const POLICY_REF_FIELDS = Object.freeze(["identity", "revision", "contentHash"]);
const APPROVAL_REF_FIELDS = Object.freeze(["id", "status", "approver"]);
const GATE_OUTCOME_REF_FIELDS = Object.freeze(["index", "gate", "gateRevision", "hash", "verdict"]);
const DELEGATION_REF_FIELDS = Object.freeze([
	"delegator",
	"delegate",
	"capability",
	"scope",
	"validFrom",
	"validUntil",
	"policy",
]);
const VERDICTS = Object.freeze(["pass", "deny"]);

function outcomeLedgerPath(cwd) {
	return statePathForCreate(cwd, "policies", "outcomes.jsonl");
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

function isNonNegativeInt(value) {
	return Number.isInteger(value) && value >= 0;
}

function quotedList(values) {
	return values.map((value) => `"${value}"`).join(", ");
}

function hasRelaxingName(key) {
	return /^(allow|relax)/i.test(key);
}

function parseClockValue(input, opts) {
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

function stringArrayProblem(value, label) {
	if (!Array.isArray(value)) {
		return `${label} must be an array of non-empty strings when present; got ${JSON.stringify(value)}`;
	}
	for (const entry of value) {
		if (!isNonEmptyString(entry)) {
			return `${label} must be an array of non-empty strings when present; got ${JSON.stringify(entry)}`;
		}
	}
	return null;
}

function unknownFieldProblem(value, allowed, label) {
	const unknown = Object.keys(value)
		.filter((key) => !allowed.includes(key))
		.sort();
	if (unknown.length === 0) return null;
	return {
		code: unknown.some(hasRelaxingName) ? POLICY_CONFLICT_CODE : POLICY_INVALID_CODE,
		message: `${label} carries unknown key${unknown.length > 1 ? "s" : ""} ${quotedList(unknown)}; the closed key set is ${allowed.join(", ")}`,
	};
}

function delegationProblem(delegation, label) {
	if (!isPlainObject(delegation)) {
		return {
			code: POLICY_INVALID_CODE,
			message: `${label} must be an object { delegator, delegate, capability, scope, validFrom, validUntil }; got ${JSON.stringify(delegation)}`,
		};
	}
	const unknown = unknownFieldProblem(delegation, POLICY_DELEGATION_FIELDS, label);
	if (unknown !== null) return unknown;
	const missing = POLICY_DELEGATION_FIELDS.filter((field) => !(field in delegation));
	if (missing.length > 0) {
		return {
			code: POLICY_INVALID_CODE,
			message: `${label} is missing field${missing.length > 1 ? "s" : ""} ${quotedList(missing)}; delegations are explicit and time-bounded`,
		};
	}
	for (const field of ["delegator", "delegate", "capability", "scope", "validFrom", "validUntil"]) {
		if (!isNonEmptyString(delegation[field])) {
			return {
				code: POLICY_INVALID_CODE,
				message: `${label}.${field} must be a non-empty string; got ${JSON.stringify(delegation[field])}`,
			};
		}
	}
	const validFrom = parseTimestamp(delegation.validFrom);
	const validUntil = parseTimestamp(delegation.validUntil);
	if (validFrom === null || validUntil === null) {
		return {
			code: POLICY_INVALID_CODE,
			message: `${label}.validFrom and ${label}.validUntil must be ISO-8601 dates or zoned date-times; got ${JSON.stringify(delegation.validFrom)} and ${JSON.stringify(delegation.validUntil)}`,
		};
	}
	if (validUntil <= validFrom) {
		return {
			code: POLICY_INVALID_CODE,
			message: `${label}.validUntil must be after validFrom (the delegation window is half-open [validFrom, validUntil)); got ${JSON.stringify(delegation.validFrom)} and ${JSON.stringify(delegation.validUntil)}`,
		};
	}
	return null;
}

function policyRulesProblem(rules, label) {
	if (rules === undefined) return null;
	if (!isPlainObject(rules)) {
		return {
			code: POLICY_INVALID_CODE,
			message: `${label} must be an object when present; got ${JSON.stringify(rules)}`,
		};
	}
	const unknown = unknownFieldProblem(rules, POLICY_RULE_FIELDS, label);
	if (unknown !== null) return unknown;
	if (rules.requireSeparationOfDuties !== undefined) {
		if (rules.requireSeparationOfDuties === false) {
			return {
				code: POLICY_CONFLICT_CODE,
				message: `${label}.requireSeparationOfDuties cannot be false: lower policy may only tighten the org/tenant ceiling and separation of duties is never relaxed`,
			};
		}
		if (rules.requireSeparationOfDuties !== true) {
			return {
				code: POLICY_INVALID_CODE,
				message: `${label}.requireSeparationOfDuties must be true when present; got ${JSON.stringify(rules.requireSeparationOfDuties)}`,
			};
		}
	}
	if (rules.denyBreakGlassOverdueReview !== undefined) {
		if (rules.denyBreakGlassOverdueReview === false) {
			return {
				code: POLICY_CONFLICT_CODE,
				message: `${label}.denyBreakGlassOverdueReview cannot be false: lower policy may only tighten the org/tenant ceiling and an overdue break-glass post-review is never waived`,
			};
		}
		if (rules.denyBreakGlassOverdueReview !== true) {
			return {
				code: POLICY_INVALID_CODE,
				message: `${label}.denyBreakGlassOverdueReview must be true when present; got ${JSON.stringify(rules.denyBreakGlassOverdueReview)}`,
			};
		}
	}
	for (const key of ["denyPrincipals", "denyCapabilities", "denyScopes"]) {
		if (rules[key] !== undefined) {
			const problem = stringArrayProblem(rules[key], `${label}.${key}`);
			if (problem !== null) return { code: POLICY_INVALID_CODE, message: problem };
		}
	}
	return null;
}

function policyContractProblem(contract, expectedLayer) {
	if (!isPlainObject(contract)) {
		return {
			code: POLICY_INVALID_CODE,
			message: `policy contract must be an object under extensions.policy; got ${JSON.stringify(contract)}`,
		};
	}
	const unknown = unknownFieldProblem(contract, POLICY_CONTRACT_FIELDS, "policy contract");
	if (unknown !== null) return unknown;
	if (contract.policyVersion === undefined) {
		return {
			code: POLICY_INVALID_CODE,
			message: `policy.policyVersion is required and must be ${POLICY_SCHEMA_VERSION}; got ${JSON.stringify(contract.policyVersion)}`,
		};
	}
	if (!Number.isInteger(contract.policyVersion)) {
		return {
			code: POLICY_INVALID_CODE,
			message: `policy.policyVersion must be an integer schema version; got ${JSON.stringify(contract.policyVersion)}`,
		};
	}
	if (contract.policyVersion !== POLICY_SCHEMA_VERSION) {
		return {
			code: POLICY_UNSUPPORTED_VERSION_CODE,
			message: `policy.policyVersion ${contract.policyVersion} is not supported by this evaluator (supported: ${POLICY_SCHEMA_VERSION}); strict consumption refuses instead of reinterpreting a newer Policy Contract`,
		};
	}
	if (!POLICY_LAYERS.includes(contract.layer)) {
		return {
			code: POLICY_INVALID_CODE,
			message: `policy.layer must be one of the closed stack layers (${POLICY_LAYERS.join(", ")}); got ${JSON.stringify(contract.layer)}`,
		};
	}
	if (contract.layer !== expectedLayer) {
		return {
			code: POLICY_CONFLICT_CODE,
			message: `policy artifact supplied for the ${expectedLayer} layer declares layer ${JSON.stringify(contract.layer)}; a policy stack cannot relabel lower layers to widen authority`,
		};
	}
	if (contract.validUntil !== undefined) {
		if (typeof contract.validUntil !== "string" || parseTimestamp(contract.validUntil) === null) {
			return {
				code: POLICY_INVALID_CODE,
				message: `policy.validUntil must be an ISO-8601 date, or a date-time carrying an explicit zone (Z or ±hh:mm), when present; got ${JSON.stringify(contract.validUntil)}`,
			};
		}
	}
	if (contract.maxPolicyAgeMs !== undefined && !isPositiveInt(contract.maxPolicyAgeMs)) {
		return {
			code: POLICY_INVALID_CODE,
			message: `policy.maxPolicyAgeMs must be a positive integer (milliseconds) when present; got ${JSON.stringify(contract.maxPolicyAgeMs)}`,
		};
	}
	const rulesProblem = policyRulesProblem(contract.rules, "policy.rules");
	if (rulesProblem !== null) return rulesProblem;
	if (contract.delegations !== undefined) {
		if (!Array.isArray(contract.delegations)) {
			return {
				code: POLICY_INVALID_CODE,
				message: `policy.delegations must be an array of explicit direct delegations when present; got ${JSON.stringify(contract.delegations)}`,
			};
		}
		if (!REQUIRED_POLICY_LAYERS.includes(contract.layer) && contract.delegations.length > 0) {
			return {
				code: POLICY_CONFLICT_CODE,
				message: `${contract.layer} policy cannot declare delegations: repo/play/gate policy may only tighten the org/tenant ceiling and delegation grants authority`,
			};
		}
		for (let index = 0; index < contract.delegations.length; index += 1) {
			const problem = delegationProblem(
				contract.delegations[index],
				`policy.delegations[${index}]`,
			);
			if (problem !== null) return problem;
		}
	}
	return null;
}

function policyHash(contract) {
	return hashText(canonicalJson(JSON.stringify(contract)));
}

function resolvePolicyStack(cwd, policyInputs, evalNowMs, at) {
	if (!isPlainObject(policyInputs)) {
		return {
			ok: false,
			code: POLICY_MISSING_CODE,
			errors: [
				`policies must be an object naming at least org and tenant Policy artifacts; got ${JSON.stringify(policyInputs)}`,
			],
		};
	}
	const unknown = Object.keys(policyInputs)
		.filter((key) => !POLICY_LAYERS.includes(key))
		.sort();
	if (unknown.length > 0) {
		return {
			ok: false,
			code: POLICY_INVALID_CODE,
			errors: [
				`policies carries unknown layer${unknown.length > 1 ? "s" : ""} ${quotedList(unknown)}; the closed stack order is ${POLICY_LAYERS.join(", ")}`,
			],
		};
	}
	for (const layer of REQUIRED_POLICY_LAYERS) {
		if (!isNonEmptyString(policyInputs[layer])) {
			return {
				ok: false,
				code: POLICY_MISSING_CODE,
				errors: [
					`${layer} policy is required for strict consumption; pass --${layer}-policy <identity> naming a committed active Policy Contract`,
				],
			};
		}
	}
	const entries = [];
	for (const layer of POLICY_LAYERS) {
		const identity = policyInputs[layer];
		if (identity === undefined || identity === null) continue;
		if (!isNonEmptyString(identity)) {
			return {
				ok: false,
				code: POLICY_MISSING_CODE,
				errors: [
					`${layer} policy identity must be a non-empty string; got ${JSON.stringify(identity)}`,
				],
			};
		}
		let projection;
		try {
			projection = showArtifact(cwd, identity, { type: "policy" });
		} catch (err) {
			return {
				ok: false,
				code: err.amberCode || POLICY_MISSING_CODE,
				errors: [err.message || String(err)],
			};
		}
		if (projection === null) {
			return {
				ok: false,
				code: POLICY_MISSING_CODE,
				errors: [
					`no committed policy artifact found for ${layer} policy "${identity}"; strict consumption requires org and tenant policy and only named policy artifacts are evaluated`,
				],
			};
		}
		if (projection.lifecycle !== "active") {
			return {
				ok: false,
				code: POLICY_INVALID_CODE,
				errors: [
					`policy "${identity}" revision ${projection.revision} is in lifecycle state ${JSON.stringify(projection.lifecycle)}; strict consumption requires active Policy Contracts`,
				],
			};
		}
		const extensions = projection.envelope ? projection.envelope.extensions : undefined;
		const contract = isPlainObject(extensions) ? extensions.policy : undefined;
		const shapeProblem = policyContractProblem(contract, layer);
		if (shapeProblem !== null) {
			return { ok: false, code: shapeProblem.code, errors: [shapeProblem.message] };
		}
		if (contract.validUntil !== undefined) {
			const validUntilMs = parseTimestamp(contract.validUntil);
			if (validUntilMs !== null && validUntilMs <= evalNowMs) {
				return {
					ok: false,
					code: POLICY_STALE_CODE,
					errors: [
						`policy "${identity}" revision ${projection.revision} expired at ${contract.validUntil} and the evaluation clock is ${at}; stale Policy Contracts refuse strict consumption and append no outcome`,
					],
				};
			}
		}
		if (contract.maxPolicyAgeMs !== undefined) {
			const committedAtMs = parseTimestamp(projection.committedAt);
			if (committedAtMs === null) {
				return {
					ok: false,
					code: POLICY_INVALID_CODE,
					errors: [
						`policy "${identity}" revision ${projection.revision} has no parseable committedAt timestamp, so maxPolicyAgeMs cannot be evaluated safely`,
					],
				};
			}
			if (evalNowMs - committedAtMs > contract.maxPolicyAgeMs) {
				return {
					ok: false,
					code: POLICY_STALE_CODE,
					errors: [
						`policy "${identity}" revision ${projection.revision} is older than maxPolicyAgeMs=${contract.maxPolicyAgeMs} at ${at}; stale Policy Contracts refuse strict consumption and append no outcome`,
					],
				};
			}
		}
		entries.push(
			Object.freeze({
				layer,
				identity,
				revision: projection.revision,
				contentHash: policyHash(contract),
				contract,
			}),
		);
	}
	return { ok: true, entries };
}

function policiesForOutcome(entries) {
	return entries.reduce((acc, entry) => {
		acc[entry.layer] = {
			identity: entry.identity,
			revision: entry.revision,
			contentHash: entry.contentHash,
		};
		return acc;
	}, {});
}

function pushUnique(reasons, reason) {
	if (!reasons.includes(reason)) reasons.push(reason);
}

function collectEvidenceIds(gateOutcome) {
	const ids = new Set();
	const add = (detail) => {
		if (detail && isNonEmptyString(detail.evidenceId)) ids.add(detail.evidenceId);
	};
	const details = isPlainObject(gateOutcome?.details) ? gateOutcome.details : {};
	for (const detail of Array.isArray(details.requirements) ? details.requirements : []) add(detail);
	for (const set of Array.isArray(details.anyOf) ? details.anyOf : []) {
		for (const detail of Array.isArray(set.entries) ? set.entries : []) add(detail);
	}
	return [...ids];
}

function verifierIdOf(entry) {
	if (isNonEmptyString(entry?.id)) return entry.id;
	if (isNonEmptyString(entry?.verifier?.id)) return entry.verifier.id;
	return null;
}

function appendEvidenceActors(cwd, gateOutcome, actors, scopeCandidates, reasons) {
	const ids = collectEvidenceIds(gateOutcome);
	for (const id of ids) {
		let receipt;
		try {
			receipt = showEvidence(cwd, id);
		} catch (err) {
			return {
				ok: false,
				code: err.amberCode || "AMBER_E_EVIDENCE_REGISTRY_CORRUPT",
				errors: [err.message || String(err)],
			};
		}
		if (receipt === null) {
			pushUnique(
				reasons,
				`gate outcome ${gateOutcome.index} references evidence "${id}", but that receipt is not recorded`,
			);
			continue;
		}
		if (isNonEmptyString(receipt.producer?.id)) {
			actors.push({ role: `evidence producer ${id}`, id: receipt.producer.id });
		}
		for (const verification of Array.isArray(receipt.verifiedBy) ? receipt.verifiedBy : []) {
			const verifierId = verifierIdOf(verification);
			if (verifierId !== null) actors.push({ role: `evidence verifier ${id}`, id: verifierId });
		}
		if (isNonEmptyString(receipt.scope)) {
			scopeCandidates.push({ label: `evidence ${id} scope`, value: receipt.scope });
		}
	}
	return { ok: true };
}

function separationRoleClass(role) {
	if (role.startsWith("evidence producer ")) return "evidence producer";
	if (role.startsWith("evidence verifier ")) return "evidence verifier";
	return role;
}

function collectSeparationReasons(actors) {
	const reasons = [];
	const seen = new Map();
	for (const actor of actors) {
		if (!isNonEmptyString(actor.id)) continue;
		const roleClass = separationRoleClass(actor.role);
		const first = seen.get(actor.id);
		if (first !== undefined && first.roleClass !== roleClass) {
			pushUnique(
				reasons,
				`separation of duties violation: principal "${actor.id}" occupies both ${first.role} and ${actor.role}`,
			);
		} else if (first === undefined) {
			seen.set(actor.id, { role: actor.role, roleClass });
		}
	}
	return reasons;
}

function collectDenyRuleReasons(entries, { actors, capability, scopes }) {
	const reasons = [];
	const uniqueActors = [...new Set(actors.map((actor) => actor.id).filter(isNonEmptyString))];
	const uniqueScopes = [...new Set(scopes.map((scope) => scope.value).filter(isNonEmptyString))];
	for (const entry of entries) {
		const rules = entry.contract.rules || {};
		for (const principal of rules.denyPrincipals || []) {
			if (uniqueActors.includes(principal)) {
				pushUnique(
					reasons,
					`${entry.layer} policy "${entry.identity}" denies principal "${principal}" for this consumption context`,
				);
			}
		}
		for (const deniedCapability of rules.denyCapabilities || []) {
			if (deniedCapability === capability) {
				pushUnique(
					reasons,
					`${entry.layer} policy "${entry.identity}" denies capability "${capability}"`,
				);
			}
		}
		for (const deniedScope of rules.denyScopes || []) {
			if (uniqueScopes.includes(deniedScope)) {
				pushUnique(
					reasons,
					`${entry.layer} policy "${entry.identity}" denies subject/scope "${deniedScope}"`,
				);
			}
		}
	}
	return reasons;
}

// P8 (F057): a stack layer may declare denyBreakGlassOverdueReview — a
// deny-only clause consuming the break-glass registry's overdue-review
// projection. An ended emergency grant whose mandatory post-review is
// overdue at the evaluation clock denies strict consumption under every
// declaring layer, so review cannot be silently skipped; a corrupt grant
// ledger refuses before any outcome is appended.
function collectBreakGlassOverdueReasons(cwd, entries, evalNow) {
	const declaring = entries.filter(
		(entry) => (entry.contract.rules || {}).denyBreakGlassOverdueReview === true,
	);
	if (declaring.length === 0) return { ok: true, reasons: [] };
	let overdue;
	try {
		const { overdueBreakGlassReviews } = require("./breakglass-registry");
		overdue = overdueBreakGlassReviews(cwd, { now: evalNow });
	} catch (err) {
		return {
			ok: false,
			code: err.amberCode || "AMBER_E_BREAKGLASS_CORRUPT",
			errors: [err.message || String(err)],
		};
	}
	const reasons = [];
	for (const entry of declaring) {
		for (const grant of overdue) {
			pushUnique(
				reasons,
				`${entry.layer} policy "${entry.identity}" denies consumption while break-glass grant "${grant.id}" has an overdue post-review (due ${grant.reviewBy}); emergency review cannot be silently skipped`,
			);
		}
	}
	return { ok: true, reasons };
}

function resolveDelegation(entries, { delegator, submitter, capability, subject, evalNowMs }) {
	if (delegator === null) return { ok: true, delegation: null, reasons: [] };
	for (const entry of entries) {
		for (const delegation of entry.contract.delegations || []) {
			if (
				delegation.delegator === delegator &&
				delegation.delegate === submitter &&
				delegation.capability === capability &&
				delegation.scope === subject
			) {
				const from = parseTimestamp(delegation.validFrom);
				const until = parseTimestamp(delegation.validUntil);
				if (from !== null && until !== null && from <= evalNowMs && evalNowMs < until) {
					return {
						ok: true,
						delegation: {
							delegator,
							delegate: submitter,
							capability,
							scope: subject,
							validFrom: delegation.validFrom,
							validUntil: delegation.validUntil,
							policy: {
								identity: entry.identity,
								revision: entry.revision,
								contentHash: entry.contentHash,
							},
						},
						reasons: [],
					};
				}
			}
		}
	}
	return {
		ok: false,
		delegation: null,
		reasons: [
			`no active direct delegation grants "${submitter}" capability "${capability}" on subject "${subject}" from delegator "${delegator}" at the evaluation clock; delegation is explicit, non-transitive, scoped, capability-limited, and time-limited`,
		],
	};
}

function approvalRef(record, approvalId) {
	if (record === null) return { id: approvalId, status: "missing", approver: null };
	return { id: record.id, status: record.status, approver: record.approver?.id ?? null };
}

function gateOutcomeRef(record, gateOutcomeIndex) {
	if (record === null) {
		return { index: gateOutcomeIndex, gate: null, gateRevision: null, hash: null, verdict: null };
	}
	return {
		index: record.index,
		gate: record.gate,
		gateRevision: record.gateRevision,
		hash: record.hash,
		verdict: record.verdict,
	};
}

function appendPolicyOutcome(cwd, eventBody) {
	let release;
	try {
		release = acquireOutcomeLock(cwd);
	} catch (err) {
		return {
			ok: false,
			code: err.amberCode || OUTCOME_REGISTRY_CORRUPT_CODE,
			errors: [err.message || String(err)],
		};
	}
	try {
		let folded;
		try {
			folded = foldOutcomes(cwd);
		} catch (err) {
			return {
				ok: false,
				code: err.amberCode || OUTCOME_REGISTRY_CORRUPT_CODE,
				errors: [err.message || String(err)],
			};
		}
		const prevHash = folded.length > 0 ? folded[folded.length - 1].hash : GENESIS_HASH;
		const index = folded.length;
		const event = { ...eventBody, prevHash, hash: chainHash(eventBody, prevHash) };
		const ceiling = appendWithinCeiling(cwd, event);
		if (ceiling.wouldExceed) {
			return {
				ok: false,
				code: OUTCOME_SIZE_CEILING_CODE,
				errors: [
					`appending the policy outcome for subject "${eventBody.subject}" would grow the policy outcome ledger beyond its size ceiling of ${ceiling.ceiling} bytes (${MAX_OUTCOME_ENV}); the write is refused before any durable state is touched`,
				],
			};
		}
		try {
			appendJSONL(outcomeLedgerPath(cwd), event);
		} catch (err) {
			return {
				ok: false,
				code: OUTCOME_REGISTRY_CORRUPT_CODE,
				errors: [
					`failed to append the policy outcome for subject "${eventBody.subject}" to the policy outcome ledger: ${err.message || String(err)}`,
				],
			};
		}
		return { ok: true, outcome: { ...event, index } };
	} finally {
		release();
	}
}

function inputProblem(input) {
	if (!isPlainObject(input)) return `input must be an object; got ${JSON.stringify(input)}`;
	for (const [field, example] of [
		["subject", "spec/login@2"],
		["submitter", "dev@example.com"],
		["capability", "release"],
		["approval", "approval/login-42"],
	]) {
		if (!isNonEmptyString(input[field])) {
			return `${field} is required and must be a non-empty string (e.g. ${example}); got ${JSON.stringify(input[field])}`;
		}
	}
	if (!isNonNegativeInt(input.gateOutcomeIndex)) {
		return `gateOutcomeIndex is required and must be a non-negative integer (the 0-based gate outcome ledger line); got ${JSON.stringify(input.gateOutcomeIndex)}`;
	}
	if (
		input.delegator !== undefined &&
		input.delegator !== null &&
		!isNonEmptyString(input.delegator)
	) {
		return `delegator must be a non-empty string when provided; got ${JSON.stringify(input.delegator)}`;
	}
	return null;
}

function firstDenialCode(reasons) {
	if (reasons.some((reason) => reason.startsWith("separation of duties violation:"))) {
		return POLICY_SEPARATION_CODE;
	}
	if (
		reasons.some(
			(reason) =>
				reason.startsWith("no active direct delegation") ||
				reason.startsWith("delegation invalid:"),
		)
	) {
		return POLICY_DELEGATION_REQUIRED_CODE;
	}
	return POLICY_DENIED_CODE;
}

/**
 * Evaluate a named policy stack for one strict consumption context and append
 * an immutable Policy Outcome when the stack is valid. A pass returns ok true;
 * a completed deny appends the outcome and returns ok false with the policy
 * denial code. Contract-resolution failures (missing/stale/unsupported/
 * conflicting policy) refuse before append and return outcome:null.
 *
 * @param {string} cwd - Repository root.
 * @param {object} input - { policies, subject, submitter, capability, approval, gateOutcomeIndex, delegator?, now? }.
 * @param {object} [opts] - { now? } alternative clock injection.
 * @returns {{ok: boolean, code: string|null, outcome: object|null, errors: string[]}}
 */
function evaluatePolicy(cwd, input = {}, opts = {}) {
	const fail = (code, errors, outcome = null) => ({ ok: false, code, outcome, errors });
	const problem = inputProblem(input);
	if (problem !== null) return fail(INVALID_ARG_CODE, [problem]);
	const clock = parseClockValue(input, opts);
	if (!clock.ok) return fail(INVALID_ARG_CODE, [clock.message]);
	const evalNow = clock.date;
	const evalNowMs = clock.ms;
	const at = evalNow.toISOString();

	const stack = resolvePolicyStack(cwd, input.policies, evalNowMs, at);
	if (!stack.ok) return fail(stack.code, stack.errors);

	let submitterPrincipal;
	try {
		submitterPrincipal = resolveActivePrincipal(cwd, input.submitter, { now: evalNow });
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_PRINCIPAL_REGISTRY_CORRUPT", [
			err.message || String(err),
		]);
	}
	if (!submitterPrincipal.ok) return fail(submitterPrincipal.code, [submitterPrincipal.message]);

	const delegator =
		input.delegator === undefined || input.delegator === null ? null : input.delegator;
	let delegatorPrincipalSnapshot = null;
	if (delegator !== null) {
		let delegatorPrincipal;
		try {
			delegatorPrincipal = resolveActivePrincipal(cwd, delegator, { now: evalNow });
		} catch (err) {
			return fail(err.amberCode || "AMBER_E_PRINCIPAL_REGISTRY_CORRUPT", [
				err.message || String(err),
			]);
		}
		if (!delegatorPrincipal.ok) return fail(delegatorPrincipal.code, [delegatorPrincipal.message]);
		delegatorPrincipalSnapshot = delegatorPrincipal.principal;
	}

	const reasons = [];
	const actors = [{ role: "submitter", id: submitterPrincipal.principal.id }];
	const scopeCandidates = [{ label: "subject", value: input.subject }];

	let approvalRecord;
	try {
		approvalRecord = showApproval(cwd, input.approval, { now: evalNow });
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_APPROVAL_REGISTRY_CORRUPT", [err.message || String(err)]);
	}
	if (approvalRecord === null) {
		pushUnique(reasons, `approval "${input.approval}" is not recorded`);
	} else {
		if (approvalRecord.status !== "consumed") {
			pushUnique(
				reasons,
				`approval "${input.approval}" status is ${approvalRecord.status}; strict consumption requires a consumed Approval record`,
			);
		}
		if (approvalRecord.subject !== input.subject) {
			pushUnique(
				reasons,
				`approval "${input.approval}" authorizes subject "${approvalRecord.subject}", not requested subject "${input.subject}"`,
			);
		}
		if (isNonEmptyString(approvalRecord.approver?.id)) {
			actors.push({ role: "approval approver", id: approvalRecord.approver.id });
		}
		if (isNonEmptyString(approvalRecord.scope)) {
			scopeCandidates.push({ label: "approval scope", value: approvalRecord.scope });
		}
	}

	let gateOutcome;
	try {
		gateOutcome = showGateOutcome(cwd, { index: input.gateOutcomeIndex });
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT", [
			err.message || String(err),
		]);
	}
	if (gateOutcome === null) {
		pushUnique(reasons, `gate outcome index ${input.gateOutcomeIndex} is not recorded`);
	} else {
		if (gateOutcome.verdict !== "pass") {
			pushUnique(
				reasons,
				`gate outcome ${input.gateOutcomeIndex} verdict is ${gateOutcome.verdict}; strict consumption requires a passing Gate outcome`,
			);
		}
		if (gateOutcome.subject !== input.subject) {
			pushUnique(
				reasons,
				`gate outcome ${input.gateOutcomeIndex} is scoped to subject "${gateOutcome.subject}", not requested subject "${input.subject}"`,
			);
		}
		const evidenceResult = appendEvidenceActors(cwd, gateOutcome, actors, scopeCandidates, reasons);
		if (!evidenceResult.ok) return fail(evidenceResult.code, evidenceResult.errors);
	}

	if (delegator !== null) actors.push({ role: "delegator", id: delegator });

	for (const reason of collectSeparationReasons(actors)) pushUnique(reasons, reason);
	for (const reason of collectDenyRuleReasons(stack.entries, {
		actors,
		capability: input.capability,
		scopes: scopeCandidates,
	})) {
		pushUnique(reasons, reason);
	}
	const breakGlassOverdue = collectBreakGlassOverdueReasons(cwd, stack.entries, evalNow);
	if (!breakGlassOverdue.ok) return fail(breakGlassOverdue.code, breakGlassOverdue.errors);
	for (const reason of breakGlassOverdue.reasons) pushUnique(reasons, reason);

	if (delegatorPrincipalSnapshot !== null) {
		if (delegatorPrincipalSnapshot.capability !== input.capability) {
			pushUnique(
				reasons,
				`delegation invalid: delegator "${delegator}" has capability ${JSON.stringify(delegatorPrincipalSnapshot.capability)}, not requested capability "${input.capability}"`,
			);
		}
		if (delegatorPrincipalSnapshot.scope !== input.subject) {
			pushUnique(
				reasons,
				`delegation invalid: delegator "${delegator}" has scope ${JSON.stringify(delegatorPrincipalSnapshot.scope)}, not requested subject "${input.subject}"`,
			);
		}
	}

	const delegationResult = resolveDelegation(stack.entries, {
		delegator,
		submitter: input.submitter,
		capability: input.capability,
		subject: input.subject,
		evalNowMs,
	});
	if (!delegationResult.ok) {
		for (const reason of delegationResult.reasons) pushUnique(reasons, reason);
	}

	const verdict = reasons.length === 0 ? "pass" : "deny";
	const eventBody = {
		kind: "evaluated",
		schemaVersion: POLICY_EVALUATION_SCHEMA_VERSION,
		at,
		clockSource: clock.clockSource,
		skewPolicy: SKEW_POLICY,
		subject: input.subject,
		submitter: input.submitter,
		capability: input.capability,
		policies: policiesForOutcome(stack.entries),
		approval: approvalRef(approvalRecord, input.approval),
		gateOutcome: gateOutcomeRef(gateOutcome, input.gateOutcomeIndex),
		verdict,
		reasons,
		delegation: delegationResult.delegation,
	};

	const appended = appendPolicyOutcome(cwd, eventBody);
	if (!appended.ok) return fail(appended.code, appended.errors);
	if (verdict === "pass") {
		return { ok: true, code: null, outcome: appended.outcome, errors: [] };
	}
	return fail(firstDenialCode(reasons), reasons, appended.outcome);
}

function acquireOutcomeLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(outcomeLedgerPath(cwd)),
		lockName: "outcomes.lock",
		conflictCode: OUTCOME_REGISTRY_LOCK_CODE,
		corruptCode: OUTCOME_REGISTRY_CORRUPT_CODE,
		label: "policy outcome ledger",
		staleMs: LOCK_STALE_MS,
	});
}

function appendWithinCeiling(cwd, event) {
	return sharedAppendWithinCeiling({
		ledgerPath: outcomeLedgerPath(cwd),
		event,
		envName: MAX_OUTCOME_ENV,
		defaultBytes: DEFAULT_MAX_OUTCOME_BYTES,
		label: "policy outcome ledger",
	});
}

function nullableStringProblem(value, label) {
	if (value !== null && !isNonEmptyString(value)) {
		return `${label} must be null or a non-empty string; got ${JSON.stringify(value)}`;
	}
	return null;
}

function closedFieldsProblem(value, fields, label) {
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

function policyRefProblem(ref, label) {
	if (!isPlainObject(ref)) return `${label} must be an object; got ${JSON.stringify(ref)}`;
	const closed = closedFieldsProblem(ref, POLICY_REF_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(ref.identity)) return `${label}.identity must be a non-empty string`;
	if (!isPositiveInt(ref.revision)) return `${label}.revision must be a positive integer`;
	if (!isNonEmptyString(ref.contentHash)) return `${label}.contentHash must be a non-empty string`;
	return null;
}

function approvalRefProblem(ref) {
	if (!isPlainObject(ref)) return `approval must be an object; got ${JSON.stringify(ref)}`;
	const closed = closedFieldsProblem(ref, APPROVAL_REF_FIELDS, "approval");
	if (closed !== null) return closed;
	if (!isNonEmptyString(ref.id)) return `approval.id must be a non-empty string`;
	const statusProblem = nullableStringProblem(ref.status, "approval.status");
	if (statusProblem !== null) return statusProblem;
	const approverProblem = nullableStringProblem(ref.approver, "approval.approver");
	if (approverProblem !== null) return approverProblem;
	return null;
}

function gateOutcomeRefProblem(ref) {
	if (!isPlainObject(ref)) return `gateOutcome must be an object; got ${JSON.stringify(ref)}`;
	const closed = closedFieldsProblem(ref, GATE_OUTCOME_REF_FIELDS, "gateOutcome");
	if (closed !== null) return closed;
	if (!isNonNegativeInt(ref.index)) return `gateOutcome.index must be a non-negative integer`;
	for (const field of ["gate", "hash", "verdict"]) {
		const problem = nullableStringProblem(ref[field], `gateOutcome.${field}`);
		if (problem !== null) return problem;
	}
	if (ref.gateRevision !== null && !isPositiveInt(ref.gateRevision)) {
		return `gateOutcome.gateRevision must be null or a positive integer`;
	}
	if (ref.verdict !== null && ref.verdict !== "pass" && ref.verdict !== "fail") {
		return `gateOutcome.verdict must be pass, fail, or null; got ${JSON.stringify(ref.verdict)}`;
	}
	return null;
}

function delegationRefProblem(ref) {
	if (ref === null) return null;
	if (!isPlainObject(ref))
		return `delegation must be null or an object; got ${JSON.stringify(ref)}`;
	const closed = closedFieldsProblem(ref, DELEGATION_REF_FIELDS, "delegation");
	if (closed !== null) return closed;
	for (const field of ["delegator", "delegate", "capability", "scope", "validFrom", "validUntil"]) {
		if (!isNonEmptyString(ref[field])) return `delegation.${field} must be a non-empty string`;
	}
	return policyRefProblem(ref.policy, "delegation.policy");
}

function foldOutcomes(cwd) {
	const events = readLedgerFailClosed(
		outcomeLedgerPath(cwd),
		OUTCOME_REGISTRY_CORRUPT_CODE,
		"policy outcome ledger",
	);
	const records = [];
	let prevHash = GENESIS_HASH;
	for (let index = 0; index < events.length; index += 1) {
		const lineIndex = index + 1;
		const event = events[index];
		if (!isPlainObject(event)) {
			throw outcomeCorrupt(
				`policy outcome ledger event ${lineIndex} is not an object; got ${JSON.stringify(event)}`,
			);
		}
		if (!Number.isInteger(event.schemaVersion)) {
			throw outcomeCorrupt(
				`policy outcome ledger event ${lineIndex} carries no integer schemaVersion; got ${JSON.stringify(event.schemaVersion)}`,
			);
		}
		if (!SUPPORTED_POLICY_EVALUATION_SCHEMA_VERSIONS.includes(event.schemaVersion)) {
			throw outcomeCorrupt(
				`policy outcome ledger event ${lineIndex} declares schemaVersion ${JSON.stringify(event.schemaVersion)}, but this reader supports ${SUPPORTED_POLICY_EVALUATION_SCHEMA_VERSIONS.join(", ")}; an event this reader cannot interpret is rejected rather than reinterpreted`,
			);
		}
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash) {
			throw outcomeCorrupt(
				`policy outcome ledger event ${lineIndex} breaks the hash chain: its prevHash does not match the previous event's hash — the ledger was edited in place`,
			);
		}
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash) {
			throw outcomeCorrupt(
				`policy outcome ledger event ${lineIndex} carries a hash that does not match its content — the ledger was edited in place`,
			);
		}
		const closed = closedFieldsProblem(
			event,
			OUTCOME_EVENT_FIELDS,
			`policy outcome ledger event ${lineIndex}`,
		);
		if (closed !== null) throw outcomeCorrupt(closed);
		if (event.kind !== "evaluated") {
			throw outcomeCorrupt(
				`policy outcome ledger event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}; the closed kind set is evaluated`,
			);
		}
		if (!CLOCK_SOURCES.includes(event.clockSource)) {
			throw outcomeCorrupt(
				`policy outcome ledger event ${lineIndex} carries clockSource ${JSON.stringify(event.clockSource)} outside the closed set (${CLOCK_SOURCES.join(", ")})`,
			);
		}
		if (event.skewPolicy !== SKEW_POLICY) {
			throw outcomeCorrupt(
				`policy outcome ledger event ${lineIndex} carries skewPolicy ${JSON.stringify(event.skewPolicy)}, but the recorded policy is fixed (${SKEW_POLICY})`,
			);
		}
		if (!VERDICTS.includes(event.verdict)) {
			throw outcomeCorrupt(
				`policy outcome ledger event ${lineIndex} carries verdict ${JSON.stringify(event.verdict)} outside the closed set (${VERDICTS.join(", ")})`,
			);
		}
		for (const field of ["at", "subject", "submitter", "capability"]) {
			if (!isNonEmptyString(event[field])) {
				throw outcomeCorrupt(
					`policy outcome ledger event ${lineIndex} carries a ${field} that is not a non-empty string; got ${JSON.stringify(event[field])}`,
				);
			}
		}
		if (!isPlainObject(event.policies)) {
			throw outcomeCorrupt(
				`policy outcome ledger event ${lineIndex} carries policies that is not an object; got ${JSON.stringify(event.policies)}`,
			);
		}
		const policyLayers = Object.keys(event.policies);
		const unknownLayers = policyLayers.filter((layer) => !POLICY_LAYERS.includes(layer)).sort();
		if (unknownLayers.length > 0) {
			throw outcomeCorrupt(
				`policy outcome ledger event ${lineIndex} carries unknown policy layer${unknownLayers.length > 1 ? "s" : ""} ${quotedList(unknownLayers)}; the closed layer set is ${POLICY_LAYERS.join(", ")}`,
			);
		}
		for (const layer of REQUIRED_POLICY_LAYERS) {
			if (!Object.prototype.hasOwnProperty.call(event.policies, layer)) {
				throw outcomeCorrupt(
					`policy outcome ledger event ${lineIndex} is missing required policy layer ${layer}`,
				);
			}
		}
		for (const layer of policyLayers) {
			const problem = policyRefProblem(event.policies[layer], `policies.${layer}`);
			if (problem !== null)
				throw outcomeCorrupt(`policy outcome ledger event ${lineIndex} carries ${problem}`);
		}
		const approvalProblem = approvalRefProblem(event.approval);
		if (approvalProblem !== null) {
			throw outcomeCorrupt(`policy outcome ledger event ${lineIndex} carries ${approvalProblem}`);
		}
		const gateProblem = gateOutcomeRefProblem(event.gateOutcome);
		if (gateProblem !== null) {
			throw outcomeCorrupt(`policy outcome ledger event ${lineIndex} carries ${gateProblem}`);
		}
		if (
			!Array.isArray(event.reasons) ||
			event.reasons.some((reason) => !isNonEmptyString(reason))
		) {
			throw outcomeCorrupt(
				`policy outcome ledger event ${lineIndex} carries reasons that are not an array of non-empty strings; got ${JSON.stringify(event.reasons)}`,
			);
		}
		if (event.verdict === "pass" && event.reasons.length !== 0) {
			throw outcomeCorrupt(
				`policy outcome ledger event ${lineIndex} has verdict pass but non-empty reasons; a passing outcome carries no denial reasons`,
			);
		}
		if (event.verdict === "deny" && event.reasons.length === 0) {
			throw outcomeCorrupt(
				`policy outcome ledger event ${lineIndex} has verdict deny but no reasons; a denial must explain why strict consumption failed`,
			);
		}
		const delegationProblemText = delegationRefProblem(event.delegation);
		if (delegationProblemText !== null) {
			throw outcomeCorrupt(
				`policy outcome ledger event ${lineIndex} carries ${delegationProblemText}`,
			);
		}
		records.push({ ...event, index });
		prevHash = event.hash;
	}
	return records;
}

function listPolicyOutcomes(
	cwd,
	{ subject = null, submitter = null, capability = null, verdict = null } = {},
) {
	return foldOutcomes(cwd).filter(
		(record) =>
			(subject === null || record.subject === subject) &&
			(submitter === null || record.submitter === submitter) &&
			(capability === null || record.capability === capability) &&
			(verdict === null || record.verdict === verdict),
	);
}

function showPolicyOutcome(cwd, { index } = {}) {
	if (!isNonNegativeInt(index)) {
		throw typedError(
			INVALID_ARG_CODE,
			`index must be a non-negative integer (the 0-based policy outcome ledger line); got ${JSON.stringify(index)}`,
		);
	}
	return foldOutcomes(cwd).find((record) => record.index === index) ?? null;
}

module.exports = {
	POLICY_EVALUATION_SCHEMA_VERSION,
	SUPPORTED_POLICY_EVALUATION_SCHEMA_VERSIONS,
	POLICY_SCHEMA_VERSION,
	POLICY_LAYERS,
	SKEW_POLICY,
	CLOCK_SOURCES,
	DEFAULT_MAX_OUTCOME_BYTES,
	MAX_OUTCOME_ENV,
	GENESIS_HASH,
	chainHash,
	evaluatePolicy,
	showPolicyOutcome,
	listPolicyOutcomes,
};
