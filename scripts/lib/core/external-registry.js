"use strict";

// F056 T1 (#288) — External Effect registry with pinned Adapter contracts.
//
// Amber deliberately forbids arbitrary third-party writes. The only thing
// that can ever execute externally is a registered effect contract: it
// declares the external owner, system type, operation, exact target and
// scope, idempotency behavior, credentials class, expected receipt
// fields, compensation or explicit irreversibility, timeout, and the one
// registered F051 Adapter that owns the API — behind a single-use
// committed human Decision, immutable per version. No contract field can
// carry a command, executable, or remote URL: the closed shape refuses
// free-form execution vectors by construction.

const path = require("node:path");
const crypto = require("node:crypto");

const { readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { typedError } = require("./error-catalog");
const { listArtifactRevisions } = require("./canonical-artifacts");
const { canonicalJson } = require("./context-hash");
const { showAdapter } = require("./adapter-registry");
const { consumeApproval, showApproval } = require("./approval-registry");
const {
	GENESIS_HASH,
	chainHash,
	acquireLedgerLock,
	appendLedgerEvent,
} = require("./registry-ledger");

const EXTERNAL_SCHEMA_VERSION = 1;
const SUPPORTED_EXTERNAL_SCHEMA_VERSIONS = Object.freeze([1]);
const DEFAULT_MAX_EXTERNAL_BYTES = 1024 * 1024;
// Timeouts are bounded (24h) so a contract can never declare an
// effectively unbounded external operation.
const MAX_EXTERNAL_TIMEOUT_MS = 24 * 3_600_000;
const LOCK_STALE_MS = 30_000;

// The closed external system vocabulary a contract may declare.
const EXTERNAL_SYSTEMS = Object.freeze([
	"ticketing",
	"code-review",
	"notification",
	"deployment",
	"storage",
]);
// Declared duplicate-request behavior of the external operation.
const EXTERNAL_IDEMPOTENCY = Object.freeze(["idempotent", "at-most-once"]);
const EXTERNAL_CREDENTIALS = Object.freeze(["none", "scoped"]);
// Human-only authority slots, mirroring the F050/F052/F055 contract.
const EXTERNAL_DECISION_KINDS = Object.freeze(["acceptance", "approval"]);

const EXTERNAL_INVALID_CODE = "AMBER_E_EXTERNAL_INVALID";
const EXTERNAL_CORRUPT_CODE = "AMBER_E_EXTERNAL_CORRUPT";
const EXTERNAL_LOCK_CODE = "AMBER_E_EXTERNAL_LOCK";
const EXTERNAL_SIZE_CEILING_CODE = "AMBER_E_EXTERNAL_SIZE_CEILING";
const EXTERNAL_NOT_FOUND_CODE = "AMBER_E_EXTERNAL_NOT_FOUND";
const EXTERNAL_DRIFT_CODE = "AMBER_E_EXTERNAL_DRIFT";
const PROPOSAL_CORRUPT_CODE = "AMBER_E_EXTERNAL_PROPOSAL_CORRUPT";
const PROPOSAL_LOCK_CODE = "AMBER_E_EXTERNAL_PROPOSAL_LOCK";
const PROPOSAL_SIZE_CEILING_CODE = "AMBER_E_EXTERNAL_PROPOSAL_SIZE_CEILING";

const PROPOSAL_STATUSES = Object.freeze(["proposed", "authorized"]);

// One slug grammar for every external-facing name: no whitespace, no URL
// scheme, no shell metacharacters — a command or remote URL cannot ride.
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const OPERATION_PATTERN = /^[a-z][a-z0-9.-]*$/;

const EFFECT_INPUT_FIELDS = Object.freeze([
	"id",
	"version",
	"owner",
	"system",
	"operation",
	"target",
	"scope",
	"idempotency",
	"credentials",
	"receiptFields",
	"compensation",
	"timeoutMs",
	"adapter",
	"decision",
]);
const COMPENSATION_FIELDS = Object.freeze(["kind", "effect"]);
const ADAPTER_PIN_FIELDS = Object.freeze(["id", "version"]);
const DECISION_PIN_FIELDS = Object.freeze(["identity", "revision"]);
const DECISION_SNAPSHOT_FIELDS = Object.freeze([
	"identity",
	"revision",
	"decisionKind",
	"principal",
]);
const EFFECT_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"version",
	"owner",
	"system",
	"operation",
	"target",
	"scope",
	"idempotency",
	"credentials",
	"receiptFields",
	"compensation",
	"timeoutMs",
	"adapter",
	"decision",
	"prevHash",
	"hash",
]);

function effectsPath(cwd) {
	return statePathForCreate(cwd, "external", "effects.jsonl");
}

function externalCorrupt(message) {
	return typedError(EXTERNAL_CORRUPT_CODE, message);
}

function acquireEffectLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(effectsPath(cwd)),
		lockName: "effects.lock",
		conflictCode: EXTERNAL_LOCK_CODE,
		corruptCode: EXTERNAL_CORRUPT_CODE,
		label: "external effect registry",
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

// A registered name can never be an execution vector: URL schemes,
// whitespace, shell metacharacters, and ".." traversal segments refuse.
function slugProblem(value, label) {
	if (!isNonEmptyString(value)) return `${label} must be a non-empty string`;
	if (value.includes("://"))
		return `${label} must not carry a URL scheme; the registered Adapter owns the endpoint`;
	if (value.split("/").includes(".."))
		return `${label} must not carry a ".." path segment; a path escape cannot ride a registered name`;
	if (!SLUG_PATTERN.test(value))
		return `${label} must match ${SLUG_PATTERN} — a command, path escape, or URL cannot ride a registered name`;
	return null;
}

// Deliberate T1 latitude: the compensating effect is name-validated but
// not resolved against the registry — mutually compensating pairs would
// deadlock registration order. Execution-side surfaces resolve the pin.
function compensationProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const unknown = unknownFieldProblem(value, COMPENSATION_FIELDS, label);
	if (unknown !== null) return unknown;
	if (value.kind === "irreversible") {
		if ("effect" in value)
			return `${label} declares irreversible and must not name a compensating effect`;
		return null;
	}
	if (value.kind === "effect") {
		const slug = slugProblem(value.effect, `${label}.effect`);
		if (slug !== null) return slug;
		return null;
	}
	return `${label}.kind must be "effect" or "irreversible"`;
}

function adapterPinProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object carrying id and version`;
	const closed = closedFieldProblem(value, ADAPTER_PIN_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(value.id)) return `${label}.id must be a non-empty string`;
	if (!isNonEmptyString(value.version)) return `${label}.version must be a non-empty string`;
	return null;
}

function decisionPinProblem(value) {
	if (!isPlainObject(value)) return "decision must be an object carrying identity and revision";
	const unknown = unknownFieldProblem(value, DECISION_PIN_FIELDS, "decision");
	if (unknown !== null) return unknown;
	if (!isNonEmptyString(value.identity)) return "decision.identity must be a non-empty string";
	if (!Number.isInteger(value.revision) || value.revision < 1)
		return "decision.revision must be a positive integer";
	return null;
}

function decisionSnapshotProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, DECISION_SNAPSHOT_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(value.identity)) return `${label}.identity must be a non-empty string`;
	if (!Number.isInteger(value.revision) || value.revision < 1)
		return `${label}.revision must be a positive integer`;
	if (!EXTERNAL_DECISION_KINDS.includes(value.decisionKind))
		return `${label}.decisionKind must be one of ${EXTERNAL_DECISION_KINDS.join(", ")}`;
	if (!isNonEmptyString(value.principal)) return `${label}.principal must be a non-empty string`;
	return null;
}

// The contract shape shared by register input and stored event.
function effectShapeProblem(value, label) {
	for (const [field, fieldLabel] of [
		["id", `${label}.id`],
		["version", `${label}.version`],
		["owner", `${label}.owner`],
		["target", `${label}.target`],
		["scope", `${label}.scope`],
	]) {
		const slug = slugProblem(value[field], fieldLabel);
		if (slug !== null) return slug;
	}
	if (!EXTERNAL_SYSTEMS.includes(value.system))
		return `${label}.system must be one of ${EXTERNAL_SYSTEMS.join(", ")}`;
	if (!isNonEmptyString(value.operation) || !OPERATION_PATTERN.test(value.operation))
		return `${label}.operation must match ${OPERATION_PATTERN} — one registered operation name, never a command line`;
	if (!EXTERNAL_IDEMPOTENCY.includes(value.idempotency))
		return `${label}.idempotency must be one of ${EXTERNAL_IDEMPOTENCY.join(", ")}`;
	if (!EXTERNAL_CREDENTIALS.includes(value.credentials))
		return `${label}.credentials must be one of ${EXTERNAL_CREDENTIALS.join(", ")}`;
	if (!Array.isArray(value.receiptFields) || value.receiptFields.length === 0)
		return `${label}.receiptFields must be a non-empty array of expected receipt field names`;
	for (const [index, field] of value.receiptFields.entries()) {
		const slug = slugProblem(field, `${label}.receiptFields[${index}]`);
		if (slug !== null) return slug;
	}
	const compensation = compensationProblem(value.compensation, `${label}.compensation`);
	if (compensation !== null) return compensation;
	if (
		!Number.isInteger(value.timeoutMs) ||
		value.timeoutMs < 1 ||
		value.timeoutMs > MAX_EXTERNAL_TIMEOUT_MS
	)
		return `${label}.timeoutMs must be a positive integer no greater than ${MAX_EXTERNAL_TIMEOUT_MS}`;
	const adapter = adapterPinProblem(value.adapter, `${label}.adapter`);
	if (adapter !== null) return adapter;
	return null;
}

function effectEventProblem(event, lineIndex) {
	const label = `external effect event ${lineIndex}`;
	const closed = closedFieldProblem(event, EFFECT_EVENT_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at) || Number.isNaN(Date.parse(event.at)))
		return `${label}.at must be an ISO-8601 timestamp`;
	const shape = effectShapeProblem(event, label);
	if (shape !== null) return shape;
	return decisionSnapshotProblem(event.decision, `${label}.decision`);
}

function effectKey(id, version) {
	return `${id}@${version}`;
}

function foldEffects(cwd) {
	const events = readLedgerFailClosed(
		effectsPath(cwd),
		EXTERNAL_CORRUPT_CODE,
		"external effect registry",
	);
	let prevHash = GENESIS_HASH;
	const keys = new Set();
	const effects = [];
	events.forEach((event, index) => {
		const lineIndex = index + 1;
		if (!isPlainObject(event))
			throw externalCorrupt(`external effect event ${lineIndex} is not an object`);
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash)
			throw externalCorrupt(`external effect event ${lineIndex} breaks the hash chain`);
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash)
			throw externalCorrupt(
				`external effect event ${lineIndex} carries a hash that does not match its content`,
			);
		if (!SUPPORTED_EXTERNAL_SCHEMA_VERSIONS.includes(event.schemaVersion))
			throw externalCorrupt(
				`external effect event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		if (event.kind !== "effect")
			throw externalCorrupt(
				`external effect event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
			);
		const problem = effectEventProblem(event, lineIndex);
		if (problem !== null) throw externalCorrupt(problem);
		const key = effectKey(event.id, event.version);
		if (keys.has(key))
			throw externalCorrupt(`external effect ${JSON.stringify(key)} is registered more than once`);
		keys.add(key);
		const { prevHash: _prev, hash: _hash, ...body } = event;
		effects.push({ ...body, index });
		prevHash = event.hash;
	});
	return effects;
}

const EFFECT_LEDGER = Object.freeze({
	acquire: acquireEffectLock,
	fold: foldEffects,
	path: effectsPath,
	corruptCode: EXTERNAL_CORRUPT_CODE,
	sizeCeilingCode: EXTERNAL_SIZE_CEILING_CODE,
	envName: "AMBER_EXTERNAL_MAX_EFFECTS_BYTES",
	defaultBytes: DEFAULT_MAX_EXTERNAL_BYTES,
	label: "external effect registry",
});

// Registration authority mirrors the F052/F055 contract: a committed,
// unscoped, human acceptance/approval Decision with a verified principal.
function resolveEffectDecision(revisions, decision, label) {
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
	if (!EXTERNAL_DECISION_KINDS.includes(match.decisionKind))
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

// Single-use is scoped to the effect ledger domain, matching the
// per-registry F052/F055 mirror convention.
function effectDecisionSpender(effects, decision) {
	const spender = effects.find(
		(entry) =>
			entry.decision.identity === decision.identity &&
			entry.decision.revision === decision.revision,
	);
	return spender ? effectKey(spender.id, spender.version) : null;
}

/**
 * Register one External Effect contract behind a single-use committed
 * human Decision. Registered versions are immutable — changed external
 * semantics register a new version, and stale pins refuse downstream.
 */
function registerExternalEffect(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input)) return fail(EXTERNAL_INVALID_CODE, ["effect input must be an object"]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(EXTERNAL_INVALID_CODE, ["now must be a valid clock"]);
	const inputClosed = unknownFieldProblem(input, EFFECT_INPUT_FIELDS, "effect input");
	if (inputClosed !== null) return fail(EXTERNAL_INVALID_CODE, [inputClosed]);
	const shape = effectShapeProblem(input, "effect input");
	if (shape !== null) return fail(EXTERNAL_INVALID_CODE, [shape]);
	const pinProblem = decisionPinProblem(input.decision);
	if (pinProblem !== null) return fail(EXTERNAL_INVALID_CODE, [pinProblem]);
	let adapter;
	try {
		adapter = showAdapter(cwd, input.adapter.id);
	} catch (err) {
		return fail(err.amberCode || EXTERNAL_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (adapter === null)
		return fail(EXTERNAL_INVALID_CODE, [
			`adapter ${JSON.stringify(input.adapter.id)} is not registered; an External Effect binds a registered Adapter`,
		]);
	if (adapter.adapterVersion !== input.adapter.version)
		return fail(EXTERNAL_INVALID_CODE, [
			`adapter ${JSON.stringify(input.adapter.id)} is registered at version ${JSON.stringify(adapter.adapterVersion)}, not the pinned ${JSON.stringify(input.adapter.version)}`,
		]);
	let revisions;
	try {
		revisions = listArtifactRevisions(cwd);
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_ARTIFACT_JOURNAL_CORRUPT", [err.message || String(err)]);
	}
	const resolved = resolveEffectDecision(revisions, input.decision, "External Effect registration");
	if (resolved.problem) return fail(EXTERNAL_INVALID_CODE, [resolved.problem]);
	return appendLedgerEvent(
		cwd,
		EFFECT_LEDGER,
		{
			kind: "effect",
			schemaVersion: EXTERNAL_SCHEMA_VERSION,
			at: now.toISOString(),
			id: input.id,
			version: input.version,
			owner: input.owner,
			system: input.system,
			operation: input.operation,
			target: input.target,
			scope: input.scope,
			idempotency: input.idempotency,
			credentials: input.credentials,
			receiptFields: [...input.receiptFields],
			compensation:
				input.compensation.kind === "irreversible"
					? { kind: "irreversible" }
					: { kind: "effect", effect: input.compensation.effect },
			timeoutMs: input.timeoutMs,
			adapter: { id: input.adapter.id, version: input.adapter.version },
			decision: resolved.decision,
		},
		(fold) => {
			const key = effectKey(input.id, input.version);
			if (fold.some((entry) => effectKey(entry.id, entry.version) === key))
				return fail(EXTERNAL_INVALID_CODE, [
					`external effect ${JSON.stringify(key)} is already registered; changed external semantics register a new version`,
				]);
			const spender = effectDecisionSpender(fold, input.decision);
			if (spender !== null)
				return fail(EXTERNAL_INVALID_CODE, [
					`decision ${JSON.stringify(input.decision.identity)}@${input.decision.revision} already authorized effect ${JSON.stringify(spender)}; a registration Decision is single-use`,
				]);
			return null;
		},
		(fold) =>
			fold.find(
				(entry) => effectKey(entry.id, entry.version) === effectKey(input.id, input.version),
			),
	);
}

function showExternalEffect(cwd, id, version = null) {
	const versions = foldEffects(cwd).filter((entry) => entry.id === id);
	if (versions.length === 0) return null;
	// "Latest" is last-appended ledger order, not a version-string sort.
	if (version === null) return versions[versions.length - 1];
	return versions.find((entry) => entry.version === version) ?? null;
}

function listExternalEffects(cwd, { system = null } = {}) {
	return foldEffects(cwd).filter((entry) => system === null || entry.system === system);
}

// ---------------------------------------------------------------------------
// F056 T2 (#289) — proposals & drift-bound authorization. Review binds
// exactly what will happen: a proposal snapshots the registered contract
// into a canonical requestHash, idempotency refuses duplicate requests,
// and authorization consumes a single-use Approval bound to that hash —
// effect-version or Adapter-version drift since proposal refuses.
// ---------------------------------------------------------------------------

function proposalsPath(cwd) {
	return statePathForCreate(cwd, "external", "proposals.jsonl");
}

function proposalCorrupt(message) {
	return typedError(PROPOSAL_CORRUPT_CODE, message);
}

function acquireProposalLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(proposalsPath(cwd)),
		lockName: "proposals.lock",
		conflictCode: PROPOSAL_LOCK_CODE,
		corruptCode: PROPOSAL_CORRUPT_CODE,
		label: "external proposal ledger",
		staleMs: LOCK_STALE_MS,
	});
}

function canonicalHashOf(value) {
	return `sha256:${crypto
		.createHash("sha256")
		.update(Buffer.from(canonicalJson(JSON.stringify(value))))
		.digest("hex")}`;
}

const PAYLOAD_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const EFFECT_PIN_FIELDS = Object.freeze(["id", "version"]);
const PROPOSAL_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"owner",
	"effect",
	"adapter",
	"target",
	"scope",
	"payloadHash",
	"credentials",
	"compensation",
	"requestHash",
	"prevHash",
	"hash",
]);
const PROPOSAL_AUTHORIZED_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"approvalId",
	"decision",
	"prevHash",
	"hash",
]);

function effectPinProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object carrying id and version`;
	const closed = closedFieldProblem(value, EFFECT_PIN_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(value.id)) return `${label}.id must be a non-empty string`;
	if (!isNonEmptyString(value.version)) return `${label}.version must be a non-empty string`;
	return null;
}

function proposalEventProblem(event, lineIndex) {
	const label = `external proposal event ${lineIndex}`;
	if (event.kind === "proposal") {
		const closed = closedFieldProblem(event, PROPOSAL_EVENT_FIELDS, label);
		if (closed !== null) return closed;
		if (!isNonEmptyString(event.at) || Number.isNaN(Date.parse(event.at)))
			return `${label}.at must be an ISO-8601 timestamp`;
		if (!isNonEmptyString(event.id)) return `${label}.id must be a non-empty string`;
		const effectPin = effectPinProblem(event.effect, `${label}.effect`);
		if (effectPin !== null) return effectPin;
		const adapterPin = adapterPinProblem(event.adapter, `${label}.adapter`);
		if (adapterPin !== null) return adapterPin;
		for (const [field, fieldLabel] of [
			["owner", `${label}.owner`],
			["target", `${label}.target`],
			["scope", `${label}.scope`],
		]) {
			const slug = slugProblem(event[field], fieldLabel);
			if (slug !== null) return slug;
		}
		if (!PAYLOAD_HASH_PATTERN.test(event.payloadHash ?? ""))
			return `${label}.payloadHash must be a sha256:<64-hex> string`;
		if (!EXTERNAL_CREDENTIALS.includes(event.credentials))
			return `${label}.credentials must be one of ${EXTERNAL_CREDENTIALS.join(", ")}`;
		const compensation = compensationProblem(event.compensation, `${label}.compensation`);
		if (compensation !== null) return compensation;
		if (!PAYLOAD_HASH_PATTERN.test(event.requestHash ?? ""))
			return `${label}.requestHash must be a sha256:<64-hex> string`;
		return null;
	}
	const closed = closedFieldProblem(event, PROPOSAL_AUTHORIZED_EVENT_FIELDS, label);
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

function foldProposals(cwd) {
	const events = readLedgerFailClosed(
		proposalsPath(cwd),
		PROPOSAL_CORRUPT_CODE,
		"external proposal ledger",
	);
	let prevHash = GENESIS_HASH;
	const proposals = [];
	const byId = new Map();
	events.forEach((event, index) => {
		const lineIndex = index + 1;
		if (!isPlainObject(event))
			throw proposalCorrupt(`external proposal event ${lineIndex} is not an object`);
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash)
			throw proposalCorrupt(`external proposal event ${lineIndex} breaks the hash chain`);
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash)
			throw proposalCorrupt(
				`external proposal event ${lineIndex} carries a hash that does not match its content`,
			);
		if (!SUPPORTED_EXTERNAL_SCHEMA_VERSIONS.includes(event.schemaVersion))
			throw proposalCorrupt(
				`external proposal event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		if (event.kind !== "proposal" && event.kind !== "authorized")
			throw proposalCorrupt(
				`external proposal event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
			);
		const problem = proposalEventProblem(event, lineIndex);
		if (problem !== null) throw proposalCorrupt(problem);
		if (event.kind === "proposal") {
			if (byId.has(event.id))
				throw proposalCorrupt(
					`external proposal event ${lineIndex} reuses proposal id ${JSON.stringify(event.id)}`,
				);
			const { prevHash: _prev, hash: _hash, at, ...body } = event;
			const proposal = {
				...body,
				proposedAt: at,
				status: "proposed",
				authorization: null,
				index,
			};
			proposals.push(proposal);
			byId.set(event.id, proposal);
		} else {
			const proposal = byId.get(event.id);
			if (!proposal)
				throw proposalCorrupt(
					`external proposal event ${lineIndex} authorizes unknown proposal ${JSON.stringify(event.id)}`,
				);
			if (proposal.status !== "proposed")
				throw proposalCorrupt(
					`external proposal event ${lineIndex} authorizes an already-authorized proposal`,
				);
			proposal.status = "authorized";
			proposal.authorization = {
				at: event.at,
				approvalId: event.approvalId,
				decision: event.decision,
			};
		}
		prevHash = event.hash;
	});
	return proposals;
}

const PROPOSAL_LEDGER = Object.freeze({
	acquire: acquireProposalLock,
	fold: foldProposals,
	path: proposalsPath,
	corruptCode: PROPOSAL_CORRUPT_CODE,
	sizeCeilingCode: PROPOSAL_SIZE_CEILING_CODE,
	envName: "AMBER_EXTERNAL_MAX_PROPOSALS_BYTES",
	defaultBytes: DEFAULT_MAX_EXTERNAL_BYTES,
	label: "external proposal ledger",
});

// The deterministic request content: exactly what a reviewer sees and
// exactly what the authorization hash binds. The pinned effect version
// must be the effect's current head and its Adapter pin must still match
// the registry — evaluated identically at proposal and at authorization,
// so any change in between surfaces as drift.
function deriveRequestContent(cwd, effectPin, payloadHash) {
	let head;
	try {
		head = showExternalEffect(cwd, effectPin.id);
	} catch (err) {
		return {
			problem: {
				code: err.amberCode || EXTERNAL_CORRUPT_CODE,
				errors: [err.message || String(err)],
			},
		};
	}
	if (head === null)
		return {
			notFound: `effect ${JSON.stringify(effectPin.id)} is not registered; an External Effect proposal binds a registered contract`,
		};
	if (head.version !== effectPin.version)
		return {
			drift: `effect ${JSON.stringify(effectPin.id)} is currently registered at version ${JSON.stringify(head.version)}, not the pinned ${JSON.stringify(effectPin.version)}; changed external semantics never ride an older pin`,
		};
	let adapter;
	try {
		adapter = showAdapter(cwd, head.adapter.id);
	} catch (err) {
		return {
			problem: {
				code: err.amberCode || EXTERNAL_CORRUPT_CODE,
				errors: [err.message || String(err)],
			},
		};
	}
	if (adapter === null || adapter.adapterVersion !== head.adapter.version)
		return {
			drift: `adapter ${JSON.stringify(head.adapter.id)} no longer matches the contract's pinned version ${JSON.stringify(head.adapter.version)}; register a new effect version against the current Adapter`,
		};
	const content = {
		owner: head.owner,
		effect: { id: head.id, version: head.version },
		adapter: { id: head.adapter.id, version: head.adapter.version },
		target: head.target,
		scope: head.scope,
		payloadHash,
		credentials: head.credentials,
		compensation: head.compensation,
	};
	return { content: { ...content, requestHash: canonicalHashOf(content) } };
}

/**
 * Propose one external effect request: a governance-write that binds the
 * registered effect version, its exact target and scope, the canonical
 * payload hash, the credentials class, and the declared compensation
 * into a canonical requestHash — nothing external is touched. The
 * idempotency identity (owner + effect + target + scope + payloadHash)
 * refuses duplicates naming the existing proposal, so a retry can never
 * create a duplicate external record.
 */
function proposeExternalEffect(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(EXTERNAL_INVALID_CODE, ["proposal input must be an object"]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(EXTERNAL_INVALID_CODE, ["now must be a valid clock"]);
	const inputClosed = unknownFieldProblem(input, ["id", "effect", "payloadHash"], "proposal input");
	if (inputClosed !== null) return fail(EXTERNAL_INVALID_CODE, [inputClosed]);
	if (!isNonEmptyString(input.id))
		return fail(EXTERNAL_INVALID_CODE, ["id must be a non-empty string"]);
	const pinProblem = effectPinProblem(input.effect, "proposal input.effect");
	if (pinProblem !== null) return fail(EXTERNAL_INVALID_CODE, [pinProblem]);
	if (!PAYLOAD_HASH_PATTERN.test(input.payloadHash ?? ""))
		return fail(EXTERNAL_INVALID_CODE, [
			"payloadHash must be a sha256:<64-hex> string — the canonical hash of the exact payload under review; the payload itself never enters the ledger",
		]);
	const derived = deriveRequestContent(cwd, input.effect, input.payloadHash);
	if (derived.problem) return fail(derived.problem.code, derived.problem.errors);
	if (derived.notFound) return fail(EXTERNAL_NOT_FOUND_CODE, [derived.notFound]);
	if (derived.drift) return fail(EXTERNAL_INVALID_CODE, [derived.drift]);
	const { content } = derived;
	return appendLedgerEvent(
		cwd,
		PROPOSAL_LEDGER,
		{
			kind: "proposal",
			schemaVersion: EXTERNAL_SCHEMA_VERSION,
			at: now.toISOString(),
			id: input.id,
			owner: content.owner,
			effect: content.effect,
			adapter: content.adapter,
			target: content.target,
			scope: content.scope,
			payloadHash: content.payloadHash,
			credentials: content.credentials,
			compensation: content.compensation,
			requestHash: content.requestHash,
		},
		(fold) => {
			if (fold.some((entry) => entry.id === input.id))
				return fail(EXTERNAL_INVALID_CODE, [
					`proposal ${JSON.stringify(input.id)} already exists; propose a new id for a new request`,
				]);
			const duplicate = fold.find((entry) => entry.requestHash === content.requestHash);
			if (duplicate)
				return fail(EXTERNAL_INVALID_CODE, [
					`an identical request (owner + effect + target + scope + payloadHash) is already proposed as ${JSON.stringify(duplicate.id)}; a retry re-reads the existing proposal instead of duplicating the external record`,
				]);
			return null;
		},
		(fold) => fold.find((entry) => entry.id === input.id),
	);
}

/**
 * Authorize one proposed request: consumes a single-use Approval whose
 * subject binds the proposal's canonical requestHash, after re-deriving
 * the request content against the current registries — an effect version
 * or Adapter version that drifted since the proposal refuses, so a stale
 * authorization can never ride changed external semantics.
 */
function authorizeExternalEffect(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(EXTERNAL_INVALID_CODE, ["authorize input must be an object"]);
	const inputClosed = unknownFieldProblem(
		input,
		["id", "approval", "decisionIdentity", "body", "traces", "scope"],
		"authorize input",
	);
	if (inputClosed !== null) return fail(EXTERNAL_INVALID_CODE, [inputClosed]);
	for (const field of ["id", "approval", "decisionIdentity", "body"]) {
		if (!isNonEmptyString(input[field]))
			return fail(EXTERNAL_INVALID_CODE, [`${field} must be a non-empty string`]);
	}
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	let consumed = null;
	// The guard completes this object from the consumption receipt before
	// the append hashes the event body.
	const decision = { identity: input.decisionIdentity, revision: 1 };
	const appended = appendLedgerEvent(
		cwd,
		PROPOSAL_LEDGER,
		{
			kind: "authorized",
			schemaVersion: EXTERNAL_SCHEMA_VERSION,
			at,
			id: input.id,
			approvalId: input.approval,
			decision,
		},
		(fold) => {
			const proposal = fold.find((entry) => entry.id === input.id) ?? null;
			if (proposal === null)
				return fail(EXTERNAL_NOT_FOUND_CODE, [
					`proposal ${JSON.stringify(input.id)} does not exist`,
				]);
			if (proposal.status !== "proposed")
				return fail(EXTERNAL_INVALID_CODE, [
					`proposal ${JSON.stringify(input.id)} is already authorized; an authorization is single-use`,
				]);
			const derived = deriveRequestContent(cwd, proposal.effect, proposal.payloadHash);
			if (derived.problem) return fail(derived.problem.code, derived.problem.errors);
			if (derived.notFound) return fail(EXTERNAL_DRIFT_CODE, [derived.notFound]);
			if (derived.drift) return fail(EXTERNAL_DRIFT_CODE, [derived.drift]);
			if (derived.content.requestHash !== proposal.requestHash)
				return fail(EXTERNAL_DRIFT_CODE, [
					`proposal ${JSON.stringify(input.id)} no longer matches what was reviewed; propose and review a fresh request`,
				]);
			let approval;
			try {
				approval = showApproval(cwd, input.approval, { now: opts.now });
			} catch (err) {
				return fail(err.amberCode || PROPOSAL_CORRUPT_CODE, [err.message || String(err)]);
			}
			if (approval === null)
				return fail(EXTERNAL_INVALID_CODE, [
					`approval ${JSON.stringify(input.approval)} is not recorded`,
				]);
			const binding = `external-effect:${proposal.requestHash}`;
			if (approval.subject !== binding)
				return fail(EXTERNAL_INVALID_CODE, [
					`approval ${JSON.stringify(input.approval)} authorizes subject ${JSON.stringify(approval.subject)}, not this proposal's binding ${JSON.stringify(binding)}; one authorization binds one reviewed request hash`,
				]);
			// Consumption is the point of no return: it settles the human
			// Decision atomically under the approval ledger's own lock. A
			// ceiling/write failure AFTER this point leaves the consumed
			// approval and settled Decision as the auditable source of
			// truth for manual recovery — the proposal stays proposed.
			const consumption = consumeApproval(
				cwd,
				{
					id: input.approval,
					decisionIdentity: input.decisionIdentity,
					body: input.body,
					traces: input.traces ?? [],
					scope: input.scope ?? null,
				},
				opts,
			);
			if (!consumption.ok) return fail(consumption.code, consumption.errors);
			consumed = consumption;
			decision.revision = consumption.receipt.revision;
			return null;
		},
		(fold) => fold.find((entry) => entry.id === input.id),
	);
	if (!appended.ok) return appended;
	return { ...appended, consumption: consumed };
}

function showExternalProposal(cwd, id) {
	return foldProposals(cwd).find((entry) => entry.id === id) ?? null;
}

function listExternalProposals(cwd, { status = null } = {}) {
	return foldProposals(cwd).filter((entry) => status === null || entry.status === status);
}

module.exports = {
	EXTERNAL_SCHEMA_VERSION,
	SUPPORTED_EXTERNAL_SCHEMA_VERSIONS,
	DEFAULT_MAX_EXTERNAL_BYTES,
	MAX_EXTERNAL_TIMEOUT_MS,
	EXTERNAL_SYSTEMS,
	EXTERNAL_IDEMPOTENCY,
	EXTERNAL_CREDENTIALS,
	EXTERNAL_DECISION_KINDS,
	GENESIS_HASH,
	chainHash,
	effectsPath,
	registerExternalEffect,
	showExternalEffect,
	listExternalEffects,
	PROPOSAL_STATUSES,
	proposalsPath,
	proposeExternalEffect,
	authorizeExternalEffect,
	showExternalProposal,
	listExternalProposals,
};
