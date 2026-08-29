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
const { resolveRequestCapability } = require("./runner-registry");
const { showExternalEffect } = require("./external-registry");
const {
	GENESIS_HASH,
	chainHash,
	acquireLedgerLock,
	appendLedgerEvent,
	credentialLeakProblem,
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
const GRANT_STATUSES = Object.freeze(["granted", "revoked", "expired"]);

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
		if (event.kind !== "grant" && event.kind !== "revoke")
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
			const grant = { ...body, grantedAt: at, revocation: null, index };
			grants.push(grant);
			byId.set(event.id, grant);
		} else {
			const grant = byId.get(event.id);
			if (!grant)
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} revokes unknown grant ${JSON.stringify(event.id)}`,
				);
			if (grant.revocation !== null)
				throw breakglassCorrupt(
					`break-glass event ${lineIndex} revokes an already-revoked grant; history is never rewritten`,
				);
			grant.revocation = { at: event.at, reason: event.reason, decision: event.decision };
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

// Status is a pure read-time derivation: revocation always wins, expiry
// derives from the injected clock against the half-open window, and the
// original grant record is preserved untouched in every state. A grant
// whose window has not opened yet still reads "granted" — the status
// vocabulary is fixed, the window anchors to the grant instant at mint,
// and consumption (T2) separately refuses outside [validFrom, validUntil).
function grantStatusAt(grant, nowMs) {
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
	if (!BREAKGLASS_DECISION_KINDS.includes(match.decisionKind))
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

// Single-use is scoped to the grant ledger domain, matching the
// per-registry mirror convention — and it spans BOTH event kinds: one
// Decision can authorize one grant or one revocation, never two acts.
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
	}
	return null;
}

function decisionPinProblem(value) {
	if (!isPlainObject(value)) return "decision must be an object carrying identity and revision";
	const unknown = unknownFieldProblem(value, ["identity", "revision"], "decision");
	if (unknown !== null) return unknown;
	if (!isNonEmptyString(value.identity)) return "decision.identity must be a non-empty string";
	if (!Number.isInteger(value.revision) || value.revision < 1)
		return "decision.revision must be a positive integer";
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
	const idSlug = slugProblem(input.id, "id");
	if (idSlug !== null)
		return fail(
			/credential material/.test(idSlug) ? BREAKGLASS_LEAK_CODE : BREAKGLASS_INVALID_CODE,
			[idSlug],
		);
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

function showBreakGlassGrant(cwd, id, opts = {}) {
	const now = opts.now instanceof Date ? opts.now : new Date();
	const grant = foldGrants(cwd).find((entry) => entry.id === id) ?? null;
	return grant === null ? null : projectGrant(grant, now.getTime());
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
	showBreakGlassGrant,
	listBreakGlassGrants,
};
