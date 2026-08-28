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

const path = require("node:path");

const { appendJSONL, readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { typedError } = require("./error-catalog");
const { listArtifactRevisions } = require("./canonical-artifacts");
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

module.exports = {
	RUNNER_REGISTRY_SCHEMA_VERSION,
	SUPPORTED_RUNNER_REGISTRY_SCHEMA_VERSIONS,
	DEFAULT_MAX_RUNNER_REGISTRY_BYTES,
	EFFECT_KINDS,
	CREDENTIAL_REQUIREMENTS,
	RUNNER_DECISION_KINDS,
	GENESIS_HASH,
	chainHash,
	registryPath,
	registerRunner,
	registerRunnerCapability,
	resolveRunner,
	showRunner,
	listRunners,
	listRunnerCapabilities,
};
