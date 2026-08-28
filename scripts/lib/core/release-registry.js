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
const {
	ENVIRONMENTS,
	CREDENTIAL_REQUIREMENTS,
	resolveRequestCapability,
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
};
