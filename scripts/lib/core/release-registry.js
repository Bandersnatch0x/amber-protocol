"use strict";

// F053 T1 (#274) — release candidate preparation.
//
// A release candidate is the closed, immutable binding of ONE exact Change
// to everything a later authorization may rely on: committed Artifact
// revisions and commit hash, recorded Evidence, per-axis Review findings
// (logic, security, spec compliance — Evidence references by construction,
// so an AI finding can never occupy an approval slot), target environment,
// a versioned release Policy artifact, one registered F052 Runner
// capability pin, the credentials class, and a rollback plan. Preparation
// is a governance write: it never deploys and touches no git state. The
// canonical releaseHash covers the full closed content, so any drift
// invalidates downstream authorization instead of silently retargeting it.

const crypto = require("node:crypto");
const path = require("node:path");

const { appendJSONL, readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { typedError } = require("./error-catalog");
const { ARTIFACT_TYPES, listArtifactRevisions } = require("./canonical-artifacts");
const { showEvidence } = require("./evidence-receipts");
const { showApproval, consumeApproval } = require("./approval-registry");
const { showGateOutcome } = require("./gate-evaluation");
const {
	ENVIRONMENTS,
	CREDENTIAL_REQUIREMENTS,
	resolveRequestCapability,
	showRunnerRequest,
	showRunnerExecution,
} = require("./runner-registry");
const { canonicalJson } = require("./context-hash");
const {
	GENESIS_HASH,
	chainHash,
	chainHeadHash,
	acquireLedgerLock,
	appendWithinCeiling: sharedAppendWithinCeiling,
} = require("./registry-ledger");

const RELEASE_CANDIDATE_SCHEMA_VERSION = 1;
const SUPPORTED_RELEASE_CANDIDATE_SCHEMA_VERSIONS = Object.freeze([1]);
const DEFAULT_MAX_RELEASE_CANDIDATES_BYTES = 1024 * 1024;
const LOCK_STALE_MS = 30_000;

// The review axes a candidate must carry — each a recorded Evidence
// reference, never an approval: AI review supplements code ownership.
const REVIEW_AXES = Object.freeze(["logic", "security", "specCompliance"]);

const RELEASE_INVALID_CODE = "AMBER_E_RELEASE_INVALID";
const RELEASE_EXISTS_CODE = "AMBER_E_RELEASE_EXISTS";
const RELEASE_NOT_FOUND_CODE = "AMBER_E_RELEASE_NOT_FOUND";
const RELEASE_CORRUPT_CODE = "AMBER_E_RELEASE_CORRUPT";
const RELEASE_LOCK_CODE = "AMBER_E_RELEASE_LOCK";
const RELEASE_SIZE_CEILING_CODE = "AMBER_E_RELEASE_SIZE_CEILING";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

const CANDIDATE_INPUT_FIELDS = Object.freeze([
	"releaseId",
	"change",
	"evidence",
	"review",
	"environment",
	"policy",
	"capability",
	"credentialsClass",
	"rollbackPlan",
]);
const CHANGE_FIELDS = Object.freeze(["commit", "artifacts"]);
const ARTIFACT_PIN_FIELDS = Object.freeze(["type", "identity", "revision"]);
const POLICY_PIN_FIELDS = Object.freeze(["identity", "revision"]);
const CAPABILITY_PIN_FIELDS = Object.freeze([
	"runnerId",
	"runnerVersion",
	"name",
	"capabilityVersion",
]);
const PREPARED_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"releaseId",
	"releaseHash",
	"change",
	"evidence",
	"review",
	"environment",
	"policy",
	"capability",
	"credentialsClass",
	"rollbackPlan",
	"prevHash",
	"hash",
]);

function candidatesPath(cwd) {
	return statePathForCreate(cwd, "release", "candidates.jsonl");
}

function releaseCorrupt(message) {
	return typedError(RELEASE_CORRUPT_CODE, message);
}

function acquireReleaseLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(candidatesPath(cwd)),
		lockName: "candidates.lock",
		conflictCode: RELEASE_LOCK_CODE,
		corruptCode: RELEASE_CORRUPT_CODE,
		label: "release candidate ledger",
		staleMs: LOCK_STALE_MS,
	});
}

function appendCandidateWithinCeiling(cwd, event) {
	return sharedAppendWithinCeiling({
		ledgerPath: candidatesPath(cwd),
		event,
		envName: "AMBER_RELEASE_MAX_CANDIDATES_BYTES",
		defaultBytes: DEFAULT_MAX_RELEASE_CANDIDATES_BYTES,
		label: "release candidate ledger",
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

function canonicalHashOf(value) {
	return `sha256:${crypto
		.createHash("sha256")
		.update(Buffer.from(canonicalJson(JSON.stringify(value))))
		.digest("hex")}`;
}

function artifactPinProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, ARTIFACT_PIN_FIELDS, label);
	if (closed !== null) return closed;
	if (!ARTIFACT_TYPES.includes(value.type))
		return `${label}.type must be one of ${ARTIFACT_TYPES.join(", ")}`;
	if (!isNonEmptyString(value.identity)) return `${label}.identity must be a non-empty string`;
	if (!Number.isInteger(value.revision) || value.revision < 1)
		return `${label}.revision must be a positive integer`;
	return null;
}

function changeProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, CHANGE_FIELDS, label);
	if (closed !== null) return closed;
	if (!COMMIT_PATTERN.test(value.commit ?? ""))
		return `${label}.commit must be a 40-hex git commit sha`;
	if (!Array.isArray(value.artifacts) || value.artifacts.length === 0)
		return `${label}.artifacts must be a non-empty array of committed artifact pins`;
	for (let index = 0; index < value.artifacts.length; index += 1) {
		const problem = artifactPinProblem(value.artifacts[index], `${label}.artifacts[${index}]`);
		if (problem !== null) return problem;
	}
	return null;
}

function reviewProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, REVIEW_AXES, label);
	if (closed !== null) return closed;
	for (const axis of REVIEW_AXES) {
		if (!isNonEmptyString(value[axis]))
			return `${label}.${axis} must be a recorded Evidence receipt id`;
	}
	return null;
}

function policyPinProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, POLICY_PIN_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(value.identity)) return `${label}.identity must be a non-empty string`;
	if (!Number.isInteger(value.revision) || value.revision < 1)
		return `${label}.revision must be a positive integer`;
	return null;
}

function capabilityPinProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, CAPABILITY_PIN_FIELDS, label);
	if (closed !== null) return closed;
	for (const field of CAPABILITY_PIN_FIELDS) {
		if (!isNonEmptyString(value[field])) return `${label}.${field} must be a non-empty string`;
	}
	return null;
}

// The shape shared by prepare input (minus releaseId) and the stored event
// body — every reference field is structural here; resolution happens in
// prepareReleaseCandidate.
function candidateShapeProblem(value, label) {
	const change = changeProblem(value.change, `${label}.change`);
	if (change !== null) return change;
	if (!Array.isArray(value.evidence) || value.evidence.length === 0)
		return `${label}.evidence must be a non-empty array of recorded Evidence receipt ids`;
	for (const entry of value.evidence) {
		if (!isNonEmptyString(entry))
			return `${label}.evidence entries must be non-empty Evidence receipt ids`;
	}
	const review = reviewProblem(value.review, `${label}.review`);
	if (review !== null) return review;
	if (!ENVIRONMENTS.includes(value.environment))
		return `${label}.environment must be one of ${ENVIRONMENTS.join(", ")}`;
	const policy = policyPinProblem(value.policy, `${label}.policy`);
	if (policy !== null) return policy;
	const capability = capabilityPinProblem(value.capability, `${label}.capability`);
	if (capability !== null) return capability;
	if (!CREDENTIAL_REQUIREMENTS.includes(value.credentialsClass))
		return `${label}.credentialsClass must be one of ${CREDENTIAL_REQUIREMENTS.join(", ")}`;
	if (!isNonEmptyString(value.rollbackPlan))
		return `${label}.rollbackPlan must be a recorded Evidence receipt id`;
	return null;
}

function preparedEventProblem(event, lineIndex) {
	const closed = closedFieldProblem(
		event,
		PREPARED_EVENT_FIELDS,
		`release candidate event ${lineIndex}`,
	);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at))
		return `release candidate event ${lineIndex}.at must be a non-empty string`;
	if (!isNonEmptyString(event.releaseId))
		return `release candidate event ${lineIndex}.releaseId must be a non-empty string`;
	if (!/^sha256:[0-9a-f]{64}$/.test(event.releaseHash ?? ""))
		return `release candidate event ${lineIndex}.releaseHash must be a sha256:<64-hex> string`;
	const shape = candidateShapeProblem(event, `release candidate event ${lineIndex}`);
	if (shape !== null) return shape;
	return null;
}

function foldReleaseCandidates(cwd) {
	const events = readLedgerFailClosed(
		candidatesPath(cwd),
		RELEASE_CORRUPT_CODE,
		"release candidate ledger",
	);
	let prevHash = GENESIS_HASH;
	const byId = new Set();
	const candidates = [];
	events.forEach((event, index) => {
		const lineIndex = index + 1;
		if (!isPlainObject(event))
			throw releaseCorrupt(`release candidate event ${lineIndex} is not an object`);
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash)
			throw releaseCorrupt(`release candidate event ${lineIndex} breaks the hash chain`);
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash)
			throw releaseCorrupt(
				`release candidate event ${lineIndex} carries a hash that does not match its content`,
			);
		if (!SUPPORTED_RELEASE_CANDIDATE_SCHEMA_VERSIONS.includes(event.schemaVersion))
			throw releaseCorrupt(
				`release candidate event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		if (event.kind !== "prepared")
			throw releaseCorrupt(
				`release candidate event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
			);
		const problem = preparedEventProblem(event, lineIndex);
		if (problem !== null) throw releaseCorrupt(problem);
		if (byId.has(event.releaseId))
			throw releaseCorrupt(
				`release candidate ${JSON.stringify(event.releaseId)} is recorded more than once`,
			);
		byId.add(event.releaseId);
		const { prevHash: _prev, hash: _hash, ...body } = event;
		candidates.push({ ...body, index });
		prevHash = event.hash;
	});
	return candidates;
}

function releaseAppendFailure(err) {
	return {
		ok: false,
		code: err.amberCode || RELEASE_CORRUPT_CODE,
		record: null,
		errors: [err.message || String(err)],
	};
}

// Guard contract: any non-null guard result is returned verbatim without
// appending; `derive(fold)` picks the caller's record after the append.
function appendCandidateEvent(cwd, body, guard, derive) {
	let release;
	try {
		release = acquireReleaseLock(cwd);
	} catch (err) {
		return releaseAppendFailure(err);
	}
	try {
		let folded;
		try {
			folded = foldReleaseCandidates(cwd);
		} catch (err) {
			return releaseAppendFailure(err);
		}
		const guardVerdict = guard(folded);
		if (guardVerdict !== null) return guardVerdict;
		let prevHash;
		try {
			prevHash = chainHeadHash(candidatesPath(cwd), RELEASE_CORRUPT_CODE, "release candidates");
		} catch (err) {
			return releaseAppendFailure(err);
		}
		const event = { ...body, prevHash, hash: chainHash(body, prevHash) };
		let ceiling;
		try {
			ceiling = appendCandidateWithinCeiling(cwd, event);
		} catch (err) {
			return releaseAppendFailure(err);
		}
		if (ceiling.wouldExceed)
			return {
				ok: false,
				code: RELEASE_SIZE_CEILING_CODE,
				record: null,
				errors: [`release candidate event would exceed ${ceiling.ceiling} bytes`],
			};
		try {
			appendJSONL(candidatesPath(cwd), event);
		} catch (err) {
			return releaseAppendFailure(err);
		}
		let record;
		try {
			record = derive(foldReleaseCandidates(cwd)) ?? null;
		} catch (err) {
			return releaseAppendFailure(err);
		}
		return { ok: true, code: null, record, errors: [] };
	} finally {
		release();
	}
}

// One committed artifact revision, or a reason string.
function committedRevisionRefusal(revisions, pin, label) {
	const match = revisions.find(
		(revision) =>
			revision.type === pin.type &&
			revision.identity === pin.identity &&
			revision.revision === pin.revision,
	);
	if (!match)
		return `${label} ${JSON.stringify(`${pin.type}:${pin.identity}@${pin.revision}`)} is not a committed artifact revision`;
	return null;
}

// One recorded Evidence receipt, or a reason string; corrupt Evidence
// ledgers keep their own typed code via the thrown error.
function evidenceRefusal(cwd, id, label) {
	let receipt;
	try {
		receipt = showEvidence(cwd, id);
	} catch (err) {
		return { code: err.amberCode || RELEASE_CORRUPT_CODE, reason: err.message || String(err) };
	}
	if (receipt === null)
		return {
			code: null,
			reason: `${label} ${JSON.stringify(id)} names no recorded Evidence receipt; record it first (amber evidence record)`,
		};
	return null;
}

/**
 * Prepare one release candidate: a pure governance write that binds the
 * closed release content and refuses any reference that does not resolve —
 * an unresolved artifact revision, Evidence id, Review finding, policy
 * revision, or capability pin never becomes releasable material (the
 * commit sha is format-bound only; git state is deliberately untouched).
 * Returns the derived record carrying the canonical releaseHash.
 */
function prepareReleaseCandidate(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(RELEASE_INVALID_CODE, ["candidate input must be an object"]);
	const inputClosed = unknownFieldProblem(input, CANDIDATE_INPUT_FIELDS, "candidate input");
	if (inputClosed !== null) return fail(RELEASE_INVALID_CODE, [inputClosed]);
	if (!isNonEmptyString(input.releaseId))
		return fail(RELEASE_INVALID_CODE, ["releaseId must be a non-empty string"]);
	const shaped = {
		change: input.change,
		evidence: input.evidence,
		review: input.review,
		environment: input.environment,
		policy: input.policy,
		capability: input.capability,
		credentialsClass: input.credentialsClass,
		rollbackPlan: input.rollbackPlan,
	};
	const shape = candidateShapeProblem(shaped, "candidate input");
	if (shape !== null) return fail(RELEASE_INVALID_CODE, [shape]);

	let revisions;
	try {
		revisions = listArtifactRevisions(cwd);
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_ARTIFACT_JOURNAL_CORRUPT", [err.message || String(err)]);
	}
	for (let index = 0; index < shaped.change.artifacts.length; index += 1) {
		const refusal = committedRevisionRefusal(
			revisions,
			shaped.change.artifacts[index],
			`change.artifacts[${index}]`,
		);
		if (refusal !== null) return fail(RELEASE_INVALID_CODE, [refusal]);
	}
	const policyRefusal = committedRevisionRefusal(
		revisions,
		{ type: "policy", ...shaped.policy },
		"policy",
	);
	if (policyRefusal !== null) return fail(RELEASE_INVALID_CODE, [policyRefusal]);

	for (const [id, label] of [
		...shaped.evidence.map((entry, index) => [entry, `evidence[${index}]`]),
		...REVIEW_AXES.map((axis) => [shaped.review[axis], `review.${axis}`]),
		[shaped.rollbackPlan, "rollbackPlan"],
	]) {
		const refusal = evidenceRefusal(cwd, id, label);
		if (refusal !== null) {
			if (refusal.code !== null) return fail(refusal.code, [refusal.reason]);
			return fail(RELEASE_INVALID_CODE, [refusal.reason]);
		}
	}

	const capability = resolveRequestCapability(cwd, shaped.capability);
	if (!capability.ok) return fail(capability.code, capability.errors);

	const releaseHash = canonicalHashOf({
		schemaVersion: RELEASE_CANDIDATE_SCHEMA_VERSION,
		...shaped,
	});
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	return appendCandidateEvent(
		cwd,
		{
			kind: "prepared",
			schemaVersion: RELEASE_CANDIDATE_SCHEMA_VERSION,
			at,
			releaseId: input.releaseId,
			releaseHash,
			...shaped,
		},
		(fold) =>
			fold.some((candidate) => candidate.releaseId === input.releaseId)
				? fail(RELEASE_EXISTS_CODE, [
						`release candidate ${JSON.stringify(input.releaseId)} is already prepared; a candidate is immutable — prepare a new releaseId for a new binding`,
					])
				: null,
		(fold) => fold.find((candidate) => candidate.releaseId === input.releaseId),
	);
}

function showReleaseCandidate(cwd, releaseId) {
	return foldReleaseCandidates(cwd).find((candidate) => candidate.releaseId === releaseId) ?? null;
}

function listReleaseCandidates(cwd, { environment = null } = {}) {
	return foldReleaseCandidates(cwd).filter(
		(candidate) => environment === null || candidate.environment === environment,
	);
}

// ── F053 T2 (#275): staging & production release authorization ────────────
//
// Authorization is per-environment, separate from execution, and always
// human: staging consumes one named single-use F050 Approval bound to
// `release:staging:<releaseHash>` plus a rollback rehearsal receipt whose
// producer is not the approver; production binds branch-protection
// Evidence, TWO distinct human Decisions (code owner and release manager,
// neither of whom produced any bound Evidence), passing release and
// environment Gate outcomes, a runbook.* capability, and the scoped
// credentials class. Stale authority never authorizes: the candidate must
// re-derive to its recorded releaseHash, its capability must still
// resolve, and a newer revision of the pinned release Policy invalidates
// the candidate outright.

const RELEASE_AUTHORIZATION_SCHEMA_VERSION = 1;
const SUPPORTED_RELEASE_AUTHORIZATION_SCHEMA_VERSIONS = Object.freeze([1]);
const DEFAULT_MAX_RELEASE_AUTHORIZATIONS_BYTES = 1024 * 1024;

// Human-only authority slots, mirroring the F050/F051/F052 contract.
const RELEASE_DECISION_KINDS = Object.freeze(["acceptance", "approval"]);

const RELEASE_AUTH_CORRUPT_CODE = "AMBER_E_RELEASE_AUTH_CORRUPT";
const RELEASE_AUTH_LOCK_CODE = "AMBER_E_RELEASE_AUTH_LOCK";
const RELEASE_AUTH_SIZE_CEILING_CODE = "AMBER_E_RELEASE_AUTH_SIZE_CEILING";
const RELEASE_DRIFT_CODE = "AMBER_E_RELEASE_DRIFT";
const RELEASE_SEPARATION_CODE = "AMBER_E_RELEASE_SEPARATION";
const RELEASE_APPROVAL_MISMATCH_CODE = "AMBER_E_RELEASE_APPROVAL_MISMATCH";
const RELEASE_GATE_CODE = "AMBER_E_RELEASE_GATE";

const AUTHORIZE_INPUT_FIELDS = Object.freeze([
	"releaseId",
	"approval",
	"decisionIdentity",
	"body",
	"traces",
	"scope",
	"rehearsal",
	"branchProtection",
	"codeOwner",
	"releaseManager",
	"releaseGateIndex",
	"environmentGateIndex",
]);
const DECISION_PIN_FIELDS = Object.freeze(["identity", "revision"]);
const BOUND_DECISION_FIELDS = Object.freeze(["identity", "revision", "decisionKind", "principal"]);
// One closed event set for both environments: the fields the OTHER
// environment does not bind are null, and the stored-shape validator
// enforces exactly that nullness per environment.
const AUTHORIZED_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"releaseId",
	"releaseHash",
	"environment",
	"approvalId",
	"decision",
	"rehearsal",
	"branchProtection",
	"codeOwner",
	"releaseManager",
	"releaseGateIndex",
	"environmentGateIndex",
	"prevHash",
	"hash",
]);

function authorizationsPath(cwd) {
	return statePathForCreate(cwd, "release", "authorizations.jsonl");
}

function releaseAuthCorrupt(message) {
	return typedError(RELEASE_AUTH_CORRUPT_CODE, message);
}

function acquireAuthorizationLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(authorizationsPath(cwd)),
		lockName: "authorizations.lock",
		conflictCode: RELEASE_AUTH_LOCK_CODE,
		corruptCode: RELEASE_AUTH_CORRUPT_CODE,
		label: "release authorization ledger",
		staleMs: LOCK_STALE_MS,
	});
}

function appendAuthorizationWithinCeiling(cwd, event) {
	return sharedAppendWithinCeiling({
		ledgerPath: authorizationsPath(cwd),
		event,
		envName: "AMBER_RELEASE_MAX_AUTHORIZATIONS_BYTES",
		defaultBytes: DEFAULT_MAX_RELEASE_AUTHORIZATIONS_BYTES,
		label: "release authorization ledger",
	});
}

function boundDecisionProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, BOUND_DECISION_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(value.identity)) return `${label}.identity must be a non-empty string`;
	if (!Number.isInteger(value.revision) || value.revision < 1)
		return `${label}.revision must be a positive integer`;
	if (!RELEASE_DECISION_KINDS.includes(value.decisionKind))
		return `${label}.decisionKind must be one of ${RELEASE_DECISION_KINDS.join(", ")}`;
	if (!isNonEmptyString(value.principal)) return `${label}.principal must be a non-empty string`;
	return null;
}

function authorizedEventProblem(event, lineIndex) {
	const label = `release authorization event ${lineIndex}`;
	const closed = closedFieldProblem(event, AUTHORIZED_EVENT_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at)) return `${label}.at must be a non-empty string`;
	if (!isNonEmptyString(event.releaseId)) return `${label}.releaseId must be a non-empty string`;
	if (!/^sha256:[0-9a-f]{64}$/.test(event.releaseHash ?? ""))
		return `${label}.releaseHash must be a sha256:<64-hex> string`;
	if (!ENVIRONMENTS.includes(event.environment))
		return `${label}.environment must be one of ${ENVIRONMENTS.join(", ")}`;
	if (event.environment === "production") {
		for (const field of ["approvalId", "rehearsal"]) {
			if (event[field] !== null) return `${label}.${field} must be null for production`;
		}
		if (event.decision !== null) return `${label}.decision must be null for production`;
		if (!isNonEmptyString(event.branchProtection))
			return `${label}.branchProtection must be a recorded Evidence receipt id`;
		for (const slot of ["codeOwner", "releaseManager"]) {
			const problem = boundDecisionProblem(event[slot], `${label}.${slot}`);
			if (problem !== null) return problem;
		}
		for (const field of ["releaseGateIndex", "environmentGateIndex"]) {
			if (!Number.isInteger(event[field]) || event[field] < 0)
				return `${label}.${field} must be a non-negative integer`;
		}
		return null;
	}
	for (const field of ["branchProtection"]) {
		if (event[field] !== null) return `${label}.${field} must be null outside production`;
	}
	for (const slot of ["codeOwner", "releaseManager"]) {
		if (event[slot] !== null) return `${label}.${slot} must be null outside production`;
	}
	for (const field of ["releaseGateIndex", "environmentGateIndex"]) {
		if (event[field] !== null) return `${label}.${field} must be null outside production`;
	}
	if (!isNonEmptyString(event.approvalId)) return `${label}.approvalId must be a non-empty string`;
	const decision = closedFieldProblem(
		event.decision ?? {},
		DECISION_PIN_FIELDS,
		`${label}.decision`,
	);
	if (!isPlainObject(event.decision) || decision !== null)
		return decision ?? `${label}.decision must be an object`;
	if (!isNonEmptyString(event.decision.identity))
		return `${label}.decision.identity must be a non-empty string`;
	if (!Number.isInteger(event.decision.revision) || event.decision.revision < 1)
		return `${label}.decision.revision must be a positive integer`;
	if (!isNonEmptyString(event.rehearsal))
		return `${label}.rehearsal must be a recorded Evidence receipt id`;
	return null;
}

function foldReleaseAuthorizations(cwd) {
	const events = readLedgerFailClosed(
		authorizationsPath(cwd),
		RELEASE_AUTH_CORRUPT_CODE,
		"release authorization ledger",
	);
	let prevHash = GENESIS_HASH;
	const byId = new Set();
	const authorizations = [];
	events.forEach((event, index) => {
		const lineIndex = index + 1;
		if (!isPlainObject(event))
			throw releaseAuthCorrupt(`release authorization event ${lineIndex} is not an object`);
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash)
			throw releaseAuthCorrupt(`release authorization event ${lineIndex} breaks the hash chain`);
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash)
			throw releaseAuthCorrupt(
				`release authorization event ${lineIndex} carries a hash that does not match its content`,
			);
		if (!SUPPORTED_RELEASE_AUTHORIZATION_SCHEMA_VERSIONS.includes(event.schemaVersion))
			throw releaseAuthCorrupt(
				`release authorization event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		if (event.kind !== "authorized")
			throw releaseAuthCorrupt(
				`release authorization event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
			);
		const problem = authorizedEventProblem(event, lineIndex);
		if (problem !== null) throw releaseAuthCorrupt(problem);
		if (byId.has(event.releaseId))
			throw releaseAuthCorrupt(
				`release ${JSON.stringify(event.releaseId)} is authorized more than once`,
			);
		byId.add(event.releaseId);
		const { prevHash: _prev, hash: _hash, ...body } = event;
		authorizations.push({ ...body, index });
		prevHash = event.hash;
	});
	return authorizations;
}

function authorizationAppendFailure(err) {
	return {
		ok: false,
		code: err.amberCode || RELEASE_AUTH_CORRUPT_CODE,
		record: null,
		errors: [err.message || String(err)],
	};
}

// Guard contract: any non-null guard result is returned verbatim without
// appending; `derive(fold)` picks the caller's record after the append.
function appendAuthorizationEvent(cwd, body, guard, derive) {
	let release;
	try {
		release = acquireAuthorizationLock(cwd);
	} catch (err) {
		return authorizationAppendFailure(err);
	}
	try {
		let folded;
		try {
			folded = foldReleaseAuthorizations(cwd);
		} catch (err) {
			return authorizationAppendFailure(err);
		}
		const guardVerdict = guard(folded);
		if (guardVerdict !== null) return guardVerdict;
		let prevHash;
		try {
			prevHash = chainHeadHash(
				authorizationsPath(cwd),
				RELEASE_AUTH_CORRUPT_CODE,
				"release authorizations",
			);
		} catch (err) {
			return authorizationAppendFailure(err);
		}
		const event = { ...body, prevHash, hash: chainHash(body, prevHash) };
		let ceiling;
		try {
			ceiling = appendAuthorizationWithinCeiling(cwd, event);
		} catch (err) {
			return authorizationAppendFailure(err);
		}
		if (ceiling.wouldExceed)
			return {
				ok: false,
				code: RELEASE_AUTH_SIZE_CEILING_CODE,
				record: null,
				errors: [`release authorization event would exceed ${ceiling.ceiling} bytes`],
			};
		try {
			appendJSONL(authorizationsPath(cwd), event);
		} catch (err) {
			return authorizationAppendFailure(err);
		}
		let record;
		try {
			record = derive(foldReleaseAuthorizations(cwd)) ?? null;
		} catch (err) {
			return authorizationAppendFailure(err);
		}
		return { ok: true, code: null, record, errors: [] };
	} finally {
		release();
	}
}

// Stale authority never authorizes: the stored candidate must re-derive
// to its recorded releaseHash, its capability must still resolve, and a
// newer committed revision of the pinned release Policy invalidates it.
function candidateDriftProblem(cwd, candidate, revisions) {
	const rederived = canonicalHashOf({
		schemaVersion: candidate.schemaVersion,
		change: candidate.change,
		evidence: candidate.evidence,
		review: candidate.review,
		environment: candidate.environment,
		policy: candidate.policy,
		capability: candidate.capability,
		credentialsClass: candidate.credentialsClass,
		rollbackPlan: candidate.rollbackPlan,
	});
	if (rederived !== candidate.releaseHash)
		return `release ${JSON.stringify(candidate.releaseId)} no longer re-derives to its recorded releaseHash`;
	const capability = resolveRequestCapability(cwd, candidate.capability);
	if (!capability.ok)
		return `the registered capability behind this release is no longer resolvable (${capability.errors[0]})`;
	const newest = revisions
		.filter(
			(revision) => revision.type === "policy" && revision.identity === candidate.policy.identity,
		)
		.reduce((max, revision) => Math.max(max, revision.revision), 0);
	if (newest > candidate.policy.revision)
		return `release policy ${JSON.stringify(candidate.policy.identity)} has a newer revision ${newest} than the pinned ${candidate.policy.revision}; changed authority makes stale candidates unusable`;
	return null;
}

// The producer ids behind every Evidence receipt the candidate binds —
// the "submitting side" for separation-of-duties purposes.
function boundProducerIds(cwd, candidate) {
	const ids = new Set();
	const references = [
		...candidate.evidence,
		...REVIEW_AXES.map((axis) => candidate.review[axis]),
		candidate.rollbackPlan,
	];
	for (const reference of references) {
		const receipt = showEvidence(cwd, reference);
		if (receipt === null)
			throw releaseAuthCorrupt(
				`release ${JSON.stringify(candidate.releaseId)} binds Evidence ${JSON.stringify(reference)} that is no longer recorded`,
			);
		ids.add(receipt.producer.id);
	}
	return ids;
}

// One committed human Decision (acceptance|approval) with its verified
// principal snapshot, or a refusal.
function resolveReleaseDecision(revisions, pin, label) {
	const match = revisions.find(
		(revision) =>
			revision.type === "decision" &&
			revision.identity === pin.identity &&
			revision.revision === pin.revision,
	);
	if (!match)
		return {
			ok: false,
			reason: `${label} ${JSON.stringify(pin.identity)}@${pin.revision} is not a committed Decision artifact`,
		};
	if (!RELEASE_DECISION_KINDS.includes(match.decisionKind))
		return {
			ok: false,
			reason: `${label} requires a human acceptance or approval Decision; ${JSON.stringify(pin.identity)}@${pin.revision} carries decisionKind ${JSON.stringify(match.decisionKind)}`,
		};
	const principal = match.principal?.id;
	if (!isNonEmptyString(principal))
		return {
			ok: false,
			reason: `${label} ${JSON.stringify(pin.identity)}@${pin.revision} carries no verified principal snapshot`,
		};
	return {
		ok: true,
		decision: {
			identity: pin.identity,
			revision: pin.revision,
			decisionKind: match.decisionKind,
			principal,
		},
	};
}

function decisionPinProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object carrying identity and revision`;
	const closed = closedFieldProblem(value, DECISION_PIN_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(value.identity)) return `${label}.identity must be a non-empty string`;
	if (!Number.isInteger(value.revision) || value.revision < 1)
		return `${label}.revision must be a positive integer`;
	return null;
}

/**
 * Authorize one prepared release for its environment. Staging consumes a
 * named single-use Approval and binds an independent rollback rehearsal;
 * production binds branch protection, two distinct human Decisions kept
 * apart from every bound Evidence producer, passing release and
 * environment Gates, a runbook capability, and the scoped credentials
 * class. One release authorizes at most once.
 */
function authorizeRelease(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(RELEASE_INVALID_CODE, ["authorize input must be an object"]);
	const inputClosed = unknownFieldProblem(input, AUTHORIZE_INPUT_FIELDS, "authorize input");
	if (inputClosed !== null) return fail(RELEASE_INVALID_CODE, [inputClosed]);
	if (!isNonEmptyString(input.releaseId))
		return fail(RELEASE_INVALID_CODE, ["releaseId must be a non-empty string"]);
	let candidate;
	try {
		candidate = showReleaseCandidate(cwd, input.releaseId);
	} catch (err) {
		return fail(err.amberCode || RELEASE_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (candidate === null)
		return fail(RELEASE_NOT_FOUND_CODE, [
			`release candidate ${JSON.stringify(input.releaseId)} is not prepared`,
		]);
	let revisions;
	try {
		revisions = listArtifactRevisions(cwd);
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_ARTIFACT_JOURNAL_CORRUPT", [err.message || String(err)]);
	}
	const drift = candidateDriftProblem(cwd, candidate, revisions);
	if (drift !== null) return fail(RELEASE_DRIFT_CODE, [drift]);

	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	const base = {
		kind: "authorized",
		schemaVersion: RELEASE_AUTHORIZATION_SCHEMA_VERSION,
		at,
		releaseId: candidate.releaseId,
		releaseHash: candidate.releaseHash,
		environment: candidate.environment,
		approvalId: null,
		decision: null,
		rehearsal: null,
		branchProtection: null,
		codeOwner: null,
		releaseManager: null,
		releaseGateIndex: null,
		environmentGateIndex: null,
	};

	if (candidate.environment === "production") {
		for (const field of ["approval", "decisionIdentity", "body", "traces", "scope", "rehearsal"]) {
			if (input[field] !== undefined)
				return fail(RELEASE_INVALID_CODE, [
					`${field} is a staging binding; production authorization binds decisions and gates`,
				]);
		}
		if (!candidate.capability.name.startsWith("runbook."))
			return fail(RELEASE_INVALID_CODE, [
				`production releases deploy only through runbook.* capabilities; the candidate pins ${JSON.stringify(candidate.capability.name)}`,
			]);
		if (candidate.credentialsClass !== "scoped")
			return fail(RELEASE_INVALID_CODE, [
				`production releases require the scoped credentials class; the candidate declares ${JSON.stringify(candidate.credentialsClass)}`,
			]);
		if (!isNonEmptyString(input.branchProtection))
			return fail(RELEASE_INVALID_CODE, [
				"branchProtection must be a recorded Evidence receipt id",
			]);
		const branch = evidenceRefusal(cwd, input.branchProtection, "branchProtection");
		if (branch !== null) {
			if (branch.code !== null) return fail(branch.code, [branch.reason]);
			return fail(RELEASE_INVALID_CODE, [branch.reason]);
		}
		for (const [slot, pin] of [
			["codeOwner", input.codeOwner],
			["releaseManager", input.releaseManager],
		]) {
			const problem = decisionPinProblem(pin, slot);
			if (problem !== null) return fail(RELEASE_INVALID_CODE, [problem]);
		}
		const codeOwner = resolveReleaseDecision(revisions, input.codeOwner, "codeOwner");
		if (!codeOwner.ok) return fail(RELEASE_INVALID_CODE, [codeOwner.reason]);
		const releaseManager = resolveReleaseDecision(
			revisions,
			input.releaseManager,
			"releaseManager",
		);
		if (!releaseManager.ok) return fail(RELEASE_INVALID_CODE, [releaseManager.reason]);
		if (codeOwner.decision.principal === releaseManager.decision.principal)
			return fail(RELEASE_SEPARATION_CODE, [
				`code owner and release manager must be distinct humans; both decisions bind ${JSON.stringify(codeOwner.decision.principal)}`,
			]);
		let producers;
		try {
			producers = boundProducerIds(cwd, candidate);
			// The branch-protection receipt is bound by THIS authorization:
			// its producer is on the submitting side too.
			producers.add(showEvidence(cwd, input.branchProtection).producer.id);
		} catch (err) {
			return fail(err.amberCode || RELEASE_AUTH_CORRUPT_CODE, [err.message || String(err)]);
		}
		for (const slot of [codeOwner.decision, releaseManager.decision]) {
			if (producers.has(slot.principal))
				return fail(RELEASE_SEPARATION_CODE, [
					`${JSON.stringify(slot.principal)} produced Evidence this release binds and cannot also approve it; the submitting side never satisfies a required approval`,
				]);
		}
		if (input.releaseGateIndex === input.environmentGateIndex)
			return fail(RELEASE_GATE_CODE, [
				`releaseGateIndex and environmentGateIndex both name outcome ${input.releaseGateIndex}; the release Gate and the environment Gate are separate controls`,
			]);
		for (const [label, index] of [
			["releaseGateIndex", input.releaseGateIndex],
			["environmentGateIndex", input.environmentGateIndex],
		]) {
			if (!Number.isInteger(index) || index < 0)
				return fail(RELEASE_INVALID_CODE, [`${label} must be a non-negative integer`]);
			let outcome;
			try {
				outcome = showGateOutcome(cwd, { index });
			} catch (err) {
				return fail(err.amberCode || RELEASE_GATE_CODE, [err.message || String(err)]);
			}
			if (outcome === null)
				return fail(RELEASE_GATE_CODE, [`${label} ${index} names no recorded Gate outcome`]);
			if (outcome.subject !== candidate.releaseId)
				return fail(RELEASE_GATE_CODE, [
					`${label} ${index} records subject ${JSON.stringify(outcome.subject)}, not this release ${JSON.stringify(candidate.releaseId)}; a Gate outcome authorizes only its own subject`,
				]);
			if (outcome.verdict !== "pass")
				return fail(RELEASE_GATE_CODE, [
					`${label} ${index} records verdict ${JSON.stringify(outcome.verdict)}; production authorization requires a passing Gate outcome`,
				]);
		}
		return appendAuthorizationEvent(
			cwd,
			{
				...base,
				branchProtection: input.branchProtection,
				codeOwner: codeOwner.decision,
				releaseManager: releaseManager.decision,
				releaseGateIndex: input.releaseGateIndex,
				environmentGateIndex: input.environmentGateIndex,
			},
			(fold) => {
				if (fold.some((entry) => entry.releaseId === candidate.releaseId))
					return fail(RELEASE_EXISTS_CODE, [
						`release ${JSON.stringify(candidate.releaseId)} is already authorized; an authorization is single-use`,
					]);
				const spender = fold.find((entry) =>
					[entry.codeOwner, entry.releaseManager, entry.decision].some(
						(slot) =>
							slot !== null &&
							[input.codeOwner, input.releaseManager].some(
								(pin) => slot.identity === pin.identity && slot.revision === pin.revision,
							),
					),
				);
				if (spender)
					return fail(RELEASE_INVALID_CODE, [
						`a bound Decision already authorized release ${JSON.stringify(spender.releaseId)}; an authorization Decision is single-use`,
					]);
				return null;
			},
			(fold) => fold.find((entry) => entry.releaseId === candidate.releaseId),
		);
	}

	// Staging (and development) path: one named single-use Approval plus an
	// independent rollback rehearsal receipt.
	for (const field of [
		"branchProtection",
		"codeOwner",
		"releaseManager",
		"releaseGateIndex",
		"environmentGateIndex",
	]) {
		if (input[field] !== undefined)
			return fail(RELEASE_INVALID_CODE, [
				`${field} is a production binding; ${candidate.environment} authorization consumes a named Approval`,
			]);
	}
	for (const field of ["approval", "decisionIdentity", "body", "rehearsal"]) {
		if (!isNonEmptyString(input[field]))
			return fail(RELEASE_INVALID_CODE, [`${field} must be a non-empty string`]);
	}
	const rehearsal = evidenceRefusal(cwd, input.rehearsal, "rehearsal");
	if (rehearsal !== null) {
		if (rehearsal.code !== null) return fail(rehearsal.code, [rehearsal.reason]);
		return fail(RELEASE_INVALID_CODE, [rehearsal.reason]);
	}
	const binding = `release:${candidate.environment}:${candidate.releaseHash}`;
	let approval;
	try {
		approval = showApproval(cwd, input.approval, { now: opts.now });
	} catch (err) {
		return fail(err.amberCode || RELEASE_AUTH_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (approval === null)
		return fail(RELEASE_APPROVAL_MISMATCH_CODE, [
			`approval ${JSON.stringify(input.approval)} is not recorded`,
		]);
	if (approval.subject !== binding)
		return fail(RELEASE_APPROVAL_MISMATCH_CODE, [
			`approval ${JSON.stringify(input.approval)} authorizes subject ${JSON.stringify(approval.subject)}, not this release's binding ${JSON.stringify(binding)}; one authorization binds one release and environment`,
		]);
	let rehearsalReceipt;
	try {
		rehearsalReceipt = showEvidence(cwd, input.rehearsal);
	} catch (err) {
		return fail(err.amberCode || RELEASE_AUTH_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (rehearsalReceipt.producer.id === approval.approver.id)
		return fail(RELEASE_SEPARATION_CODE, [
			`approval ${JSON.stringify(input.approval)} was granted by ${JSON.stringify(approval.approver.id)}, who also produced the rehearsal Evidence ${JSON.stringify(input.rehearsal)}; the rehearsing party cannot approve its own rehearsal`,
		]);
	let consumed = null;
	// The guard completes this object from the consumption receipt before
	// the append hashes the event body.
	const decision = { identity: input.decisionIdentity, revision: 1 };
	const appended = appendAuthorizationEvent(
		cwd,
		{
			...base,
			approvalId: input.approval,
			decision,
			rehearsal: input.rehearsal,
		},
		(fold) => {
			if (fold.some((entry) => entry.releaseId === candidate.releaseId))
				return fail(RELEASE_EXISTS_CODE, [
					`release ${JSON.stringify(candidate.releaseId)} is already authorized; an authorization is single-use`,
				]);
			// Consumption is the point of no return: it settles the human
			// Decision atomically under the approval ledger's own lock. A
			// ceiling/write failure AFTER this point leaves the consumed
			// approval and settled Decision as the auditable recovery trail.
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
		(fold) => fold.find((entry) => entry.releaseId === candidate.releaseId),
	);
	if (!appended.ok) return appended;
	return { ...appended, consumption: consumed };
}

function showReleaseAuthorization(cwd, releaseId) {
	return foldReleaseAuthorizations(cwd).find((entry) => entry.releaseId === releaseId) ?? null;
}

function listReleaseAuthorizations(cwd, { environment = null } = {}) {
	return foldReleaseAuthorizations(cwd).filter(
		(entry) => environment === null || entry.environment === environment,
	);
}

// ── F053 T3 (#276): deployment & rollback execution binding ───────────────
//
// Deployment and rollback are separate target-write transactions executed
// ONLY through the F052 controlled-runner surface: a transaction binds one
// authorized release to one authorized F052 request whose pins must equal
// the candidate's, and the execution itself settles in the F052 journal —
// the transaction's outcome is a read-time projection of that settlement,
// so a failed or partial deployment reads as exactly that, never as
// success. Transactions carry only ids and hashes: no credential value,
// and no git surface, can ride in them.

const RELEASE_TRANSACTION_SCHEMA_VERSION = 1;
const SUPPORTED_RELEASE_TRANSACTION_SCHEMA_VERSIONS = Object.freeze([1]);
const DEFAULT_MAX_RELEASE_TRANSACTIONS_BYTES = 1024 * 1024;

const RELEASE_TX_OPERATIONS = Object.freeze(["deploy", "rollback"]);

const RELEASE_TX_STATE_CODE = "AMBER_E_RELEASE_TX_STATE";
const RELEASE_TX_MISMATCH_CODE = "AMBER_E_RELEASE_TX_MISMATCH";
const RELEASE_TX_CORRUPT_CODE = "AMBER_E_RELEASE_TX_CORRUPT";
const RELEASE_TX_LOCK_CODE = "AMBER_E_RELEASE_TX_LOCK";
const RELEASE_TX_SIZE_CEILING_CODE = "AMBER_E_RELEASE_TX_SIZE_CEILING";

const TRANSACTION_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"releaseId",
	"releaseHash",
	"requestHash",
	"prevHash",
	"hash",
]);
const TRANSACTION_INPUT_FIELDS = Object.freeze(["releaseId", "requestHash"]);

function transactionsPath(cwd) {
	return statePathForCreate(cwd, "release", "transactions.jsonl");
}

function releaseTxCorrupt(message) {
	return typedError(RELEASE_TX_CORRUPT_CODE, message);
}

function acquireTransactionLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(transactionsPath(cwd)),
		lockName: "transactions.lock",
		conflictCode: RELEASE_TX_LOCK_CODE,
		corruptCode: RELEASE_TX_CORRUPT_CODE,
		label: "release transaction ledger",
		staleMs: LOCK_STALE_MS,
	});
}

function appendTransactionWithinCeiling(cwd, event) {
	return sharedAppendWithinCeiling({
		ledgerPath: transactionsPath(cwd),
		event,
		envName: "AMBER_RELEASE_MAX_TRANSACTIONS_BYTES",
		defaultBytes: DEFAULT_MAX_RELEASE_TRANSACTIONS_BYTES,
		label: "release transaction ledger",
	});
}

function transactionEventProblem(event, lineIndex) {
	const label = `release transaction event ${lineIndex}`;
	const closed = closedFieldProblem(event, TRANSACTION_EVENT_FIELDS, label);
	if (closed !== null) return closed;
	if (!RELEASE_TX_OPERATIONS.includes(event.kind))
		return `${label}.kind must be one of ${RELEASE_TX_OPERATIONS.join(", ")}`;
	if (!isNonEmptyString(event.at)) return `${label}.at must be a non-empty string`;
	if (!isNonEmptyString(event.releaseId)) return `${label}.releaseId must be a non-empty string`;
	for (const field of ["releaseHash", "requestHash"]) {
		if (!/^sha256:[0-9a-f]{64}$/.test(event[field] ?? ""))
			return `${label}.${field} must be a sha256:<64-hex> string`;
	}
	return null;
}

function foldReleaseTransactions(cwd) {
	const events = readLedgerFailClosed(
		transactionsPath(cwd),
		RELEASE_TX_CORRUPT_CODE,
		"release transaction ledger",
	);
	let prevHash = GENESIS_HASH;
	const seen = new Set();
	const byRequest = new Set();
	const transactions = [];
	events.forEach((event, index) => {
		const lineIndex = index + 1;
		if (!isPlainObject(event))
			throw releaseTxCorrupt(`release transaction event ${lineIndex} is not an object`);
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash)
			throw releaseTxCorrupt(`release transaction event ${lineIndex} breaks the hash chain`);
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash)
			throw releaseTxCorrupt(
				`release transaction event ${lineIndex} carries a hash that does not match its content`,
			);
		if (!SUPPORTED_RELEASE_TRANSACTION_SCHEMA_VERSIONS.includes(event.schemaVersion))
			throw releaseTxCorrupt(
				`release transaction event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		const problem = transactionEventProblem(event, lineIndex);
		if (problem !== null) throw releaseTxCorrupt(problem);
		const key = `${event.kind}:${event.releaseId}`;
		if (seen.has(key))
			throw releaseTxCorrupt(
				`release ${JSON.stringify(event.releaseId)} records ${event.kind} more than once`,
			);
		if (event.kind === "rollback" && !seen.has(`deploy:${event.releaseId}`))
			throw releaseTxCorrupt(
				`release transaction event ${lineIndex} rolls back ${JSON.stringify(event.releaseId)}, which never deployed`,
			);
		if (byRequest.has(event.requestHash))
			throw releaseTxCorrupt(
				`request ${JSON.stringify(event.requestHash)} rides more than one release transaction`,
			);
		seen.add(key);
		byRequest.add(event.requestHash);
		const { prevHash: _prev, hash: _hash, ...body } = event;
		transactions.push({ ...body, operation: event.kind, index });
		prevHash = event.hash;
	});
	return transactions;
}

function transactionAppendFailure(err) {
	return {
		ok: false,
		code: err.amberCode || RELEASE_TX_CORRUPT_CODE,
		record: null,
		errors: [err.message || String(err)],
	};
}

// Guard contract: any non-null guard result is returned verbatim without
// appending; `derive(fold)` picks the caller's record after the append.
function appendTransactionEvent(cwd, body, guard, derive) {
	let release;
	try {
		release = acquireTransactionLock(cwd);
	} catch (err) {
		return transactionAppendFailure(err);
	}
	try {
		let folded;
		try {
			folded = foldReleaseTransactions(cwd);
		} catch (err) {
			return transactionAppendFailure(err);
		}
		const guardVerdict = guard(folded);
		if (guardVerdict !== null) return guardVerdict;
		let prevHash;
		try {
			prevHash = chainHeadHash(
				transactionsPath(cwd),
				RELEASE_TX_CORRUPT_CODE,
				"release transactions",
			);
		} catch (err) {
			return transactionAppendFailure(err);
		}
		const event = { ...body, prevHash, hash: chainHash(body, prevHash) };
		let ceiling;
		try {
			ceiling = appendTransactionWithinCeiling(cwd, event);
		} catch (err) {
			return transactionAppendFailure(err);
		}
		if (ceiling.wouldExceed)
			return {
				ok: false,
				code: RELEASE_TX_SIZE_CEILING_CODE,
				record: null,
				errors: [`release transaction event would exceed ${ceiling.ceiling} bytes`],
			};
		try {
			appendJSONL(transactionsPath(cwd), event);
		} catch (err) {
			return transactionAppendFailure(err);
		}
		let record;
		try {
			record = derive(foldReleaseTransactions(cwd)) ?? null;
		} catch (err) {
			return transactionAppendFailure(err);
		}
		return { ok: true, code: null, record, errors: [] };
	} finally {
		release();
	}
}

// The F052 request a transaction rides must be authorized and must bind
// exactly what the candidate pinned: same capability, same environment,
// same credentials class — an approved release can never widen into a
// different operation.
function transactionRequestProblem(cwd, candidate, requestHash) {
	let request;
	try {
		request = showRunnerRequest(cwd, requestHash);
	} catch (err) {
		return { code: err.amberCode || RELEASE_TX_CORRUPT_CODE, reason: err.message || String(err) };
	}
	if (request === null)
		return {
			code: RELEASE_TX_STATE_CODE,
			reason: `request ${JSON.stringify(requestHash)} is not recorded; submit and authorize the F052 request first`,
		};
	if (request.status !== "authorized")
		return {
			code: RELEASE_TX_STATE_CODE,
			reason: `request ${JSON.stringify(requestHash)} is ${JSON.stringify(request.status)}; a release transaction rides only an authorized request`,
		};
	const pin = candidate.capability;
	const requestPin = request.capability;
	if (
		requestPin.runnerId !== pin.runnerId ||
		requestPin.runnerVersion !== pin.runnerVersion ||
		requestPin.name !== pin.name ||
		requestPin.capabilityVersion !== pin.capabilityVersion
	)
		return {
			code: RELEASE_TX_MISMATCH_CODE,
			reason: `request ${JSON.stringify(requestHash)} pins capability ${JSON.stringify(`${requestPin.runnerId}@${requestPin.runnerVersion}/${requestPin.name}@${requestPin.capabilityVersion}`)}, not the release's ${JSON.stringify(`${pin.runnerId}@${pin.runnerVersion}/${pin.name}@${pin.capabilityVersion}`)}`,
		};
	if (request.environment !== candidate.environment)
		return {
			code: RELEASE_TX_MISMATCH_CODE,
			reason: `request ${JSON.stringify(requestHash)} targets ${JSON.stringify(request.environment)}, not the release's ${JSON.stringify(candidate.environment)}`,
		};
	if (request.credentialRequirement !== candidate.credentialsClass)
		return {
			code: RELEASE_TX_MISMATCH_CODE,
			reason: `request ${JSON.stringify(requestHash)} declares credentialRequirement ${JSON.stringify(request.credentialRequirement)}, not the release's credentials class ${JSON.stringify(candidate.credentialsClass)}`,
		};
	return null;
}

// Shared preamble for both transaction verbs: shape, prepared candidate,
// recorded authorization, and freedom from drift.
function transactionPreamble(cwd, input) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return { failure: fail(RELEASE_INVALID_CODE, ["transaction input must be an object"]) };
	const inputClosed = unknownFieldProblem(input, TRANSACTION_INPUT_FIELDS, "transaction input");
	if (inputClosed !== null) return { failure: fail(RELEASE_INVALID_CODE, [inputClosed]) };
	if (!isNonEmptyString(input.releaseId))
		return { failure: fail(RELEASE_INVALID_CODE, ["releaseId must be a non-empty string"]) };
	if (!/^sha256:[0-9a-f]{64}$/.test(input.requestHash ?? ""))
		return {
			failure: fail(RELEASE_INVALID_CODE, ["requestHash must be a sha256:<64-hex> string"]),
		};
	let candidate;
	try {
		candidate = showReleaseCandidate(cwd, input.releaseId);
	} catch (err) {
		return { failure: fail(err.amberCode || RELEASE_CORRUPT_CODE, [err.message || String(err)]) };
	}
	if (candidate === null)
		return {
			failure: fail(RELEASE_NOT_FOUND_CODE, [
				`release candidate ${JSON.stringify(input.releaseId)} is not prepared`,
			]),
		};
	let authorization;
	try {
		authorization = showReleaseAuthorization(cwd, input.releaseId);
	} catch (err) {
		return {
			failure: fail(err.amberCode || RELEASE_AUTH_CORRUPT_CODE, [err.message || String(err)]),
		};
	}
	if (authorization === null)
		return {
			failure: fail(RELEASE_TX_STATE_CODE, [
				`release ${JSON.stringify(input.releaseId)} is not authorized; a transaction follows authorization`,
			]),
		};
	let revisions;
	try {
		revisions = listArtifactRevisions(cwd);
	} catch (err) {
		return {
			failure: fail(err.amberCode || "AMBER_E_ARTIFACT_JOURNAL_CORRUPT", [
				err.message || String(err),
			]),
		};
	}
	const drift = candidateDriftProblem(cwd, candidate, revisions);
	if (drift !== null) return { failure: fail(RELEASE_DRIFT_CODE, [drift]) };
	const request = transactionRequestProblem(cwd, candidate, input.requestHash);
	if (request !== null) return { failure: fail(request.code, [request.reason]) };
	return { candidate, fail };
}

/**
 * Bind one authorized release to one authorized F052 deployment request.
 * One deploy per release, one transaction per request — a concurrent
 * second use refuses instead of racing.
 */
function deployRelease(cwd, input = {}, opts = {}) {
	const preamble = transactionPreamble(cwd, input);
	if (preamble.failure) return preamble.failure;
	const { candidate, fail } = preamble;
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	return appendTransactionEvent(
		cwd,
		{
			kind: "deploy",
			schemaVersion: RELEASE_TRANSACTION_SCHEMA_VERSION,
			at,
			releaseId: candidate.releaseId,
			releaseHash: candidate.releaseHash,
			requestHash: input.requestHash,
		},
		(fold) => {
			if (
				fold.some(
					(entry) => entry.operation === "deploy" && entry.releaseId === candidate.releaseId,
				)
			)
				return fail(RELEASE_EXISTS_CODE, [
					`release ${JSON.stringify(candidate.releaseId)} already has a deploy transaction; one authorization deploys at most once`,
				]);
			if (fold.some((entry) => entry.requestHash === input.requestHash))
				return fail(RELEASE_EXISTS_CODE, [
					`request ${JSON.stringify(input.requestHash)} already rides a release transaction`,
				]);
			return null;
		},
		(fold) =>
			fold.find((entry) => entry.operation === "deploy" && entry.releaseId === candidate.releaseId),
	);
}

/**
 * Bind the rollback of one DEPLOYED release to its own authorized F052
 * request on the same releaseHash — recovery can never target an
 * unrelated version, and it never reuses the deployment's request.
 */
function rollbackRelease(cwd, input = {}, opts = {}) {
	const preamble = transactionPreamble(cwd, input);
	if (preamble.failure) return preamble.failure;
	const { candidate, fail } = preamble;
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	return appendTransactionEvent(
		cwd,
		{
			kind: "rollback",
			schemaVersion: RELEASE_TRANSACTION_SCHEMA_VERSION,
			at,
			releaseId: candidate.releaseId,
			releaseHash: candidate.releaseHash,
			requestHash: input.requestHash,
		},
		(fold) => {
			const deploy = fold.find(
				(entry) => entry.operation === "deploy" && entry.releaseId === candidate.releaseId,
			);
			if (!deploy)
				return fail(RELEASE_TX_STATE_CODE, [
					`release ${JSON.stringify(candidate.releaseId)} never deployed; rollback follows deployment`,
				]);
			if (deploy.requestHash === input.requestHash)
				return fail(RELEASE_TX_MISMATCH_CODE, [
					`rollback must ride its own authorized request, not the deployment's ${JSON.stringify(input.requestHash)}`,
				]);
			if (
				fold.some(
					(entry) => entry.operation === "rollback" && entry.releaseId === candidate.releaseId,
				)
			)
				return fail(RELEASE_EXISTS_CODE, [
					`release ${JSON.stringify(candidate.releaseId)} already has a rollback transaction`,
				]);
			if (fold.some((entry) => entry.requestHash === input.requestHash))
				return fail(RELEASE_EXISTS_CODE, [
					`request ${JSON.stringify(input.requestHash)} already rides a release transaction`,
				]);
			return null;
		},
		(fold) =>
			fold.find(
				(entry) => entry.operation === "rollback" && entry.releaseId === candidate.releaseId,
			),
	);
}

// A transaction's outcome is the F052 settlement it rides, projected at
// read time: no settlement yet reads as "pending" — absence of Evidence
// never means success.
function withExecutionProjection(cwd, transaction) {
	const execution = showRunnerExecution(cwd, transaction.requestHash);
	return {
		...transaction,
		execution,
		outcome: execution === null ? "pending" : execution.status,
	};
}

function listReleaseTransactions(cwd, { releaseId = null } = {}) {
	return foldReleaseTransactions(cwd)
		.filter((entry) => releaseId === null || entry.releaseId === releaseId)
		.map((entry) => withExecutionProjection(cwd, entry));
}

module.exports = {
	RELEASE_CANDIDATE_SCHEMA_VERSION,
	SUPPORTED_RELEASE_CANDIDATE_SCHEMA_VERSIONS,
	DEFAULT_MAX_RELEASE_CANDIDATES_BYTES,
	REVIEW_AXES,
	GENESIS_HASH,
	chainHash,
	candidatesPath,
	prepareReleaseCandidate,
	showReleaseCandidate,
	listReleaseCandidates,
	RELEASE_AUTHORIZATION_SCHEMA_VERSION,
	SUPPORTED_RELEASE_AUTHORIZATION_SCHEMA_VERSIONS,
	DEFAULT_MAX_RELEASE_AUTHORIZATIONS_BYTES,
	RELEASE_DECISION_KINDS,
	authorizationsPath,
	authorizeRelease,
	showReleaseAuthorization,
	listReleaseAuthorizations,
	RELEASE_TRANSACTION_SCHEMA_VERSION,
	SUPPORTED_RELEASE_TRANSACTION_SCHEMA_VERSIONS,
	RELEASE_TX_OPERATIONS,
	transactionsPath,
	deployRelease,
	rollbackRelease,
	listReleaseTransactions,
};
