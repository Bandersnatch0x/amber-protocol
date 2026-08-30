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

const { readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { typedError } = require("./error-catalog");
const { listArtifactRevisions } = require("./canonical-artifacts");
const { showAdapter } = require("./adapter-registry");
const { consumeSubjectBoundApproval, showApproval } = require("./approval-registry");
const { showEvidence } = require("./evidence-receipts");
const {
	GENESIS_HASH,
	chainHash,
	acquireLedgerLock,
	appendLedgerEvent,
	credentialLeakProblem,
	chainLinkProblem,
	isCredentialLeakProblem,
	isPlainObject,
	isNonEmptyString,
	closedFieldProblem,
	unknownFieldProblem,
	decisionPinProblem,
	resolveRegistrationDecision,
	decisionSnapshotProblem: sharedDecisionSnapshotProblem,
	canonicalHashOf,
	findDecisionSpend,
} = require("./registry-ledger");
const { compileInline } = require("./schema-contract");

// v2 added the required `compensates` linkage to proposal events (F056
// T4); v1 proposal events written before it stay readable with a null
// linkage. v3 added the required `inputSchema` declaration to effect
// events (acceptance review P5): the contract declares the operation's
// payload shape as a compilable JSON schema. v1/v2 effect events stay
// readable with `inputSchema` folded to null — those contracts declared
// no payload shape — and every other event kind shares one shape across
// versions.
const EXTERNAL_SCHEMA_VERSION = 3;
const SUPPORTED_EXTERNAL_SCHEMA_VERSIONS = Object.freeze([1, 2, 3]);
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
const EXEC_CORRUPT_CODE = "AMBER_E_EXTERNAL_EXEC_CORRUPT";
const EXEC_LOCK_CODE = "AMBER_E_EXTERNAL_EXEC_LOCK";
const EXEC_SIZE_CEILING_CODE = "AMBER_E_EXTERNAL_EXEC_SIZE_CEILING";
const CREDENTIAL_LEAK_CODE = "AMBER_E_EXTERNAL_CREDENTIAL_LEAK";

const PROPOSAL_STATUSES = Object.freeze(["proposed", "authorized"]);
// What the external Adapter may declare on its result receipt.
const DECLARED_STATUSES = Object.freeze(["committed", "failed", "denied", "unknown"]);
// What Amber derives — never the adapter.
const EXECUTION_OUTCOMES = Object.freeze(["denied", "attempted", "committed", "failed", "unknown"]);

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
	"inputSchema",
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
	"inputSchema",
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
// v1/v2 effect events predate the declared input schema; the closed set
// keeps a legacy event from smuggling one in.
const EFFECT_EVENT_FIELDS_LEGACY = Object.freeze(
	EFFECT_EVENT_FIELDS.filter((field) => field !== "inputSchema"),
);

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

// Structural contract of the declared payload schema: one JSON-schema
// OBJECT (a bare boolean schema declares nothing reviewable), free of
// credential-looking material — the schema is ledger-bound free text and
// this registry owns the credential boundary. Whether it COMPILES is a
// registration-time verdict (compileInline), never a read-time one.
function inputSchemaProblem(value, label) {
	if (!isPlainObject(value))
		return `${label} must be a JSON-schema object declaring the operation's payload shape`;
	return credentialLeakProblem(JSON.stringify(value), label);
}

function decisionSnapshotProblem(value, label) {
	return sharedDecisionSnapshotProblem(value, EXTERNAL_DECISION_KINDS, label);
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
	const closed = closedFieldProblem(
		event,
		event.schemaVersion >= 3 ? EFFECT_EVENT_FIELDS : EFFECT_EVENT_FIELDS_LEGACY,
		label,
	);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at) || Number.isNaN(Date.parse(event.at)))
		return `${label}.at must be an ISO-8601 timestamp`;
	const shape = effectShapeProblem(event, label);
	if (shape !== null) return shape;
	if (event.schemaVersion >= 3) {
		const schema = inputSchemaProblem(event.inputSchema, `${label}.inputSchema`);
		if (schema !== null) return schema;
	}
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
		const link = chainLinkProblem(event, prevHash, lineIndex, "external effect");
		if (link !== null) throw externalCorrupt(link);
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
		effects.push({ ...body, inputSchema: event.inputSchema ?? null, index });
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
	return resolveRegistrationDecision(revisions, decision, EXTERNAL_DECISION_KINDS, label);
}

// Single-use is scoped to the effect ledger domain, matching the
// per-registry F052/F055 mirror convention.
function effectDecisionSpender(effects, decision) {
	const spent = findDecisionSpend(effects, decision, ["decision"]);
	return spent ? effectKey(spent.record.id, spent.record.version) : null;
}

// The registration input prologue: closed fields, the contract shape,
// the declared payload schema (shape, credential boundary, and a
// registration-time compile verdict), and the Decision pin.
// Returns { code, errors } or null.
function effectRegistrationInputProblem(input) {
	const inputClosed = unknownFieldProblem(input, EFFECT_INPUT_FIELDS, "effect input");
	if (inputClosed !== null) return { code: EXTERNAL_INVALID_CODE, errors: [inputClosed] };
	const shape = effectShapeProblem(input, "effect input");
	if (shape !== null) return { code: EXTERNAL_INVALID_CODE, errors: [shape] };
	const schemaProblem = inputSchemaProblem(input.inputSchema, "effect input.inputSchema");
	if (schemaProblem !== null)
		return {
			code: isCredentialLeakProblem(schemaProblem) ? CREDENTIAL_LEAK_CODE : EXTERNAL_INVALID_CODE,
			errors: [schemaProblem],
		};
	// The declared schema must compile: a contract whose payload shape is
	// not checkable declares nothing.
	try {
		compileInline(input.inputSchema);
	} catch (err) {
		return {
			code: EXTERNAL_INVALID_CODE,
			errors: [
				`effect input.inputSchema does not compile as a JSON schema: ${err.message || String(err)}`,
			],
		};
	}
	const pinProblem = decisionPinProblem(input.decision);
	if (pinProblem !== null) return { code: EXTERNAL_INVALID_CODE, errors: [pinProblem] };
	return null;
}

// The pinned Adapter must be registered at exactly the pinned version:
// an External Effect binds a registered Adapter, and a drifted pin
// refuses. Returns { code, errors } or null.
function effectAdapterPinProblem(cwd, pin) {
	let adapter;
	try {
		adapter = showAdapter(cwd, pin.id);
	} catch (err) {
		return { code: err.amberCode || EXTERNAL_CORRUPT_CODE, errors: [err.message || String(err)] };
	}
	if (adapter === null)
		return {
			code: EXTERNAL_INVALID_CODE,
			errors: [
				`adapter ${JSON.stringify(pin.id)} is not registered; an External Effect binds a registered Adapter`,
			],
		};
	if (adapter.adapterVersion !== pin.version)
		return {
			code: EXTERNAL_INVALID_CODE,
			errors: [
				`adapter ${JSON.stringify(pin.id)} is registered at version ${JSON.stringify(adapter.adapterVersion)}, not the pinned ${JSON.stringify(pin.version)}`,
			],
		};
	return null;
}

// The in-lock registration guards: an effect id/version pair registers
// at most once, and the registration Decision is single-use in this
// ledger. Returns { code, errors } or null.
function effectRegistrationProblem(fold, input) {
	const key = effectKey(input.id, input.version);
	if (fold.some((entry) => effectKey(entry.id, entry.version) === key))
		return {
			code: EXTERNAL_INVALID_CODE,
			errors: [
				`external effect ${JSON.stringify(key)} is already registered; changed external semantics register a new version`,
			],
		};
	const spender = effectDecisionSpender(fold, input.decision);
	if (spender !== null)
		return {
			code: EXTERNAL_INVALID_CODE,
			errors: [
				`decision ${JSON.stringify(input.decision.identity)}@${input.decision.revision} already authorized effect ${JSON.stringify(spender)}; a registration Decision is single-use`,
			],
		};
	return null;
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
	const inputProblem = effectRegistrationInputProblem(input);
	if (inputProblem !== null) return fail(inputProblem.code, inputProblem.errors);
	const adapterProblem = effectAdapterPinProblem(cwd, input.adapter);
	if (adapterProblem !== null) return fail(adapterProblem.code, adapterProblem.errors);
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
			inputSchema: input.inputSchema,
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
			const problem = effectRegistrationProblem(fold, input);
			return problem === null ? null : fail(problem.code, problem.errors);
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

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
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
	"compensates",
	"requestHash",
	"prevHash",
	"hash",
]);
const PROPOSAL_EVENT_FIELDS_LEGACY = Object.freeze(
	PROPOSAL_EVENT_FIELDS.filter((field) => field !== "compensates"),
);
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
		const closed = closedFieldProblem(
			event,
			event.schemaVersion >= 2 ? PROPOSAL_EVENT_FIELDS : PROPOSAL_EVENT_FIELDS_LEGACY,
			label,
		);
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
		if (!SHA256_PATTERN.test(event.payloadHash ?? ""))
			return `${label}.payloadHash must be a sha256:<64-hex> string`;
		if (!EXTERNAL_CREDENTIALS.includes(event.credentials))
			return `${label}.credentials must be one of ${EXTERNAL_CREDENTIALS.join(", ")}`;
		const compensation = compensationProblem(event.compensation, `${label}.compensation`);
		if (compensation !== null) return compensation;
		if (event.compensates !== undefined && event.compensates !== null) {
			if (!isNonEmptyString(event.compensates))
				return `${label}.compensates must be null or the original execution id`;
			const leak = credentialLeakProblem(event.compensates, `${label}.compensates`);
			if (leak !== null) return leak;
		}
		if (!SHA256_PATTERN.test(event.requestHash ?? ""))
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
		const link = chainLinkProblem(event, prevHash, lineIndex, "external proposal");
		if (link !== null) throw proposalCorrupt(link);
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
				compensates: event.compensates ?? null,
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
	if (!SHA256_PATTERN.test(input.payloadHash ?? ""))
		return fail(EXTERNAL_INVALID_CODE, [
			"payloadHash must be a sha256:<64-hex> string — the canonical hash of the exact payload under review; the payload itself never enters the ledger",
		]);
	const derived = deriveRequestContent(cwd, input.effect, input.payloadHash);
	if (derived.problem) return fail(derived.problem.code, derived.problem.errors);
	if (derived.notFound) return fail(EXTERNAL_NOT_FOUND_CODE, [derived.notFound]);
	if (derived.drift) return fail(EXTERNAL_INVALID_CODE, [derived.drift]);
	return appendProposal(cwd, input.id, derived.content, null, now, () => null);
}

// The shared proposal append for plain requests and compensations: the
// same idempotency identity and duplicate naming apply to both.
function appendProposal(cwd, id, content, compensates, now, extraGuard) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	return appendLedgerEvent(
		cwd,
		PROPOSAL_LEDGER,
		{
			kind: "proposal",
			schemaVersion: EXTERNAL_SCHEMA_VERSION,
			at: now.toISOString(),
			id,
			owner: content.owner,
			effect: content.effect,
			adapter: content.adapter,
			target: content.target,
			scope: content.scope,
			payloadHash: content.payloadHash,
			credentials: content.credentials,
			compensation: content.compensation,
			compensates,
			requestHash: content.requestHash,
		},
		(fold) => {
			if (fold.some((entry) => entry.id === id))
				return fail(EXTERNAL_INVALID_CODE, [
					`proposal ${JSON.stringify(id)} already exists; propose a new id for a new request`,
				]);
			const guarded = extraGuard(fold);
			if (guarded !== null) return guarded;
			// The requestHash identity is shared by plain requests and
			// compensations: identical external semantics never duplicate,
			// whatever review path proposed them.
			const duplicate = fold.find((entry) => entry.requestHash === content.requestHash);
			if (duplicate)
				return fail(EXTERNAL_INVALID_CODE, [
					compensates === null
						? `an identical request (owner + effect + target + scope + payloadHash) is already proposed as ${JSON.stringify(duplicate.id)}; a retry re-reads the existing proposal instead of duplicating the external record`
						: `an identical request is already proposed as ${JSON.stringify(duplicate.id)}; a compensation shares the request idempotency identity — compensate with a distinct payload or complete the existing request`,
				]);
			return null;
		},
		(fold) => fold.find((entry) => entry.id === id),
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
			const binding = `external-effect:${proposal.requestHash}`;
			// Consumption is the point of no return: it settles the human
			// Decision atomically under the approval ledger's own lock. A
			// ceiling/write failure AFTER this point leaves the consumed
			// approval and settled Decision as the auditable source of
			// truth for manual recovery — the proposal stays proposed.
			const settled = consumeSubjectBoundApproval(
				cwd,
				{
					id: input.approval,
					binding,
					decision,
					fail,
					corruptCode: PROPOSAL_CORRUPT_CODE,
					invalidCode: EXTERNAL_INVALID_CODE,
					subjectMismatch: (approval) =>
						`approval ${JSON.stringify(input.approval)} authorizes subject ${JSON.stringify(approval.subject)}, not this proposal's binding ${JSON.stringify(binding)}; one authorization binds one reviewed request hash`,
					decisionIdentity: input.decisionIdentity,
					body: input.body,
					traces: input.traces ?? [],
					scope: input.scope ?? null,
				},
				opts,
			);
			if (settled.verdict !== null) return settled.verdict;
			consumed = settled.consumption;
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

// ---------------------------------------------------------------------------
// F056 T3 (#290) — Adapter execution, settlement & credential boundary.
// Missing output never means success, and no credential material ever
// rides a record: the closed event shapes carry no handle/value field at
// all, and Amber — never the adapter — derives every terminal outcome.
// ---------------------------------------------------------------------------

function executionsPath(cwd) {
	return statePathForCreate(cwd, "external", "executions.jsonl");
}

function executionCorrupt(message) {
	return typedError(EXEC_CORRUPT_CODE, message);
}

function acquireExecutionLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(executionsPath(cwd)),
		lockName: "executions.lock",
		conflictCode: EXEC_LOCK_CODE,
		corruptCode: EXEC_CORRUPT_CODE,
		label: "external execution ledger",
		staleMs: LOCK_STALE_MS,
	});
}

const CREDENTIAL_BOUNDARY_FIELDS = Object.freeze(["purpose", "scope", "expiresAt"]);

// The stored boundary is purpose/scope/expiry only: no field for a
// handle or value exists, so credential material cannot ride the ledger.
function credentialBoundaryProblem(value, label, at, timeoutMs) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, CREDENTIAL_BOUNDARY_FIELDS, label);
	if (closed !== null) return closed;
	for (const field of ["purpose", "scope"]) {
		const slug = slugProblem(value[field], `${label}.${field}`);
		if (slug !== null) return slug;
		const leak = credentialLeakProblem(value[field], `${label}.${field}`);
		if (leak !== null) return leak;
	}
	if (!isNonEmptyString(value.expiresAt) || Number.isNaN(Date.parse(value.expiresAt)))
		return `${label}.expiresAt must be an ISO-8601 timestamp`;
	const atMs = Date.parse(at);
	const expiresMs = Date.parse(value.expiresAt);
	if (expiresMs <= atMs)
		return `${label}.expiresAt must be strictly after the execution clock; a credential boundary is short-lived`;
	if (expiresMs - atMs > timeoutMs)
		return `${label}.expiresAt must not outlive the contract's declared timeout (${timeoutMs}ms); a credential boundary is bounded by the operation it serves`;
	return null;
}

const EXECUTION_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"request",
	"effect",
	"adapter",
	"operation",
	"target",
	"scope",
	"idempotency",
	"timeoutMs",
	"credential",
	"prevHash",
	"hash",
]);
const SETTLEMENT_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"externalRecordId",
	"requestDigest",
	"responseDigest",
	"declared",
	"outcome",
	"prevHash",
	"hash",
]);
const RECONCILIATION_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"evidence",
	"externalRecordId",
	"prevHash",
	"hash",
]);

/**
 * Amber's outcome derivation — the adapter declares, Amber decides:
 * - committed requires the real external record id AND the response
 *   digest; missing output reads as its refusal, never success.
 * - failed/denied hold only with the response digest that proves the
 *   interpretation; without it the request is merely `attempted`
 *   (submitted, unconfirmed — it may have landed).
 * - unknown must carry no output at all; a record id on any
 *   non-committed declaration refuses (a created record settles as
 *   committed or reconciles — it never hides behind a failure).
 */
function deriveOutcome(receipt) {
	const { externalRecordId, responseDigest, declared } = receipt;
	if (declared === "committed") {
		if (externalRecordId === null || responseDigest === null)
			return {
				problem:
					"a committed receipt names the real external record id and the response digest; missing output reads as its refusal, never success",
			};
		return { outcome: "committed" };
	}
	if (externalRecordId !== null)
		return {
			problem: `a receipt naming a created external record cannot declare ${JSON.stringify(declared)}; it settles as committed or reconciles`,
		};
	if (declared === "unknown") {
		if (responseDigest !== null)
			return {
				problem:
					"an output-bearing receipt cannot declare unknown; declare what the response showed",
			};
		return { outcome: "unknown" };
	}
	return { outcome: responseDigest === null ? "attempted" : declared };
}

function settlementReceiptProblem(event, label) {
	if (event.externalRecordId !== null) {
		const slug = slugProblem(event.externalRecordId, `${label}.externalRecordId`);
		if (slug !== null) return slug;
	}
	if (!SHA256_PATTERN.test(event.requestDigest ?? ""))
		return `${label}.requestDigest must be a sha256:<64-hex> string — the digest of exactly what was submitted`;
	if (event.responseDigest !== null && !SHA256_PATTERN.test(event.responseDigest))
		return `${label}.responseDigest must be null or a sha256:<64-hex> string`;
	if (!DECLARED_STATUSES.includes(event.declared))
		return `${label}.declared must be one of ${DECLARED_STATUSES.join(", ")}`;
	return null;
}

function executionEventProblem(event, lineIndex) {
	const label = `external execution event ${lineIndex}`;
	if (event.kind === "execution") {
		const closed = closedFieldProblem(event, EXECUTION_EVENT_FIELDS, label);
		if (closed !== null) return closed;
		if (!isNonEmptyString(event.at) || Number.isNaN(Date.parse(event.at)))
			return `${label}.at must be an ISO-8601 timestamp`;
		for (const field of ["id", "request"]) {
			if (!isNonEmptyString(event[field])) return `${label}.${field} must be a non-empty string`;
			const leak = credentialLeakProblem(event[field], `${label}.${field}`);
			if (leak !== null) return leak;
		}
		const effectPin = effectPinProblem(event.effect, `${label}.effect`);
		if (effectPin !== null) return effectPin;
		const adapterPin = adapterPinProblem(event.adapter, `${label}.adapter`);
		if (adapterPin !== null) return adapterPin;
		if (!isNonEmptyString(event.operation) || !OPERATION_PATTERN.test(event.operation))
			return `${label}.operation must match ${OPERATION_PATTERN}`;
		for (const [field, fieldLabel] of [
			["target", `${label}.target`],
			["scope", `${label}.scope`],
		]) {
			const slug = slugProblem(event[field], fieldLabel);
			if (slug !== null) return slug;
		}
		if (!EXTERNAL_IDEMPOTENCY.includes(event.idempotency))
			return `${label}.idempotency must be one of ${EXTERNAL_IDEMPOTENCY.join(", ")}`;
		if (
			!Number.isInteger(event.timeoutMs) ||
			event.timeoutMs < 1 ||
			event.timeoutMs > MAX_EXTERNAL_TIMEOUT_MS
		)
			return `${label}.timeoutMs must be a positive integer no greater than ${MAX_EXTERNAL_TIMEOUT_MS}`;
		if (event.credential !== null) {
			const boundary = credentialBoundaryProblem(
				event.credential,
				`${label}.credential`,
				event.at,
				event.timeoutMs,
			);
			if (boundary !== null) return boundary;
		}
		return null;
	}
	if (event.kind === "settlement") {
		const closed = closedFieldProblem(event, SETTLEMENT_EVENT_FIELDS, label);
		if (closed !== null) return closed;
		if (!isNonEmptyString(event.at) || Number.isNaN(Date.parse(event.at)))
			return `${label}.at must be an ISO-8601 timestamp`;
		if (!isNonEmptyString(event.id)) return `${label}.id must be a non-empty string`;
		const receipt = settlementReceiptProblem(event, label);
		if (receipt !== null) return receipt;
		for (const field of ["id", "externalRecordId"]) {
			const leak = credentialLeakProblem(event[field], `${label}.${field}`);
			if (leak !== null) return leak;
		}
		if (!EXECUTION_OUTCOMES.includes(event.outcome))
			return `${label}.outcome must be one of ${EXECUTION_OUTCOMES.join(", ")}`;
		return null;
	}
	const closed = closedFieldProblem(event, RECONCILIATION_EVENT_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at) || Number.isNaN(Date.parse(event.at)))
		return `${label}.at must be an ISO-8601 timestamp`;
	for (const field of ["id", "evidence"]) {
		if (!isNonEmptyString(event[field])) return `${label}.${field} must be a non-empty string`;
		const leak = credentialLeakProblem(event[field], `${label}.${field}`);
		if (leak !== null) return leak;
	}
	const recordSlug = slugProblem(event.externalRecordId, `${label}.externalRecordId`);
	if (recordSlug !== null) return recordSlug;
	return credentialLeakProblem(event.externalRecordId, `${label}.externalRecordId`);
}

function foldExecutions(cwd) {
	const events = readLedgerFailClosed(
		executionsPath(cwd),
		EXEC_CORRUPT_CODE,
		"external execution ledger",
	);
	let prevHash = GENESIS_HASH;
	const executions = [];
	const byId = new Map();
	events.forEach((event, index) => {
		const lineIndex = index + 1;
		const link = chainLinkProblem(event, prevHash, lineIndex, "external execution");
		if (link !== null) throw executionCorrupt(link);
		if (!SUPPORTED_EXTERNAL_SCHEMA_VERSIONS.includes(event.schemaVersion))
			throw executionCorrupt(
				`external execution event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		if (!["execution", "settlement", "reconciliation"].includes(event.kind))
			throw executionCorrupt(
				`external execution event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
			);
		const problem = executionEventProblem(event, lineIndex);
		if (problem !== null) throw executionCorrupt(problem);
		if (event.kind === "execution") {
			if (byId.has(event.id))
				throw executionCorrupt(
					`external execution event ${lineIndex} reuses execution id ${JSON.stringify(event.id)}`,
				);
			const { prevHash: _prev, hash: _hash, at, ...body } = event;
			const execution = {
				...body,
				preparedAt: at,
				status: "prepared",
				settlement: null,
				reconciliation: null,
				outcome: null,
				index,
			};
			executions.push(execution);
			byId.set(event.id, execution);
		} else if (event.kind === "settlement") {
			const execution = byId.get(event.id);
			if (!execution)
				throw executionCorrupt(
					`external execution event ${lineIndex} settles unknown execution ${JSON.stringify(event.id)}`,
				);
			if (execution.status !== "prepared")
				throw executionCorrupt(
					`external execution event ${lineIndex} re-settles a settled execution; settled outcomes never re-settle`,
				);
			// The recorded outcome must be exactly what Amber derives from
			// the receipt — a rewritten verdict fails the read closed.
			const derived = deriveOutcome(event);
			if (derived.problem || derived.outcome !== event.outcome)
				throw executionCorrupt(
					`external execution event ${lineIndex} carries an outcome the receipt does not derive; Amber, never the adapter, derives the outcome`,
				);
			execution.status = "settled";
			execution.outcome = event.outcome;
			execution.settlement = {
				at: event.at,
				externalRecordId: event.externalRecordId,
				requestDigest: event.requestDigest,
				responseDigest: event.responseDigest,
				declared: event.declared,
			};
		} else {
			const execution = byId.get(event.id);
			if (!execution)
				throw executionCorrupt(
					`external execution event ${lineIndex} reconciles unknown execution ${JSON.stringify(event.id)}`,
				);
			if (execution.status !== "settled" || execution.outcome !== "unknown")
				throw executionCorrupt(
					`external execution event ${lineIndex} reconciles an execution whose outcome is not unknown; reconciliation is the only path from unknown to committed`,
				);
			execution.outcome = "committed";
			execution.reconciliation = {
				at: event.at,
				evidence: event.evidence,
				externalRecordId: event.externalRecordId,
			};
		}
		prevHash = event.hash;
	});
	return executions;
}

const EXECUTION_LEDGER = Object.freeze({
	acquire: acquireExecutionLock,
	fold: foldExecutions,
	path: executionsPath,
	corruptCode: EXEC_CORRUPT_CODE,
	sizeCeilingCode: EXEC_SIZE_CEILING_CODE,
	envName: "AMBER_EXTERNAL_MAX_EXECUTIONS_BYTES",
	defaultBytes: DEFAULT_MAX_EXTERNAL_BYTES,
	label: "external execution ledger",
});

// The declared credential class binds the execution: "none" refuses any
// boundary, "scoped" requires a purpose/scope/expiry boundary (never a
// handle or value) bounded by the contract's timeout.
// Returns { code, errors } or null.
function executionCredentialProblem(contract, credential, at) {
	if (contract.credentials === "none" && credential !== null)
		return {
			code: EXTERNAL_INVALID_CODE,
			errors: [
				`effect ${JSON.stringify(contract.id)} declares credentials "none"; no credential boundary rides this execution`,
			],
		};
	if (contract.credentials === "scoped") {
		if (credential === null)
			return {
				code: EXTERNAL_INVALID_CODE,
				errors: [
					`effect ${JSON.stringify(contract.id)} declares scoped credentials; the execution binds a purpose/scope/expiry credential boundary (never a handle or value)`,
				],
			};
		const boundary = credentialBoundaryProblem(credential, "credential", at, contract.timeoutMs);
		if (boundary !== null)
			return {
				code: isCredentialLeakProblem(boundary) ? CREDENTIAL_LEAK_CODE : EXTERNAL_INVALID_CODE,
				errors: [boundary],
			};
	}
	return null;
}

// The retry/idempotency guards for one request's attempt history: a
// duplicate execution id refuses, ANY committed attempt blocks forever
// (an older unknown that was reconciled to committed must not be bypassed
// by a newer failed retry), an open attempt settles first, and an
// unconfirmed outcome (attempted/unknown) retries only through a contract
// declared idempotent. Returns { code, errors } or null.
function executionRetryProblem(fold, proposal, contract, executionId) {
	if (fold.some((entry) => entry.id === executionId))
		return {
			code: EXTERNAL_INVALID_CODE,
			errors: [`execution ${JSON.stringify(executionId)} already exists; open a new execution id`],
		};
	const attempts = fold.filter((entry) => entry.request === proposal.id);
	const committed = attempts.find((entry) => entry.outcome === "committed");
	if (committed)
		return {
			code: EXTERNAL_INVALID_CODE,
			errors: [
				`request ${JSON.stringify(proposal.id)} already committed externally (execution ${JSON.stringify(committed.id)}); a retry never creates a duplicate external record`,
			],
		};
	const latest = attempts.length > 0 ? attempts[attempts.length - 1] : null;
	if (latest === null) return null;
	if (latest.status === "prepared")
		return {
			code: EXTERNAL_INVALID_CODE,
			errors: [
				`execution ${JSON.stringify(latest.id)} is still open for this request; settle it before retrying`,
			],
		};
	// failed/denied re-execute freely; an unconfirmed outcome
	// (attempted/unknown) may already have landed externally, so
	// only a contract declared idempotent may retry through it.
	if (["attempted", "unknown"].includes(latest.outcome) && contract.idempotency !== "idempotent")
		return {
			code: EXTERNAL_INVALID_CODE,
			errors: [
				`request ${JSON.stringify(proposal.id)} has an unconfirmed ${JSON.stringify(latest.outcome)} outcome and the contract declares at-most-once; reconcile with independent Evidence instead of retrying`,
			],
		};
	return null;
}

// The prepared execution event copies the executed operation, target,
// scope, and Adapter pin only from the reviewed contract snapshot —
// caller input contributes ids and the bounded credential boundary.
function executionEventBodyFor(input, proposal, contract, credential, at) {
	return {
		kind: "execution",
		schemaVersion: EXTERNAL_SCHEMA_VERSION,
		at,
		id: input.id,
		request: proposal.id,
		effect: proposal.effect,
		adapter: proposal.adapter,
		operation: contract.operation,
		target: proposal.target,
		scope: proposal.scope,
		idempotency: contract.idempotency,
		timeoutMs: contract.timeoutMs,
		credential:
			credential === null
				? null
				: {
						purpose: credential.purpose,
						scope: credential.scope,
						expiresAt: credential.expiresAt,
					},
	};
}

/**
 * Prepare one execution for an AUTHORIZED request: the executed
 * operation, target, scope, and Adapter pin come only from the reviewed
 * contract snapshot — caller input can never supply a command,
 * executable, or URL. The request content is re-derived one last time so
 * changed external semantics refuse even after authorization, and the
 * credential boundary stores purpose/scope/expiry only.
 */
function executeExternalEffect(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(EXTERNAL_INVALID_CODE, ["execute input must be an object"]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(EXTERNAL_INVALID_CODE, ["now must be a valid clock"]);
	const at = now.toISOString();
	const inputClosed = unknownFieldProblem(input, ["id", "request", "credential"], "execute input");
	if (inputClosed !== null) return fail(EXTERNAL_INVALID_CODE, [inputClosed]);
	for (const field of ["id", "request"]) {
		if (!isNonEmptyString(input[field]))
			return fail(EXTERNAL_INVALID_CODE, [`${field} must be a non-empty string`]);
		const leak = credentialLeakProblem(input[field], field);
		if (leak !== null) return fail(CREDENTIAL_LEAK_CODE, [leak]);
	}
	let proposal;
	try {
		proposal = showExternalProposal(cwd, input.request);
	} catch (err) {
		return fail(err.amberCode || PROPOSAL_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (proposal === null)
		return fail(EXTERNAL_NOT_FOUND_CODE, [
			`proposal ${JSON.stringify(input.request)} does not exist`,
		]);
	if (proposal.status !== "authorized")
		return fail(EXTERNAL_INVALID_CODE, [
			`proposal ${JSON.stringify(input.request)} is not authorized; execution follows authorization`,
		]);
	const derived = deriveRequestContent(cwd, proposal.effect, proposal.payloadHash);
	if (derived.problem) return fail(derived.problem.code, derived.problem.errors);
	if (derived.notFound) return fail(EXTERNAL_DRIFT_CODE, [derived.notFound]);
	if (derived.drift) return fail(EXTERNAL_DRIFT_CODE, [derived.drift]);
	if (derived.content.requestHash !== proposal.requestHash)
		return fail(EXTERNAL_DRIFT_CODE, [
			`proposal ${JSON.stringify(input.request)} no longer matches what was authorized; propose and review a fresh request`,
		]);
	let contract;
	try {
		contract = showExternalEffect(cwd, proposal.effect.id, proposal.effect.version);
	} catch (err) {
		return fail(err.amberCode || EXTERNAL_CORRUPT_CODE, [err.message || String(err)]);
	}
	const credential = input.credential ?? null;
	const credentialProblem = executionCredentialProblem(contract, credential, at);
	if (credentialProblem !== null) return fail(credentialProblem.code, credentialProblem.errors);
	return appendLedgerEvent(
		cwd,
		EXECUTION_LEDGER,
		executionEventBodyFor(input, proposal, contract, credential, at),
		(fold) => {
			const problem = executionRetryProblem(fold, proposal, contract, input.id);
			return problem === null ? null : fail(problem.code, problem.errors);
		},
		(fold) => fold.find((entry) => entry.id === input.id),
	);
}

/**
 * Settle one execution from the Adapter's declared result receipt. The
 * receipt declares; Amber derives the terminal outcome and records both.
 * Settled outcomes never re-settle, and credential-looking material in
 * any field refuses before anything is written.
 */
function settleExternalExecution(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input)) return fail(EXTERNAL_INVALID_CODE, ["settle input must be an object"]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(EXTERNAL_INVALID_CODE, ["now must be a valid clock"]);
	const inputClosed = unknownFieldProblem(
		input,
		["id", "externalRecordId", "requestDigest", "responseDigest", "declared"],
		"settle input",
	);
	if (inputClosed !== null) return fail(EXTERNAL_INVALID_CODE, [inputClosed]);
	if (!isNonEmptyString(input.id))
		return fail(EXTERNAL_INVALID_CODE, ["id must be a non-empty string"]);
	const idLeak = credentialLeakProblem(input.id, "id");
	if (idLeak !== null) return fail(CREDENTIAL_LEAK_CODE, [idLeak]);
	const receipt = {
		externalRecordId: input.externalRecordId ?? null,
		requestDigest: input.requestDigest,
		responseDigest: input.responseDigest ?? null,
		declared: input.declared,
	};
	const shape = settlementReceiptProblem(receipt, "receipt");
	if (shape !== null) return fail(EXTERNAL_INVALID_CODE, [shape]);
	if (receipt.externalRecordId !== null) {
		const leak = credentialLeakProblem(receipt.externalRecordId, "receipt.externalRecordId");
		if (leak !== null) return fail(CREDENTIAL_LEAK_CODE, [leak]);
	}
	const derived = deriveOutcome(receipt);
	if (derived.problem) return fail(EXTERNAL_INVALID_CODE, [derived.problem]);
	return appendLedgerEvent(
		cwd,
		EXECUTION_LEDGER,
		{
			kind: "settlement",
			schemaVersion: EXTERNAL_SCHEMA_VERSION,
			at: now.toISOString(),
			id: input.id,
			externalRecordId: receipt.externalRecordId,
			requestDigest: receipt.requestDigest,
			responseDigest: receipt.responseDigest,
			declared: receipt.declared,
			outcome: derived.outcome,
		},
		(fold) => {
			const execution = fold.find((entry) => entry.id === input.id) ?? null;
			if (execution === null)
				return fail(EXTERNAL_NOT_FOUND_CODE, [
					`execution ${JSON.stringify(input.id)} does not exist`,
				]);
			if (execution.status !== "prepared")
				return fail(EXTERNAL_INVALID_CODE, [
					`execution ${JSON.stringify(input.id)} is already settled; settled outcomes never re-settle`,
				]);
			return null;
		},
		(fold) => fold.find((entry) => entry.id === input.id),
	);
}

// One request commits at most once: while a retry is open or another
// attempt already committed, an unknown outcome cannot also become
// committed. Returns { code, errors } or null.
function reconciliationSiblingProblem(fold, execution) {
	const sibling = fold.find(
		(entry) =>
			entry.request === execution.request &&
			entry.id !== execution.id &&
			(entry.status === "prepared" || entry.outcome === "committed"),
	);
	if (!sibling) return null;
	return {
		code: EXTERNAL_INVALID_CODE,
		errors: [
			`execution ${JSON.stringify(sibling.id)} for the same request is ${sibling.status === "prepared" ? "still open" : "already committed"}; a request commits at most once`,
		],
	};
}

// Reconciliation Evidence must exist and come from a producer independent
// of the approver who authorized the request. Independence is enforced at
// write time by design: the event records the evidence REFERENCE (the
// receipt itself carries the producer snapshot in its own ledger), and
// the hash chain protects the recorded reference from rewrites.
// Returns { code, errors } or null.
function reconciliationIndependenceProblem(cwd, execution, evidenceId, now) {
	let evidence;
	try {
		evidence = showEvidence(cwd, evidenceId);
	} catch (err) {
		return { code: err.amberCode || EXEC_CORRUPT_CODE, errors: [err.message || String(err)] };
	}
	if (evidence === null)
		return {
			code: EXTERNAL_INVALID_CODE,
			errors: [
				`evidence ${JSON.stringify(evidenceId)} is not recorded; an unknown result becomes committed only through recorded reconciliation Evidence`,
			],
		};
	let approverId;
	try {
		const proposal = showExternalProposal(cwd, execution.request);
		const approval =
			proposal?.authorization == null
				? null
				: showApproval(cwd, proposal.authorization.approvalId, { now });
		approverId = approval?.approver?.id ?? null;
	} catch (err) {
		return { code: err.amberCode || PROPOSAL_CORRUPT_CODE, errors: [err.message || String(err)] };
	}
	if (approverId === null)
		return {
			code: EXEC_CORRUPT_CODE,
			errors: [
				`execution ${JSON.stringify(execution.id)} cannot resolve the authorizing approver; reconciliation requires the recorded authorization chain`,
			],
		};
	if (evidence.producer.id === approverId)
		return {
			code: EXTERNAL_INVALID_CODE,
			errors: [
				`evidence ${JSON.stringify(evidenceId)} was produced by the authorizing approver ${JSON.stringify(approverId)}; reconciliation requires an independent producer`,
			],
		};
	return null;
}

/**
 * Reconcile one unknown outcome to committed — the only path, and only
 * through recorded Evidence from a producer independent of the approver
 * who authorized the request.
 */
function reconcileExternalExecution(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(EXTERNAL_INVALID_CODE, ["reconcile input must be an object"]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(EXTERNAL_INVALID_CODE, ["now must be a valid clock"]);
	const inputClosed = unknownFieldProblem(
		input,
		["id", "evidence", "externalRecordId"],
		"reconcile input",
	);
	if (inputClosed !== null) return fail(EXTERNAL_INVALID_CODE, [inputClosed]);
	for (const field of ["id", "evidence"]) {
		if (!isNonEmptyString(input[field]))
			return fail(EXTERNAL_INVALID_CODE, [`${field} must be a non-empty string`]);
		const leak = credentialLeakProblem(input[field], field);
		if (leak !== null) return fail(CREDENTIAL_LEAK_CODE, [leak]);
	}
	const recordSlug = slugProblem(input.externalRecordId, "externalRecordId");
	if (recordSlug !== null) return fail(EXTERNAL_INVALID_CODE, [recordSlug]);
	const leak = credentialLeakProblem(input.externalRecordId, "externalRecordId");
	if (leak !== null) return fail(CREDENTIAL_LEAK_CODE, [leak]);
	return appendLedgerEvent(
		cwd,
		EXECUTION_LEDGER,
		{
			kind: "reconciliation",
			schemaVersion: EXTERNAL_SCHEMA_VERSION,
			at: now.toISOString(),
			id: input.id,
			evidence: input.evidence,
			externalRecordId: input.externalRecordId,
		},
		(fold) => {
			const execution = fold.find((entry) => entry.id === input.id) ?? null;
			if (execution === null)
				return fail(EXTERNAL_NOT_FOUND_CODE, [
					`execution ${JSON.stringify(input.id)} does not exist`,
				]);
			if (execution.status !== "settled" || execution.outcome !== "unknown")
				return fail(EXTERNAL_INVALID_CODE, [
					`execution ${JSON.stringify(input.id)} has outcome ${JSON.stringify(execution.outcome ?? execution.status)}; reconciliation is the only path from unknown to committed`,
				]);
			const sibling = reconciliationSiblingProblem(fold, execution);
			if (sibling !== null) return fail(sibling.code, sibling.errors);
			const independence = reconciliationIndependenceProblem(cwd, execution, input.evidence, now);
			if (independence !== null) return fail(independence.code, independence.errors);
			return null;
		},
		(fold) => fold.find((entry) => entry.id === input.id),
	);
}

function showExternalExecution(cwd, id) {
	return foldExecutions(cwd).find((entry) => entry.id === id) ?? null;
}

function listExternalExecutions(cwd, { request = null } = {}) {
	return foldExecutions(cwd).filter((entry) => request === null || entry.request === request);
}

// ---------------------------------------------------------------------------
// F056 T4 (#291) — compensation effects & the transactions projection.
// External state history stays complete: compensation is a NEW governed
// effect riding the full proposal/authorization/execution pipeline, and
// the compensated linkage exists only in the read-time projection — the
// original outcome is never rewritten.
// ---------------------------------------------------------------------------

/**
 * Open a compensation proposal for one committed (or failed-partial)
 * execution. The compensating effect is exactly the one the ORIGINAL
 * contract declared — an irreversible contract refuses — and the new
 * proposal records the original execution id as its compensates linkage,
 * then rides the normal T2/T3 pipeline (own requestHash, own
 * authorization, own execution, own receipt).
 */
function compensateExternalEffect(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(EXTERNAL_INVALID_CODE, ["compensate input must be an object"]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime()))
		return fail(EXTERNAL_INVALID_CODE, ["now must be a valid clock"]);
	const inputClosed = unknownFieldProblem(
		input,
		["id", "execution", "payloadHash"],
		"compensate input",
	);
	if (inputClosed !== null) return fail(EXTERNAL_INVALID_CODE, [inputClosed]);
	for (const field of ["id", "execution"]) {
		if (!isNonEmptyString(input[field]))
			return fail(EXTERNAL_INVALID_CODE, [`${field} must be a non-empty string`]);
		const leak = credentialLeakProblem(input[field], field);
		if (leak !== null) return fail(CREDENTIAL_LEAK_CODE, [leak]);
	}
	if (!SHA256_PATTERN.test(input.payloadHash ?? ""))
		return fail(EXTERNAL_INVALID_CODE, [
			"payloadHash must be a sha256:<64-hex> string — the canonical hash of the exact compensating payload under review",
		]);
	let original;
	try {
		original = showExternalExecution(cwd, input.execution);
	} catch (err) {
		return fail(err.amberCode || EXEC_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (original === null)
		return fail(EXTERNAL_NOT_FOUND_CODE, [
			`execution ${JSON.stringify(input.execution)} does not exist`,
		]);
	if (!["committed", "failed"].includes(original.outcome))
		return fail(EXTERNAL_INVALID_CODE, [
			`execution ${JSON.stringify(input.execution)} has outcome ${JSON.stringify(original.outcome ?? original.status)}; only a committed or failed effect compensates — an unknown outcome reconciles first, and attempted or denied outcomes retry through the same request`,
		]);
	let contract;
	try {
		contract = showExternalEffect(cwd, original.effect.id, original.effect.version);
	} catch (err) {
		return fail(err.amberCode || EXTERNAL_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (contract === null)
		return fail(EXTERNAL_CORRUPT_CODE, [
			`execution ${JSON.stringify(input.execution)} references effect ${JSON.stringify(original.effect.id)}@${original.effect.version} that the registry no longer resolves`,
		]);
	if (contract.compensation.kind === "irreversible")
		return fail(EXTERNAL_INVALID_CODE, [
			`effect ${JSON.stringify(contract.id)}@${contract.version} declares irreversibility; an irreversible contract refuses compensation — the recorded outcome stands`,
		]);
	// Compensation rides exactly the declared compensating effect at its
	// current head — never a caller-chosen operation.
	let head;
	try {
		head = showExternalEffect(cwd, contract.compensation.effect);
	} catch (err) {
		return fail(err.amberCode || EXTERNAL_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (head === null)
		return fail(EXTERNAL_INVALID_CODE, [
			`compensating effect ${JSON.stringify(contract.compensation.effect)} is not registered; register the declared compensation contract before compensating`,
		]);
	const derived = deriveRequestContent(
		cwd,
		{ id: head.id, version: head.version },
		input.payloadHash,
	);
	if (derived.problem) return fail(derived.problem.code, derived.problem.errors);
	if (derived.notFound) return fail(EXTERNAL_NOT_FOUND_CODE, [derived.notFound]);
	if (derived.drift) return fail(EXTERNAL_INVALID_CODE, [derived.drift]);
	// Deliberate ruling: ONE compensation lineage per original, whatever
	// state it reaches — external state history stays complete and a
	// second undo can never race the first. A failed compensation
	// execution retries under the same proposal; a compensation that
	// dead-ends is a governance decision recorded in the lineage.
	return appendProposal(cwd, input.id, derived.content, input.execution, now, (fold) => {
		const existing = fold.find((entry) => entry.compensates === input.execution);
		if (existing)
			return fail(EXTERNAL_INVALID_CODE, [
				`execution ${JSON.stringify(input.execution)} already has compensation proposal ${JSON.stringify(existing.id)}; one compensation lineage per original — external state history stays complete`,
			]);
		return null;
	});
}

/**
 * The read-time transactions projection: every execution joined with its
 * compensation lineage. Nothing here writes — the original outcome is
 * never rewritten, and `compensated` flips only when a compensating
 * execution actually committed.
 */
function listExternalTransactions(cwd, { request = null } = {}) {
	const proposals = foldProposals(cwd);
	const executions = foldExecutions(cwd);
	return executions
		.filter((entry) => request === null || entry.request === request)
		.map((entry) => {
			const lineage = proposals.find((proposal) => proposal.compensates === entry.id) ?? null;
			if (lineage === null) return { ...entry, compensatedBy: null, compensated: false };
			const committed =
				executions.find(
					(candidate) => candidate.request === lineage.id && candidate.outcome === "committed",
				) ?? null;
			return {
				...entry,
				compensatedBy: {
					proposal: lineage.id,
					requestHash: lineage.requestHash,
					status: lineage.status,
					execution: committed === null ? null : committed.id,
					// A reconciled compensation became committed at its
					// reconciliation, not at the earlier unknown settlement.
					settledAt:
						committed === null
							? null
							: committed.reconciliation === null
								? committed.settlement.at
								: committed.reconciliation.at,
				},
				compensated: committed !== null,
			};
		});
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
	DECLARED_STATUSES,
	EXECUTION_OUTCOMES,
	executionsPath,
	executeExternalEffect,
	settleExternalExecution,
	reconcileExternalExecution,
	showExternalExecution,
	listExternalExecutions,
	compensateExternalEffect,
	listExternalTransactions,
};
