"use strict";

// F052 T1 (#255) — controlled Runner & capability registry.
//
// A registered Runner is an EXTERNAL executor identity: Amber records who may
// execute, at which version and integrity digest, and which closed operation
// capabilities it supports — it never spawns anything itself (ADR-0022).
// Capabilities are closed records (declared effects, path scope shape,
// timeout bound, credential requirement, rollback declaration); there is no
// command field anywhere, so callers can never smuggle shell text through
// the registry. Registration is a human-approved governance mutation: every
// event binds a committed human Decision whose principal is verified against
// the Principal registry, and a Decision is single-use across the ledger.

const crypto = require("node:crypto");
const path = require("node:path");

const { appendJSONL, readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { typedError } = require("./error-catalog");
const { listArtifactRevisions } = require("./canonical-artifacts");
const { showApproval, consumeApproval } = require("./approval-registry");
const { canonicalJson } = require("./context-hash");
const {
	GENESIS_HASH,
	chainHash,
	chainHeadHash,
	acquireLedgerLock,
	appendWithinCeiling: sharedAppendWithinCeiling,
} = require("./registry-ledger");

const RUNNER_REGISTRY_SCHEMA_VERSION = 1;
const SUPPORTED_RUNNER_REGISTRY_SCHEMA_VERSIONS = Object.freeze([1]);
const DEFAULT_MAX_RUNNER_REGISTRY_BYTES = 1024 * 1024;
const LOCK_STALE_MS = 30_000;

// The closed effect vocabulary capabilities declare. Risk derivation (T2)
// and environment profiles (T3) reason over these facts, so a free-text
// effect would let a caller invent an authority class.
const EFFECT_KINDS = Object.freeze([
	"read",
	"prepare",
	"diagnose",
	"write-target",
	"deploy",
	"rollback",
]);
const CREDENTIAL_REQUIREMENTS = Object.freeze(["none", "scoped"]);
// Human-only authority slots, mirroring the F050/F051 decision contract.
const RUNNER_DECISION_KINDS = Object.freeze(["acceptance", "approval"]);

const INVALID_CODE = "AMBER_E_RUNNER_INVALID";
const EXISTS_CODE = "AMBER_E_RUNNER_EXISTS";
const NOT_FOUND_CODE = "AMBER_E_RUNNER_NOT_FOUND";
const VERSION_DRIFT_CODE = "AMBER_E_RUNNER_VERSION_DRIFT";
const INTEGRITY_MISMATCH_CODE = "AMBER_E_RUNNER_INTEGRITY_MISMATCH";
const CAPABILITY_EXISTS_CODE = "AMBER_E_RUNNER_CAPABILITY_EXISTS";
const CORRUPT_CODE = "AMBER_E_RUNNER_REGISTRY_CORRUPT";
const LOCK_CODE = "AMBER_E_RUNNER_REGISTRY_LOCK";
const SIZE_CEILING_CODE = "AMBER_E_RUNNER_REGISTRY_SIZE_CEILING";

const RUNNER_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"version",
	"integrityDigest",
	"owner",
	"decision",
	"prevHash",
	"hash",
]);
const CAPABILITY_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"runnerId",
	"runnerVersion",
	"name",
	"capabilityVersion",
	"effects",
	"pathPrefixes",
	"timeoutMsMax",
	"credentialRequirement",
	"rollback",
	"decision",
	"prevHash",
	"hash",
]);
const DECISION_FIELDS = Object.freeze(["identity", "revision", "decisionKind", "principal"]);
const RUNNER_INPUT_FIELDS = Object.freeze([
	"id",
	"version",
	"integrityDigest",
	"owner",
	"decision",
]);
const CAPABILITY_INPUT_FIELDS = Object.freeze([
	"runnerId",
	"runnerVersion",
	"name",
	"capabilityVersion",
	"effects",
	"pathPrefixes",
	"timeoutMsMax",
	"credentialRequirement",
	"rollback",
	"decision",
]);

const INTEGRITY_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
// Dotted lowercase words, e.g. "deploy.staging-web" — a NAME, never a command.
const CAPABILITY_NAME_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;

function registryPath(cwd) {
	return statePathForCreate(cwd, "runner", "registry.jsonl");
}

function runnerCorrupt(message) {
	return typedError(CORRUPT_CODE, message);
}

function acquireRunnerLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(registryPath(cwd)),
		lockName: "registry.lock",
		conflictCode: LOCK_CODE,
		corruptCode: CORRUPT_CODE,
		label: "runner registry",
		staleMs: LOCK_STALE_MS,
	});
}

function appendRunnerWithinCeiling(cwd, event) {
	return sharedAppendWithinCeiling({
		ledgerPath: registryPath(cwd),
		event,
		envName: "AMBER_RUNNER_MAX_REGISTRY_BYTES",
		defaultBytes: DEFAULT_MAX_RUNNER_REGISTRY_BYTES,
		label: "runner registry",
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

function decisionShapeProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, DECISION_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(value.identity)) return `${label}.identity must be a non-empty string`;
	if (!Number.isInteger(value.revision) || value.revision < 1)
		return `${label}.revision must be a positive integer`;
	if (!RUNNER_DECISION_KINDS.includes(value.decisionKind))
		return `${label}.decisionKind must be one of ${RUNNER_DECISION_KINDS.join(", ")}`;
	if (!isNonEmptyString(value.principal)) return `${label}.principal must be a non-empty string`;
	return null;
}

function effectsProblem(effects, label) {
	if (!Array.isArray(effects) || effects.length === 0)
		return `${label} must be a non-empty array of registered effects`;
	const seen = new Set();
	for (const effect of effects) {
		if (!EFFECT_KINDS.includes(effect))
			return `${label} carries unregistered effect ${JSON.stringify(effect)}; the closed vocabulary is ${EFFECT_KINDS.join(", ")}`;
		if (seen.has(effect)) return `${label} repeats effect ${JSON.stringify(effect)}`;
		seen.add(effect);
	}
	return null;
}

function pathPrefixesProblem(pathPrefixes, label) {
	if (pathPrefixes === null) return null;
	if (!Array.isArray(pathPrefixes) || pathPrefixes.length === 0)
		return `${label} must be null or a non-empty array of path prefixes`;
	for (const prefix of pathPrefixes) {
		if (!isNonEmptyString(prefix)) return `${label} entries must be non-empty strings`;
	}
	return null;
}

// Shape-only validation for one stored event per kind (string | null);
// fold-state checks (hash chain, duplicates, unknown runner) stay in the
// fold walk.
function runnerEventProblem(event, lineIndex) {
	const closed = closedFieldProblem(event, RUNNER_EVENT_FIELDS, `runner event ${lineIndex}`);
	if (closed !== null) return closed;
	for (const field of ["at", "id", "version", "owner"]) {
		if (!isNonEmptyString(event[field]))
			return `runner event ${lineIndex}.${field} must be a non-empty string`;
	}
	if (!INTEGRITY_DIGEST_PATTERN.test(event.integrityDigest))
		return `runner event ${lineIndex}.integrityDigest must be a sha256:<64-hex> string`;
	return decisionShapeProblem(event.decision, `runner event ${lineIndex}.decision`);
}

function capabilityEventProblem(event, lineIndex) {
	const closed = closedFieldProblem(event, CAPABILITY_EVENT_FIELDS, `runner event ${lineIndex}`);
	if (closed !== null) return closed;
	for (const field of ["at", "runnerId", "runnerVersion", "name", "capabilityVersion"]) {
		if (!isNonEmptyString(event[field]))
			return `runner event ${lineIndex}.${field} must be a non-empty string`;
	}
	if (!CAPABILITY_NAME_PATTERN.test(event.name))
		return `runner event ${lineIndex}.name must match ${CAPABILITY_NAME_PATTERN}; a capability is a registered name, never command text`;
	const effects = effectsProblem(event.effects, `runner event ${lineIndex}.effects`);
	if (effects !== null) return effects;
	const prefixes = pathPrefixesProblem(
		event.pathPrefixes,
		`runner event ${lineIndex}.pathPrefixes`,
	);
	if (prefixes !== null) return prefixes;
	if (!Number.isInteger(event.timeoutMsMax) || event.timeoutMsMax < 1)
		return `runner event ${lineIndex}.timeoutMsMax must be a positive integer`;
	if (!CREDENTIAL_REQUIREMENTS.includes(event.credentialRequirement))
		return `runner event ${lineIndex}.credentialRequirement must be one of ${CREDENTIAL_REQUIREMENTS.join(", ")}`;
	if (!isNonEmptyString(event.rollback))
		return `runner event ${lineIndex}.rollback must be a non-empty declaration ("none" when the capability has no compensation)`;
	return decisionShapeProblem(event.decision, `runner event ${lineIndex}.decision`);
}

function runnerKey(id, version) {
	return `${id}@${version}`;
}

function capabilityKey(runnerId, runnerVersion, name, capabilityVersion) {
	return `${runnerId}@${runnerVersion}/${name}@${capabilityVersion}`;
}

function foldRunnerRegistry(cwd) {
	const events = readLedgerFailClosed(registryPath(cwd), CORRUPT_CODE, "runner registry");
	let prevHash = GENESIS_HASH;
	const runners = [];
	const capabilities = [];
	const runnerVersions = new Set();
	const capabilityKeys = new Set();
	events.forEach((event, index) => {
		const lineIndex = index + 1;
		if (!isPlainObject(event)) throw runnerCorrupt(`runner event ${lineIndex} is not an object`);
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash)
			throw runnerCorrupt(`runner event ${lineIndex} breaks the hash chain`);
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash)
			throw runnerCorrupt(
				`runner event ${lineIndex} carries a hash that does not match its content`,
			);
		if (!SUPPORTED_RUNNER_REGISTRY_SCHEMA_VERSIONS.includes(event.schemaVersion))
			throw runnerCorrupt(
				`runner event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		if (event.kind === "runner") {
			const problem = runnerEventProblem(event, lineIndex);
			if (problem !== null) throw runnerCorrupt(problem);
			const key = runnerKey(event.id, event.version);
			if (runnerVersions.has(key))
				throw runnerCorrupt(`runner ${JSON.stringify(key)} is registered more than once`);
			runnerVersions.add(key);
			const { prevHash: _prev, hash: _hash, ...body } = event;
			runners.push({ ...body, index });
		} else if (event.kind === "capability") {
			const problem = capabilityEventProblem(event, lineIndex);
			if (problem !== null) throw runnerCorrupt(problem);
			if (!runnerVersions.has(runnerKey(event.runnerId, event.runnerVersion)))
				throw runnerCorrupt(
					`runner event ${lineIndex} registers a capability for unknown runner ${JSON.stringify(runnerKey(event.runnerId, event.runnerVersion))}`,
				);
			const key = capabilityKey(
				event.runnerId,
				event.runnerVersion,
				event.name,
				event.capabilityVersion,
			);
			if (capabilityKeys.has(key))
				throw runnerCorrupt(`capability ${JSON.stringify(key)} is registered more than once`);
			capabilityKeys.add(key);
			const { prevHash: _prev, hash: _hash, ...body } = event;
			capabilities.push({ ...body, index });
		} else {
			throw runnerCorrupt(
				`runner event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
			);
		}
		prevHash = event.hash;
	});
	return { runners, capabilities };
}

// Registration authority: a committed human acceptance/approval Decision
// scoped to null (the registry is repository-global), carrying a verified
// principal snapshot. Mirrors the F051 cutover decision contract.
function resolveRegistryDecision(cwd, decision) {
	let revisions;
	try {
		revisions = listArtifactRevisions(cwd);
	} catch (err) {
		return {
			ok: false,
			code: err.amberCode || "AMBER_E_ARTIFACT_JOURNAL_CORRUPT",
			errors: [err.message || String(err)],
		};
	}
	const match = revisions.find(
		(revision) =>
			revision.type === "decision" &&
			revision.identity === decision.identity &&
			revision.revision === decision.revision,
	);
	if (!match)
		return {
			ok: false,
			code: INVALID_CODE,
			errors: [
				`decision ${JSON.stringify(decision.identity)}@${decision.revision} is not a committed Decision artifact`,
			],
		};
	if ((match.scope ?? null) !== null)
		return {
			ok: false,
			code: INVALID_CODE,
			errors: [
				`decision ${JSON.stringify(decision.identity)}@${decision.revision} is scoped to ${JSON.stringify(match.scope)}; runner registration is repository-global and binds an unscoped Decision`,
			],
		};
	if (!RUNNER_DECISION_KINDS.includes(match.decisionKind))
		return {
			ok: false,
			code: INVALID_CODE,
			errors: [
				`runner registration requires a human acceptance or approval Decision; ${JSON.stringify(decision.identity)}@${decision.revision} carries decisionKind ${JSON.stringify(match.decisionKind)}`,
			],
		};
	const principal = match.principal?.id;
	if (!isNonEmptyString(principal))
		return {
			ok: false,
			code: INVALID_CODE,
			errors: [
				`decision ${JSON.stringify(decision.identity)}@${decision.revision} carries no verified principal snapshot`,
			],
		};
	return {
		ok: true,
		decision: {
			identity: decision.identity,
			revision: decision.revision,
			decisionKind: match.decisionKind,
			principal,
		},
	};
}

// A registry Decision is single-use across the whole ledger: one human
// approval authorizes exactly one registration event.
function registryDecisionSpentBy({ runners, capabilities }, decision) {
	const spender = [...runners, ...capabilities].find(
		(record) =>
			record.decision.identity === decision.identity &&
			record.decision.revision === decision.revision,
	);
	if (!spender) return null;
	return spender.kind === "runner"
		? runnerKey(spender.id, spender.version)
		: capabilityKey(
				spender.runnerId,
				spender.runnerVersion,
				spender.name,
				spender.capabilityVersion,
			);
}

function decisionInputProblem(decision) {
	if (!isPlainObject(decision)) return `decision must be an object carrying identity and revision`;
	const unknown = unknownFieldProblem(decision, ["identity", "revision"], "decision");
	if (unknown !== null) return unknown;
	if (!isNonEmptyString(decision.identity)) return `decision.identity must be a non-empty string`;
	if (!Number.isInteger(decision.revision) || decision.revision < 1)
		return `decision.revision must be a positive integer`;
	return null;
}

function runnerAppendFailure(err) {
	return {
		ok: false,
		code: err.amberCode || CORRUPT_CODE,
		record: null,
		errors: [err.message || String(err)],
	};
}

// Guard contract: any non-null guard result is returned verbatim without
// appending.
function appendRegistryEvent(cwd, body, guard) {
	let release;
	try {
		release = acquireRunnerLock(cwd);
	} catch (err) {
		return runnerAppendFailure(err);
	}
	try {
		let folded;
		try {
			folded = foldRunnerRegistry(cwd);
		} catch (err) {
			return runnerAppendFailure(err);
		}
		const guardVerdict = guard(folded);
		if (guardVerdict !== null) return guardVerdict;
		let prevHash;
		try {
			prevHash = chainHeadHash(registryPath(cwd), CORRUPT_CODE, "runner registry");
		} catch (err) {
			return runnerAppendFailure(err);
		}
		const event = { ...body, prevHash, hash: chainHash(body, prevHash) };
		let ceiling;
		try {
			ceiling = appendRunnerWithinCeiling(cwd, event);
		} catch (err) {
			return runnerAppendFailure(err);
		}
		if (ceiling.wouldExceed)
			return {
				ok: false,
				code: SIZE_CEILING_CODE,
				record: null,
				errors: [`runner registry event would exceed ${ceiling.ceiling} bytes`],
			};
		try {
			appendJSONL(registryPath(cwd), event);
		} catch (err) {
			return runnerAppendFailure(err);
		}
		const { prevHash: _prev, hash: _hash, ...record } = event;
		return { ok: true, code: null, record, errors: [] };
	} finally {
		release();
	}
}

function registerRunner(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input)) return fail(INVALID_CODE, ["runner input must be an object"]);
	const inputClosed = unknownFieldProblem(input, RUNNER_INPUT_FIELDS, "runner input");
	if (inputClosed !== null) return fail(INVALID_CODE, [inputClosed]);
	for (const field of ["id", "version", "owner"]) {
		if (!isNonEmptyString(input[field]))
			return fail(INVALID_CODE, [`${field} must be a non-empty string`]);
	}
	if (!INTEGRITY_DIGEST_PATTERN.test(input.integrityDigest ?? ""))
		return fail(INVALID_CODE, ["integrityDigest must be a sha256:<64-hex> string"]);
	const decisionProblem = decisionInputProblem(input.decision);
	if (decisionProblem !== null) return fail(INVALID_CODE, [decisionProblem]);
	const resolved = resolveRegistryDecision(cwd, input.decision);
	if (!resolved.ok) return fail(resolved.code, resolved.errors);
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	return appendRegistryEvent(
		cwd,
		{
			kind: "runner",
			schemaVersion: RUNNER_REGISTRY_SCHEMA_VERSION,
			at,
			id: input.id,
			version: input.version,
			integrityDigest: input.integrityDigest,
			owner: input.owner,
			decision: resolved.decision,
		},
		(folded) => {
			const key = runnerKey(input.id, input.version);
			if (folded.runners.some((runner) => runnerKey(runner.id, runner.version) === key))
				return fail(EXISTS_CODE, [
					`runner ${JSON.stringify(key)} is already registered; a new build registers a new version`,
				]);
			const spentBy = registryDecisionSpentBy(folded, input.decision);
			if (spentBy !== null)
				return fail(INVALID_CODE, [
					`decision ${JSON.stringify(input.decision.identity)}@${input.decision.revision} already authorized ${JSON.stringify(spentBy)}; a registration Decision is single-use`,
				]);
			return null;
		},
	);
}

function registerRunnerCapability(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input)) return fail(INVALID_CODE, ["capability input must be an object"]);
	const inputClosed = unknownFieldProblem(input, CAPABILITY_INPUT_FIELDS, "capability input");
	if (inputClosed !== null) return fail(INVALID_CODE, [inputClosed]);
	for (const field of ["runnerId", "runnerVersion", "name", "capabilityVersion"]) {
		if (!isNonEmptyString(input[field]))
			return fail(INVALID_CODE, [`${field} must be a non-empty string`]);
	}
	if (!CAPABILITY_NAME_PATTERN.test(input.name))
		return fail(INVALID_CODE, [
			`name ${JSON.stringify(input.name)} must match ${CAPABILITY_NAME_PATTERN}; a capability is a registered name, never command text`,
		]);
	const effects = effectsProblem(input.effects, "effects");
	if (effects !== null) return fail(INVALID_CODE, [effects]);
	const pathPrefixes = input.pathPrefixes ?? null;
	const prefixes = pathPrefixesProblem(pathPrefixes, "pathPrefixes");
	if (prefixes !== null) return fail(INVALID_CODE, [prefixes]);
	if (!Number.isInteger(input.timeoutMsMax) || input.timeoutMsMax < 1)
		return fail(INVALID_CODE, ["timeoutMsMax must be a positive integer"]);
	if (!CREDENTIAL_REQUIREMENTS.includes(input.credentialRequirement))
		return fail(INVALID_CODE, [
			`credentialRequirement must be one of ${CREDENTIAL_REQUIREMENTS.join(", ")}`,
		]);
	if (!isNonEmptyString(input.rollback))
		return fail(INVALID_CODE, [
			`rollback must be a non-empty declaration ("none" when the capability has no compensation)`,
		]);
	const decisionProblem = decisionInputProblem(input.decision);
	if (decisionProblem !== null) return fail(INVALID_CODE, [decisionProblem]);
	const resolved = resolveRegistryDecision(cwd, input.decision);
	if (!resolved.ok) return fail(resolved.code, resolved.errors);
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	return appendRegistryEvent(
		cwd,
		{
			kind: "capability",
			schemaVersion: RUNNER_REGISTRY_SCHEMA_VERSION,
			at,
			runnerId: input.runnerId,
			runnerVersion: input.runnerVersion,
			name: input.name,
			capabilityVersion: input.capabilityVersion,
			effects: input.effects,
			pathPrefixes,
			timeoutMsMax: input.timeoutMsMax,
			credentialRequirement: input.credentialRequirement,
			rollback: input.rollback,
			decision: resolved.decision,
		},
		(folded) => {
			const versions = folded.runners.filter((runner) => runner.id === input.runnerId);
			if (versions.length === 0)
				return fail(NOT_FOUND_CODE, [`runner ${JSON.stringify(input.runnerId)} is not registered`]);
			if (!versions.some((runner) => runner.version === input.runnerVersion))
				return fail(VERSION_DRIFT_CODE, [
					`runner ${JSON.stringify(input.runnerId)} has no registered version ${JSON.stringify(input.runnerVersion)}; a capability binds one registered runner version`,
				]);
			const key = capabilityKey(
				input.runnerId,
				input.runnerVersion,
				input.name,
				input.capabilityVersion,
			);
			if (
				folded.capabilities.some(
					(capability) =>
						capabilityKey(
							capability.runnerId,
							capability.runnerVersion,
							capability.name,
							capability.capabilityVersion,
						) === key,
				)
			)
				return fail(CAPABILITY_EXISTS_CODE, [
					`capability ${JSON.stringify(key)} is already registered; a changed contract registers a new capabilityVersion`,
				]);
			const spentBy = registryDecisionSpentBy(folded, input.decision);
			if (spentBy !== null)
				return fail(INVALID_CODE, [
					`decision ${JSON.stringify(input.decision.identity)}@${input.decision.revision} already authorized ${JSON.stringify(spentBy)}; a registration Decision is single-use`,
				]);
			return null;
		},
	);
}

/**
 * Resolve one runner identity fail-closed: the id must be registered, the
 * version must be a registered version of that id (drift is its own
 * verdict), and the integrity digest must match the registered one — an
 * unknown or drifted executor holds no execution identity.
 */
function resolveRunner(cwd, { id, version, integrityDigest } = {}) {
	const fail = (code, errors) => ({ ok: false, code, runner: null, errors });
	for (const [field, value] of [
		["id", id],
		["version", version],
		["integrityDigest", integrityDigest],
	]) {
		if (!isNonEmptyString(value))
			return fail(INVALID_CODE, [`${field} must be a non-empty string`]);
	}
	const { runners } = foldRunnerRegistry(cwd);
	const versions = runners.filter((runner) => runner.id === id);
	if (versions.length === 0)
		return fail(NOT_FOUND_CODE, [`runner ${JSON.stringify(id)} is not registered`]);
	const match = versions.find((runner) => runner.version === version);
	if (!match)
		return fail(VERSION_DRIFT_CODE, [
			`runner ${JSON.stringify(id)} has no registered version ${JSON.stringify(version)} (registered: ${versions.map((runner) => runner.version).join(", ")}); version drift holds no execution identity`,
		]);
	if (match.integrityDigest !== integrityDigest)
		return fail(INTEGRITY_MISMATCH_CODE, [
			`runner ${JSON.stringify(id)}@${version} integrity digest does not match the registered digest; an unverified executor fails closed`,
		]);
	return { ok: true, code: null, runner: match, errors: [] };
}

// The latest registered version of one runner id plus every capability
// registered for it, or null.
function showRunner(cwd, id) {
	const { runners, capabilities } = foldRunnerRegistry(cwd);
	const versions = runners.filter((runner) => runner.id === id);
	if (versions.length === 0) return null;
	return {
		...versions[versions.length - 1],
		versions: versions.map((runner) => runner.version),
		capabilities: capabilities.filter((capability) => capability.runnerId === id),
	};
}

function listRunners(cwd) {
	return foldRunnerRegistry(cwd).runners;
}

function listRunnerCapabilities(cwd, { runnerId = null } = {}) {
	return foldRunnerRegistry(cwd).capabilities.filter(
		(capability) => runnerId === null || capability.runnerId === runnerId,
	);
}

// ── F052 T2 (#256): execution requests & policy-derived risk ──────────────
//
// A request is the closed declaration of ONE intended execution of ONE
// registered capability. Risk derives from the registered capability facts
// through a versioned, code-pinned policy — the request contract has no
// risk field, so a caller can never classify its own operation. Semantic
// refusals are recorded as immutable `denied` events (no attempt
// disappears), and authorization consumes a single-use F050 Approval whose
// subject binds exactly one requestHash and environment.

const RUNNER_REQUEST_SCHEMA_VERSION = 1;
const SUPPORTED_RUNNER_REQUEST_SCHEMA_VERSIONS = Object.freeze([1]);
const DEFAULT_MAX_RUNNER_REQUESTS_BYTES = 1024 * 1024;

const ENVIRONMENTS = Object.freeze(["development", "staging", "production"]);
const REQUEST_STATUSES = Object.freeze(["requested", "authorized", "denied"]);
const RISK_LEVELS = Object.freeze(["low", "medium", "high"]);
const RISK_POLICY_VERSION = 1;
const EFFECT_RISK = Object.freeze({
	read: "low",
	prepare: "low",
	diagnose: "low",
	"write-target": "medium",
	deploy: "high",
	rollback: "high",
});

const CAPABILITY_NOT_FOUND_CODE = "AMBER_E_RUNNER_CAPABILITY_NOT_FOUND";
const REQUEST_INVALID_CODE = "AMBER_E_RUNNER_REQUEST_INVALID";
const REQUEST_EXISTS_CODE = "AMBER_E_RUNNER_REQUEST_EXISTS";
const REQUEST_NOT_FOUND_CODE = "AMBER_E_RUNNER_REQUEST_NOT_FOUND";
const REQUEST_DENIED_CODE = "AMBER_E_RUNNER_REQUEST_DENIED";
const REQUEST_DRIFT_CODE = "AMBER_E_RUNNER_REQUEST_DRIFT";
const APPROVAL_MISMATCH_CODE = "AMBER_E_RUNNER_REQUEST_APPROVAL_MISMATCH";
const REQUEST_CORRUPT_CODE = "AMBER_E_RUNNER_REQUEST_CORRUPT";
const REQUEST_LOCK_CODE = "AMBER_E_RUNNER_REQUEST_LOCK";
const REQUEST_SIZE_CEILING_CODE = "AMBER_E_RUNNER_REQUEST_SIZE_CEILING";

const REQUEST_CAPABILITY_FIELDS = Object.freeze([
	"runnerId",
	"runnerVersion",
	"name",
	"capabilityVersion",
]);
const REQUEST_TARGET_FIELDS = Object.freeze(["repository", "paths"]);
const REQUEST_INPUT_FIELDS = Object.freeze([
	"capability",
	"target",
	"scope",
	"environment",
	"inputHashes",
	"timeoutMs",
	"effects",
	"credentialRequirement",
	"rollback",
]);
const AUTHORIZE_INPUT_FIELDS = Object.freeze([
	"requestHash",
	"approval",
	"decisionIdentity",
	"body",
	"traces",
	"scope",
]);
const REQUESTED_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"requestHash",
	"capability",
	"target",
	"scope",
	"environment",
	"inputHashes",
	"timeoutMs",
	"effects",
	"credentialRequirement",
	"rollback",
	"riskPolicyVersion",
	"risk",
	"approvalBinding",
	"prevHash",
	"hash",
]);
const DENIED_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"capability",
	"target",
	"scope",
	"environment",
	"reason",
	"prevHash",
	"hash",
]);
const AUTHORIZED_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"requestHash",
	"approvalId",
	"decision",
	"prevHash",
	"hash",
]);
const AUTHORIZED_DECISION_FIELDS = Object.freeze(["identity", "revision"]);

function requestsPath(cwd) {
	return statePathForCreate(cwd, "runner", "requests.jsonl");
}

function requestCorrupt(message) {
	return typedError(REQUEST_CORRUPT_CODE, message);
}

function acquireRequestLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(requestsPath(cwd)),
		lockName: "requests.lock",
		conflictCode: REQUEST_LOCK_CODE,
		corruptCode: REQUEST_CORRUPT_CODE,
		label: "runner request ledger",
		staleMs: LOCK_STALE_MS,
	});
}

function appendRequestWithinCeiling(cwd, event) {
	return sharedAppendWithinCeiling({
		ledgerPath: requestsPath(cwd),
		event,
		envName: "AMBER_RUNNER_MAX_REQUESTS_BYTES",
		defaultBytes: DEFAULT_MAX_RUNNER_REQUESTS_BYTES,
		label: "runner request ledger",
	});
}

function sha256Bytes(buffer) {
	return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

// Normalized posix form for prefix confinement, mirroring the adapter
// registry's allowed-path discipline so ".." and separator spellings
// cannot escape a declared prefix.
function normalizedRequestPath(value) {
	const normalized = path.posix.normalize(String(value).replace(/\\/g, "/"));
	return normalized === "." ? "" : normalized;
}

function underPrefix(candidate, prefix) {
	const root = normalizedRequestPath(prefix).replace(/\/$/, "");
	const actual = normalizedRequestPath(candidate);
	return root.length > 0 && (actual === root || actual.startsWith(`${root}/`));
}

// Risk classifies the REGISTERED capability's declared effects — the
// authority class a request draws on — never the caller's subset. An
// effect the pinned policy does not map refuses (null) instead of silently
// classifying low.
function riskOf(effects) {
	let highest = 0;
	for (const effect of effects) {
		const level = RISK_LEVELS.indexOf(EFFECT_RISK[effect]);
		if (level === -1) return null;
		highest = Math.max(highest, level);
	}
	return RISK_LEVELS[highest];
}

function requestHashOf(request) {
	return sha256Bytes(Buffer.from(canonicalJson(JSON.stringify(request))));
}

function approvalBindingOf(environment, requestHash) {
	return `runner-request:${environment}:${requestHash}`;
}

function requestCapabilityProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, REQUEST_CAPABILITY_FIELDS, label);
	if (closed !== null) return closed;
	for (const field of REQUEST_CAPABILITY_FIELDS) {
		if (!isNonEmptyString(value[field])) return `${label}.${field} must be a non-empty string`;
	}
	return null;
}

function requestTargetProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, REQUEST_TARGET_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(value.repository)) return `${label}.repository must be a non-empty string`;
	if (!Array.isArray(value.paths) || value.paths.length === 0)
		return `${label}.paths must be a non-empty array of exact target paths`;
	for (const entry of value.paths) {
		if (!isNonEmptyString(entry)) return `${label}.paths entries must be non-empty strings`;
	}
	return null;
}

function inputHashesProblem(value, label) {
	if (!Array.isArray(value)) return `${label} must be an array of sha256:<64-hex> input hashes`;
	for (const entry of value) {
		if (!INTEGRITY_DIGEST_PATTERN.test(entry ?? ""))
			return `${label} entries must be sha256:<64-hex> strings`;
	}
	return null;
}

// The capability/target/scope/environment context shared by requested and
// denied events (and request input).
function requestContextProblem(value, label) {
	const capability = requestCapabilityProblem(value.capability, `${label}.capability`);
	if (capability !== null) return capability;
	const target = requestTargetProblem(value.target, `${label}.target`);
	if (target !== null) return target;
	if (value.scope !== null && !isNonEmptyString(value.scope))
		return `${label}.scope must be null or a non-empty string`;
	if (!ENVIRONMENTS.includes(value.environment))
		return `${label}.environment must be one of ${ENVIRONMENTS.join(", ")}`;
	return null;
}

// The shape shared by request input and the stored requested event body.
function requestShapeProblem(value, label) {
	const context = requestContextProblem(value, label);
	if (context !== null) return context;
	const hashes = inputHashesProblem(value.inputHashes, `${label}.inputHashes`);
	if (hashes !== null) return hashes;
	if (!Number.isInteger(value.timeoutMs) || value.timeoutMs < 1)
		return `${label}.timeoutMs must be a positive integer`;
	const effects = effectsProblem(value.effects, `${label}.effects`);
	if (effects !== null) return effects;
	if (!CREDENTIAL_REQUIREMENTS.includes(value.credentialRequirement))
		return `${label}.credentialRequirement must be one of ${CREDENTIAL_REQUIREMENTS.join(", ")}`;
	if (!isNonEmptyString(value.rollback))
		return `${label}.rollback must be a non-empty declaration ("none" when the capability has no compensation)`;
	return null;
}

function requestedEventProblem(event, lineIndex) {
	const closed = closedFieldProblem(
		event,
		REQUESTED_EVENT_FIELDS,
		`runner request event ${lineIndex}`,
	);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at))
		return `runner request event ${lineIndex}.at must be a non-empty string`;
	if (!INTEGRITY_DIGEST_PATTERN.test(event.requestHash ?? ""))
		return `runner request event ${lineIndex}.requestHash must be a sha256:<64-hex> string`;
	const shape = requestShapeProblem(event, `runner request event ${lineIndex}`);
	if (shape !== null) return shape;
	if (!Number.isInteger(event.riskPolicyVersion) || event.riskPolicyVersion < 1)
		return `runner request event ${lineIndex}.riskPolicyVersion must be a positive integer`;
	if (!RISK_LEVELS.includes(event.risk))
		return `runner request event ${lineIndex}.risk must be one of ${RISK_LEVELS.join(", ")}`;
	if (event.approvalBinding !== approvalBindingOf(event.environment, event.requestHash))
		return `runner request event ${lineIndex}.approvalBinding does not match its environment and requestHash`;
	return null;
}

function deniedEventProblem(event, lineIndex) {
	const closed = closedFieldProblem(
		event,
		DENIED_EVENT_FIELDS,
		`runner request event ${lineIndex}`,
	);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at))
		return `runner request event ${lineIndex}.at must be a non-empty string`;
	const context = requestContextProblem(event, `runner request event ${lineIndex}`);
	if (context !== null) return context;
	if (!isNonEmptyString(event.reason))
		return `runner request event ${lineIndex}.reason must be a non-empty string`;
	return null;
}

function authorizedEventProblem(event, lineIndex) {
	const closed = closedFieldProblem(
		event,
		AUTHORIZED_EVENT_FIELDS,
		`runner request event ${lineIndex}`,
	);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at))
		return `runner request event ${lineIndex}.at must be a non-empty string`;
	if (!INTEGRITY_DIGEST_PATTERN.test(event.requestHash ?? ""))
		return `runner request event ${lineIndex}.requestHash must be a sha256:<64-hex> string`;
	if (!isNonEmptyString(event.approvalId))
		return `runner request event ${lineIndex}.approvalId must be a non-empty string`;
	if (!isPlainObject(event.decision))
		return `runner request event ${lineIndex}.decision must be an object`;
	const decisionClosed = closedFieldProblem(
		event.decision,
		AUTHORIZED_DECISION_FIELDS,
		`runner request event ${lineIndex}.decision`,
	);
	if (decisionClosed !== null) return decisionClosed;
	if (!isNonEmptyString(event.decision.identity))
		return `runner request event ${lineIndex}.decision.identity must be a non-empty string`;
	if (!Number.isInteger(event.decision.revision) || event.decision.revision < 1)
		return `runner request event ${lineIndex}.decision.revision must be a positive integer`;
	return null;
}

function foldRunnerRequests(cwd) {
	const events = readLedgerFailClosed(requestsPath(cwd), REQUEST_CORRUPT_CODE, "runner requests");
	let prevHash = GENESIS_HASH;
	const requests = [];
	const denials = [];
	const byHash = new Map();
	events.forEach((event, index) => {
		const lineIndex = index + 1;
		if (!isPlainObject(event))
			throw requestCorrupt(`runner request event ${lineIndex} is not an object`);
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash)
			throw requestCorrupt(`runner request event ${lineIndex} breaks the hash chain`);
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash)
			throw requestCorrupt(
				`runner request event ${lineIndex} carries a hash that does not match its content`,
			);
		if (!SUPPORTED_RUNNER_REQUEST_SCHEMA_VERSIONS.includes(event.schemaVersion))
			throw requestCorrupt(
				`runner request event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		if (event.kind === "requested") {
			const problem = requestedEventProblem(event, lineIndex);
			if (problem !== null) throw requestCorrupt(problem);
			if (byHash.has(event.requestHash))
				throw requestCorrupt(
					`request ${JSON.stringify(event.requestHash)} is recorded more than once`,
				);
			const { prevHash: _prev, hash: _hash, ...body } = event;
			const record = { ...body, index, authorization: null };
			byHash.set(event.requestHash, record);
			requests.push(record);
		} else if (event.kind === "denied") {
			const problem = deniedEventProblem(event, lineIndex);
			if (problem !== null) throw requestCorrupt(problem);
			const { prevHash: _prev, hash: _hash, ...body } = event;
			denials.push({ ...body, index });
		} else if (event.kind === "authorized") {
			const problem = authorizedEventProblem(event, lineIndex);
			if (problem !== null) throw requestCorrupt(problem);
			const record = byHash.get(event.requestHash);
			if (!record)
				throw requestCorrupt(
					`runner request event ${lineIndex} authorizes unknown request ${JSON.stringify(event.requestHash)}`,
				);
			if (record.authorization !== null)
				throw requestCorrupt(
					`runner request event ${lineIndex} authorizes ${JSON.stringify(event.requestHash)} twice`,
				);
			record.authorization = {
				at: event.at,
				approvalId: event.approvalId,
				decision: event.decision,
			};
		} else {
			throw requestCorrupt(
				`runner request event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
			);
		}
		prevHash = event.hash;
	});
	return {
		requests: requests.map((record) => ({
			...record,
			status: record.authorization === null ? "requested" : "authorized",
		})),
		denials: denials.map((record) => ({ ...record, status: "denied" })),
	};
}

function requestAppendFailure(err) {
	return {
		ok: false,
		code: err.amberCode || REQUEST_CORRUPT_CODE,
		record: null,
		errors: [err.message || String(err)],
	};
}

// Guard contract: any non-null guard result is returned verbatim without
// appending. On success the ledger is re-folded INSIDE the lock and
// `derive(fold)` picks the caller's derived record.
function appendRequestEvent(cwd, body, guard, derive) {
	let release;
	try {
		release = acquireRequestLock(cwd);
	} catch (err) {
		return requestAppendFailure(err);
	}
	try {
		let folded;
		try {
			folded = foldRunnerRequests(cwd);
		} catch (err) {
			return requestAppendFailure(err);
		}
		const guardVerdict = guard(folded);
		if (guardVerdict !== null) return guardVerdict;
		let prevHash;
		try {
			prevHash = chainHeadHash(requestsPath(cwd), REQUEST_CORRUPT_CODE, "runner requests");
		} catch (err) {
			return requestAppendFailure(err);
		}
		const event = { ...body, prevHash, hash: chainHash(body, prevHash) };
		let ceiling;
		try {
			ceiling = appendRequestWithinCeiling(cwd, event);
		} catch (err) {
			return requestAppendFailure(err);
		}
		if (ceiling.wouldExceed)
			return {
				ok: false,
				code: REQUEST_SIZE_CEILING_CODE,
				record: null,
				errors: [`runner request event would exceed ${ceiling.ceiling} bytes`],
			};
		try {
			appendJSONL(requestsPath(cwd), event);
		} catch (err) {
			return requestAppendFailure(err);
		}
		let record;
		try {
			record = derive(foldRunnerRequests(cwd)) ?? null;
		} catch (err) {
			return requestAppendFailure(err);
		}
		return { ok: true, code: null, record, errors: [] };
	} finally {
		release();
	}
}

// Locate the registered capability the request names, distinguishing
// unknown runner id, version drift, and unregistered capability.
function resolveRequestCapability(cwd, pin) {
	let folded;
	try {
		folded = foldRunnerRegistry(cwd);
	} catch (err) {
		return { ok: false, code: err.amberCode || CORRUPT_CODE, errors: [err.message || String(err)] };
	}
	const versions = folded.runners.filter((runner) => runner.id === pin.runnerId);
	if (versions.length === 0)
		return {
			ok: false,
			code: NOT_FOUND_CODE,
			errors: [`runner ${JSON.stringify(pin.runnerId)} is not registered`],
		};
	if (!versions.some((runner) => runner.version === pin.runnerVersion))
		return {
			ok: false,
			code: VERSION_DRIFT_CODE,
			errors: [
				`runner ${JSON.stringify(pin.runnerId)} has no registered version ${JSON.stringify(pin.runnerVersion)}; a request binds one registered runner version`,
			],
		};
	const capability = folded.capabilities.find(
		(entry) =>
			capabilityKey(entry.runnerId, entry.runnerVersion, entry.name, entry.capabilityVersion) ===
			capabilityKey(pin.runnerId, pin.runnerVersion, pin.name, pin.capabilityVersion),
	);
	if (!capability)
		return {
			ok: false,
			code: CAPABILITY_NOT_FOUND_CODE,
			errors: [
				`capability ${JSON.stringify(capabilityKey(pin.runnerId, pin.runnerVersion, pin.name, pin.capabilityVersion))} is not registered`,
			],
		};
	return { ok: true, capability };
}

// A caller cannot widen what the registered capability declared: an
// undeclared effect, a longer timeout, a different credential class, or a
// path outside the declared prefixes is a policy refusal, not input noise.
function capabilityRefusal(input, capability) {
	for (const effect of input.effects) {
		if (!capability.effects.includes(effect))
			return `request declares effect ${JSON.stringify(effect)} the registered capability does not declare`;
	}
	if (input.timeoutMs > capability.timeoutMsMax)
		return `request timeoutMs ${input.timeoutMs} exceeds the registered capability bound ${capability.timeoutMsMax}`;
	if (input.credentialRequirement !== capability.credentialRequirement)
		return `request credentialRequirement ${JSON.stringify(input.credentialRequirement)} does not match the registered ${JSON.stringify(capability.credentialRequirement)}`;
	if (capability.pathPrefixes !== null) {
		for (const target of input.target.paths) {
			if (!capability.pathPrefixes.some((prefix) => underPrefix(target, prefix)))
				return `request path ${JSON.stringify(target)} falls outside the registered path prefixes ${capability.pathPrefixes.join(", ")}`;
		}
	}
	return null;
}

/**
 * Declare one intended execution. Malformed input refuses without touching
 * the ledger (it has no reliable identity); a well-formed request that the
 * registered capability facts refuse appends an immutable `denied` event —
 * no attempt disappears. A valid request derives its risk from the pinned
 * policy, records a `requested` event, and returns the approval binding a
 * human must grant (`runner-request:<environment>:<requestHash>`).
 */
function submitRunnerRequest(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input)) return fail(REQUEST_INVALID_CODE, ["request input must be an object"]);
	const inputClosed = unknownFieldProblem(input, REQUEST_INPUT_FIELDS, "request input");
	if (inputClosed !== null) return fail(REQUEST_INVALID_CODE, [inputClosed]);
	const shaped = {
		capability: input.capability,
		target: input.target,
		scope: input.scope ?? null,
		environment: input.environment,
		inputHashes: input.inputHashes ?? [],
		timeoutMs: input.timeoutMs,
		effects: input.effects,
		credentialRequirement: input.credentialRequirement,
		rollback: input.rollback,
	};
	const shape = requestShapeProblem(shaped, "request input");
	if (shape !== null) return fail(REQUEST_INVALID_CODE, [shape]);
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	// A shape-valid attempt carries reliable identity, so every refusal
	// from here on is recorded append-only — no attempt disappears.
	const deny = (code, reason) => {
		const appended = appendRequestEvent(
			cwd,
			{
				kind: "denied",
				schemaVersion: RUNNER_REQUEST_SCHEMA_VERSION,
				at,
				capability: shaped.capability,
				target: shaped.target,
				scope: shaped.scope,
				environment: shaped.environment,
				reason,
			},
			() => null,
			(fold) => fold.denials[fold.denials.length - 1],
		);
		if (!appended.ok) return appended;
		return { ok: false, code, record: appended.record, errors: [reason] };
	};
	const resolved = resolveRequestCapability(cwd, shaped.capability);
	if (!resolved.ok) return deny(resolved.code, resolved.errors[0]);
	const refusal = capabilityRefusal(shaped, resolved.capability);
	if (refusal !== null) return deny(REQUEST_DENIED_CODE, refusal);
	// The authority class is the REGISTERED capability's declared effect
	// set, not the caller's subset — requesting one low-risk effect of a
	// deploy-capable capability is still a deploy-class authorization.
	const risk = riskOf(resolved.capability.effects);
	if (risk === null)
		return fail(REQUEST_INVALID_CODE, [
			`capability effects ${resolved.capability.effects.join(", ")} carry no risk classification under policy version ${RISK_POLICY_VERSION}`,
		]);
	const requestHash = requestHashOf({
		schemaVersion: RUNNER_REQUEST_SCHEMA_VERSION,
		...shaped,
		riskPolicyVersion: RISK_POLICY_VERSION,
		risk,
	});
	return appendRequestEvent(
		cwd,
		{
			kind: "requested",
			schemaVersion: RUNNER_REQUEST_SCHEMA_VERSION,
			at,
			requestHash,
			...shaped,
			riskPolicyVersion: RISK_POLICY_VERSION,
			risk,
			approvalBinding: approvalBindingOf(shaped.environment, requestHash),
		},
		(fold) =>
			fold.requests.some((record) => record.requestHash === requestHash)
				? fail(REQUEST_EXISTS_CODE, [
						`request ${JSON.stringify(requestHash)} is already recorded; an identical declaration reuses the pending request`,
					])
				: null,
		(fold) => fold.requests.find((record) => record.requestHash === requestHash),
	);
}

// Stale authority never authorizes: the stored request must re-derive to
// the same hash and risk under the CURRENT pinned policy, and its
// capability must still be registered.
function requestDriftProblem(cwd, record) {
	const resolved = resolveRequestCapability(cwd, record.capability);
	if (!resolved.ok)
		return `the registered capability behind this request is no longer resolvable (${resolved.errors[0]})`;
	if (record.riskPolicyVersion !== RISK_POLICY_VERSION)
		return `request was risk-classified under policy version ${record.riskPolicyVersion}, but the current policy is version ${RISK_POLICY_VERSION}; changed authority makes stale approvals unusable`;
	const risk = riskOf(resolved.capability.effects);
	if (risk === null)
		return `capability effects ${resolved.capability.effects.join(", ")} carry no risk classification under policy version ${RISK_POLICY_VERSION}`;
	const rederived = requestHashOf({
		schemaVersion: record.schemaVersion,
		capability: record.capability,
		target: record.target,
		scope: record.scope,
		environment: record.environment,
		inputHashes: record.inputHashes,
		timeoutMs: record.timeoutMs,
		effects: record.effects,
		credentialRequirement: record.credentialRequirement,
		rollback: record.rollback,
		riskPolicyVersion: record.riskPolicyVersion,
		risk,
	});
	if (rederived !== record.requestHash)
		return `request ${JSON.stringify(record.requestHash)} no longer re-derives under the current policy`;
	return null;
}

/**
 * Authorize one pending request by consuming a single-use F050 Approval
 * whose subject is exactly `runner-request:<environment>:<requestHash>`.
 * Consumption settles the human Decision atomically (F050 contract), so a
 * replayed or drifted authorization fails closed before any state changes.
 */
function authorizeRunnerRequest(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(REQUEST_INVALID_CODE, ["authorize input must be an object"]);
	const inputClosed = unknownFieldProblem(input, AUTHORIZE_INPUT_FIELDS, "authorize input");
	if (inputClosed !== null) return fail(REQUEST_INVALID_CODE, [inputClosed]);
	for (const field of ["requestHash", "approval", "decisionIdentity", "body"]) {
		if (!isNonEmptyString(input[field]))
			return fail(REQUEST_INVALID_CODE, [`${field} must be a non-empty string`]);
	}
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	let consumed = null;
	// The guard completes this object from the consumption receipt before
	// the append hashes the event body.
	const decision = { identity: input.decisionIdentity, revision: 1 };
	const appended = appendRequestEvent(
		cwd,
		{
			kind: "authorized",
			schemaVersion: RUNNER_REQUEST_SCHEMA_VERSION,
			at,
			requestHash: input.requestHash,
			approvalId: input.approval,
			decision,
		},
		(fold) => {
			const record = fold.requests.find((entry) => entry.requestHash === input.requestHash);
			if (!record)
				return fail(REQUEST_NOT_FOUND_CODE, [
					`request ${JSON.stringify(input.requestHash)} is not recorded`,
				]);
			if (record.status !== "requested")
				return fail(REQUEST_EXISTS_CODE, [
					`request ${JSON.stringify(input.requestHash)} is already authorized; an authorization is single-use`,
				]);
			const drift = requestDriftProblem(cwd, record);
			if (drift !== null) return fail(REQUEST_DRIFT_CODE, [drift]);
			let approval;
			try {
				approval = showApproval(cwd, input.approval, { now: opts.now });
			} catch (err) {
				return fail(err.amberCode || REQUEST_CORRUPT_CODE, [err.message || String(err)]);
			}
			if (approval === null)
				return fail(APPROVAL_MISMATCH_CODE, [
					`approval ${JSON.stringify(input.approval)} is not recorded`,
				]);
			if (approval.subject !== record.approvalBinding)
				return fail(APPROVAL_MISMATCH_CODE, [
					`approval ${JSON.stringify(input.approval)} authorizes subject ${JSON.stringify(approval.subject)}, not this request's binding ${JSON.stringify(record.approvalBinding)}; one authorization binds one request hash and environment`,
				]);
			// Consumption is the point of no return: it settles the human
			// Decision atomically under the approval ledger's own lock. A
			// ceiling/write failure AFTER this point leaves the consumed
			// approval and settled Decision as the auditable source of
			// truth for manual recovery.
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
		(fold) => fold.requests.find((entry) => entry.requestHash === input.requestHash),
	);
	if (!appended.ok) return appended;
	return { ...appended, consumption: consumed };
}

function showRunnerRequest(cwd, requestHash) {
	return (
		foldRunnerRequests(cwd).requests.find((record) => record.requestHash === requestHash) ?? null
	);
}

// Every attempt in append order — requested, authorized, and denied alike.
function listRunnerRequests(cwd, { environment = null, status = null } = {}) {
	const fold = foldRunnerRequests(cwd);
	return [...fold.requests, ...fold.denials]
		.sort((left, right) => left.index - right.index)
		.filter(
			(record) =>
				(environment === null || record.environment === environment) &&
				(status === null || record.status === status),
		);
}

module.exports = {
	RUNNER_REGISTRY_SCHEMA_VERSION,
	SUPPORTED_RUNNER_REGISTRY_SCHEMA_VERSIONS,
	DEFAULT_MAX_RUNNER_REGISTRY_BYTES,
	RUNNER_REQUEST_SCHEMA_VERSION,
	SUPPORTED_RUNNER_REQUEST_SCHEMA_VERSIONS,
	DEFAULT_MAX_RUNNER_REQUESTS_BYTES,
	EFFECT_KINDS,
	CREDENTIAL_REQUIREMENTS,
	RUNNER_DECISION_KINDS,
	ENVIRONMENTS,
	REQUEST_STATUSES,
	RISK_LEVELS,
	RISK_POLICY_VERSION,
	EFFECT_RISK,
	GENESIS_HASH,
	chainHash,
	registryPath,
	requestsPath,
	registerRunner,
	registerRunnerCapability,
	resolveRunner,
	showRunner,
	listRunners,
	listRunnerCapabilities,
	submitRunnerRequest,
	authorizeRunnerRequest,
	showRunnerRequest,
	listRunnerRequests,
};
