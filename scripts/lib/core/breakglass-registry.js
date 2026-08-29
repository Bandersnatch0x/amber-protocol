"use strict";

// F057 T1 (#292) — Break-glass grant registry with human-only emergency
// authorization.
//
// Emergency pressure must not erase identity or scope: a break-glass
// grant is a distinct, one-use human authorization — never a flag, a
// reusable token, or an Agent-granted exception. A grant is limited by
// one registered capability (an F052 runner capability or an F056
// external effect), exact target and scope, environment, purpose, risk,
// credential class, a short half-open validity window, an incident
// reference, and a post-review deadline. Grants and revocations settle
// behind single-use committed human Decisions, and history is never
// rewritten: a revoked or expired grant stays listable forever.

const path = require("node:path");

const { readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { typedError } = require("./error-catalog");
const { listArtifactRevisions } = require("./canonical-artifacts");
const {
	resolveRequestCapability,
	showRunnerRequest,
	showRunnerExecution,
} = require("./runner-registry");
const {
	showExternalEffect,
	showExternalProposal,
	showExternalExecution,
} = require("./external-registry");
const { showEvidence } = require("./evidence-receipts");
const {
	GENESIS_HASH,
	chainHash,
	acquireLedgerLock,
	appendLedgerEvent,
	credentialLeakProblem,
	isPlainObject,
	isNonEmptyString,
	quotedList,
	closedFieldProblem,
	unknownFieldProblem,
	decisionPinProblem,
	resolveRegistrationDecision,
} = require("./registry-ledger");

const BREAKGLASS_SCHEMA_VERSION = 1;
const SUPPORTED_BREAKGLASS_SCHEMA_VERSIONS = Object.freeze([1]);
const DEFAULT_MAX_BREAKGLASS_BYTES = 1024 * 1024;
// A break-glass window is short by construction (at most 24h), and the
// mandatory post-review must land within 30 days of the window closing.
const MAX_BREAKGLASS_WINDOW_MS = 24 * 3_600_000;
const MAX_REVIEW_DELAY_MS = 30 * 24 * 3_600_000;
const LOCK_STALE_MS = 30_000;

const BREAKGLASS_CAPABILITY_KINDS = Object.freeze(["runner", "external"]);
const BREAKGLASS_CREDENTIALS = Object.freeze(["none", "scoped"]);
const BREAKGLASS_RISKS = Object.freeze(["low", "medium", "high", "critical"]);
// Human-only authority slots, mirroring the F050/F052/F055/F056 contract.
const BREAKGLASS_DECISION_KINDS = Object.freeze(["acceptance", "approval"]);
const GRANT_STATUSES = Object.freeze(["granted", "used", "revoked", "expired"]);

const BREAKGLASS_INVALID_CODE = "AMBER_E_BREAKGLASS_INVALID";
const BREAKGLASS_NOT_FOUND_CODE = "AMBER_E_BREAKGLASS_NOT_FOUND";
const BREAKGLASS_CORRUPT_CODE = "AMBER_E_BREAKGLASS_CORRUPT";
const BREAKGLASS_LOCK_CODE = "AMBER_E_BREAKGLASS_LOCK";
const BREAKGLASS_SIZE_CEILING_CODE = "AMBER_E_BREAKGLASS_SIZE_CEILING";
const BREAKGLASS_LEAK_CODE = "AMBER_E_BREAKGLASS_CREDENTIAL_LEAK";

// One slug grammar for every grant-facing name: no whitespace, no URL
// scheme, no shell metacharacters, no ".." traversal — a command,
// executable, or remote URL can never ride an emergency grant.
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function grantsPath(cwd) {
	return statePathForCreate(cwd, "breakglass", "grants.jsonl");
}

function breakglassCorrupt(message) {
	return typedError(BREAKGLASS_CORRUPT_CODE, message);
}

function acquireGrantLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(grantsPath(cwd)),
		lockName: "grants.lock",
		conflictCode: BREAKGLASS_LOCK_CODE,
		corruptCode: BREAKGLASS_CORRUPT_CODE,
		label: "break-glass grant ledger",
		staleMs: LOCK_STALE_MS,
	});
}

// The shared refusal shape for a slug-validated input field: a leak
// carries its dedicated code, every other slug problem is invalid.
function slugRefusal(value, label) {
	const problem = slugProblem(value, label);
	if (problem === null) return null;
	return {
		code: /credential material/.test(problem) ? BREAKGLASS_LEAK_CODE : BREAKGLASS_INVALID_CODE,
		message: problem,
	};
}

function slugProblem(value, label) {
	if (!isNonEmptyString(value)) return `${label} must be a non-empty string`;
	if (value.includes("://"))
		return `${label} must not carry a URL scheme; a grant names governed capabilities, never endpoints`;
	if (value.split("/").includes(".."))
		return `${label} must not carry a ".." path segment; a path escape cannot ride an emergency grant`;
	if (!SLUG_PATTERN.test(value))
		return `${label} must match ${SLUG_PATTERN} — a command, path escape, or URL cannot ride an emergency grant`;
	const leak = credentialLeakProblem(value, label);
	if (leak !== null) return leak;
	return null;
}

const RUNNER_PIN_FIELDS = Object.freeze([
	"kind",
	"runnerId",
	"runnerVersion",
	"name",
	"capabilityVersion",
]);
const EXTERNAL_PIN_FIELDS = Object.freeze(["kind", "id", "version"]);
const DECISION_SNAPSHOT_FIELDS = Object.freeze([
	"identity",
	"revision",
	"decisionKind",
	"principal",
]);
const GRANT_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"incident",
	"purpose",
	"capability",
	"target",
	"scope",
	"environment",
	"risk",
	"credentials",
	"validFrom",
	"validUntil",
	"reviewBy",
	"decision",
	"prevHash",
	"hash",
]);
const REVOKE_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"reason",
	"decision",
	"prevHash",
	"hash",
]);
const USE_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"reference",
	"requestHash",
	"prevHash",
	"hash",
]);
const USE_REFERENCE_FIELDS = Object.freeze(["kind", "id"]);
const REQUEST_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SETTLEMENT_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"receipt",
	"outcome",
	"remedy",
	"prevHash",
	"hash",
]);
const SETTLEMENT_RECEIPT_FIELDS = Object.freeze(["kind", "id"]);
const REMEDY_FIELDS = Object.freeze(["kind", "reference"]);
const REMEDY_KINDS = Object.freeze(["rollback", "compensation", "irreversible"]);
const REVIEW_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"outcome",
	"necessity",
	"impact",
	"followUp",
	"decision",
	"prevHash",
	"hash",
]);
const REVIEW_TEXT_FIELDS = Object.freeze(["outcome", "necessity", "impact", "followUp"]);

function capabilityPinProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	if (value.kind === "runner") {
		const closed = closedFieldProblem(value, RUNNER_PIN_FIELDS, label);
		if (closed !== null) return closed;
		for (const field of ["runnerId", "runnerVersion", "name", "capabilityVersion"]) {
			const slug = slugProblem(value[field], `${label}.${field}`);
			if (slug !== null) return slug;
		}
		return null;
	}
	if (value.kind === "external") {
		const closed = closedFieldProblem(value, EXTERNAL_PIN_FIELDS, label);
		if (closed !== null) return closed;
		for (const field of ["id", "version"]) {
			const slug = slugProblem(value[field], `${label}.${field}`);
			if (slug !== null) return slug;
		}
		return null;
	}
	return `${label}.kind must be one of ${BREAKGLASS_CAPABILITY_KINDS.join(", ")} — break-glass reaches only registered capabilities, never arbitrary shell or HTTP`;
}

function decisionSnapshotProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, DECISION_SNAPSHOT_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(value.identity)) return `${label}.identity must be a non-empty string`;
	if (!Number.isInteger(value.revision) || value.revision < 1)
		return `${label}.revision must be a positive integer`;
	if (!BREAKGLASS_DECISION_KINDS.includes(value.decisionKind))
		return `${label}.decisionKind must be one of ${BREAKGLASS_DECISION_KINDS.join(", ")}`;
	if (!isNonEmptyString(value.principal)) return `${label}.principal must be a non-empty string`;
	return null;
}

function isoProblem(value, label) {
	if (!isNonEmptyString(value) || Number.isNaN(Date.parse(value)))
		return `${label} must be an ISO-8601 timestamp`;
	return null;
}

// The grant shape shared by input validation and the stored event.
function grantShapeProblem(value, label) {
	for (const field of ["id", "incident", "purpose", "target", "scope", "environment"]) {
		const slug = slugProblem(value[field], `${label}.${field}`);
		if (slug !== null) return slug;
	}
	const capability = capabilityPinProblem(value.capability, `${label}.capability`);
	if (capability !== null) return capability;
	if (!BREAKGLASS_RISKS.includes(value.risk))
		return `${label}.risk must be one of ${BREAKGLASS_RISKS.join(", ")}`;
	if (!BREAKGLASS_CREDENTIALS.includes(value.credentials))
		return `${label}.credentials must be one of ${BREAKGLASS_CREDENTIALS.join(", ")}`;
	for (const field of ["validFrom", "validUntil", "reviewBy"]) {
		const iso = isoProblem(value[field], `${label}.${field}`);
		if (iso !== null) return iso;
	}
	const fromMs = Date.parse(value.validFrom);
	const untilMs = Date.parse(value.validUntil);
	const reviewMs = Date.parse(value.reviewBy);
	if (untilMs <= fromMs)
		return `${label}.validUntil must be strictly after validFrom; the window is half-open [validFrom, validUntil)`;
	if (untilMs - fromMs > MAX_BREAKGLASS_WINDOW_MS)
		return `${label} validity window must not exceed ${MAX_BREAKGLASS_WINDOW_MS}ms; a break-glass grant is short-lived by construction`;
	if (reviewMs <= untilMs)
		return `${label}.reviewBy must be strictly after validUntil; the mandatory post-review follows the emergency window`;
	if (reviewMs - untilMs > MAX_REVIEW_DELAY_MS)
		return `${label}.reviewBy must be within ${MAX_REVIEW_DELAY_MS}ms of validUntil; a post-review cannot be deferred indefinitely`;
	return null;
}

function grantEventProblem(event, lineIndex) {
	const label = `break-glass event ${lineIndex}`;
	if (event.kind === "grant") {
		const closed = closedFieldProblem(event, GRANT_EVENT_FIELDS, label);
		if (closed !== null) return closed;
		const at = isoProblem(event.at, `${label}.at`);
		if (at !== null) return at;
		const shape = grantShapeProblem(event, label);
		if (shape !== null) return shape;
		return decisionSnapshotProblem(event.decision, `${label}.decision`);
	}
	if (event.kind === "revoke") {
		const closed = closedFieldProblem(event, REVOKE_EVENT_FIELDS, label);
		if (closed !== null) return closed;
		const at = isoProblem(event.at, `${label}.at`);
		if (at !== null) return at;
		if (!isNonEmptyString(event.id)) return `${label}.id must be a non-empty string`;
		if (!isNonEmptyString(event.reason))
			return `${label}.reason must preserve a non-empty reason; a revocation is accountable`;
		const leak = credentialLeakProblem(event.reason, `${label}.reason`);
		if (leak !== null) return leak;
		return decisionSnapshotProblem(event.decision, `${label}.decision`);
	}
	if (event.kind === "settlement") {
		const closed = closedFieldProblem(event, SETTLEMENT_EVENT_FIELDS, label);
		if (closed !== null) return closed;
		const at = isoProblem(event.at, `${label}.at`);
		if (at !== null) return at;
		if (!isNonEmptyString(event.id)) return `${label}.id must be a non-empty string`;
		if (!isPlainObject(event.receipt)) return `${label}.receipt must be an object`;
		const receiptClosed = closedFieldProblem(
			event.receipt,
			SETTLEMENT_RECEIPT_FIELDS,
			`${label}.receipt`,
		);
		if (receiptClosed !== null) return receiptClosed;
		if (!BREAKGLASS_CAPABILITY_KINDS.includes(event.receipt.kind))
			return `${label}.receipt.kind must be one of ${BREAKGLASS_CAPABILITY_KINDS.join(", ")}`;
		if (!isNonEmptyString(event.receipt.id))
			return `${label}.receipt.id must be a non-empty string`;
		const receiptLeak = credentialLeakProblem(event.receipt.id, `${label}.receipt.id`);
		if (receiptLeak !== null) return receiptLeak;
		if (!isNonEmptyString(event.outcome))
			return `${label}.outcome must record the underlying outcome; an emergency attempt cannot disappear`;
		const outcomeLeak = credentialLeakProblem(event.outcome, `${label}.outcome`);
		if (outcomeLeak !== null) return outcomeLeak;
		if (!isPlainObject(event.remedy)) return `${label}.remedy must be an object`;
		const remedyClosed = closedFieldProblem(event.remedy, REMEDY_FIELDS, `${label}.remedy`);
		if (remedyClosed !== null) return remedyClosed;
		if (!REMEDY_KINDS.includes(event.remedy.kind))
			return `${label}.remedy.kind must be one of ${REMEDY_KINDS.join(", ")}`;
		if (event.remedy.kind === "irreversible") {
			if (event.remedy.reference !== null)
				return `${label}.remedy declares irreversibility and carries no reference`;
		} else if (!isNonEmptyString(event.remedy.reference)) {
			return `${label}.remedy.reference must name the declared rollback or compensation`;
		} else {
			const remedyLeak = credentialLeakProblem(event.remedy.reference, `${label}.remedy.reference`);
			if (remedyLeak !== null) return remedyLeak;
		}
		return null;
	}
	if (event.kind === "review") {
		const closed = closedFieldProblem(event, REVIEW_EVENT_FIELDS, label);
		if (closed !== null) return closed;
		const at = isoProblem(event.at, `${label}.at`);
		if (at !== null) return at;
		if (!isNonEmptyString(event.id)) return `${label}.id must be a non-empty string`;
		for (const field of REVIEW_TEXT_FIELDS) {
			if (!isNonEmptyString(event[field]))
				return `${label}.${field} must preserve a non-empty ${field}; a post-review is accountable`;
			const leak = credentialLeakProblem(event[field], `${label}.${field}`);
			if (leak !== null) return leak;
		}
		return decisionSnapshotProblem(event.decision, `${label}.decision`);
	}
	const closed = closedFieldProblem(event, USE_EVENT_FIELDS, label);
	if (closed !== null) return closed;
	const at = isoProblem(event.at, `${label}.at`);
	if (at !== null) return at;
	if (!isNonEmptyString(event.id)) return `${label}.id must be a non-empty string`;
	if (!isPlainObject(event.reference)) return `${label}.reference must be an object`;
	const refClosed = closedFieldProblem(event.reference, USE_REFERENCE_FIELDS, `${label}.reference`);
	if (refClosed !== null) return refClosed;
	if (!BREAKGLASS_CAPABILITY_KINDS.includes(event.reference.kind))
		return `${label}.reference.kind must be one of ${BREAKGLASS_CAPABILITY_KINDS.join(", ")}`;
	if (!isNonEmptyString(event.reference.id))
		return `${label}.reference.id must be a non-empty string`;
	const refLeak = credentialLeakProblem(event.reference.id, `${label}.reference.id`);
	if (refLeak !== null) return refLeak;
	if (!REQUEST_HASH_PATTERN.test(event.requestHash ?? ""))
		return `${label}.requestHash must be a sha256:<64-hex> string — the exact admitted request`;
	return null;
}

function foldGrants(cwd) {
	const events = readLedgerFailClosed(
		grantsPath(cwd),
		BREAKGLASS_CORRUPT_CODE,
		"break-glass grant ledger",
	);
	let prevHash = GENESIS_HASH;
	const grants = [];
	const byId = new Map();
	events.forEach((event, index) => {
		const lineIndex = index + 1;
		if (!isPlainObject(event))
			throw breakglassCorrupt(`break-glass event ${lineIndex} is not an object`);
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash)
			throw breakglassCorrupt(`break-glass event ${lineIndex} breaks the hash chain`);
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash)
			throw breakglassCorrupt(
				`break-glass event ${lineIndex} carries a hash that does not match its content`,
			);
		if (!SUPPORTED_BREAKGLASS_SCHEMA_VERSIONS.includes(event.schemaVersion))
			throw breakglassCorrupt(
				`break-glass event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		if (!["grant", "revoke", "use", "settlement", "review"].includes(event.kind))
			throw breakglassCorrupt(
				`break-glass event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
			);
		const problem = grantEventProblem(event, lineIndex);
		if (problem !== null) throw breakglassCorrupt(problem);
		if (event.kind === "grant") {
			if (byId.has(event.id))
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} reuses grant id ${JSON.stringify(event.id)}`,
				);
			const { prevHash: _prev, hash: _hash, at, ...body } = event;
			const grant = {
				...body,
				grantedAt: at,
				revocation: null,
				use: null,
				settlement: null,
				review: null,
				index,
			};
			grants.push(grant);
			byId.set(event.id, grant);
		} else if (event.kind === "revoke") {
			const grant = byId.get(event.id);
			if (!grant)
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} revokes unknown grant ${JSON.stringify(event.id)}`,
				);
			if (grant.revocation !== null)
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} revokes an already-revoked grant; history is never rewritten`,
				);
			if (grant.use !== null)
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} revokes a used grant; a spent authorization already ended through use`,
				);
			grant.revocation = { at: event.at, reason: event.reason, decision: event.decision };
		} else if (event.kind === "use") {
			const grant = byId.get(event.id);
			if (!grant)
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} uses unknown grant ${JSON.stringify(event.id)}`,
				);
			if (grant.use !== null)
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} uses a spent grant; a break-glass authorization is one-use`,
				);
			if (grant.revocation !== null)
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} uses a revoked grant; revocation blocks future use immediately`,
				);
			// Re-derivable facts fail closed: the reference kind must be the
			// granted capability kind, and the use instant must sit inside
			// the half-open window — a validly re-chained forgery of either
			// fails every read. (The reference id itself is a cross-ledger
			// fact and is enforced at write time; the hash chain protects
			// the recorded value from in-place rewrites.)
			if (event.reference.kind !== grant.capability.kind)
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} uses grant ${JSON.stringify(event.id)} through a ${JSON.stringify(event.reference.kind)} reference, not the granted ${JSON.stringify(grant.capability.kind)} capability`,
				);
			const usedMs = Date.parse(event.at);
			if (usedMs < Date.parse(grant.validFrom) || usedMs >= Date.parse(grant.validUntil))
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} uses grant ${JSON.stringify(event.id)} outside its validity window`,
				);
			grant.use = { at: event.at, reference: event.reference, requestHash: event.requestHash };
		}
		if (event.kind === "settlement") {
			const grant = byId.get(event.id);
			if (!grant)
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} settles unknown grant ${JSON.stringify(event.id)}`,
				);
			if (grant.use === null)
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} settles an unused grant; settlement follows use`,
				);
			if (grant.settlement !== null)
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} re-settles grant ${JSON.stringify(event.id)}; emergency history is never rewritten`,
				);
			if (event.receipt.kind !== grant.capability.kind)
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} settles grant ${JSON.stringify(event.id)} through a ${JSON.stringify(event.receipt.kind)} receipt, not the granted ${JSON.stringify(grant.capability.kind)} capability`,
				);
			// A runner receipt IS the admitted request hash — in-ledger
			// derivable, so a validly re-chained swap fails the read.
			if (event.receipt.kind === "runner" && event.receipt.id !== grant.use.reference.id)
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} settles grant ${JSON.stringify(event.id)} against receipt ${JSON.stringify(event.receipt.id)}, not the admitted request ${JSON.stringify(grant.use.reference.id)}`,
				);
			grant.settlement = {
				at: event.at,
				receipt: event.receipt,
				outcome: event.outcome,
				remedy: event.remedy,
			};
		}
		if (event.kind === "review") {
			const grant = byId.get(event.id);
			if (!grant)
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} reviews unknown grant ${JSON.stringify(event.id)}`,
				);
			if (grant.review !== null)
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} re-reviews grant ${JSON.stringify(event.id)}; one post-review per grant`,
				);
			// A review lands only after the grant ENDED: through use,
			// revocation, or expiry (re-derivable from the review instant
			// against the window).
			if (
				grant.use === null &&
				grant.revocation === null &&
				Date.parse(event.at) < Date.parse(grant.validUntil)
			)
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} reviews grant ${JSON.stringify(event.id)} before it ended; a post-review follows use, revocation, or expiry`,
				);
			grant.review = {
				at: event.at,
				outcome: event.outcome,
				necessity: event.necessity,
				impact: event.impact,
				followUp: event.followUp,
				decision: event.decision,
			};
		}
		prevHash = event.hash;
	});
	return grants;
}

const GRANT_LEDGER = Object.freeze({
	acquire: acquireGrantLock,
	fold: foldGrants,
	path: grantsPath,
	corruptCode: BREAKGLASS_CORRUPT_CODE,
	sizeCeilingCode: BREAKGLASS_SIZE_CEILING_CODE,
	envName: "AMBER_BREAKGLASS_MAX_GRANTS_BYTES",
	defaultBytes: DEFAULT_MAX_BREAKGLASS_BYTES,
	label: "break-glass grant ledger",
});

// Status is a pure read-time derivation: a terminal use wins, then
// revocation, then expiry at the injected clock against the half-open
// window, and the original grant record is preserved untouched in every
// state. A grant
// whose window has not opened yet still reads "granted" — the status
// vocabulary is fixed, the window anchors to the grant instant at mint,
// and consumption (T2) separately refuses outside [validFrom, validUntil).
function grantStatusAt(grant, nowMs) {
	if (grant.use !== null) return "used";
	if (grant.revocation !== null) return "revoked";
	if (nowMs >= Date.parse(grant.validUntil)) return "expired";
	return "granted";
}

function projectGrant(grant, nowMs) {
	return { ...grant, status: grantStatusAt(grant, nowMs) };
}

// Authority mirrors the F052/F055/F056 contract: a committed, unscoped,
// human acceptance/approval Decision with a verified principal snapshot.
// Human-only is enforced at Decision admission (acceptance/approval are
// human-only slots), so Agents, service identities, and executors can
// never satisfy the emergency authorization.
function resolveGrantDecision(revisions, decision, label) {
	return resolveRegistrationDecision(revisions, decision, BREAKGLASS_DECISION_KINDS, label);
}

// Single-use is scoped to the grant ledger domain, matching the
// per-registry mirror convention — and it spans EVERY Decision-bearing
// event kind: one Decision authorizes one act (a grant, a revocation, or
// a post-review), never two.
function grantDecisionSpender(grants, decision) {
	for (const grant of grants) {
		if (
			grant.decision.identity === decision.identity &&
			grant.decision.revision === decision.revision
		)
			return `grant ${JSON.stringify(grant.id)}`;
		if (
			grant.revocation !== null &&
			grant.revocation.decision.identity === decision.identity &&
			grant.revocation.decision.revision === decision.revision
		)
			return `the revocation of grant ${JSON.stringify(grant.id)}`;
		if (
			grant.review !== null &&
			grant.review.decision.identity === decision.identity &&
			grant.review.decision.revision === decision.revision
		)
			return `the post-review of grant ${JSON.stringify(grant.id)}`;
	}
	return null;
}

// Resolve the pinned capability against its own registry: break-glass
// reaches only what F052/F056 already govern, never a new executor. A
// corrupt source registry passes its corrupt code through; an unresolved
// or drifted pin refuses as a break-glass invalid.
function verifyCapabilityPin(cwd, capability) {
	if (capability.kind === "runner") {
		const resolved = resolveRequestCapability(cwd, {
			runnerId: capability.runnerId,
			runnerVersion: capability.runnerVersion,
			name: capability.name,
			capabilityVersion: capability.capabilityVersion,
		});
		if (!resolved.ok)
			return {
				problem: resolved.errors[0],
				code: /CORRUPT/.test(resolved.code || "") ? resolved.code : BREAKGLASS_INVALID_CODE,
			};
		return {};
	}
	let effect;
	try {
		effect = showExternalEffect(cwd, capability.id, capability.version);
	} catch (err) {
		return { problem: err.message || String(err), code: err.amberCode };
	}
	if (effect === null)
		return {
			problem: `external effect ${JSON.stringify(capability.id)}@${capability.version} is not registered; break-glass reaches only registered capabilities`,
			code: BREAKGLASS_INVALID_CODE,
		};
	return {};
}

const GRANT_INPUT_FIELDS = Object.freeze([
	"id",
	"incident",
	"purpose",
	"capability",
	"target",
	"scope",
	"environment",
	"risk",
	"credentials",
	"validFrom",
	"validUntil",
	"reviewBy",
	"decision",
]);

/**
 * Grant one break-glass authorization: a distinct, one-use, human-only
 * emergency authorization limited by registered capability, exact target
 * and scope, environment, purpose, risk, credential class, a short
 * half-open validity window, an incident reference, and a post-review
 * deadline. Never self-grantable: the authority is a committed human
 * Decision, single-use across the grant ledger.
 */
function grantBreakGlass(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(BREAKGLASS_INVALID_CODE, ["grant input must be an object"]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(BREAKGLASS_INVALID_CODE, ["now must be a valid clock"]);
	const inputClosed = unknownFieldProblem(input, GRANT_INPUT_FIELDS, "grant input");
	if (inputClosed !== null) return fail(BREAKGLASS_INVALID_CODE, [inputClosed]);
	const leakCode = (problem) =>
		/credential material/.test(problem) ? BREAKGLASS_LEAK_CODE : BREAKGLASS_INVALID_CODE;
	const shape = grantShapeProblem(input, "grant input");
	if (shape !== null) return fail(leakCode(shape), [shape]);
	// The window anchors to the grant instant (F050 mirror, no skew
	// tolerance): no backdating, no born-expired grant, and no deferred
	// standing authorization parked behind a far-future window.
	const nowMs = now.getTime();
	if (Date.parse(input.validFrom) < nowMs)
		return fail(BREAKGLASS_INVALID_CODE, [
			"validFrom must be at or after the grant clock; an emergency grant cannot backdate its window",
		]);
	if (Date.parse(input.validFrom) - nowMs > MAX_BREAKGLASS_WINDOW_MS)
		return fail(BREAKGLASS_INVALID_CODE, [
			"validFrom must open within 24h of the grant clock; a deferred window is a standing authorization, not an emergency",
		]);
	const pinProblem = decisionPinProblem(input.decision);
	if (pinProblem !== null) return fail(BREAKGLASS_INVALID_CODE, [pinProblem]);
	const capability = verifyCapabilityPin(cwd, input.capability);
	if (capability.problem)
		return fail(capability.code || BREAKGLASS_INVALID_CODE, [capability.problem]);
	let revisions;
	try {
		revisions = listArtifactRevisions(cwd);
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_ARTIFACT_JOURNAL_CORRUPT", [err.message || String(err)]);
	}
	const resolved = resolveGrantDecision(revisions, input.decision, "a break-glass grant");
	if (resolved.problem) return fail(BREAKGLASS_INVALID_CODE, [resolved.problem]);
	return appendLedgerEvent(
		cwd,
		GRANT_LEDGER,
		{
			kind: "grant",
			schemaVersion: BREAKGLASS_SCHEMA_VERSION,
			at: now.toISOString(),
			id: input.id,
			incident: input.incident,
			purpose: input.purpose,
			capability:
				input.capability.kind === "runner"
					? {
							kind: "runner",
							runnerId: input.capability.runnerId,
							runnerVersion: input.capability.runnerVersion,
							name: input.capability.name,
							capabilityVersion: input.capability.capabilityVersion,
						}
					: {
							kind: "external",
							id: input.capability.id,
							version: input.capability.version,
						},
			target: input.target,
			scope: input.scope,
			environment: input.environment,
			risk: input.risk,
			credentials: input.credentials,
			validFrom: input.validFrom,
			validUntil: input.validUntil,
			reviewBy: input.reviewBy,
			decision: resolved.decision,
		},
		(fold) => {
			if (fold.some((entry) => entry.id === input.id))
				return fail(BREAKGLASS_INVALID_CODE, [
					`grant ${JSON.stringify(input.id)} already exists; an emergency authorization is never reused`,
				]);
			const spender = grantDecisionSpender(fold, input.decision);
			if (spender !== null)
				return fail(BREAKGLASS_INVALID_CODE, [
					`decision ${JSON.stringify(input.decision.identity)}@${input.decision.revision} already authorized ${spender}; an emergency Decision is single-use`,
				]);
			return null;
		},
		(fold) => {
			const record = fold.find((entry) => entry.id === input.id);
			return record ? projectGrant(record, now.getTime()) : null;
		},
	);
}

/**
 * Revoke one grant: a second single-use human Decision that immediately
 * blocks future use. The original grant record is preserved — a revoked
 * grant stays listable forever with its revocation attached.
 */
function revokeBreakGlass(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(BREAKGLASS_INVALID_CODE, ["revoke input must be an object"]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(BREAKGLASS_INVALID_CODE, ["now must be a valid clock"]);
	const inputClosed = unknownFieldProblem(input, ["id", "reason", "decision"], "revoke input");
	if (inputClosed !== null) return fail(BREAKGLASS_INVALID_CODE, [inputClosed]);
	const idRefusal = slugRefusal(input.id, "id");
	if (idRefusal !== null) return fail(idRefusal.code, [idRefusal.message]);
	if (!isNonEmptyString(input.reason))
		return fail(BREAKGLASS_INVALID_CODE, [
			"reason must preserve a non-empty reason; a revocation is accountable",
		]);
	const reasonLeak = credentialLeakProblem(input.reason, "reason");
	if (reasonLeak !== null) return fail(BREAKGLASS_LEAK_CODE, [reasonLeak]);
	const pinProblem = decisionPinProblem(input.decision);
	if (pinProblem !== null) return fail(BREAKGLASS_INVALID_CODE, [pinProblem]);
	let revisions;
	try {
		revisions = listArtifactRevisions(cwd);
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_ARTIFACT_JOURNAL_CORRUPT", [err.message || String(err)]);
	}
	const resolved = resolveGrantDecision(revisions, input.decision, "a break-glass revocation");
	if (resolved.problem) return fail(BREAKGLASS_INVALID_CODE, [resolved.problem]);
	return appendLedgerEvent(
		cwd,
		GRANT_LEDGER,
		{
			kind: "revoke",
			schemaVersion: BREAKGLASS_SCHEMA_VERSION,
			at: now.toISOString(),
			id: input.id,
			reason: input.reason,
			decision: resolved.decision,
		},
		(fold) => {
			const grant = fold.find((entry) => entry.id === input.id) ?? null;
			if (grant === null)
				return fail(BREAKGLASS_NOT_FOUND_CODE, [
					`grant ${JSON.stringify(input.id)} does not exist`,
				]);
			if (grant.revocation !== null)
				return fail(BREAKGLASS_INVALID_CODE, [
					`grant ${JSON.stringify(input.id)} is already revoked; history is never rewritten`,
				]);
			if (grant.use !== null)
				return fail(BREAKGLASS_INVALID_CODE, [
					`grant ${JSON.stringify(input.id)} is already used; a spent authorization ended through use`,
				]);
			const spender = grantDecisionSpender(fold, input.decision);
			if (spender !== null)
				return fail(BREAKGLASS_INVALID_CODE, [
					`decision ${JSON.stringify(input.decision.identity)}@${input.decision.revision} already authorized ${spender}; an emergency Decision is single-use`,
				]);
			return null;
		},
		(fold) => {
			const record = fold.find((entry) => entry.id === input.id);
			return record ? projectGrant(record, now.getTime()) : null;
		},
	);
}

// ---------------------------------------------------------------------------
// F057 T2 (#293) — atomic one-use consumption bound to the underlying
// admission. Replay is impossible: the grant spends atomically with the
// reference it admits, under the ledger lock, and a failed admission
// never consumes.
// ---------------------------------------------------------------------------

// The underlying reference must ride EXACTLY the capability the grant
// pinned, at the grant's exact target and scope — a grant can never
// widen itself. Runner requests also bind the grant's environment;
// external contracts carry no environment field, so the grant's declared
// environment is recorded context there, not an equality axis.
function resolveUseReference(cwd, grant, referenceId) {
	if (grant.capability.kind === "external") {
		let proposal;
		try {
			proposal = showExternalProposal(cwd, referenceId);
		} catch (err) {
			return { problem: err.message || String(err), code: err.amberCode };
		}
		if (proposal === null)
			return {
				problem: `proposal ${JSON.stringify(referenceId)} does not exist; break-glass admits only a prepared underlying request`,
			};
		if (proposal.status !== "authorized")
			return {
				problem: `proposal ${JSON.stringify(referenceId)} is not authorized; break-glass never substitutes for the underlying authorization`,
			};
		if (
			proposal.effect.id !== grant.capability.id ||
			proposal.effect.version !== grant.capability.version
		)
			return {
				problem: `proposal ${JSON.stringify(referenceId)} rides effect ${JSON.stringify(proposal.effect.id)}@${proposal.effect.version}, not the granted capability ${JSON.stringify(grant.capability.id)}@${grant.capability.version}; a grant cannot widen itself`,
			};
		if (proposal.target !== grant.target || proposal.scope !== grant.scope)
			return {
				problem: `proposal ${JSON.stringify(referenceId)} targets ${JSON.stringify(proposal.target)} scope ${JSON.stringify(proposal.scope)}, not the granted target ${JSON.stringify(grant.target)} scope ${JSON.stringify(grant.scope)}; a grant cannot widen itself`,
			};
		return { requestHash: proposal.requestHash };
	}
	let request;
	try {
		request = showRunnerRequest(cwd, referenceId);
	} catch (err) {
		return { problem: err.message || String(err), code: err.amberCode };
	}
	if (request === null)
		return {
			problem: `runner request ${JSON.stringify(referenceId)} does not exist; break-glass admits only a prepared underlying request`,
		};
	if (request.status !== "authorized")
		return {
			problem: `runner request ${JSON.stringify(referenceId)} is not authorized; break-glass never substitutes for the underlying authorization`,
		};
	const pin = grant.capability;
	const capability = request.capability;
	if (
		capability.runnerId !== pin.runnerId ||
		capability.runnerVersion !== pin.runnerVersion ||
		capability.name !== pin.name ||
		capability.capabilityVersion !== pin.capabilityVersion
	)
		return {
			problem: `runner request ${JSON.stringify(referenceId)} rides capability ${JSON.stringify(capability.name)}@${capability.capabilityVersion} of ${JSON.stringify(capability.runnerId)}@${capability.runnerVersion}, not the granted pin; a grant cannot widen itself`,
		};
	if (request.environment !== grant.environment)
		return {
			problem: `runner request ${JSON.stringify(referenceId)} runs in environment ${JSON.stringify(request.environment)}, not the granted ${JSON.stringify(grant.environment)}; a grant cannot widen itself`,
		};
	if (request.target?.repository !== grant.target || (request.scope ?? null) !== grant.scope)
		return {
			problem: `runner request ${JSON.stringify(referenceId)} targets repository ${JSON.stringify(request.target?.repository)} scope ${JSON.stringify(request.scope ?? null)}, not the granted target ${JSON.stringify(grant.target)} scope ${JSON.stringify(grant.scope)}; a grant cannot widen itself`,
		};
	// Derivable separation of duties (F057): an Evidence producer on the
	// underlying request cannot be the human who authorized the emergency.
	// Submitter and executor principals are not recorded by the underlying
	// registries, so those axes are not derivably enforceable — they stay
	// post-review obligations; the human-only Decision slots are enforced
	// at grant/revoke/review admission.
	if (isNonEmptyString(request.rehearsal)) {
		let rehearsal;
		try {
			rehearsal = showEvidence(cwd, request.rehearsal);
		} catch (err) {
			return { problem: err.message || String(err), code: err.amberCode };
		}
		if (rehearsal !== null && rehearsal.producer.id === grant.decision.principal)
			return {
				problem: `rollback-rehearsal Evidence ${JSON.stringify(request.rehearsal)} was produced by the emergency approver ${JSON.stringify(grant.decision.principal)}; Evidence producers cannot satisfy the required human emergency authorization slot`,
			};
	}
	return { requestHash: referenceId };
}

/**
 * Use one break-glass grant: the one-use authorization spends atomically
 * with the underlying admission under the ledger lock — concurrent
 * callers cannot double-spend, a failed admission leaves the grant
 * granted, and a spent grant refuses every later use. Consumption
 * refuses outside the half-open validity window at the injected clock
 * and after revocation, and the use event records the exact admitted
 * request hash.
 */
function useBreakGlass(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input)) return fail(BREAKGLASS_INVALID_CODE, ["use input must be an object"]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(BREAKGLASS_INVALID_CODE, ["now must be a valid clock"]);
	const inputClosed = unknownFieldProblem(input, ["id", "reference"], "use input");
	if (inputClosed !== null) return fail(BREAKGLASS_INVALID_CODE, [inputClosed]);
	const idRefusal = slugRefusal(input.id, "id");
	if (idRefusal !== null) return fail(idRefusal.code, [idRefusal.message]);
	if (!isNonEmptyString(input.reference))
		return fail(BREAKGLASS_INVALID_CODE, ["reference must be a non-empty string"]);
	const referenceLeak = credentialLeakProblem(input.reference, "reference");
	if (referenceLeak !== null) return fail(BREAKGLASS_LEAK_CODE, [referenceLeak]);
	const nowMs = now.getTime();
	// The guard stashes the resolved admission; the body factory then
	// builds the event after the guard, so no sentinel value can ever
	// reach the ledger.
	let admitted = null;
	return appendLedgerEvent(
		cwd,
		GRANT_LEDGER,
		() => ({
			kind: "use",
			schemaVersion: BREAKGLASS_SCHEMA_VERSION,
			at: now.toISOString(),
			id: input.id,
			reference: { kind: admitted.kind, id: input.reference },
			requestHash: admitted.requestHash,
		}),
		(fold) => {
			const grant = fold.find((entry) => entry.id === input.id) ?? null;
			if (grant === null)
				return fail(BREAKGLASS_NOT_FOUND_CODE, [
					`grant ${JSON.stringify(input.id)} does not exist`,
				]);
			if (grant.use !== null)
				return fail(BREAKGLASS_INVALID_CODE, [
					`grant ${JSON.stringify(input.id)} is already used; a break-glass authorization is one-use`,
				]);
			if (grant.revocation !== null)
				return fail(BREAKGLASS_INVALID_CODE, [
					`grant ${JSON.stringify(input.id)} is revoked; revocation blocks future use immediately`,
				]);
			if (nowMs < Date.parse(grant.validFrom))
				return fail(BREAKGLASS_INVALID_CODE, [
					`grant ${JSON.stringify(input.id)} is not valid yet; the window opens at ${grant.validFrom}`,
				]);
			if (nowMs >= Date.parse(grant.validUntil))
				return fail(BREAKGLASS_INVALID_CODE, [
					`grant ${JSON.stringify(input.id)} expired at ${grant.validUntil}; emergency authority never outlives its window`,
				]);
			const resolved = resolveUseReference(cwd, grant, input.reference);
			if (resolved.problem)
				return fail(/CORRUPT/.test(resolved.code || "") ? resolved.code : BREAKGLASS_INVALID_CODE, [
					resolved.problem,
				]);
			admitted = { kind: grant.capability.kind, requestHash: resolved.requestHash };
			return null;
		},
		(fold) => {
			const record = fold.find((entry) => entry.id === input.id);
			return record ? projectGrant(record, nowMs) : null;
		},
	);
}

// ---------------------------------------------------------------------------
// F057 T3 (#294) — outcome settlement linkage & mandatory post-review.
// An emergency attempt cannot disappear: settlement binds the used grant
// to the REAL underlying receipt (failures and partials record), and the
// mandatory human post-review lands against the declared deadline — an
// overdue review is a visible read-time projection.
// ---------------------------------------------------------------------------

// Resolve the claimed receipt against the underlying registry and derive
// the outcome and remedy from it — a claim without a real reference
// refuses, and break-glass never substitutes a claim for execution
// Evidence.
function resolveSettlementReceipt(cwd, grant, receiptId) {
	if (grant.capability.kind === "external") {
		let execution;
		try {
			execution = showExternalExecution(cwd, receiptId);
		} catch (err) {
			return { problem: err.message || String(err), code: err.amberCode };
		}
		if (execution === null)
			return {
				problem: `execution ${JSON.stringify(receiptId)} does not exist; break-glass never substitutes a claim for execution Evidence`,
			};
		if (execution.request !== grant.use.reference.id)
			return {
				problem: `execution ${JSON.stringify(receiptId)} settles request ${JSON.stringify(execution.request)}, not the admitted ${JSON.stringify(grant.use.reference.id)}`,
			};
		if (execution.status !== "settled")
			return {
				problem: `execution ${JSON.stringify(receiptId)} is not settled; missing output never means success — settle the underlying execution first`,
			};
		if (execution.outcome === "unknown")
			return {
				problem: `execution ${JSON.stringify(receiptId)} settled unknown; an unknown outcome reconciles through independent Evidence before break-glass settles`,
			};
		// Derivable separation of duties (F057): the Evidence that turned an
		// unknown outcome committed cannot come from the human who authorized
		// the emergency.
		if (execution.reconciliation !== null) {
			let evidence;
			try {
				evidence = showEvidence(cwd, execution.reconciliation.evidence);
			} catch (err) {
				return { problem: err.message || String(err), code: err.amberCode };
			}
			if (evidence !== null && evidence.producer.id === grant.decision.principal)
				return {
					problem: `reconciliation Evidence ${JSON.stringify(execution.reconciliation.evidence)} was produced by the emergency approver ${JSON.stringify(grant.decision.principal)}; Evidence producers cannot satisfy the required human emergency authorization slot`,
				};
		}
		let proposal;
		try {
			proposal = showExternalProposal(cwd, grant.use.reference.id);
		} catch (err) {
			return { problem: err.message || String(err), code: err.amberCode };
		}
		if (proposal === null)
			return {
				problem: `proposal ${JSON.stringify(grant.use.reference.id)} no longer resolves; break-glass never substitutes a claim for execution Evidence`,
			};
		return {
			outcome: execution.outcome,
			remedy:
				proposal.compensation.kind === "irreversible"
					? { kind: "irreversible", reference: null }
					: { kind: "compensation", reference: proposal.compensation.effect },
		};
	}
	if (receiptId !== grant.use.reference.id)
		return {
			problem: `runner receipt ${JSON.stringify(receiptId)} is not the admitted request ${JSON.stringify(grant.use.reference.id)}; a runner execution settles under its own request hash`,
		};
	let execution;
	try {
		execution = showRunnerExecution(cwd, receiptId);
	} catch (err) {
		return { problem: err.message || String(err), code: err.amberCode };
	}
	if (execution === null)
		return {
			problem: `runner execution ${JSON.stringify(receiptId)} does not exist; break-glass never substitutes a claim for execution Evidence`,
		};
	// The runner fold derives status (committed|timed-out|failed|
	// rolled-back, or attempted for an aborted attempt) and terminality;
	// an attempt that is not terminal has no outcome to link yet.
	if (execution.terminal !== true)
		return {
			problem: `runner execution ${JSON.stringify(receiptId)} has no terminal outcome yet; settle the underlying execution first`,
		};
	let request;
	try {
		request = showRunnerRequest(cwd, receiptId);
	} catch (err) {
		return { problem: err.message || String(err), code: err.amberCode };
	}
	if (request === null)
		return {
			problem: `runner request ${JSON.stringify(receiptId)} no longer resolves; break-glass never substitutes a claim for execution Evidence`,
		};
	return {
		outcome: execution.status,
		// F052 declares rollback "none" when no compensation exists — that
		// IS declared irreversibility, never a remedy reference.
		remedy:
			request.rollback === "none"
				? { kind: "irreversible", reference: null }
				: { kind: "rollback", reference: request.rollback },
	};
}

/**
 * Settle one used grant against the real underlying receipt: the outcome
 * (including failures and partial outcomes) and the declared rollback or
 * compensation linkage derive from the underlying registry — never from
 * the caller — and record immutably. One settlement per grant.
 */
function settleBreakGlass(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(BREAKGLASS_INVALID_CODE, ["settle input must be an object"]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(BREAKGLASS_INVALID_CODE, ["now must be a valid clock"]);
	const inputClosed = unknownFieldProblem(input, ["id", "receipt"], "settle input");
	if (inputClosed !== null) return fail(BREAKGLASS_INVALID_CODE, [inputClosed]);
	const idRefusal = slugRefusal(input.id, "id");
	if (idRefusal !== null) return fail(idRefusal.code, [idRefusal.message]);
	if (!isNonEmptyString(input.receipt))
		return fail(BREAKGLASS_INVALID_CODE, [
			"receipt must name the real underlying receipt; a claim without a reference refuses",
		]);
	const receiptLeak = credentialLeakProblem(input.receipt, "receipt");
	if (receiptLeak !== null) return fail(BREAKGLASS_LEAK_CODE, [receiptLeak]);
	const nowMs = now.getTime();
	let resolved = null;
	return appendLedgerEvent(
		cwd,
		GRANT_LEDGER,
		() => ({
			kind: "settlement",
			schemaVersion: BREAKGLASS_SCHEMA_VERSION,
			at: now.toISOString(),
			id: input.id,
			receipt: { kind: resolved.kind, id: input.receipt },
			outcome: resolved.outcome,
			remedy: resolved.remedy,
		}),
		(fold) => {
			const grant = fold.find((entry) => entry.id === input.id) ?? null;
			if (grant === null)
				return fail(BREAKGLASS_NOT_FOUND_CODE, [
					`grant ${JSON.stringify(input.id)} does not exist`,
				]);
			if (grant.use === null)
				return fail(BREAKGLASS_INVALID_CODE, [
					`grant ${JSON.stringify(input.id)} was never used; settlement follows use`,
				]);
			if (grant.settlement !== null)
				return fail(BREAKGLASS_INVALID_CODE, [
					`grant ${JSON.stringify(input.id)} is already settled; emergency history is never rewritten`,
				]);
			const receipt = resolveSettlementReceipt(cwd, grant, input.receipt);
			if (receipt.problem)
				return fail(/CORRUPT/.test(receipt.code || "") ? receipt.code : BREAKGLASS_INVALID_CODE, [
					receipt.problem,
				]);
			resolved = {
				kind: grant.capability.kind,
				outcome: receipt.outcome,
				remedy: receipt.remedy,
			};
			return null;
		},
		(fold) => {
			const record = fold.find((entry) => entry.id === input.id);
			return record ? projectGrant(record, nowMs) : null;
		},
	);
}

/**
 * Record the mandatory human post-review for one ended grant: outcome,
 * necessity, impact, and follow-up — non-empty and preserved — behind a
 * single-use committed human Decision. One review per grant; a late
 * review is still recordable and reads flagged against the declared
 * deadline.
 */
function reviewBreakGlass(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(BREAKGLASS_INVALID_CODE, ["review input must be an object"]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(BREAKGLASS_INVALID_CODE, ["now must be a valid clock"]);
	const inputClosed = unknownFieldProblem(
		input,
		["id", "outcome", "necessity", "impact", "followUp", "decision"],
		"review input",
	);
	if (inputClosed !== null) return fail(BREAKGLASS_INVALID_CODE, [inputClosed]);
	const idRefusal = slugRefusal(input.id, "id");
	if (idRefusal !== null) return fail(idRefusal.code, [idRefusal.message]);
	for (const field of REVIEW_TEXT_FIELDS) {
		if (!isNonEmptyString(input[field]))
			return fail(BREAKGLASS_INVALID_CODE, [
				`${field} must preserve a non-empty ${field}; a post-review is accountable`,
			]);
		const leak = credentialLeakProblem(input[field], field);
		if (leak !== null) return fail(BREAKGLASS_LEAK_CODE, [leak]);
	}
	const pinProblem = decisionPinProblem(input.decision);
	if (pinProblem !== null) return fail(BREAKGLASS_INVALID_CODE, [pinProblem]);
	let revisions;
	try {
		revisions = listArtifactRevisions(cwd);
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_ARTIFACT_JOURNAL_CORRUPT", [err.message || String(err)]);
	}
	const resolved = resolveGrantDecision(revisions, input.decision, "a break-glass post-review");
	if (resolved.problem) return fail(BREAKGLASS_INVALID_CODE, [resolved.problem]);
	const nowMs = now.getTime();
	return appendLedgerEvent(
		cwd,
		GRANT_LEDGER,
		{
			kind: "review",
			schemaVersion: BREAKGLASS_SCHEMA_VERSION,
			at: now.toISOString(),
			id: input.id,
			outcome: input.outcome,
			necessity: input.necessity,
			impact: input.impact,
			followUp: input.followUp,
			decision: resolved.decision,
		},
		(fold) => {
			const grant = fold.find((entry) => entry.id === input.id) ?? null;
			if (grant === null)
				return fail(BREAKGLASS_NOT_FOUND_CODE, [
					`grant ${JSON.stringify(input.id)} does not exist`,
				]);
			if (grant.review !== null)
				return fail(BREAKGLASS_INVALID_CODE, [
					`grant ${JSON.stringify(input.id)} is already reviewed; one post-review per grant`,
				]);
			if (grant.use === null && grant.revocation === null && nowMs < Date.parse(grant.validUntil))
				return fail(BREAKGLASS_INVALID_CODE, [
					`grant ${JSON.stringify(input.id)} has not ended; a post-review follows use, revocation, or expiry`,
				]);
			const spender = grantDecisionSpender(fold, input.decision);
			if (spender !== null)
				return fail(BREAKGLASS_INVALID_CODE, [
					`decision ${JSON.stringify(input.decision.identity)}@${input.decision.revision} already authorized ${spender}; an emergency Decision is single-use`,
				]);
			return null;
		},
		(fold) => {
			const record = fold.find((entry) => entry.id === input.id);
			return record ? projectGrant(record, nowMs) : null;
		},
	);
}

// The full lifecycle projection at the injected clock: status, the use,
// settlement, and review records, and the read-time review flags — an
// overdue post-review is visible, and Policy consumers can fail closed
// on it. Nothing here writes.
function breakGlassStatus(cwd, id, opts = {}) {
	const now = opts.now instanceof Date ? opts.now : new Date();
	const grant = foldGrants(cwd).find((entry) => entry.id === id) ?? null;
	if (grant === null) return null;
	const nowMs = now.getTime();
	const projected = projectGrant(grant, nowMs);
	const ended = projected.status !== "granted";
	const reviewOverdue = grant.review === null && ended && nowMs >= Date.parse(grant.reviewBy);
	const reviewLate =
		grant.review !== null && Date.parse(grant.review.at) >= Date.parse(grant.reviewBy);
	return { ...projected, reviewOverdue, reviewLate };
}

function showBreakGlassGrant(cwd, id, opts = {}) {
	const now = opts.now instanceof Date ? opts.now : new Date();
	const grant = foldGrants(cwd).find((entry) => entry.id === id) ?? null;
	return grant === null ? null : projectGrant(grant, now.getTime());
}

// The P8 seam Policy evaluation consumes: every ended grant whose
// mandatory post-review is overdue at the clock. Read-only; a stack that
// declares the break-glass overdue-review deny rule fails strict
// consumption closed on a non-empty result, so review cannot be silently
// skipped.
function overdueBreakGlassReviews(cwd, opts = {}) {
	const now = opts.now instanceof Date ? opts.now : new Date();
	const nowMs = now.getTime();
	return foldGrants(cwd)
		.filter(
			(grant) =>
				grantStatusAt(grant, nowMs) !== "granted" &&
				grant.review === null &&
				nowMs >= Date.parse(grant.reviewBy),
		)
		.map((grant) => ({ id: grant.id, reviewBy: grant.reviewBy }));
}

function listBreakGlassGrants(cwd, { status = null, now = null } = {}) {
	const clock = now instanceof Date ? now : new Date();
	return foldGrants(cwd)
		.map((entry) => projectGrant(entry, clock.getTime()))
		.filter((entry) => status === null || entry.status === status);
}

module.exports = {
	BREAKGLASS_SCHEMA_VERSION,
	SUPPORTED_BREAKGLASS_SCHEMA_VERSIONS,
	DEFAULT_MAX_BREAKGLASS_BYTES,
	MAX_BREAKGLASS_WINDOW_MS,
	MAX_REVIEW_DELAY_MS,
	BREAKGLASS_CAPABILITY_KINDS,
	BREAKGLASS_CREDENTIALS,
	BREAKGLASS_RISKS,
	BREAKGLASS_DECISION_KINDS,
	GRANT_STATUSES,
	GENESIS_HASH,
	chainHash,
	grantsPath,
	grantBreakGlass,
	revokeBreakGlass,
	useBreakGlass,
	settleBreakGlass,
	reviewBreakGlass,
	breakGlassStatus,
	showBreakGlassGrant,
	overdueBreakGlassReviews,
	listBreakGlassGrants,
};
