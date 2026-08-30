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

const { typedError } = require("./error-catalog");
const { listArtifactRevisions } = require("./canonical-artifacts");
const { showApproval, consumeApproval } = require("./approval-registry");
const { showEvidence, RECORDABLE_ASSURANCE } = require("./evidence-receipts");
const {
	GENESIS_HASH,
	chainHash,
	canonicalHashOf,
	findDecisionSpend,
} = require("./registry-ledger");
const { defineLedgerFamily } = require("./ledger-family");

const RUNNER_REGISTRY_SCHEMA_VERSION = 1;
const SUPPORTED_RUNNER_REGISTRY_SCHEMA_VERSIONS = Object.freeze([1]);
const DEFAULT_MAX_RUNNER_REGISTRY_BYTES = 1024 * 1024;

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
	return REGISTRY_LEDGER.path(cwd);
}

function runnerCorrupt(message) {
	return typedError(CORRUPT_CODE, message);
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

function applyRegistryEvent(state, event, lineIndex) {
	if (!SUPPORTED_RUNNER_REGISTRY_SCHEMA_VERSIONS.includes(event.schemaVersion))
		throw runnerCorrupt(
			`runner event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
		);
	if (event.kind === "runner") {
		const problem = runnerEventProblem(event, lineIndex);
		if (problem !== null) throw runnerCorrupt(problem);
		const key = runnerKey(event.id, event.version);
		if (state.runnerVersions.has(key))
			throw runnerCorrupt(`runner ${JSON.stringify(key)} is registered more than once`);
		state.runnerVersions.add(key);
		const { prevHash: _prev, hash: _hash, ...body } = event;
		state.runners.push({ ...body, index: lineIndex - 1 });
	} else if (event.kind === "capability") {
		const problem = capabilityEventProblem(event, lineIndex);
		if (problem !== null) throw runnerCorrupt(problem);
		if (!state.runnerVersions.has(runnerKey(event.runnerId, event.runnerVersion)))
			throw runnerCorrupt(
				`runner event ${lineIndex} registers a capability for unknown runner ${JSON.stringify(runnerKey(event.runnerId, event.runnerVersion))}`,
			);
		const key = capabilityKey(
			event.runnerId,
			event.runnerVersion,
			event.name,
			event.capabilityVersion,
		);
		if (state.capabilityKeys.has(key))
			throw runnerCorrupt(`capability ${JSON.stringify(key)} is registered more than once`);
		state.capabilityKeys.add(key);
		const { prevHash: _prev, hash: _hash, ...body } = event;
		state.capabilities.push({ ...body, index: lineIndex - 1 });
	} else {
		throw runnerCorrupt(
			`runner event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
		);
	}
}

function applyRequestEvent(state, event, lineIndex) {
	if (!SUPPORTED_RUNNER_REQUEST_SCHEMA_VERSIONS.includes(event.schemaVersion))
		throw requestCorrupt(
			`runner request event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
		);
	if (event.kind === "requested") {
		const problem = requestedEventProblem(event, lineIndex);
		if (problem !== null) throw requestCorrupt(problem);
		if (state.byHash.has(event.requestHash))
			throw requestCorrupt(
				`request ${JSON.stringify(event.requestHash)} is recorded more than once`,
			);
		const { prevHash: _prev, hash: _hash, ...body } = event;
		const record = { ...body, index: lineIndex - 1, authorization: null };
		state.byHash.set(event.requestHash, record);
		state.requests.push(record);
	} else if (event.kind === "denied") {
		const problem = deniedEventProblem(event, lineIndex);
		if (problem !== null) throw requestCorrupt(problem);
		const { prevHash: _prev, hash: _hash, ...body } = event;
		state.denials.push({ ...body, index: lineIndex - 1 });
	} else if (event.kind === "authorized") {
		const problem = authorizedEventProblem(event, lineIndex);
		if (problem !== null) throw requestCorrupt(problem);
		const record = state.byHash.get(event.requestHash);
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
}

function applyPreparedExecutionEvent(state, event, lineIndex) {
	const problem = preparedEventProblem(event, lineIndex);
	if (problem !== null) throw executionCorrupt(problem);
	if (state.byHash.has(event.requestHash))
		throw executionCorrupt(
			`runner execution event ${lineIndex} prepares ${JSON.stringify(event.requestHash)} twice`,
		);
	const record = {
		requestHash: event.requestHash,
		runner: event.runner,
		preparedAt: event.at,
		settlement: null,
		aborted: null,
		rollback: null,
		index: lineIndex - 1,
	};
	state.byHash.set(event.requestHash, record);
	state.records.push(record);
}

function applySettledExecutionEvent(state, event, lineIndex) {
	const problem = settledEventProblem(event, lineIndex);
	if (problem !== null) throw executionCorrupt(problem);
	const record = state.byHash.get(event.requestHash);
	if (!record)
		throw executionCorrupt(
			`runner execution event ${lineIndex} settles unprepared ${JSON.stringify(event.requestHash)}`,
		);
	if (record.settlement !== null || record.aborted !== null)
		throw executionCorrupt(
			`runner execution event ${lineIndex} settles ${JSON.stringify(event.requestHash)} after its terminal event`,
		);
	record.settlement = {
		at: event.at,
		outcome: event.outcome,
		reason: event.reason,
		receipt: event.receipt,
		receiptHash: event.receiptHash,
		resultIntegrity: event.resultIntegrity,
	};
}

function applyAbortedExecutionEvent(state, event, lineIndex) {
	const problem = abortedEventProblem(event, lineIndex);
	if (problem !== null) throw executionCorrupt(problem);
	const record = state.byHash.get(event.requestHash);
	if (!record)
		throw executionCorrupt(
			`runner execution event ${lineIndex} aborts unprepared ${JSON.stringify(event.requestHash)}`,
		);
	if (record.settlement !== null || record.aborted !== null)
		throw executionCorrupt(
			`runner execution event ${lineIndex} aborts ${JSON.stringify(event.requestHash)} after its terminal event`,
		);
	record.aborted = { at: event.at, reason: event.reason };
}

function applyRolledBackExecutionEvent(state, event, lineIndex) {
	const problem = rolledBackEventProblem(event, lineIndex);
	if (problem !== null) throw executionCorrupt(problem);
	const record = state.byHash.get(event.requestHash);
	if (!record)
		throw executionCorrupt(
			`runner execution event ${lineIndex} rolls back unprepared ${JSON.stringify(event.requestHash)}`,
		);
	if (record.settlement === null || record.settlement.outcome !== "committed")
		throw executionCorrupt(
			`runner execution event ${lineIndex} rolls back ${JSON.stringify(event.requestHash)}, which never committed`,
		);
	if (record.rollback !== null)
		throw executionCorrupt(
			`runner execution event ${lineIndex} rolls back ${JSON.stringify(event.requestHash)} twice`,
		);
	record.rollback = { at: event.at, evidence: event.evidence, reason: event.reason };
}

function applyExecutionEvent(state, event, lineIndex) {
	if (!SUPPORTED_RUNNER_EXECUTION_SCHEMA_VERSIONS.includes(event.schemaVersion))
		throw executionCorrupt(
			`runner execution event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
		);
	switch (event.kind) {
		case "prepared":
			return applyPreparedExecutionEvent(state, event, lineIndex);
		case "settled":
			return applySettledExecutionEvent(state, event, lineIndex);
		case "aborted":
			return applyAbortedExecutionEvent(state, event, lineIndex);
		case "rolled-back":
			return applyRolledBackExecutionEvent(state, event, lineIndex);
		default:
			break;
	}
	throw executionCorrupt(
		`runner execution event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
	);
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
	const spent = findDecisionSpend([...runners, ...capabilities], decision, ["decision"]);
	if (spent === null) return null;
	return spent.record.kind === "runner"
		? runnerKey(spent.record.id, spent.record.version)
		: capabilityKey(
				spent.record.runnerId,
				spent.record.runnerVersion,
				spent.record.name,
				spent.record.capabilityVersion,
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

function foldRunnerRegistry(cwd) {
	return REGISTRY_LEDGER.fold(cwd);
}

// Guard contract: any non-null guard result is returned verbatim without
// appending.
function appendRegistryEvent(cwd, body, guard) {
	return REGISTRY_LEDGER.append(cwd, body, guard, (fold) => {
		if (body.kind === "runner")
			return fold.runners.find(
				(runner) => runner.id === body.id && runner.version === body.version,
			);
		return fold.capabilities.find(
			(capability) =>
				capability.runnerId === body.runnerId &&
				capability.runnerVersion === body.runnerVersion &&
				capability.name === body.name &&
				capability.capabilityVersion === body.capabilityVersion,
		);
	});
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
// The versioned, code-pinned environment profiles: closed per-environment
// admission rules judged against the REGISTERED capability's effect set.
// The profile version is bound into every requestHash, so a changed
// profile makes stale approvals unusable (drift), never silently laxer.
const ENVIRONMENT_PROFILE_VERSION = 1;
// Short-lived means bounded: a declared credential handle may live at most
// this long past the submission instant. Part of the profile contract —
// changing it bumps ENVIRONMENT_PROFILE_VERSION.
const CREDENTIAL_MAX_TTL_MS = 24 * 60 * 60 * 1000;
const ENVIRONMENT_PROFILES = Object.freeze({
	// Development is isolated and policy-gated: experiments may write, but
	// only inside a declared isolation scope, and never deploy or roll back.
	development: Object.freeze({
		allowedEffects: Object.freeze(["read", "prepare", "diagnose", "write-target"]),
		requiresIsolatedScope: true,
		rehearsalEffects: Object.freeze([]),
		credentialEffects: Object.freeze([]),
		runbookNamespace: null,
	}),
	// Staging admits only allowlisted deploy/rollback capabilities, and a
	// request drawing on them must carry rollback rehearsal Evidence and a
	// short-lived scoped credential declaration.
	staging: Object.freeze({
		allowedEffects: Object.freeze(["read", "prepare", "diagnose", "deploy", "rollback"]),
		requiresIsolatedScope: false,
		rehearsalEffects: Object.freeze(["deploy", "rollback"]),
		credentialEffects: Object.freeze(["deploy", "rollback"]),
		runbookNamespace: null,
	}),
	// Production grants no generic target-write: preparation, diagnosis,
	// and capabilities registered in the runbook.* namespace (registration
	// is itself a human-approved governance mutation) only.
	production: Object.freeze({
		allowedEffects: Object.freeze(["read", "prepare", "diagnose"]),
		requiresIsolatedScope: false,
		rehearsalEffects: Object.freeze([]),
		credentialEffects: Object.freeze([]),
		runbookNamespace: "runbook.",
	}),
});
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
const REQUEST_SEPARATION_CODE = "AMBER_E_RUNNER_REQUEST_SEPARATION";
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
	"credential",
	"rehearsal",
	"rollback",
]);
const CREDENTIAL_HANDLE_FIELDS = Object.freeze(["handle", "purpose", "scope", "expiresAt"]);
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
	"credential",
	"rehearsal",
	"rollback",
	"riskPolicyVersion",
	"risk",
	"environmentProfileVersion",
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
	return REQUEST_LEDGER.path(cwd);
}

function requestCorrupt(message) {
	return typedError(REQUEST_CORRUPT_CODE, message);
}

function foldRunnerRequests(cwd) {
	return REQUEST_LEDGER.fold(cwd);
}

function appendRequestEvent(cwd, body, guard, derive) {
	return REQUEST_LEDGER.append(cwd, body, guard, derive);
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

// A credential declaration is an OPAQUE handle (reference, purpose, scope,
// expiry) — the closed field set is how "no secret values in ledgers or
// receipts" is enforced structurally: there is no field a secret could
// ride in.
function credentialHandleProblem(value, requirement, label) {
	if (requirement === "none") {
		if (value !== null) return `${label} must be null when credentialRequirement is "none"`;
		return null;
	}
	if (!isPlainObject(value))
		return `${label} is required when credentialRequirement is "scoped": a closed opaque handle {handle, purpose, scope, expiresAt}`;
	const closed = closedFieldProblem(value, CREDENTIAL_HANDLE_FIELDS, label);
	if (closed !== null) return closed;
	for (const field of CREDENTIAL_HANDLE_FIELDS) {
		if (!isNonEmptyString(value[field])) return `${label}.${field} must be a non-empty string`;
	}
	if (Number.isNaN(Date.parse(value.expiresAt)))
		return `${label}.expiresAt must be an ISO-8601 timestamp`;
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
	const credential = credentialHandleProblem(
		value.credential,
		value.credentialRequirement,
		`${label}.credential`,
	);
	if (credential !== null) return credential;
	if (value.rehearsal !== null && !isNonEmptyString(value.rehearsal))
		return `${label}.rehearsal must be null or a recorded Evidence receipt id`;
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
	if (!Number.isInteger(event.environmentProfileVersion) || event.environmentProfileVersion < 1)
		return `runner request event ${lineIndex}.environmentProfileVersion must be a positive integer`;
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

// Resolve one Evidence receipt fail-closed: a corrupt Evidence ledger
// keeps its own typed code (infrastructure fault, never a policy verdict);
// an absent receipt returns { receipt: null, code: null } for the caller
// to phrase.
function resolveEvidenceReceipt(cwd, id, fallbackCode) {
	try {
		return { receipt: showEvidence(cwd, id), code: null, reason: null };
	} catch (err) {
		return {
			receipt: null,
			code: err.amberCode || fallbackCode,
			reason: err.message || String(err),
		};
	}
}

// A missing rehearsal receipt is a policy refusal (null code).
function rehearsalRefusal(cwd, rehearsal) {
	const resolved = resolveEvidenceReceipt(cwd, rehearsal, REQUEST_CORRUPT_CODE);
	if (resolved.code !== null) return resolved;
	if (resolved.receipt === null)
		return {
			receipt: null,
			code: null,
			reason: `rehearsal ${JSON.stringify(rehearsal)} names no recorded Evidence receipt; rehearse the rollback and record it first (amber evidence record)`,
		};
	return resolved;
}

// The per-environment admission verdict, judged against the REGISTERED
// capability's effect set (the authority class, same basis as risk): a
// profile refusal is environment policy, recorded as a denial.
// null when admitted; { code: null, reason } for a policy denial; a typed
// { code, reason } for an infrastructure fault that must not be recorded
// as a denial.
function environmentRefusal(cwd, shaped, capability, now) {
	const denial = (reason) => ({ code: null, reason });
	const profile = ENVIRONMENT_PROFILES[shaped.environment];
	const runbook =
		profile.runbookNamespace !== null && capability.name.startsWith(profile.runbookNamespace);
	if (!runbook) {
		for (const effect of capability.effects) {
			if (!profile.allowedEffects.includes(effect))
				return denial(
					`capability effect ${JSON.stringify(effect)} is not admitted in ${shaped.environment} (allowed: ${profile.allowedEffects.join(", ")}${profile.runbookNamespace ? `; runbook.* capabilities are the separately approved exception` : ""})`,
				);
		}
	}
	if (profile.requiresIsolatedScope && shaped.scope === null)
		return denial(
			`${shaped.environment} requires an isolated target scope; declare a non-null scope so experiments cannot mutate the main working state`,
		);
	const needsRehearsal = capability.effects.some((effect) =>
		profile.rehearsalEffects.includes(effect),
	);
	if (needsRehearsal && shaped.rehearsal === null)
		return denial(
			`${shaped.environment} admits deploy/rollback capabilities only with rollback rehearsal Evidence; declare --rehearsal <evidence-id>`,
		);
	if (shaped.rehearsal !== null) {
		const rehearsal = rehearsalRefusal(cwd, shaped.rehearsal);
		if (rehearsal.code !== null) return rehearsal;
		if (rehearsal.reason !== null) return denial(rehearsal.reason);
	}
	const needsCredential = capability.effects.some((effect) =>
		profile.credentialEffects.includes(effect),
	);
	if (needsCredential && shaped.credential === null)
		return denial(
			`${shaped.environment} admits deploy/rollback capabilities only with a short-lived scoped credential declaration; the registered capability declares credentialRequirement ${JSON.stringify(capability.credentialRequirement)}`,
		);
	if (shaped.credential !== null) {
		const expiresAt = new Date(shaped.credential.expiresAt);
		if (expiresAt <= now)
			return denial(
				`credential handle ${JSON.stringify(shaped.credential.handle)} expired at ${shaped.credential.expiresAt}; credentials are short-lived and scoped`,
			);
		if (expiresAt.getTime() - now.getTime() > CREDENTIAL_MAX_TTL_MS)
			return denial(
				`credential handle ${JSON.stringify(shaped.credential.handle)} lives past the short-lived bound (${CREDENTIAL_MAX_TTL_MS} ms); declare an expiry within it`,
			);
	}
	return null;
}

/**
 * Declare one intended execution. Malformed input refuses without touching
 * the ledger (it has no reliable identity); a well-formed request that the
 * registered capability facts or the environment profile refuse appends an
 * immutable `denied` event — no attempt disappears. A valid request
 * derives its risk from the pinned policy, records a `requested` event,
 * and returns the approval binding a human must grant
 * (`runner-request:<environment>:<requestHash>`).
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
		credential: input.credential ?? null,
		rehearsal: input.rehearsal ?? null,
		rollback: input.rollback,
	};
	const shape = requestShapeProblem(shaped, "request input");
	if (shape !== null) return fail(REQUEST_INVALID_CODE, [shape]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	const at = now.toISOString();
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
	const environmentProblem = environmentRefusal(cwd, shaped, resolved.capability, now);
	if (environmentProblem !== null) {
		if (environmentProblem.code !== null)
			return fail(environmentProblem.code, [environmentProblem.reason]);
		return deny(REQUEST_DENIED_CODE, environmentProblem.reason);
	}
	// The authority class is the REGISTERED capability's declared effect
	// set, not the caller's subset — requesting one low-risk effect of a
	// deploy-capable capability is still a deploy-class authorization.
	const risk = riskOf(resolved.capability.effects);
	if (risk === null)
		return fail(REQUEST_INVALID_CODE, [
			`capability effects ${resolved.capability.effects.join(", ")} carry no risk classification under policy version ${RISK_POLICY_VERSION}`,
		]);
	const requestHash = canonicalHashOf({
		schemaVersion: RUNNER_REQUEST_SCHEMA_VERSION,
		...shaped,
		riskPolicyVersion: RISK_POLICY_VERSION,
		risk,
		environmentProfileVersion: ENVIRONMENT_PROFILE_VERSION,
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
			environmentProfileVersion: ENVIRONMENT_PROFILE_VERSION,
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
	if (record.environmentProfileVersion !== ENVIRONMENT_PROFILE_VERSION)
		return `request was admitted under environment profile version ${record.environmentProfileVersion}, but the current profile is version ${ENVIRONMENT_PROFILE_VERSION}; changed authority makes stale approvals unusable`;
	const risk = riskOf(resolved.capability.effects);
	if (risk === null)
		return `capability effects ${resolved.capability.effects.join(", ")} carry no risk classification under policy version ${RISK_POLICY_VERSION}`;
	const rederived = canonicalHashOf({
		schemaVersion: record.schemaVersion,
		capability: record.capability,
		target: record.target,
		scope: record.scope,
		environment: record.environment,
		inputHashes: record.inputHashes,
		timeoutMs: record.timeoutMs,
		effects: record.effects,
		credentialRequirement: record.credentialRequirement,
		credential: record.credential,
		rehearsal: record.rehearsal,
		rollback: record.rollback,
		riskPolicyVersion: record.riskPolicyVersion,
		risk,
		environmentProfileVersion: record.environmentProfileVersion,
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
			// Short-lived means short-lived: a credential handle that expired
			// between request and authorization closes the window.
			const authNow = opts.now instanceof Date ? opts.now : new Date();
			if (record.credential !== null && new Date(record.credential.expiresAt) <= authNow)
				return fail(REQUEST_DRIFT_CODE, [
					`credential handle ${JSON.stringify(record.credential.handle)} expired at ${record.credential.expiresAt}; request a fresh handle and a fresh authorization`,
				]);
			if (record.rehearsal !== null) {
				const rehearsal = rehearsalRefusal(cwd, record.rehearsal);
				if (rehearsal.code !== null) return fail(rehearsal.code, [rehearsal.reason]);
				if (rehearsal.reason !== null) return fail(REQUEST_DRIFT_CODE, [rehearsal.reason]);
				// Separation of duties: whoever rehearsed the rollback cannot
				// also be the approver — one side never vouches for itself.
				if (rehearsal.receipt.producer.id === approval.approver.id)
					return fail(REQUEST_SEPARATION_CODE, [
						`approval ${JSON.stringify(input.approval)} was granted by ${JSON.stringify(approval.approver.id)}, who also produced the rehearsal Evidence ${JSON.stringify(record.rehearsal)}; the rehearsing party cannot approve its own rehearsal`,
					]);
			}
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

// ── F052 T4 (#258): execution settlement, receipts & assurance separation ─
//
// Execution settles durably: an authorized request is PREPARED for one
// registered executor, the external Runner submits one result receipt, and
// Amber — never the runner — derives the terminal outcome. Every attempt
// is recorded (attempted/timed-out/failed/committed/rolled-back here;
// denied lives on the request ledger), non-zero exit, signal, timeout, and
// scope mismatch fail explicitly, and sandbox assurance, credential
// assurance, and result integrity stay separate fields so one proof can
// never imply another. Amber spawns nothing (ADR-0022).

const RUNNER_EXECUTION_SCHEMA_VERSION = 1;
const SUPPORTED_RUNNER_EXECUTION_SCHEMA_VERSIONS = Object.freeze([1]);
const DEFAULT_MAX_RUNNER_EXECUTIONS_BYTES = 1024 * 1024;

const EXECUTION_OUTCOMES = Object.freeze([
	"attempted",
	"timed-out",
	"failed",
	"committed",
	"rolled-back",
]);
// The outcomes a settlement event may carry — exactly what deriveOutcome
// can produce (attempted and rolled-back are derived states, never
// settled events).
const SETTLED_OUTCOMES = Object.freeze(["committed", "timed-out", "failed"]);
// The only value writable at settlement: the event binds a canonical hash
// of the exact receipt, and the hash chain fails every read closed on
// tamper. Independent of the runner-CLAIMED assurance fields by design.
const RESULT_INTEGRITY = Object.freeze(["receipt-bound"]);

const EXECUTION_INVALID_CODE = "AMBER_E_RUNNER_EXECUTION_INVALID";
const EXECUTION_EXISTS_CODE = "AMBER_E_RUNNER_EXECUTION_EXISTS";
const EXECUTION_NOT_FOUND_CODE = "AMBER_E_RUNNER_EXECUTION_NOT_FOUND";
const EXECUTION_STATE_CODE = "AMBER_E_RUNNER_EXECUTION_STATE";
const EXECUTION_TIMEOUT_CODE = "AMBER_E_RUNNER_EXECUTION_TIMEOUT";
const EXECUTION_FAILED_CODE = "AMBER_E_RUNNER_EXECUTION_FAILED";
const EXECUTION_SCOPE_CODE = "AMBER_E_RUNNER_EXECUTION_SCOPE";
const EXECUTION_CORRUPT_CODE = "AMBER_E_RUNNER_EXECUTION_CORRUPT";
const EXECUTION_LOCK_CODE = "AMBER_E_RUNNER_EXECUTION_LOCK";
const EXECUTION_SIZE_CEILING_CODE = "AMBER_E_RUNNER_EXECUTION_SIZE_CEILING";

const EXECUTION_RUNNER_FIELDS = Object.freeze(["id", "version", "integrityDigest"]);
const PREPARE_INPUT_FIELDS = Object.freeze(["requestHash", "runner"]);
const SETTLE_INPUT_FIELDS = Object.freeze(["requestHash", "receipt"]);
const ABORT_INPUT_FIELDS = Object.freeze(["requestHash", "reason"]);
const EXECUTION_ROLLBACK_INPUT_FIELDS = Object.freeze(["requestHash", "evidence", "reason"]);
const RESULT_RECEIPT_FIELDS = Object.freeze([
	"runner",
	"exitCode",
	"signal",
	"timedOut",
	"startedAt",
	"finishedAt",
	"durationMs",
	"outputsDigest",
	"scope",
	"sandboxAssurance",
	"credentialAssurance",
]);
const PREPARED_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"requestHash",
	"runner",
	"prevHash",
	"hash",
]);
const SETTLED_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"requestHash",
	"outcome",
	"reason",
	"receipt",
	"receiptHash",
	"resultIntegrity",
	"prevHash",
	"hash",
]);
const ABORTED_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"requestHash",
	"reason",
	"prevHash",
	"hash",
]);
const ROLLED_BACK_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"requestHash",
	"evidence",
	"reason",
	"prevHash",
	"hash",
]);

function executionsPath(cwd) {
	return EXECUTION_LEDGER.path(cwd);
}

function executionCorrupt(message) {
	return typedError(EXECUTION_CORRUPT_CODE, message);
}

function foldRunnerExecutions(cwd) {
	return EXECUTION_LEDGER.fold(cwd);
}

function appendExecutionEvent(cwd, body, guard, derive) {
	return EXECUTION_LEDGER.append(cwd, body, guard, derive);
}

function executionRunnerProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, EXECUTION_RUNNER_FIELDS, label);
	if (closed !== null) return closed;
	for (const field of ["id", "version"]) {
		if (!isNonEmptyString(value[field])) return `${label}.${field} must be a non-empty string`;
	}
	if (!INTEGRITY_DIGEST_PATTERN.test(value.integrityDigest ?? ""))
		return `${label}.integrityDigest must be a sha256:<64-hex> string`;
	return null;
}

// The result receipt an external Runner submits. Assurance fields carry
// the F050 recordable vocabulary: "verified" is never recordable at
// settlement — only an independent verification could ever promote it.
function resultReceiptProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, RESULT_RECEIPT_FIELDS, label);
	if (closed !== null) return closed;
	const runner = executionRunnerProblem(value.runner, `${label}.runner`);
	if (runner !== null) return runner;
	if (value.exitCode !== null && !Number.isInteger(value.exitCode))
		return `${label}.exitCode must be null or an integer`;
	if (value.signal !== null && !isNonEmptyString(value.signal))
		return `${label}.signal must be null or a non-empty string`;
	if (typeof value.timedOut !== "boolean") return `${label}.timedOut must be a boolean`;
	if (value.exitCode === null && value.signal === null && value.timedOut !== true)
		return `${label} carries no termination cause; a result declares an exit code, a signal, or a timeout`;
	for (const field of ["startedAt", "finishedAt"]) {
		if (!isNonEmptyString(value[field]) || Number.isNaN(Date.parse(value[field])))
			return `${label}.${field} must be an ISO-8601 timestamp`;
	}
	if (Date.parse(value.finishedAt) < Date.parse(value.startedAt))
		return `${label}.finishedAt must not precede startedAt`;
	if (!Number.isInteger(value.durationMs) || value.durationMs < 0)
		return `${label}.durationMs must be a non-negative integer`;
	if (value.durationMs > Date.parse(value.finishedAt) - Date.parse(value.startedAt))
		return `${label}.durationMs exceeds the receipt's own startedAt→finishedAt window; a partial or inconsistent result never settles`;
	if (value.outputsDigest !== null && !INTEGRITY_DIGEST_PATTERN.test(value.outputsDigest))
		return `${label}.outputsDigest must be null or a sha256:<64-hex> string`;
	const scope = requestTargetProblem(value.scope, `${label}.scope`);
	if (scope !== null) return scope;
	for (const field of ["sandboxAssurance", "credentialAssurance"]) {
		if (!RECORDABLE_ASSURANCE.includes(value[field]))
			return `${label}.${field} must be one of ${RECORDABLE_ASSURANCE.join(", ")}; "verified" is never recordable at settlement — only an independent verification promotes it`;
	}
	return null;
}

function preparedEventProblem(event, lineIndex) {
	const closed = closedFieldProblem(
		event,
		PREPARED_EVENT_FIELDS,
		`runner execution event ${lineIndex}`,
	);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at))
		return `runner execution event ${lineIndex}.at must be a non-empty string`;
	if (!INTEGRITY_DIGEST_PATTERN.test(event.requestHash ?? ""))
		return `runner execution event ${lineIndex}.requestHash must be a sha256:<64-hex> string`;
	return executionRunnerProblem(event.runner, `runner execution event ${lineIndex}.runner`);
}

function settledEventProblem(event, lineIndex) {
	const closed = closedFieldProblem(
		event,
		SETTLED_EVENT_FIELDS,
		`runner execution event ${lineIndex}`,
	);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at))
		return `runner execution event ${lineIndex}.at must be a non-empty string`;
	if (!INTEGRITY_DIGEST_PATTERN.test(event.requestHash ?? ""))
		return `runner execution event ${lineIndex}.requestHash must be a sha256:<64-hex> string`;
	if (!SETTLED_OUTCOMES.includes(event.outcome))
		return `runner execution event ${lineIndex}.outcome must be one of ${SETTLED_OUTCOMES.join(", ")}`;
	if (event.reason !== null && !isNonEmptyString(event.reason))
		return `runner execution event ${lineIndex}.reason must be null or a non-empty string`;
	const receipt = resultReceiptProblem(
		event.receipt,
		`runner execution event ${lineIndex}.receipt`,
	);
	if (receipt !== null) return receipt;
	if (event.receiptHash !== canonicalHashOf(event.receipt))
		return `runner execution event ${lineIndex}.receiptHash does not match its stored receipt`;
	if (!RESULT_INTEGRITY.includes(event.resultIntegrity))
		return `runner execution event ${lineIndex}.resultIntegrity must be one of ${RESULT_INTEGRITY.join(", ")}`;
	return null;
}

function abortedEventProblem(event, lineIndex) {
	const closed = closedFieldProblem(
		event,
		ABORTED_EVENT_FIELDS,
		`runner execution event ${lineIndex}`,
	);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at))
		return `runner execution event ${lineIndex}.at must be a non-empty string`;
	if (!INTEGRITY_DIGEST_PATTERN.test(event.requestHash ?? ""))
		return `runner execution event ${lineIndex}.requestHash must be a sha256:<64-hex> string`;
	if (!isNonEmptyString(event.reason))
		return `runner execution event ${lineIndex}.reason must be a non-empty string`;
	return null;
}

function rolledBackEventProblem(event, lineIndex) {
	const closed = closedFieldProblem(
		event,
		ROLLED_BACK_EVENT_FIELDS,
		`runner execution event ${lineIndex}`,
	);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at))
		return `runner execution event ${lineIndex}.at must be a non-empty string`;
	if (!INTEGRITY_DIGEST_PATTERN.test(event.requestHash ?? ""))
		return `runner execution event ${lineIndex}.requestHash must be a sha256:<64-hex> string`;
	for (const field of ["evidence", "reason"]) {
		if (!isNonEmptyString(event[field]))
			return `runner execution event ${lineIndex}.${field} must be a non-empty string`;
	}
	return null;
}

// F061 follow-up (#310) — three runner ledgers assembled by
// `defineLedgerFamily` (ADR-0028). Fold is chain-first (no preLink).
// Registry ceiling wording matches the shared default; requests and
// executions declare ceiling.message for the recorded "event would exceed"
// text. Domain apply lives in applyRegistryEvent / applyRequestEvent /
// applyExecutionEvent.
const RUNNER_FAMILY = defineLedgerFamily({
	dir: "runner",
	label: "runner registry",
	ledgers: [
		{
			name: "registry",
			fileName: "registry.jsonl",
			lockName: "registry.lock",
			conflictCode: LOCK_CODE,
			corruptCode: CORRUPT_CODE,
			sizeCeilingCode: SIZE_CEILING_CODE,
			ceiling: {
				envName: "AMBER_RUNNER_MAX_REGISTRY_BYTES",
				defaultBytes: DEFAULT_MAX_RUNNER_REGISTRY_BYTES,
			},
			label: "runner registry",
			eventLabel: "runner",
			fold: {
				init: () => ({
					runners: [],
					capabilities: [],
					runnerVersions: new Set(),
					capabilityKeys: new Set(),
				}),
				apply: applyRegistryEvent,
				result: (state) => ({ runners: state.runners, capabilities: state.capabilities }),
			},
		},
		{
			name: "requests",
			fileName: "requests.jsonl",
			lockName: "requests.lock",
			conflictCode: REQUEST_LOCK_CODE,
			corruptCode: REQUEST_CORRUPT_CODE,
			sizeCeilingCode: REQUEST_SIZE_CEILING_CODE,
			ceiling: {
				envName: "AMBER_RUNNER_MAX_REQUESTS_BYTES",
				defaultBytes: DEFAULT_MAX_RUNNER_REQUESTS_BYTES,
				message: (_event, ceiling) => `runner request event would exceed ${ceiling} bytes`,
			},
			label: "runner request ledger",
			eventLabel: "runner request",
			fold: {
				init: () => ({ requests: [], denials: [], byHash: new Map() }),
				apply: applyRequestEvent,
				result: (state) => ({
					requests: state.requests.map((record) => ({
						...record,
						status: record.authorization === null ? "requested" : "authorized",
					})),
					denials: state.denials.map((record) => ({ ...record, status: "denied" })),
				}),
			},
		},
		{
			name: "executions",
			fileName: "executions.jsonl",
			lockName: "executions.lock",
			conflictCode: EXECUTION_LOCK_CODE,
			corruptCode: EXECUTION_CORRUPT_CODE,
			sizeCeilingCode: EXECUTION_SIZE_CEILING_CODE,
			ceiling: {
				envName: "AMBER_RUNNER_MAX_EXECUTIONS_BYTES",
				defaultBytes: DEFAULT_MAX_RUNNER_EXECUTIONS_BYTES,
				message: (_event, ceiling) => `runner execution event would exceed ${ceiling} bytes`,
			},
			label: "runner execution journal",
			eventLabel: "runner execution",
			fold: {
				init: () => ({ byHash: new Map(), records: [] }),
				apply: applyExecutionEvent,
				result: (state) =>
					state.records.map((record) => ({
						...record,
						status:
							record.rollback !== null
								? "rolled-back"
								: record.settlement !== null
									? record.settlement.outcome
									: "attempted",
						terminal: record.settlement !== null || record.aborted !== null,
					})),
			},
		},
	],
});

const REGISTRY_LEDGER = RUNNER_FAMILY.ledgers.registry;
const REQUEST_LEDGER = RUNNER_FAMILY.ledgers.requests;
const EXECUTION_LEDGER = RUNNER_FAMILY.ledgers.executions;

/**
 * Prepare one authorized request for execution by one registered Runner.
 * The presented executor must BE the runner the request named
 * (id + version), must resolve against the registry (unknown identity,
 * version drift, and integrity mismatch fail closed), and a request hash
 * settles at most one execution lifecycle — a concurrent prepare refuses.
 */
function prepareRunnerExecution(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(EXECUTION_INVALID_CODE, ["prepare input must be an object"]);
	const inputClosed = unknownFieldProblem(input, PREPARE_INPUT_FIELDS, "prepare input");
	if (inputClosed !== null) return fail(EXECUTION_INVALID_CODE, [inputClosed]);
	if (!INTEGRITY_DIGEST_PATTERN.test(input.requestHash ?? ""))
		return fail(EXECUTION_INVALID_CODE, ["requestHash must be a sha256:<64-hex> string"]);
	const runnerProblem = executionRunnerProblem(input.runner, "runner");
	if (runnerProblem !== null) return fail(EXECUTION_INVALID_CODE, [runnerProblem]);
	let request;
	try {
		request = foldRunnerRequests(cwd).requests.find(
			(entry) => entry.requestHash === input.requestHash,
		);
	} catch (err) {
		return fail(err.amberCode || REQUEST_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (!request)
		return fail(EXECUTION_NOT_FOUND_CODE, [
			`request ${JSON.stringify(input.requestHash)} is not recorded`,
		]);
	if (request.status !== "authorized")
		return fail(EXECUTION_STATE_CODE, [
			`request ${JSON.stringify(input.requestHash)} is ${JSON.stringify(request.status)}; execution follows authorization`,
		]);
	if (
		request.capability.runnerId !== input.runner.id ||
		request.capability.runnerVersion !== input.runner.version
	)
		return fail(EXECUTION_INVALID_CODE, [
			`the request names runner ${JSON.stringify(runnerKey(request.capability.runnerId, request.capability.runnerVersion))}; ${JSON.stringify(runnerKey(input.runner.id, input.runner.version))} cannot execute it`,
		]);
	const resolved = resolveRunner(cwd, input.runner);
	if (!resolved.ok) return fail(resolved.code, resolved.errors);
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	return appendExecutionEvent(
		cwd,
		{
			kind: "prepared",
			schemaVersion: RUNNER_EXECUTION_SCHEMA_VERSION,
			at,
			requestHash: input.requestHash,
			runner: input.runner,
		},
		(fold) =>
			fold.some((record) => record.requestHash === input.requestHash)
				? fail(EXECUTION_EXISTS_CODE, [
						`request ${JSON.stringify(input.requestHash)} already entered execution settlement; one authorization settles at most one execution`,
					])
				: null,
		(fold) => fold.find((record) => record.requestHash === input.requestHash),
	);
}

// Amber derives the outcome from the receipt — a runner never classifies
// its own result. First violation wins: timeout, then signal, then exit
// code, then scope confinement.
function deriveOutcome(receipt, request) {
	// The authorized bound is enforced here, never trusted from the claim:
	// a receipt running past request.timeoutMs is timed-out even when the
	// runner says otherwise.
	if (receipt.timedOut === true || receipt.durationMs > request.timeoutMs)
		return {
			outcome: "timed-out",
			code: EXECUTION_TIMEOUT_CODE,
			reason: `runner ran ${receipt.durationMs} ms against the authorized bound of ${request.timeoutMs} ms${receipt.timedOut ? " and reported timeout" : " without reporting timeout"}`,
		};
	if (receipt.signal !== null)
		return {
			outcome: "failed",
			code: EXECUTION_FAILED_CODE,
			reason: `runner terminated by signal ${JSON.stringify(receipt.signal)}`,
		};
	if (receipt.exitCode !== 0)
		return {
			outcome: "failed",
			code: EXECUTION_FAILED_CODE,
			reason: `runner exited non-zero (${receipt.exitCode})`,
		};
	if (receipt.scope.repository !== request.target.repository)
		return {
			outcome: "failed",
			code: EXECUTION_SCOPE_CODE,
			reason: `receipt touches repository ${JSON.stringify(receipt.scope.repository)}, outside the authorized ${JSON.stringify(request.target.repository)}`,
		};
	for (const touched of receipt.scope.paths) {
		if (!request.target.paths.some((granted) => underPrefix(touched, granted)))
			return {
				outcome: "failed",
				code: EXECUTION_SCOPE_CODE,
				reason: `receipt touches path ${JSON.stringify(touched)}, outside the authorized target paths ${request.target.paths.join(", ")}`,
			};
	}
	return { outcome: "committed", code: null, reason: null };
}

/**
 * Settle one prepared execution from the external Runner's result receipt.
 * The receipt's executor pin must equal the prepared pin and still resolve
 * against the registry; a non-committed outcome is RECORDED and returned
 * as its stable code — execution never reports fake success, and no
 * attempt disappears.
 */
function settleRunnerExecution(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(EXECUTION_INVALID_CODE, ["settle input must be an object"]);
	const inputClosed = unknownFieldProblem(input, SETTLE_INPUT_FIELDS, "settle input");
	if (inputClosed !== null) return fail(EXECUTION_INVALID_CODE, [inputClosed]);
	if (!INTEGRITY_DIGEST_PATTERN.test(input.requestHash ?? ""))
		return fail(EXECUTION_INVALID_CODE, ["requestHash must be a sha256:<64-hex> string"]);
	const receiptProblem = resultReceiptProblem(input.receipt, "receipt");
	if (receiptProblem !== null) return fail(EXECUTION_INVALID_CODE, [receiptProblem]);
	let request;
	try {
		request = foldRunnerRequests(cwd).requests.find(
			(entry) => entry.requestHash === input.requestHash,
		);
	} catch (err) {
		return fail(err.amberCode || REQUEST_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (!request)
		return fail(EXECUTION_NOT_FOUND_CODE, [
			`request ${JSON.stringify(input.requestHash)} is not recorded`,
		]);
	const resolved = resolveRunner(cwd, input.receipt.runner);
	if (!resolved.ok) return fail(resolved.code, resolved.errors);
	const verdict = deriveOutcome(input.receipt, request);
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	const appended = appendExecutionEvent(
		cwd,
		{
			kind: "settled",
			schemaVersion: RUNNER_EXECUTION_SCHEMA_VERSION,
			at,
			requestHash: input.requestHash,
			outcome: verdict.outcome,
			reason: verdict.reason,
			receipt: input.receipt,
			receiptHash: canonicalHashOf(input.receipt),
			resultIntegrity: "receipt-bound",
		},
		(fold) => {
			const record = fold.find((entry) => entry.requestHash === input.requestHash);
			if (!record)
				return fail(EXECUTION_STATE_CODE, [
					`request ${JSON.stringify(input.requestHash)} was never prepared; settlement follows preparation`,
				]);
			if (record.terminal)
				return fail(EXECUTION_STATE_CODE, [
					`execution for ${JSON.stringify(input.requestHash)} already settled as ${JSON.stringify(record.status)}; settlement is immutable`,
				]);
			if (
				record.runner.id !== input.receipt.runner.id ||
				record.runner.version !== input.receipt.runner.version ||
				record.runner.integrityDigest !== input.receipt.runner.integrityDigest
			)
				return fail(EXECUTION_INVALID_CODE, [
					`the receipt's executor ${JSON.stringify(runnerKey(input.receipt.runner.id, input.receipt.runner.version))} is not the prepared executor ${JSON.stringify(runnerKey(record.runner.id, record.runner.version))}`,
				]);
			return null;
		},
		(fold) => fold.find((entry) => entry.requestHash === input.requestHash),
	);
	if (!appended.ok) return appended;
	if (verdict.code !== null)
		return { ...appended, ok: false, code: verdict.code, errors: [verdict.reason] };
	return appended;
}

/**
 * Abort one prepared execution that will never produce a result receipt
 * (lost runner, missing receipt). The attempt stays recorded as its own
 * terminal `attempted` state — an abort is bookkeeping, never erasure.
 */
function abortRunnerExecution(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input)) return fail(EXECUTION_INVALID_CODE, ["abort input must be an object"]);
	const inputClosed = unknownFieldProblem(input, ABORT_INPUT_FIELDS, "abort input");
	if (inputClosed !== null) return fail(EXECUTION_INVALID_CODE, [inputClosed]);
	if (!INTEGRITY_DIGEST_PATTERN.test(input.requestHash ?? ""))
		return fail(EXECUTION_INVALID_CODE, ["requestHash must be a sha256:<64-hex> string"]);
	if (!isNonEmptyString(input.reason))
		return fail(EXECUTION_INVALID_CODE, ["reason must be a non-empty string"]);
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	return appendExecutionEvent(
		cwd,
		{
			kind: "aborted",
			schemaVersion: RUNNER_EXECUTION_SCHEMA_VERSION,
			at,
			requestHash: input.requestHash,
			reason: input.reason,
		},
		(fold) => {
			const record = fold.find((entry) => entry.requestHash === input.requestHash);
			if (!record)
				return fail(EXECUTION_NOT_FOUND_CODE, [
					`request ${JSON.stringify(input.requestHash)} was never prepared`,
				]);
			if (record.terminal)
				return fail(EXECUTION_STATE_CODE, [
					`execution for ${JSON.stringify(input.requestHash)} already settled as ${JSON.stringify(record.status)}; an abort never rewrites a settlement`,
				]);
			return null;
		},
		(fold) => fold.find((entry) => entry.requestHash === input.requestHash),
	);
}

/**
 * Record that a COMMITTED execution was rolled back, binding the Evidence
 * of the rollback run. History stays immutable: the committed settlement
 * remains, and the rolled-back outcome is one more append-only fact.
 */
function markRunnerExecutionRolledBack(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(EXECUTION_INVALID_CODE, ["rollback input must be an object"]);
	const inputClosed = unknownFieldProblem(input, EXECUTION_ROLLBACK_INPUT_FIELDS, "rollback input");
	if (inputClosed !== null) return fail(EXECUTION_INVALID_CODE, [inputClosed]);
	if (!INTEGRITY_DIGEST_PATTERN.test(input.requestHash ?? ""))
		return fail(EXECUTION_INVALID_CODE, ["requestHash must be a sha256:<64-hex> string"]);
	for (const field of ["evidence", "reason"]) {
		if (!isNonEmptyString(input[field]))
			return fail(EXECUTION_INVALID_CODE, [`${field} must be a non-empty string`]);
	}
	const evidence = resolveEvidenceReceipt(cwd, input.evidence, EXECUTION_CORRUPT_CODE);
	if (evidence.code !== null) return fail(evidence.code, [evidence.reason]);
	if (evidence.receipt === null)
		return fail(EXECUTION_INVALID_CODE, [
			`evidence ${JSON.stringify(input.evidence)} names no recorded Evidence receipt; record the rollback run first (amber evidence record)`,
		]);
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	return appendExecutionEvent(
		cwd,
		{
			kind: "rolled-back",
			schemaVersion: RUNNER_EXECUTION_SCHEMA_VERSION,
			at,
			requestHash: input.requestHash,
			evidence: input.evidence,
			reason: input.reason,
		},
		(fold) => {
			const record = fold.find((entry) => entry.requestHash === input.requestHash);
			if (!record)
				return fail(EXECUTION_NOT_FOUND_CODE, [
					`request ${JSON.stringify(input.requestHash)} was never prepared`,
				]);
			if (record.settlement === null || record.settlement.outcome !== "committed")
				return fail(EXECUTION_STATE_CODE, [
					`execution for ${JSON.stringify(input.requestHash)} is ${JSON.stringify(record.status)}; only a committed execution can be rolled back`,
				]);
			if (record.rollback !== null)
				return fail(EXECUTION_STATE_CODE, [
					`execution for ${JSON.stringify(input.requestHash)} is already rolled back; history never rewrites`,
				]);
			return null;
		},
		(fold) => fold.find((entry) => entry.requestHash === input.requestHash),
	);
}

function showRunnerExecution(cwd, requestHash) {
	return foldRunnerExecutions(cwd).find((record) => record.requestHash === requestHash) ?? null;
}

function listRunnerExecutions(cwd, { status = null } = {}) {
	return foldRunnerExecutions(cwd).filter((record) => status === null || record.status === status);
}

// The three independently consumable Gate inputs of one settlement — a
// Gate may require any one without implying the others (full Gate-contract
// wiring rides the F053 release surface).
function executionGateInputs(cwd, requestHash) {
	const record = showRunnerExecution(cwd, requestHash);
	if (record === null || record.settlement === null) return null;
	return Object.freeze({
		sandboxAssurance: record.settlement.receipt.sandboxAssurance,
		credentialAssurance: record.settlement.receipt.credentialAssurance,
		resultIntegrity: record.settlement.resultIntegrity,
	});
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
	ENVIRONMENT_PROFILE_VERSION,
	ENVIRONMENT_PROFILES,
	CREDENTIAL_MAX_TTL_MS,
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
	resolveRequestCapability,
	showRunner,
	listRunners,
	listRunnerCapabilities,
	submitRunnerRequest,
	authorizeRunnerRequest,
	showRunnerRequest,
	listRunnerRequests,
	RUNNER_EXECUTION_SCHEMA_VERSION,
	SUPPORTED_RUNNER_EXECUTION_SCHEMA_VERSIONS,
	DEFAULT_MAX_RUNNER_EXECUTIONS_BYTES,
	EXECUTION_OUTCOMES,
	SETTLED_OUTCOMES,
	RESULT_INTEGRITY,
	executionsPath,
	prepareRunnerExecution,
	settleRunnerExecution,
	abortRunnerExecution,
	markRunnerExecutionRolledBack,
	showRunnerExecution,
	listRunnerExecutions,
	executionGateInputs,
};
