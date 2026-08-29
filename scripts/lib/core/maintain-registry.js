"use strict";

// F054 T1 (#279) — Control Band detectors & deterministic Findings.
// F054 T2 (#280) — Trigger Proposals & cooldown dedup.
//
// A detector is a versioned, model-independent Control Band definition:
// metric, source, baseline, deterministic tier rules, window, scope,
// cooldown, resource limits, and the one permitted output type. Detection
// is target-read-only: it evaluates a declared observation fixture against
// the registered definition and appends an immutable Finding — observation
// never becomes remediation, and an Agent can analyze a Finding but can
// never change the detector verdict. Fingerprints are stable functions of
// subject + rule version + scope + window, so repeated observations
// correlate instead of multiplying.
//
// An out-of-band Finding derives one immutable Trigger Proposal keyed by
// its fingerprint — a maintain-ledger record, structurally never a
// canonical artifact, so automation can surface work but can never start
// it. Repeats inside the detector's cooldown append Finding references to
// the open proposal instead of duplicating it; outside cooldown a new
// proposal may open only when the prior one is triaged.
//
// Triage (F054 T3, #281) binds one open proposal to one committed human
// Decision under the closed vocabulary fix|schedule|dismiss. schedule and
// dismiss preserve their reasons and close the proposal reviewably; only
// fix returns a CANDIDATE Intent admission payload that must still pass
// the normal canonical artifact surface — nothing is auto-admitted, so
// re-entry remains human-governed.
//
// Staleness (F054 T4, #282) is derived at read time, never edited in
// place: a Finding (and its proposal chain) reads stale when a newer
// detector version is registered or a later observation re-presents the
// same fingerprint with different input. Completing a fix-triaged
// proposal appends one immutable record binding fingerprint → committed
// Intent → committed Eval definition + Eval result pins, so a shipped
// fix becomes a regression signal. Rollups are deterministic within a
// declared bound and mark truncation explicitly.

const crypto = require("node:crypto");
const path = require("node:path");

const { readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { typedError } = require("./error-catalog");
const { listArtifactRevisions } = require("./canonical-artifacts");
const { resolveActivePrincipal } = require("./principal-registry");
const { canonicalJson } = require("./context-hash");
const {
	GENESIS_HASH,
	chainHash,
	acquireLedgerLock,
	appendLedgerEvent,
	credentialLeakProblem,
	isPlainObject,
	isNonEmptyString,
	closedFieldProblem,
	unknownFieldProblem,
	decisionPinProblem,
	resolveRegistrationDecision,
} = require("./registry-ledger");

// v2 added the required service `owner` and the optional `policy` pin
// (acceptance review P1/P3); v1 detector events stay readable with both
// folded to null — triage of a v1 detector keeps its any-human latitude.
const MAINTAIN_DETECTOR_SCHEMA_VERSION = 2;
const SUPPORTED_MAINTAIN_DETECTOR_SCHEMA_VERSIONS = Object.freeze([1, 2]);
const MAINTAIN_FINDING_SCHEMA_VERSION = 1;
const SUPPORTED_MAINTAIN_FINDING_SCHEMA_VERSIONS = Object.freeze([1]);
const MAINTAIN_PROPOSAL_SCHEMA_VERSION = 1;
const SUPPORTED_MAINTAIN_PROPOSAL_SCHEMA_VERSIONS = Object.freeze([1]);
const DEFAULT_MAX_MAINTAIN_BYTES = 1024 * 1024;
const LOCK_STALE_MS = 30_000;

// The deterministic comparator vocabulary a tier rule may use; validation
// derives from the same map that evaluates, so the two cannot drift.
const COMPARATOR_PREDICATES = Object.freeze({
	ge: (value, threshold) => value >= threshold,
	gt: (value, threshold) => value > threshold,
	le: (value, threshold) => value <= threshold,
	lt: (value, threshold) => value < threshold,
});
const DETECTOR_COMPARATORS = Object.freeze(Object.keys(COMPARATOR_PREDICATES));
// The only output a detector may produce: an immutable Finding.
const DETECTOR_OUTPUT_TYPES = Object.freeze(["finding"]);
// Human-only authority slots, mirroring the F050/F051/F052 contract.
const MAINTAIN_DECISION_KINDS = Object.freeze(["acceptance", "approval"]);
// The closed triage vocabulary: only fix re-enters the Intent pipeline.
const TRIAGE_OUTCOMES = Object.freeze(["fix", "schedule", "dismiss"]);

const MAINTAIN_INVALID_CODE = "AMBER_E_MAINTAIN_INVALID";
const MAINTAIN_EXISTS_CODE = "AMBER_E_MAINTAIN_EXISTS";
const MAINTAIN_NOT_FOUND_CODE = "AMBER_E_MAINTAIN_NOT_FOUND";
const MAINTAIN_CORRUPT_CODE = "AMBER_E_MAINTAIN_CORRUPT";
const MAINTAIN_LOCK_CODE = "AMBER_E_MAINTAIN_LOCK";
const MAINTAIN_SIZE_CEILING_CODE = "AMBER_E_MAINTAIN_SIZE_CEILING";
const FINDING_CORRUPT_CODE = "AMBER_E_MAINTAIN_FINDING_CORRUPT";
const FINDING_LOCK_CODE = "AMBER_E_MAINTAIN_FINDING_LOCK";
const FINDING_SIZE_CEILING_CODE = "AMBER_E_MAINTAIN_FINDING_SIZE_CEILING";
const PROPOSAL_EXISTS_CODE = "AMBER_E_MAINTAIN_PROPOSAL_EXISTS";
const PROPOSAL_CORRUPT_CODE = "AMBER_E_MAINTAIN_PROPOSAL_CORRUPT";
const PROPOSAL_LOCK_CODE = "AMBER_E_MAINTAIN_PROPOSAL_LOCK";
const PROPOSAL_SIZE_CEILING_CODE = "AMBER_E_MAINTAIN_PROPOSAL_SIZE_CEILING";
const MAINTAIN_LEAK_CODE = "AMBER_E_MAINTAIN_CREDENTIAL_LEAK";

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

const DETECTOR_INPUT_FIELDS = Object.freeze([
	"id",
	"version",
	"metric",
	"source",
	"baseline",
	"rules",
	"windowMs",
	"scope",
	"cooldownMs",
	"maxObservations",
	"outputType",
	"owner",
	"policy",
	"decision",
]);
const DECISION_FIELDS = Object.freeze(["identity", "revision", "decisionKind", "principal"]);
const RULE_FIELDS = Object.freeze(["tier", "comparator", "threshold"]);
const DETECTOR_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"version",
	"metric",
	"source",
	"baseline",
	"rules",
	"windowMs",
	"scope",
	"cooldownMs",
	"maxObservations",
	"outputType",
	"owner",
	"policy",
	"decision",
	"prevHash",
	"hash",
]);
const DETECTOR_EVENT_FIELDS_V1 = Object.freeze(
	DETECTOR_EVENT_FIELDS.filter((field) => field !== "owner" && field !== "policy"),
);
const DETECT_INPUT_FIELDS = Object.freeze([
	"detectorId",
	"detectorVersion",
	"subject",
	"window",
	"value",
	"inputHash",
]);
const WINDOW_FIELDS = Object.freeze(["from", "to"]);
const FINDING_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"detectorId",
	"detectorVersion",
	"subject",
	"scope",
	"window",
	"value",
	"inputHash",
	"baselineHash",
	"tier",
	"fingerprint",
	"prevHash",
	"hash",
]);

function detectorsPath(cwd) {
	return statePathForCreate(cwd, "maintain", "detectors.jsonl");
}

function findingsPath(cwd) {
	return statePathForCreate(cwd, "maintain", "findings.jsonl");
}

function maintainCorrupt(message) {
	return typedError(MAINTAIN_CORRUPT_CODE, message);
}

function findingCorrupt(message) {
	return typedError(FINDING_CORRUPT_CODE, message);
}

function acquireDetectorLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(detectorsPath(cwd)),
		lockName: "detectors.lock",
		conflictCode: MAINTAIN_LOCK_CODE,
		corruptCode: MAINTAIN_CORRUPT_CODE,
		label: "maintain detector registry",
		staleMs: LOCK_STALE_MS,
	});
}

function acquireFindingLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(findingsPath(cwd)),
		lockName: "findings.lock",
		conflictCode: FINDING_LOCK_CODE,
		corruptCode: FINDING_CORRUPT_CODE,
		label: "maintain finding ledger",
		staleMs: LOCK_STALE_MS,
	});
}

function canonicalHashOf(value) {
	return `sha256:${crypto
		.createHash("sha256")
		.update(Buffer.from(canonicalJson(JSON.stringify(value))))
		.digest("hex")}`;
}

function decisionShapeProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, DECISION_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(value.identity)) return `${label}.identity must be a non-empty string`;
	if (!Number.isInteger(value.revision) || value.revision < 1)
		return `${label}.revision must be a positive integer`;
	if (!MAINTAIN_DECISION_KINDS.includes(value.decisionKind))
		return `${label}.decisionKind must be one of ${MAINTAIN_DECISION_KINDS.join(", ")}`;
	if (!isNonEmptyString(value.principal)) return `${label}.principal must be a non-empty string`;
	return null;
}

// The caller-facing identity@revision pin, before registry resolution.
function rulesProblem(rules, label) {
	if (!Array.isArray(rules) || rules.length === 0)
		return `${label} must be a non-empty array of deterministic tier rules`;
	const tiers = new Set();
	for (let index = 0; index < rules.length; index += 1) {
		const rule = rules[index];
		if (!isPlainObject(rule)) return `${label}[${index}] must be an object`;
		const closed = closedFieldProblem(rule, RULE_FIELDS, `${label}[${index}]`);
		if (closed !== null) return closed;
		if (!isNonEmptyString(rule.tier)) return `${label}[${index}].tier must be a non-empty string`;
		if (rule.tier === "in-band")
			return `${label}[${index}].tier must not shadow the reserved in-band verdict`;
		if (tiers.has(rule.tier)) return `${label}[${index}] repeats tier ${JSON.stringify(rule.tier)}`;
		tiers.add(rule.tier);
		if (!DETECTOR_COMPARATORS.includes(rule.comparator))
			return `${label}[${index}].comparator must be one of ${DETECTOR_COMPARATORS.join(", ")}`;
		if (typeof rule.threshold !== "number" || !Number.isFinite(rule.threshold))
			return `${label}[${index}].threshold must be a finite number`;
	}
	return null;
}

// The detector definition shape shared by register input and stored event.
function detectorShapeProblem(value, label) {
	for (const field of ["id", "version", "metric", "source", "scope"]) {
		if (!isNonEmptyString(value[field])) return `${label}.${field} must be a non-empty string`;
	}
	if (typeof value.baseline !== "number" || !Number.isFinite(value.baseline))
		return `${label}.baseline must be a finite number`;
	const rules = rulesProblem(value.rules, `${label}.rules`);
	if (rules !== null) return rules;
	// cooldownMs and maxObservations are declared, pinned limits here;
	// their enforcement is the F054 T2 (#280) trigger/cooldown surface.
	for (const field of ["windowMs", "cooldownMs", "maxObservations"]) {
		if (!Number.isInteger(value[field]) || value[field] < 1)
			return `${label}.${field} must be a positive integer`;
	}
	if (!DETECTOR_OUTPUT_TYPES.includes(value.outputType))
		return `${label}.outputType must be one of ${DETECTOR_OUTPUT_TYPES.join(", ")}`;
	return null;
}

function detectorEventProblem(event, lineIndex) {
	const label = `maintain detector event ${lineIndex}`;
	const closed = closedFieldProblem(
		event,
		event.schemaVersion === 1 ? DETECTOR_EVENT_FIELDS_V1 : DETECTOR_EVENT_FIELDS,
		label,
	);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at)) return `${label}.at must be a non-empty string`;
	const shape = detectorShapeProblem(event, label);
	if (shape !== null) return shape;
	if (event.schemaVersion !== 1) {
		if (!isNonEmptyString(event.owner))
			return `${label}.owner must name the declared service owner`;
		if (event.policy !== null) {
			const pin = artifactPinProblem(event.policy, `${label}.policy`);
			if (pin !== null) return pin;
		}
	}
	return decisionShapeProblem(event.decision, `${label}.decision`);
}

function detectorKey(id, version) {
	return `${id}@${version}`;
}

function foldDetectors(cwd) {
	const events = readLedgerFailClosed(
		detectorsPath(cwd),
		MAINTAIN_CORRUPT_CODE,
		"maintain detector registry",
	);
	let prevHash = GENESIS_HASH;
	const keys = new Set();
	const detectors = [];
	events.forEach((event, index) => {
		const lineIndex = index + 1;
		if (!isPlainObject(event))
			throw maintainCorrupt(`maintain detector event ${lineIndex} is not an object`);
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash)
			throw maintainCorrupt(`maintain detector event ${lineIndex} breaks the hash chain`);
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash)
			throw maintainCorrupt(
				`maintain detector event ${lineIndex} carries a hash that does not match its content`,
			);
		if (!SUPPORTED_MAINTAIN_DETECTOR_SCHEMA_VERSIONS.includes(event.schemaVersion))
			throw maintainCorrupt(
				`maintain detector event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		if (event.kind !== "detector")
			throw maintainCorrupt(
				`maintain detector event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
			);
		const problem = detectorEventProblem(event, lineIndex);
		if (problem !== null) throw maintainCorrupt(problem);
		const key = detectorKey(event.id, event.version);
		if (keys.has(key))
			throw maintainCorrupt(`detector ${JSON.stringify(key)} is registered more than once`);
		keys.add(key);
		const { prevHash: _prev, hash: _hash, ...body } = event;
		detectors.push({ ...body, owner: event.owner ?? null, policy: event.policy ?? null, index });
		prevHash = event.hash;
	});
	return detectors;
}

// A registration Decision is single-use across the detector registry.
function decisionSpentBy(detectors, decision) {
	const spender = detectors.find(
		(entry) =>
			entry.decision.identity === decision.identity &&
			entry.decision.revision === decision.revision,
	);
	return spender ? detectorKey(spender.id, spender.version) : null;
}

// Registration authority: a committed human acceptance/approval Decision
// with a verified principal snapshot, mirroring the F051/F052 contract.
// `label` names the requesting surface in refusal messages.
function resolveRegistryDecision(cwd, decision, label = "detector registration") {
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
	const resolved = resolveRegistrationDecision(revisions, decision, MAINTAIN_DECISION_KINDS, label);
	if (resolved.problem)
		return { ok: false, code: MAINTAIN_INVALID_CODE, errors: [resolved.problem] };
	return { ok: true, decision: resolved.decision };
}

const DETECTOR_LEDGER = Object.freeze({
	acquire: acquireDetectorLock,
	fold: foldDetectors,
	path: detectorsPath,
	corruptCode: MAINTAIN_CORRUPT_CODE,
	sizeCeilingCode: MAINTAIN_SIZE_CEILING_CODE,
	envName: "AMBER_MAINTAIN_MAX_DETECTORS_BYTES",
	defaultBytes: DEFAULT_MAX_MAINTAIN_BYTES,
	label: "maintain detector registry",
});

/**
 * Register one versioned Control Band detector as a human-approved
 * governance mutation: a detector id/version pair registers at most once,
 * and the registration Decision is single-use across the registry.
 */
function registerDetector(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(MAINTAIN_INVALID_CODE, ["detector input must be an object"]);
	const inputClosed = unknownFieldProblem(input, DETECTOR_INPUT_FIELDS, "detector input");
	if (inputClosed !== null) return fail(MAINTAIN_INVALID_CODE, [inputClosed]);
	const shape = detectorShapeProblem(input, "detector input");
	if (shape !== null) return fail(MAINTAIN_INVALID_CODE, [shape]);
	// The declared owner is the ONLY principal whose Decision may triage
	// this detector's proposals: service-owner triage is a registered,
	// verified human identity, never a free string.
	if (!isNonEmptyString(input.owner))
		return fail(MAINTAIN_INVALID_CODE, [
			"owner must name the declared service owner; triage belongs to the owner",
		]);
	let ownerPrincipal;
	try {
		ownerPrincipal = resolveActivePrincipal(cwd, input.owner, {
			now: opts.now instanceof Date ? opts.now : new Date(),
		});
	} catch (err) {
		return fail(err.amberCode || MAINTAIN_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (!ownerPrincipal.ok) return fail(MAINTAIN_INVALID_CODE, [ownerPrincipal.message]);
	if (ownerPrincipal.principal.principalKind !== "human")
		return fail(MAINTAIN_INVALID_CODE, [
			`owner ${JSON.stringify(input.owner)} is not a human principal; service-owner triage is human-governed`,
		]);
	// The optional Policy pin names the committed policy revision the
	// detector's thresholds depend on — a newer committed revision makes
	// dependent evaluations stale rather than silently reinterpreted.
	const policy = input.policy ?? null;
	if (policy !== null) {
		const policyPin = artifactPinProblem(policy, "detector input.policy");
		if (policyPin !== null) return fail(MAINTAIN_INVALID_CODE, [policyPin]);
		let revisions;
		try {
			revisions = listArtifactRevisions(cwd);
		} catch (err) {
			return fail(err.amberCode || "AMBER_E_ARTIFACT_JOURNAL_CORRUPT", [
				err.message || String(err),
			]);
		}
		const committed = revisions.some(
			(revision) =>
				revision.type === "policy" &&
				revision.identity === policy.identity &&
				revision.revision === policy.revision,
		);
		if (!committed)
			return fail(MAINTAIN_INVALID_CODE, [
				`policy ${JSON.stringify(policy.identity)}@${policy.revision} is not a committed policy artifact revision; a detector pins the Policy its thresholds depend on`,
			]);
	}
	const pinProblem = decisionPinProblem(input.decision);
	if (pinProblem !== null) return fail(MAINTAIN_INVALID_CODE, [pinProblem]);
	const resolved = resolveRegistryDecision(cwd, input.decision);
	if (!resolved.ok) return fail(resolved.code, resolved.errors);
	// Single-use ACROSS the maintain ledgers, both directions: a Decision
	// spent by a triage can never also authorize a registration.
	let triageSpender;
	try {
		triageSpender = foldProposals(cwd).find(
			(entry) =>
				entry.triage !== null &&
				entry.triage.decision.identity === input.decision.identity &&
				entry.triage.decision.revision === input.decision.revision,
		);
	} catch (err) {
		return fail(err.amberCode || PROPOSAL_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (triageSpender)
		return fail(MAINTAIN_INVALID_CODE, [
			`decision ${JSON.stringify(input.decision.identity)}@${input.decision.revision} already triaged the proposal for ${JSON.stringify(triageSpender.fingerprint)}; a Decision is single-use across the maintain ledgers`,
		]);
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	return appendLedgerEvent(
		cwd,
		DETECTOR_LEDGER,
		{
			kind: "detector",
			schemaVersion: MAINTAIN_DETECTOR_SCHEMA_VERSION,
			at,
			id: input.id,
			version: input.version,
			metric: input.metric,
			source: input.source,
			baseline: input.baseline,
			rules: input.rules,
			windowMs: input.windowMs,
			scope: input.scope,
			cooldownMs: input.cooldownMs,
			maxObservations: input.maxObservations,
			outputType: input.outputType,
			owner: input.owner,
			policy,
			decision: resolved.decision,
		},
		(fold) => {
			const key = detectorKey(input.id, input.version);
			if (fold.some((entry) => detectorKey(entry.id, entry.version) === key))
				return fail(MAINTAIN_EXISTS_CODE, [
					`detector ${JSON.stringify(key)} is already registered; a changed definition registers a new version`,
				]);
			const spentBy = decisionSpentBy(fold, input.decision);
			if (spentBy !== null)
				return fail(MAINTAIN_INVALID_CODE, [
					`decision ${JSON.stringify(input.decision.identity)}@${input.decision.revision} already authorized ${JSON.stringify(spentBy)}; a registration Decision is single-use`,
				]);
			return null;
		},
		(fold) =>
			fold.find(
				(entry) => detectorKey(entry.id, entry.version) === detectorKey(input.id, input.version),
			),
	);
}

function showDetector(cwd, id, version = null) {
	const versions = foldDetectors(cwd).filter((entry) => entry.id === id);
	if (versions.length === 0) return null;
	if (version === null) return versions[versions.length - 1];
	return versions.find((entry) => entry.version === version) ?? null;
}

function listDetectors(cwd) {
	return foldDetectors(cwd);
}

// The stable correlation identity of an observation: subject + rule
// version + scope + window, keyed by detector id so two detectors sharing
// scope and version can never collide — deliberately NOT the input
// values, so repeated observations of the same condition share one
// fingerprint.
function fingerprintOf(detector, subject, window) {
	return canonicalHashOf({
		subject,
		detectorId: detector.id,
		ruleVersion: detector.version,
		scope: detector.scope,
		window,
	});
}

// The definition content a Finding is judged against: baseline + rules,
// hashed so a changed definition is a visibly different basis.
function baselineHashOf(detector) {
	return canonicalHashOf({ baseline: detector.baseline, rules: detector.rules });
}

function windowProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, WINDOW_FIELDS, label);
	if (closed !== null) return closed;
	for (const field of WINDOW_FIELDS) {
		if (!isNonEmptyString(value[field]) || Number.isNaN(Date.parse(value[field])))
			return `${label}.${field} must be an ISO-8601 timestamp`;
	}
	if (Date.parse(value.to) < Date.parse(value.from)) return `${label}.to must not precede from`;
	return null;
}

function findingEventProblem(event, lineIndex) {
	const label = `maintain finding event ${lineIndex}`;
	const closed = closedFieldProblem(event, FINDING_EVENT_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at)) return `${label}.at must be a non-empty string`;
	for (const field of ["detectorId", "detectorVersion", "subject", "scope", "tier"]) {
		if (!isNonEmptyString(event[field])) return `${label}.${field} must be a non-empty string`;
	}
	const window = windowProblem(event.window, `${label}.window`);
	if (window !== null) return window;
	if (typeof event.value !== "number" || !Number.isFinite(event.value))
		return `${label}.value must be a finite number`;
	for (const field of ["inputHash", "baselineHash", "fingerprint"]) {
		if (!HASH_PATTERN.test(event[field] ?? ""))
			return `${label}.${field} must be a sha256:<64-hex> string`;
	}
	return null;
}

function foldFindings(cwd) {
	const events = readLedgerFailClosed(
		findingsPath(cwd),
		FINDING_CORRUPT_CODE,
		"maintain finding ledger",
	);
	let prevHash = GENESIS_HASH;
	const findings = [];
	events.forEach((event, index) => {
		const lineIndex = index + 1;
		if (!isPlainObject(event))
			throw findingCorrupt(`maintain finding event ${lineIndex} is not an object`);
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash)
			throw findingCorrupt(`maintain finding event ${lineIndex} breaks the hash chain`);
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash)
			throw findingCorrupt(
				`maintain finding event ${lineIndex} carries a hash that does not match its content`,
			);
		if (!SUPPORTED_MAINTAIN_FINDING_SCHEMA_VERSIONS.includes(event.schemaVersion))
			throw findingCorrupt(
				`maintain finding event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		if (event.kind !== "finding")
			throw findingCorrupt(
				`maintain finding event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
			);
		const problem = findingEventProblem(event, lineIndex);
		if (problem !== null) throw findingCorrupt(problem);
		const { prevHash: _prev, hash: _hash, ...body } = event;
		findings.push({ ...body, index });
		prevHash = event.hash;
	});
	return findings;
}

const FINDING_LEDGER = Object.freeze({
	acquire: acquireFindingLock,
	fold: foldFindings,
	path: findingsPath,
	corruptCode: FINDING_CORRUPT_CODE,
	sizeCeilingCode: FINDING_SIZE_CEILING_CODE,
	envName: "AMBER_MAINTAIN_MAX_FINDINGS_BYTES",
	defaultBytes: DEFAULT_MAX_MAINTAIN_BYTES,
	label: "maintain finding ledger",
});

// The deterministic tier verdict: the LAST matching rule wins so
// definitions list tiers from least to most severe; no rule matching
// reads as the reserved in-band verdict.
function tierOf(detector, value) {
	let verdict = "in-band";
	for (const rule of detector.rules) {
		if (COMPARATOR_PREDICATES[rule.comparator](value, rule.threshold)) verdict = rule.tier;
	}
	return verdict;
}

/**
 * Evaluate one declared observation against one registered detector
 * version. Target-read-only and model-independent: the verdict is a pure
 * function of the definition and the observation. An in-band verdict
 * returns without appending; an out-of-band verdict appends one immutable
 * Finding carrying the input and baseline hashes and the stable
 * fingerprint.
 */
function detect(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, tier: null, errors });
	if (!isPlainObject(input)) return fail(MAINTAIN_INVALID_CODE, ["detect input must be an object"]);
	const inputClosed = unknownFieldProblem(input, DETECT_INPUT_FIELDS, "detect input");
	if (inputClosed !== null) return fail(MAINTAIN_INVALID_CODE, [inputClosed]);
	for (const field of ["detectorId", "detectorVersion", "subject"]) {
		if (!isNonEmptyString(input[field]))
			return fail(MAINTAIN_INVALID_CODE, [`${field} must be a non-empty string`]);
	}
	const window = windowProblem(input.window, "window");
	if (window !== null) return fail(MAINTAIN_INVALID_CODE, [window]);
	if (typeof input.value !== "number" || !Number.isFinite(input.value))
		return fail(MAINTAIN_INVALID_CODE, ["value must be a finite number"]);
	if (!HASH_PATTERN.test(input.inputHash ?? ""))
		return fail(MAINTAIN_INVALID_CODE, ["inputHash must be a sha256:<64-hex> string"]);
	let detector;
	try {
		detector = showDetector(cwd, input.detectorId, input.detectorVersion);
	} catch (err) {
		return fail(err.amberCode || MAINTAIN_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (detector === null)
		return fail(MAINTAIN_NOT_FOUND_CODE, [
			`detector ${JSON.stringify(detectorKey(input.detectorId, input.detectorVersion))} is not registered`,
		]);
	const spanMs = Date.parse(input.window.to) - Date.parse(input.window.from);
	if (spanMs > detector.windowMs)
		return fail(MAINTAIN_INVALID_CODE, [
			`window spans ${spanMs} ms, above the detector's declared ${detector.windowMs} ms`,
		]);
	const tier = tierOf(detector, input.value);
	if (tier === "in-band") return { ok: true, code: null, record: null, tier, errors: [] };
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	const appended = appendLedgerEvent(
		cwd,
		FINDING_LEDGER,
		{
			kind: "finding",
			schemaVersion: MAINTAIN_FINDING_SCHEMA_VERSION,
			at,
			detectorId: detector.id,
			detectorVersion: detector.version,
			subject: input.subject,
			scope: detector.scope,
			window: input.window,
			value: input.value,
			inputHash: input.inputHash,
			baselineHash: baselineHashOf(detector),
			tier,
			fingerprint: fingerprintOf(detector, input.subject, input.window),
		},
		() => null,
		(fold) => fold[fold.length - 1],
	);
	if (!appended.ok) return { ...appended, tier: null };
	return { ...appended, tier };
}

// Staleness is derived at read time, never edited: prior results become
// stale rather than silently reinterpreted.
function latestDetectorFor(detectors, id) {
	const versions = detectors.filter((entry) => entry.id === id);
	return versions.length > 0 ? versions[versions.length - 1] : null;
}

function findingStaleReasons(finding, detectors, findings, revisions = null) {
	const reasons = [];
	const latest = latestDetectorFor(detectors, finding.detectorId);
	if (latest !== null && latest.version !== finding.detectorVersion)
		reasons.push("detector-superseded");
	const represented = findings.some(
		(entry) =>
			entry.index > finding.index &&
			entry.fingerprint === finding.fingerprint &&
			entry.inputHash !== finding.inputHash,
	);
	if (represented) reasons.push("observation-superseded");
	// A newer committed revision of the pinned Policy makes evaluations
	// under the OWN detector version stale — Policy changes never
	// silently reinterpret prior results.
	const own =
		detectors.find(
			(entry) => entry.id === finding.detectorId && entry.version === finding.detectorVersion,
		) ?? null;
	if (
		own !== null &&
		own.policy !== null &&
		revisions !== null &&
		revisions.some(
			(revision) =>
				revision.type === "policy" &&
				revision.identity === own.policy.identity &&
				revision.revision > own.policy.revision,
		)
	)
		reasons.push("policy-superseded");
	return reasons;
}

function withStaleness(entry, reasons) {
	return { ...entry, stale: reasons.length > 0, staleReasons: reasons };
}

// The artifact journal is consulted only when some detector pins a
// Policy, so policy-free repositories never pay (or fail on) that read.
function policyRevisionsFor(cwd, detectors) {
	return detectors.some((entry) => entry.policy !== null) ? listArtifactRevisions(cwd) : null;
}

function listFindings(cwd, { detectorId = null, fingerprint = null } = {}) {
	const detectors = foldDetectors(cwd);
	const findings = foldFindings(cwd);
	const revisions = policyRevisionsFor(cwd, detectors);
	return findings
		.filter(
			(entry) =>
				(detectorId === null || entry.detectorId === detectorId) &&
				(fingerprint === null || entry.fingerprint === fingerprint),
		)
		.map((entry) =>
			withStaleness(entry, findingStaleReasons(entry, detectors, findings, revisions)),
		);
}

function proposalsPath(cwd) {
	return statePathForCreate(cwd, "maintain", "proposals.jsonl");
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
		label: "maintain proposal ledger",
		staleMs: LOCK_STALE_MS,
	});
}

const PROPOSE_INPUT_FIELDS = Object.freeze(["findingIndex"]);
// Structurally not an Intent: the closed sets carry identities, hashes,
// times, and Finding references only — no field can hold an admission
// payload. `observedAt` copies the referenced Finding's recorded time so
// the cooldown measures observation-to-observation distance.
const PROPOSAL_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"observedAt",
	"fingerprint",
	"detectorId",
	"detectorVersion",
	"subject",
	"scope",
	"tier",
	"cooldownMs",
	"findingIndex",
	"prevHash",
	"hash",
]);
const PROPOSAL_EVIDENCE_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"observedAt",
	"fingerprint",
	"findingIndex",
	"prevHash",
	"hash",
]);
const TRIAGE_INPUT_FIELDS = Object.freeze(["fingerprint", "outcome", "reason", "decision"]);
const TRIAGE_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"fingerprint",
	"outcome",
	"reason",
	"decision",
	"prevHash",
	"hash",
]);
const ARTIFACT_PIN_FIELDS = Object.freeze(["identity", "revision"]);
const COMPLETE_INPUT_FIELDS = Object.freeze(["fingerprint", "intent", "eval", "evalResult"]);
const COMPLETION_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"fingerprint",
	"proposalIndex",
	"intent",
	"eval",
	"evalResult",
	"prevHash",
	"hash",
]);

function artifactPinProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object carrying identity and revision`;
	const closed = closedFieldProblem(value, ARTIFACT_PIN_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(value.identity)) return `${label}.identity must be a non-empty string`;
	if (!Number.isInteger(value.revision) || value.revision < 1)
		return `${label}.revision must be a positive integer`;
	return null;
}

function proposalEventProblem(event, lineIndex) {
	const label = `maintain proposal event ${lineIndex}`;
	if (event.kind === "completion") {
		const closed = closedFieldProblem(event, COMPLETION_EVENT_FIELDS, label);
		if (closed !== null) return closed;
		if (!isNonEmptyString(event.at)) return `${label}.at must be a non-empty string`;
		if (!HASH_PATTERN.test(event.fingerprint ?? ""))
			return `${label}.fingerprint must be a sha256:<64-hex> string`;
		if (!Number.isInteger(event.proposalIndex) || event.proposalIndex < 0)
			return `${label}.proposalIndex must be a non-negative integer`;
		for (const [field, pinLabel] of [
			["intent", `${label}.intent`],
			["eval", `${label}.eval`],
			["evalResult", `${label}.evalResult`],
		]) {
			const pin = artifactPinProblem(event[field], pinLabel);
			if (pin !== null) return pin;
		}
		return null;
	}
	if (event.kind === "triage") {
		const closed = closedFieldProblem(event, TRIAGE_EVENT_FIELDS, label);
		if (closed !== null) return closed;
		if (!isNonEmptyString(event.at)) return `${label}.at must be a non-empty string`;
		if (!HASH_PATTERN.test(event.fingerprint ?? ""))
			return `${label}.fingerprint must be a sha256:<64-hex> string`;
		if (!TRIAGE_OUTCOMES.includes(event.outcome))
			return `${label}.outcome must be one of ${TRIAGE_OUTCOMES.join(", ")}`;
		if (event.outcome === "fix") {
			if (event.reason !== null) return `${label}.reason must be null for a fix triage`;
		} else if (!isNonEmptyString(event.reason)) {
			return `${label}.reason must be a preserved non-empty string for ${event.outcome}`;
		} else {
			const leak = credentialLeakProblem(event.reason, `${label}.reason`);
			if (leak !== null) return leak;
		}
		return decisionShapeProblem(event.decision, `${label}.decision`);
	}
	if (event.kind === "proposal") {
		const closed = closedFieldProblem(event, PROPOSAL_EVENT_FIELDS, label);
		if (closed !== null) return closed;
		for (const field of ["at", "detectorId", "detectorVersion", "subject", "scope", "tier"]) {
			if (!isNonEmptyString(event[field])) return `${label}.${field} must be a non-empty string`;
		}
		if (!Number.isInteger(event.cooldownMs) || event.cooldownMs < 1)
			return `${label}.cooldownMs must be a positive integer`;
	} else {
		const closed = closedFieldProblem(event, PROPOSAL_EVIDENCE_EVENT_FIELDS, label);
		if (closed !== null) return closed;
		if (!isNonEmptyString(event.at)) return `${label}.at must be a non-empty string`;
	}
	if (!HASH_PATTERN.test(event.fingerprint ?? ""))
		return `${label}.fingerprint must be a sha256:<64-hex> string`;
	if (!isNonEmptyString(event.observedAt) || Number.isNaN(Date.parse(event.observedAt)))
		return `${label}.observedAt must be an ISO-8601 timestamp`;
	if (!Number.isInteger(event.findingIndex) || event.findingIndex < 0)
		return `${label}.findingIndex must be a non-negative integer`;
	return null;
}

// Projects one entry per opened proposal: `findings` accumulates the
// opening Finding plus every evidence append, `lastObservedAt` tracks the
// latest referenced observation time the cooldown is measured against.
function foldProposals(cwd) {
	const events = readLedgerFailClosed(
		proposalsPath(cwd),
		PROPOSAL_CORRUPT_CODE,
		"maintain proposal ledger",
	);
	let prevHash = GENESIS_HASH;
	const proposals = [];
	const byFingerprint = new Map();
	events.forEach((event, index) => {
		const lineIndex = index + 1;
		if (!isPlainObject(event))
			throw proposalCorrupt(`maintain proposal event ${lineIndex} is not an object`);
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash)
			throw proposalCorrupt(`maintain proposal event ${lineIndex} breaks the hash chain`);
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash)
			throw proposalCorrupt(
				`maintain proposal event ${lineIndex} carries a hash that does not match its content`,
			);
		if (!SUPPORTED_MAINTAIN_PROPOSAL_SCHEMA_VERSIONS.includes(event.schemaVersion))
			throw proposalCorrupt(
				`maintain proposal event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		if (
			event.kind !== "proposal" &&
			event.kind !== "evidence" &&
			event.kind !== "triage" &&
			event.kind !== "completion"
		)
			throw proposalCorrupt(
				`maintain proposal event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
			);
		const problem = proposalEventProblem(event, lineIndex);
		if (problem !== null) throw proposalCorrupt(problem);
		if (event.kind === "proposal") {
			const current = byFingerprint.get(event.fingerprint);
			if (current && current.status === "open")
				throw proposalCorrupt(
					`maintain proposal event ${lineIndex} reopens fingerprint ${JSON.stringify(event.fingerprint)} while a proposal is open`,
				);
			const { prevHash: _prev, hash: _hash, findingIndex, observedAt, ...body } = event;
			const proposal = {
				...body,
				status: "open",
				findings: [findingIndex],
				lastObservedAt: observedAt,
				triage: null,
				completion: null,
				index,
			};
			proposals.push(proposal);
			byFingerprint.set(event.fingerprint, proposal);
		} else if (event.kind === "evidence") {
			const proposal = byFingerprint.get(event.fingerprint);
			if (!proposal)
				throw proposalCorrupt(
					`maintain proposal event ${lineIndex} appends evidence to unknown fingerprint ${JSON.stringify(event.fingerprint)}`,
				);
			if (proposal.status !== "open")
				throw proposalCorrupt(
					`maintain proposal event ${lineIndex} appends evidence to a triaged proposal`,
				);
			if (proposal.findings.includes(event.findingIndex))
				throw proposalCorrupt(
					`maintain proposal event ${lineIndex} repeats finding ${event.findingIndex}`,
				);
			proposal.findings.push(event.findingIndex);
			// An out-of-order (older) append never regresses the anchor.
			if (Date.parse(event.observedAt) > Date.parse(proposal.lastObservedAt))
				proposal.lastObservedAt = event.observedAt;
		} else if (event.kind === "completion") {
			const proposal = proposals.find((entry) => entry.index === event.proposalIndex);
			if (!proposal || proposal.fingerprint !== event.fingerprint)
				throw proposalCorrupt(
					`maintain proposal event ${lineIndex} completes unknown proposal ${event.proposalIndex} for ${JSON.stringify(event.fingerprint)}`,
				);
			if (proposal.status !== "triaged" || proposal.triage.outcome !== "fix")
				throw proposalCorrupt(
					`maintain proposal event ${lineIndex} completes a proposal that is not fix-triaged`,
				);
			proposal.status = "completed";
			proposal.completion = {
				at: event.at,
				intent: event.intent,
				eval: event.eval,
				evalResult: event.evalResult,
			};
		} else {
			const proposal = byFingerprint.get(event.fingerprint);
			if (!proposal)
				throw proposalCorrupt(
					`maintain proposal event ${lineIndex} triages unknown fingerprint ${JSON.stringify(event.fingerprint)}`,
				);
			if (proposal.status !== "open")
				throw proposalCorrupt(
					`maintain proposal event ${lineIndex} triages an already-triaged proposal`,
				);
			const spender = proposals.find(
				(entry) =>
					entry.triage !== null &&
					entry.triage.decision.identity === event.decision.identity &&
					entry.triage.decision.revision === event.decision.revision,
			);
			if (spender)
				throw proposalCorrupt(
					`maintain proposal event ${lineIndex} reuses triage decision ${JSON.stringify(event.decision.identity)}@${event.decision.revision}`,
				);
			proposal.status = "triaged";
			proposal.triage = {
				at: event.at,
				outcome: event.outcome,
				reason: event.reason,
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
	envName: "AMBER_MAINTAIN_MAX_PROPOSALS_BYTES",
	defaultBytes: DEFAULT_MAX_MAINTAIN_BYTES,
	label: "maintain proposal ledger",
});

// The latest proposal for a fingerprint carries its live state; earlier
// triaged proposals stay listed for review but no longer bind it.
function currentProposalFor(fold, fingerprint) {
	for (let index = fold.length - 1; index >= 0; index -= 1) {
		if (fold[index].fingerprint === fingerprint) return fold[index];
	}
	return null;
}

// The storm identity spans windows: one OPEN proposal per detector id +
// subject, whatever exact window each observation carried, so a sliding
// window can never mint a storm of parallel proposals.
function currentOpenProposalForSubject(fold, detectorId, subject) {
	for (let index = fold.length - 1; index >= 0; index -= 1) {
		const entry = fold[index];
		if (entry.detectorId === detectorId && entry.subject === subject && entry.status === "open")
			return entry;
	}
	return null;
}

/**
 * Derive one immutable Trigger Proposal from one recorded out-of-band
 * Finding — never from caller input: every proposal field copies from the
 * Finding and the registered detector version it names. One open proposal
 * per detector + subject ACROSS windows: a repeat inside the detector's
 * cooldown (measured against the proposal's latest recorded observation)
 * appends the Finding as evidence even when a sliding window minted a new
 * fingerprint; outside cooldown the open proposal must be triaged before
 * a new one may open, so untriaged conditions escalate to a human instead
 * of multiplying. The declared maxObservations bounds the evidence chain.
 */
function propose(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, action: null, errors });
	if (!isPlainObject(input))
		return fail(MAINTAIN_INVALID_CODE, ["propose input must be an object"]);
	const inputClosed = unknownFieldProblem(input, PROPOSE_INPUT_FIELDS, "propose input");
	if (inputClosed !== null) return fail(MAINTAIN_INVALID_CODE, [inputClosed]);
	if (!Number.isInteger(input.findingIndex) || input.findingIndex < 0)
		return fail(MAINTAIN_INVALID_CODE, ["findingIndex must be a non-negative integer"]);
	let finding;
	let detector;
	try {
		finding = foldFindings(cwd).find((entry) => entry.index === input.findingIndex) ?? null;
		if (finding !== null) detector = showDetector(cwd, finding.detectorId, finding.detectorVersion);
	} catch (err) {
		return fail(err.amberCode || FINDING_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (finding === null)
		return fail(MAINTAIN_NOT_FOUND_CODE, [`finding ${input.findingIndex} is not recorded`]);
	if (!detector)
		return fail(MAINTAIN_NOT_FOUND_CODE, [
			`detector ${JSON.stringify(detectorKey(finding.detectorId, finding.detectorVersion))} is not registered`,
		]);
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	let action = null;
	const result = appendLedgerEvent(
		cwd,
		PROPOSAL_LEDGER,
		// The factory re-derives its branch from its own fold, so it agrees
		// with the guard without depending on evaluation order.
		(fold) => {
			const open = currentOpenProposalForSubject(fold, finding.detectorId, finding.subject);
			return open !== null
				? {
						kind: "evidence",
						schemaVersion: MAINTAIN_PROPOSAL_SCHEMA_VERSION,
						at,
						observedAt: finding.at,
						fingerprint: open.fingerprint,
						findingIndex: finding.index,
					}
				: {
						kind: "proposal",
						schemaVersion: MAINTAIN_PROPOSAL_SCHEMA_VERSION,
						at,
						observedAt: finding.at,
						fingerprint: finding.fingerprint,
						detectorId: finding.detectorId,
						detectorVersion: finding.detectorVersion,
						subject: finding.subject,
						scope: finding.scope,
						tier: finding.tier,
						cooldownMs: detector.cooldownMs,
						findingIndex: finding.index,
					};
		},
		(fold) => {
			const open = currentOpenProposalForSubject(fold, finding.detectorId, finding.subject);
			if (open === null) {
				action = "opened";
				return null;
			}
			if (open.findings.includes(finding.index))
				return fail(MAINTAIN_INVALID_CODE, [
					`finding ${finding.index} is already referenced by the open proposal for ${JSON.stringify(open.fingerprint)}`,
				]);
			// A finding observed earlier than the proposal's latest referenced
			// observation is correlation, not a new storm — it appends. The
			// window is half-open, mirroring Approval validity: a delta of
			// exactly cooldownMs is already outside.
			const delta = Date.parse(finding.at) - Date.parse(open.lastObservedAt);
			if (delta >= detector.cooldownMs)
				return fail(PROPOSAL_EXISTS_CODE, [
					`an open proposal for ${JSON.stringify(open.fingerprint)} is outside its ${detector.cooldownMs} ms cooldown and must be triaged before a new proposal may open`,
				]);
			// The declared resource limit bounds the evidence chain: an
			// open proposal never references more than maxObservations
			// observations — the dead knob is now the storm ceiling.
			if (open.findings.length >= detector.maxObservations)
				return fail(MAINTAIN_INVALID_CODE, [
					`the open proposal for ${JSON.stringify(open.fingerprint)} already references its declared maxObservations (${detector.maxObservations}); triage it before recording more evidence`,
				]);
			action = "appended";
			return null;
		},
		(fold) => currentOpenProposalForSubject(fold, finding.detectorId, finding.subject),
	);
	return { ...result, action: result.ok ? action : null };
}

// A proposal chain inherits staleness from its detector version and its
// referenced Findings.
function proposalStaleReasons(proposal, detectors, findings, revisions = null) {
	const reasons = new Set();
	const latest = latestDetectorFor(detectors, proposal.detectorId);
	if (latest !== null && latest.version !== proposal.detectorVersion)
		reasons.add("detector-superseded");
	for (const index of proposal.findings) {
		const finding = findings.find((entry) => entry.index === index);
		if (!finding) continue;
		for (const reason of findingStaleReasons(finding, detectors, findings, revisions))
			reasons.add(reason);
	}
	return [...reasons].sort();
}

function listProposals(cwd, { fingerprint = null } = {}) {
	const detectors = foldDetectors(cwd);
	const findings = foldFindings(cwd);
	const revisions = policyRevisionsFor(cwd, detectors);
	return foldProposals(cwd)
		.filter((entry) => fingerprint === null || entry.fingerprint === fingerprint)
		.map((entry) =>
			withStaleness(entry, proposalStaleReasons(entry, detectors, findings, revisions)),
		);
}

// The prepare-only CANDIDATE Intent admission payload a fix triage
// returns, mirroring F051 migration candidates: a plain input for the
// normal canonical artifact surface. Nothing is auto-admitted — the
// candidate still faces Intent admission, scope, Policy, and Acceptance.
// The identity derives from the fingerprint deliberately, so re-fixing a
// reopened proposal revises the SAME Intent (a second admission passes
// expectedHead through the normal CAS rules).
function candidateIntentFor(proposal, findings) {
	const referenced = findings.filter((entry) => proposal.findings.includes(entry.index));
	return {
		type: "intent",
		identity: `intent/maintain/${proposal.fingerprint.slice(7, 23)}`,
		body: [
			`# Fix ${proposal.subject}: ${proposal.detectorId}@${proposal.detectorVersion} out of band`,
			"",
			`Control Band detector ${proposal.detectorId}@${proposal.detectorVersion} observed ${proposal.subject} at tier ${proposal.tier} in scope ${proposal.scope}.`,
			"",
			`Fingerprint: ${proposal.fingerprint}`,
			"",
			"Evidence (maintain Findings):",
			...referenced.map(
				(entry) =>
					`- finding ${entry.index}: value ${entry.value} (${entry.tier}) over ${entry.window.from} .. ${entry.window.to}, input ${entry.inputHash}`,
			),
			"",
		].join("\n"),
		scope: proposal.scope,
	};
}

/**
 * Bind one open Trigger Proposal to one committed human Decision under
 * the closed fix|schedule|dismiss vocabulary. schedule and dismiss
 * preserve their reasons and close the proposal reviewably; only fix
 * additionally returns a prepare-only candidate Intent admission payload
 * — triage itself never mutates canonical state, and the Decision is
 * single-use across the maintain ledgers.
 */
function triage(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, candidate: null, errors });
	if (!isPlainObject(input)) return fail(MAINTAIN_INVALID_CODE, ["triage input must be an object"]);
	const inputClosed = unknownFieldProblem(input, TRIAGE_INPUT_FIELDS, "triage input");
	if (inputClosed !== null) return fail(MAINTAIN_INVALID_CODE, [inputClosed]);
	if (!HASH_PATTERN.test(input.fingerprint ?? ""))
		return fail(MAINTAIN_INVALID_CODE, ["fingerprint must be a sha256:<64-hex> string"]);
	if (!TRIAGE_OUTCOMES.includes(input.outcome))
		return fail(MAINTAIN_INVALID_CODE, [`outcome must be one of ${TRIAGE_OUTCOMES.join(", ")}`]);
	const reason = input.reason ?? null;
	if (input.outcome === "fix") {
		if (reason !== null)
			return fail(MAINTAIN_INVALID_CODE, [
				"a fix triage carries its rationale in the candidate Intent body; reason is preserved only for schedule and dismiss",
			]);
	} else if (!isNonEmptyString(reason)) {
		return fail(MAINTAIN_INVALID_CODE, [
			`a ${input.outcome} triage must preserve a non-empty reason`,
		]);
	} else {
		const leak = credentialLeakProblem(reason, "reason");
		if (leak !== null) return fail(MAINTAIN_LEAK_CODE, [leak]);
	}
	const pinProblem = decisionPinProblem(input.decision);
	if (pinProblem !== null) return fail(MAINTAIN_INVALID_CODE, [pinProblem]);
	const resolved = resolveRegistryDecision(cwd, input.decision, "maintain triage");
	if (!resolved.ok) return fail(resolved.code, resolved.errors);
	let registrationSpender;
	try {
		registrationSpender = decisionSpentBy(foldDetectors(cwd), input.decision);
	} catch (err) {
		return fail(err.amberCode || MAINTAIN_CORRUPT_CODE, [err.message || String(err)]);
	}
	if (registrationSpender !== null)
		return fail(MAINTAIN_INVALID_CODE, [
			`decision ${JSON.stringify(input.decision.identity)}@${input.decision.revision} already authorized detector ${JSON.stringify(registrationSpender)}; a Decision is single-use across the maintain ledgers`,
		]);
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	let candidate = null;
	const result = appendLedgerEvent(
		cwd,
		PROPOSAL_LEDGER,
		{
			kind: "triage",
			schemaVersion: MAINTAIN_PROPOSAL_SCHEMA_VERSION,
			at,
			fingerprint: input.fingerprint,
			outcome: input.outcome,
			reason,
			decision: resolved.decision,
		},
		(fold) => {
			const current = currentProposalFor(fold, input.fingerprint);
			if (current === null)
				return fail(MAINTAIN_NOT_FOUND_CODE, [
					`no proposal exists for ${JSON.stringify(input.fingerprint)}`,
				]);
			if (current.status !== "open")
				return fail(MAINTAIN_INVALID_CODE, [
					`the proposal for ${JSON.stringify(input.fingerprint)} is already triaged (${current.triage.outcome}); triage of a closed proposal refuses`,
				]);
			// Service-owner triage: the proposal's detector version names
			// the ONLY principal whose Decision may triage it. A v1
			// detector (owner folded to null) keeps its any-human latitude.
			let ownedBy;
			try {
				ownedBy = showDetector(cwd, current.detectorId, current.detectorVersion);
			} catch (err) {
				return fail(err.amberCode || MAINTAIN_CORRUPT_CODE, [err.message || String(err)]);
			}
			if (
				ownedBy !== null &&
				ownedBy.owner !== null &&
				ownedBy.owner !== resolved.decision.principal
			)
				return fail(MAINTAIN_INVALID_CODE, [
					`triage of ${JSON.stringify(input.fingerprint)} belongs to the declared service owner ${JSON.stringify(ownedBy.owner)}; the decision principal ${JSON.stringify(resolved.decision.principal)} does not own detector ${JSON.stringify(detectorKey(current.detectorId, current.detectorVersion))}`,
				]);
			const spender = fold.find(
				(entry) =>
					entry.triage !== null &&
					entry.triage.decision.identity === input.decision.identity &&
					entry.triage.decision.revision === input.decision.revision,
			);
			if (spender)
				return fail(MAINTAIN_INVALID_CODE, [
					`decision ${JSON.stringify(input.decision.identity)}@${input.decision.revision} already triaged the proposal for ${JSON.stringify(spender.fingerprint)}; a Decision is single-use across the maintain ledgers`,
				]);
			if (input.outcome === "fix") {
				// Folded under the proposal lock: evidence is only appended
				// while this lock is held, so the candidate sees every
				// Finding the proposal references.
				let findings;
				try {
					findings = foldFindings(cwd);
				} catch (err) {
					return fail(err.amberCode || FINDING_CORRUPT_CODE, [err.message || String(err)]);
				}
				candidate = candidateIntentFor(current, findings);
			}
			return null;
		},
		(fold) => currentProposalFor(fold, input.fingerprint),
	);
	if (!result.ok) return { ...result, candidate: null };
	return { ...result, candidate };
}

// A pinned reference resolves only to a committed revision of the
// expected type; anything else refuses instead of dangling.
function resolveArtifactPin(revisions, pin, type, label) {
	const match = revisions.find(
		(revision) =>
			revision.type === type &&
			revision.identity === pin.identity &&
			revision.revision === pin.revision,
	);
	if (!match)
		return `${label} ${JSON.stringify(pin.identity)}@${pin.revision} does not resolve to a committed ${type} artifact revision`;
	return null;
}

/**
 * Complete one fix-triaged proposal by binding its fingerprint to the
 * committed Intent it re-entered as and the committed Eval definition and
 * Eval result that now watch the fix — a shipped fix becomes a regression
 * signal. Unresolved references refuse; the record is append-only.
 */
function complete(cwd, input = {}, opts = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!isPlainObject(input))
		return fail(MAINTAIN_INVALID_CODE, ["complete input must be an object"]);
	const inputClosed = unknownFieldProblem(input, COMPLETE_INPUT_FIELDS, "complete input");
	if (inputClosed !== null) return fail(MAINTAIN_INVALID_CODE, [inputClosed]);
	if (!HASH_PATTERN.test(input.fingerprint ?? ""))
		return fail(MAINTAIN_INVALID_CODE, ["fingerprint must be a sha256:<64-hex> string"]);
	for (const [field, label] of [
		["intent", "intent"],
		["eval", "eval"],
		["evalResult", "evalResult"],
	]) {
		const pin = artifactPinProblem(input[field], label);
		if (pin !== null) return fail(MAINTAIN_INVALID_CODE, [pin]);
	}
	// The AC binds the CANDIDATE Intent identity: completion re-enters as
	// the fingerprint-derived Intent the fix triage returned, never as an
	// unrelated Intent.
	const candidateIdentity = `intent/maintain/${input.fingerprint.slice(7, 23)}`;
	if (input.intent.identity !== candidateIdentity)
		return fail(MAINTAIN_INVALID_CODE, [
			`intent must reference the candidate Intent identity ${JSON.stringify(candidateIdentity)} derived from the fingerprint; got ${JSON.stringify(input.intent.identity)}`,
		]);
	let revisions;
	try {
		revisions = listArtifactRevisions(cwd);
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_ARTIFACT_JOURNAL_CORRUPT", [err.message || String(err)]);
	}
	for (const [field, type, label] of [
		["intent", "intent", "intent"],
		["eval", "eval", "eval"],
		["evalResult", "eval-result", "evalResult"],
	]) {
		const unresolved = resolveArtifactPin(revisions, input[field], type, label);
		if (unresolved !== null) return fail(MAINTAIN_INVALID_CODE, [unresolved]);
	}
	// The pinned result must be a result OF the pinned definition: F058
	// eval-results record their definition pin in the extensions carrier.
	const resultRevision = revisions.find(
		(revision) =>
			revision.type === "eval-result" &&
			revision.identity === input.evalResult.identity &&
			revision.revision === input.evalResult.revision,
	);
	const definition = resultRevision.envelope?.extensions?.evalResult?.definition ?? null;
	if (
		!isPlainObject(definition) ||
		definition.identity !== input.eval.identity ||
		definition.revision !== input.eval.revision
	)
		return fail(MAINTAIN_INVALID_CODE, [
			`evalResult ${JSON.stringify(input.evalResult.identity)}@${input.evalResult.revision} does not record eval ${JSON.stringify(input.eval.identity)}@${input.eval.revision} as its definition; the completion pins must belong together`,
		]);
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	// Completion targets the latest fix-triaged, uncompleted proposal for
	// the fingerprint; the event pins that proposal's opening index.
	const eligibleIn = (fold) =>
		[...fold]
			.reverse()
			.find(
				(entry) =>
					entry.fingerprint === input.fingerprint &&
					entry.status === "triaged" &&
					entry.triage.outcome === "fix",
			) ?? null;
	let targetIndex = null;
	return appendLedgerEvent(
		cwd,
		PROPOSAL_LEDGER,
		(fold) => {
			// The guard ran first on this same fold, so a target exists; the
			// -1 fallback fails event validation closed if that ever changes.
			const target = eligibleIn(fold);
			return {
				kind: "completion",
				schemaVersion: MAINTAIN_PROPOSAL_SCHEMA_VERSION,
				at,
				fingerprint: input.fingerprint,
				proposalIndex: target ? target.index : -1,
				intent: { identity: input.intent.identity, revision: input.intent.revision },
				eval: { identity: input.eval.identity, revision: input.eval.revision },
				evalResult: {
					identity: input.evalResult.identity,
					revision: input.evalResult.revision,
				},
			};
		},
		(fold) => {
			if (!fold.some((entry) => entry.fingerprint === input.fingerprint))
				return fail(MAINTAIN_NOT_FOUND_CODE, [
					`no proposal exists for ${JSON.stringify(input.fingerprint)}`,
				]);
			const eligible = eligibleIn(fold);
			if (eligible === null)
				return fail(MAINTAIN_INVALID_CODE, [
					`no fix-triaged proposal awaits completion for ${JSON.stringify(input.fingerprint)}`,
				]);
			targetIndex = eligible.index;
			return null;
		},
		(fold) => fold.find((entry) => entry.index === targetIndex),
	);
}

/**
 * Deterministic rollup within a declared bound: counts by tier, status,
 * and derived staleness over the first `limit` entries of each ledger in
 * append order. Truncation is an explicit marker, never hidden.
 */
function rollup(cwd, { limit } = {}) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (!Number.isInteger(limit) || limit < 1)
		return fail(MAINTAIN_INVALID_CODE, ["limit must be a declared positive integer bound"]);
	let detectors;
	let findings;
	let proposals;
	try {
		detectors = foldDetectors(cwd);
		findings = foldFindings(cwd);
		proposals = foldProposals(cwd);
	} catch (err) {
		return fail(err.amberCode || MAINTAIN_CORRUPT_CODE, [err.message || String(err)]);
	}
	const countBy = (entries, keyOf) => {
		const counts = new Map();
		for (const entry of entries) {
			const key = keyOf(entry);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		// Code-unit order keeps the projection deterministic across hosts.
		return Object.fromEntries(
			[...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
		);
	};
	const staleCount = (entries, reasonsOf) =>
		entries.reduce((total, entry) => (reasonsOf(entry).length > 0 ? total + 1 : total), 0);
	const scannedFindings = findings.slice(0, limit);
	const scannedProposals = proposals.slice(0, limit);
	const revisions = policyRevisionsFor(cwd, detectors);
	const staleFindings = staleCount(scannedFindings, (entry) =>
		findingStaleReasons(entry, detectors, findings, revisions),
	);
	const staleProposals = staleCount(scannedProposals, (entry) =>
		proposalStaleReasons(entry, detectors, findings, revisions),
	);
	return {
		ok: true,
		code: null,
		record: {
			bounds: {
				limit,
				findingsScanned: scannedFindings.length,
				findingsTotal: findings.length,
				proposalsScanned: scannedProposals.length,
				proposalsTotal: proposals.length,
				truncated: findings.length > limit || proposals.length > limit,
			},
			findings: {
				byTier: countBy(scannedFindings, (entry) => entry.tier),
				stale: staleFindings,
				fresh: scannedFindings.length - staleFindings,
			},
			proposals: {
				byStatus: {
					open: scannedProposals.filter((entry) => entry.status === "open").length,
					triaged: scannedProposals.filter((entry) => entry.status === "triaged").length,
					completed: scannedProposals.filter((entry) => entry.status === "completed").length,
				},
				byTier: countBy(scannedProposals, (entry) => entry.tier),
				stale: staleProposals,
				fresh: scannedProposals.length - staleProposals,
			},
		},
		errors: [],
	};
}

module.exports = {
	MAINTAIN_DETECTOR_SCHEMA_VERSION,
	SUPPORTED_MAINTAIN_DETECTOR_SCHEMA_VERSIONS,
	MAINTAIN_FINDING_SCHEMA_VERSION,
	SUPPORTED_MAINTAIN_FINDING_SCHEMA_VERSIONS,
	MAINTAIN_PROPOSAL_SCHEMA_VERSION,
	SUPPORTED_MAINTAIN_PROPOSAL_SCHEMA_VERSIONS,
	DEFAULT_MAX_MAINTAIN_BYTES,
	DETECTOR_COMPARATORS,
	DETECTOR_OUTPUT_TYPES,
	MAINTAIN_DECISION_KINDS,
	GENESIS_HASH,
	chainHash,
	detectorsPath,
	findingsPath,
	registerDetector,
	showDetector,
	listDetectors,
	detect,
	listFindings,
	proposalsPath,
	propose,
	listProposals,
	TRIAGE_OUTCOMES,
	triage,
	complete,
	rollup,
};
