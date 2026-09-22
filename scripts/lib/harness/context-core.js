"use strict";

// Context Firewall core (F069 H3a; Harness v2 §11/§32).
//
// Owns the ContextGrant registry (§11: Grant = Subject × Resource × Purpose ×
// Time × Policy) and the deterministic report-first check. COMPOSES the
// existing context surfaces: the classification vocabulary and ordering come
// from the loadout contract, and the check reads LABELS only — never values —
// so the firewall itself can never become a value-exfiltration surface. The
// check never gates the existing context lifecycle (F017/F027); enforcement
// wiring is H3b. Revocation is a terminal record, never an edit; expiry is a
// read-time projection.

const fs = require("node:fs");
const path = require("node:path");

const { compileSchema } = require("../core/schema-contract");
const { canonicalHashOf } = require("../core/registry-ledger");
const { statePath, statePathForCreate } = require("../state-dir-resolver");
const { emitHarnessEvent } = require("./event-ledger");

const CODE_IMMUTABLE = "AMBER_E_HARNESS_CTX_IMMUTABLE";
const CODE_NOT_FOUND = "AMBER_E_HARNESS_CTX_NOT_FOUND";
const CODE_CORRUPT = "AMBER_E_HARNESS_CTX_CORRUPT";
const CODE_ALREADY_REVOKED = "AMBER_E_HARNESS_CTX_ALREADY_REVOKED";
const CODE_INVALID_ARG = "AMBER_E_INVALID_ARG";

// The loadout classification vocabulary with its ceiling ordering; 'unknown'
// is unrated and denies fail-closed (never matches any ceiling).
const CLASSIFICATION_ORDER = Object.freeze({
	public: 0,
	internal: 1,
	confidential: 2,
	restricted: 3,
	secret: 4,
});

const DENY_REASONS = Object.freeze([
	"no-grant",
	"expired",
	"revoked",
	"purpose-mismatch",
	"classification-above-ceiling",
]);

function typedError(code, message) {
	const err = new Error(message);
	err.amberCode = code;
	return err;
}

function grantsDirForCreate(targetRoot) {
	return statePathForCreate(targetRoot, "harness", "context-grants");
}

function grantFileForCreate(targetRoot, grantId) {
	return path.join(grantsDirForCreate(targetRoot), `${safeId(grantId)}.json`);
}

function grantFileForRead(targetRoot, grantId) {
	return statePath(targetRoot, "harness", "context-grants", `${safeId(grantId)}.json`);
}

function safeId(id) {
	return String(id).replace(/[^A-Za-z0-9._-]/g, "-");
}

function prefixProblem(prefix) {
	if (typeof prefix !== "string" || prefix.trim().length === 0) {
		return "resource prefixes must be non-empty strings";
	}
	if (path.isAbsolute(prefix) || prefix.includes("\\") || prefix.split("/").includes("..")) {
		return `resource prefix ${JSON.stringify(prefix)} must be a repo-relative posix prefix without traversal`;
	}
	return null;
}

function validateGrantDocument(candidate) {
	const validate = compileSchema("context-grant");
	if (validate(candidate)) return null;
	const detail = (validate.errors || [])
		.map((e) => `${e.instancePath || "/"} ${e.message}`)
		.join("; ");
	return typedError(
		CODE_INVALID_ARG,
		`context grant does not satisfy schemas/context-grant.schema.json: ${detail}`,
	);
}

function documentProblems(candidate) {
	const schemaError = validateGrantDocument(candidate);
	if (schemaError) return schemaError;
	const problems = [];
	if (Date.parse(candidate.validUntil) <= Date.parse(candidate.validFrom)) {
		problems.push("validUntil must be after validFrom (half-open window, no zero/negative TTL)");
	}
	for (const prefix of candidate.resources) {
		const problem = prefixProblem(prefix);
		if (problem) problems.push(problem);
	}
	if (problems.length > 0) return typedError(CODE_INVALID_ARG, problems.join("; "));
	return null;
}

function readGrantFile(file) {
	let raw;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch (err) {
		return null;
	}
	try {
		return JSON.parse(raw);
	} catch (err) {
		throw typedError(CODE_CORRUPT, `context grant record is not valid JSON: ${file}`);
	}
}

/**
 * Admit one Context Grant and put the context.granted event on the trail.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.grantPath
 * @param {string} [opts.now]
 */
function admitContextGrant(targetRoot, { grantPath, now } = {}) {
	if (!grantPath || typeof grantPath !== "string") {
		throw typedError(CODE_INVALID_ARG, "--file <grant.json> is required to admit a context grant");
	}
	const resolvedPath = path.resolve(targetRoot, grantPath);
	let candidate;
	try {
		candidate = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
	} catch (err) {
		throw typedError(
			CODE_INVALID_ARG,
			`cannot read context grant at ${resolvedPath}: ${err.message}`,
		);
	}
	const documentError = documentProblems(candidate);
	if (documentError) throw documentError;

	const grantId = candidate.metadata.id;
	const snapshotHash = canonicalHashOf(candidate);
	const file = grantFileForCreate(targetRoot, grantId);
	if (fs.existsSync(file)) {
		const existing = readGrantFile(file);
		if (existing && existing.snapshotHash === snapshotHash) {
			return {
				ok: true,
				idempotent: true,
				id: grantId,
				snapshotHash,
				admittedAt: existing.admittedAt,
				grantFile: file,
			};
		}
		throw typedError(
			CODE_IMMUTABLE,
			`context grant "${grantId}" is already admitted with snapshot ${existing ? existing.snapshotHash : "unknown"}; grants are immutable after admission — changed access means a new grant (and the old one expires or is revoked)`,
		);
	}
	const admittedAt = now || new Date().toISOString();
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(
		file,
		`${JSON.stringify({ snapshotHash, admittedAt, grant: candidate }, null, "\t")}\n`,
		"utf8",
	);
	emitHarnessEvent(targetRoot, {
		kind: "context.granted",
		schemaVersion: 1,
		at: admittedAt,
		actor: candidate.subject,
		action: { tool: "context.grant", resource: candidate.resources[0] },
		pointers: [`context-grant:${grantId}#${snapshotHash}`],
	});
	return { ok: true, idempotent: false, id: grantId, snapshotHash, admittedAt, grantFile: file };
}

/**
 * Read one admitted grant (fail closed on corruption).
 */
function inspectContextGrant(targetRoot, { grantId } = {}) {
	if (!grantId || typeof grantId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--grant <id> is required to inspect a context grant");
	}
	const file = grantFileForRead(targetRoot, grantId);
	const record = readGrantFile(file);
	if (!record || !record.grant) {
		throw typedError(
			CODE_NOT_FOUND,
			`no admitted context grant "${grantId}" under the harness state area`,
		);
	}
	const derived = canonicalHashOf(record.grant);
	if (derived !== record.snapshotHash) {
		throw typedError(
			CODE_CORRUPT,
			`admitted context grant "${grantId}" no longer hashes to its snapshot (${record.snapshotHash} != ${derived}); refusing to present it`,
		);
	}
	return {
		ok: true,
		id: grantId,
		snapshotHash: record.snapshotHash,
		admittedAt: record.admittedAt,
		grant: record.grant,
		revocation: record.revocation ?? null,
		grantFile: file,
	};
}

/**
 * List admitted grants in id order, re-deriving each snapshot hash; corrupt
 * records are flagged tombstones (list view), single reads refuse closed.
 */
function listContextGrants(targetRoot) {
	const dir = statePath(targetRoot, "harness", "context-grants");
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => {
			try {
				const record = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
				const id = record.grant && record.grant.metadata ? record.grant.metadata.id : name;
				const derived = record.grant ? canonicalHashOf(record.grant) : null;
				if (derived !== record.snapshotHash) {
					return { id, snapshotHash: null, admittedAt: null, corrupt: true };
				}
				return {
					id,
					subject: record.grant.subject,
					purpose: record.grant.purpose,
					revoked: Boolean(record.revocation),
					snapshotHash: record.snapshotHash,
					admittedAt: record.admittedAt,
				};
			} catch (err) {
				return { id: name, snapshotHash: null, admittedAt: null, corrupt: true };
			}
		});
}

/**
 * Revoke one grant terminally: the revocation is a record inside the grant's
 * admission file (the admitted grant bytes stay untouched, so the snapshot
 * hash keeps re-deriving), the grant stays listable forever, and a
 * context.revoked event lands on the trail. One revocation per grant.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.grantId @param {string} opts.revoker @param {string} [opts.reason] @param {string} [opts.now]
 */
function revokeContextGrant(targetRoot, { grantId, revoker, reason, now } = {}) {
	if (!grantId || typeof grantId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--grant <id> is required to revoke a context grant");
	}
	const inspected = inspectContextGrant(targetRoot, { grantId });
	const file = inspected.grantFile;
	const record = JSON.parse(fs.readFileSync(file, "utf8"));
	if (record.revocation) {
		throw typedError(
			CODE_ALREADY_REVOKED,
			`context grant "${grantId}" was already revoked at ${record.revocation.at}; revocation is terminal`,
		);
	}
	const at = now || new Date().toISOString();
	record.revocation = { revoker: revoker || "unknown", ...(reason ? { reason } : {}), at };
	fs.writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`, "utf8");
	emitHarnessEvent(targetRoot, {
		kind: "context.revoked",
		schemaVersion: 1,
		at,
		actor: record.revocation.revoker,
		action: { tool: "context.revoke", resource: inspected.grant.resources[0] },
		pointers: [`context-grant:${grantId}#${inspected.snapshotHash}`],
		...(reason ? { reason } : {}),
	});
	return { ok: true, id: grantId, revokedAt: at };
}

/**
 * The deterministic firewall check (report-first): allow with the covering
 * grant pointer, or deny with a closed reason. Reads labels only; emits a
 * context.denied event on deny (denials are the facts worth recording — the
 * grant's admission event already covers the allow side). `runId` optionally
 * scopes the denial event to one run's trail.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.subject
 * @param {string} opts.resource - The resource path being asked about.
 * @param {string} opts.purpose
 * @param {string} [opts.classification] - The resource's label (loadout vocabulary); unrated when absent.
 * @param {string} [opts.now]
 * @param {string} [opts.runId] - Optional run scope for the denial event.
 */
function checkContextAccess(
	targetRoot,
	{ subject, resource, purpose, classification, now, runId } = {},
) {
	const missing = [
		["--subject", subject],
		["--resource", resource],
		["--purpose", purpose],
	].find(([, value]) => !value || typeof value !== "string");
	if (missing) {
		throw typedError(CODE_INVALID_ARG, `${missing[0]} is required for the context check`);
	}
	const at = now || new Date().toISOString();
	const nowMs = Date.parse(at);
	if (Number.isNaN(nowMs))
		throw typedError(CODE_INVALID_ARG, "--now must be a valid ISO timestamp");

	const deny = (reason, pointers) => {
		const body = {
			kind: "context.denied",
			schemaVersion: 1,
			at,
			actor: subject,
			action: { tool: "context.check", resource },
			decision: { result: "deny", policy: "context-firewall" },
			...(pointers && pointers.length > 0 ? { pointers } : {}),
			reason,
			...(runId ? { runId } : {}),
		};
		emitHarnessEvent(targetRoot, body);
		return {
			ok: true,
			verdict: "deny",
			reason,
			subject,
			resource,
			purpose,
			...(classification ? { classification } : {}),
			checkedAt: at,
			...(runId ? { runId } : {}),
			reportOnly: true,
		};
	};

	// All grants naming this subject.
	const subjectGrants = listContextGrants(targetRoot).filter(
		(entry) => !entry.corrupt && entry.subject === subject,
	);
	const detailed = subjectGrants.map((entry) => ({
		entry,
		record: JSON.parse(fs.readFileSync(grantFileForRead(targetRoot, entry.id), "utf8")),
	}));
	if (detailed.length === 0) return deny("no-grant");

	// …that cover the resource prefix.
	const covering = detailed.filter(({ record }) =>
		(record.grant.resources || []).some((prefix) => {
			const normalized = String(resource).replace(/\\/g, "/");
			return normalized === prefix || normalized.startsWith(`${prefix}/`);
		}),
	);
	if (covering.length === 0) return deny("no-grant");

	// …not revoked.
	const live = covering.filter(({ record }) => !record.revocation);
	if (live.length === 0) {
		return deny("revoked", covering.map(grantPointer));
	}

	// …inside the half-open window.
	const inWindow = live.filter(({ record }) => {
		const from = Date.parse(record.grant.validFrom);
		const until = Date.parse(record.grant.validUntil);
		return nowMs >= from && nowMs < until;
	});
	if (inWindow.length === 0) {
		return deny("expired", live.map(grantPointer));
	}

	// …bound to the asked purpose.
	const purposeMatched = inWindow.filter(({ record }) => record.grant.purpose === purpose);
	if (purposeMatched.length === 0) {
		return deny("purpose-mismatch", inWindow.map(grantPointer));
	}

	// …under the classification ceiling ('unknown' resources deny fail-closed;
	// without a resource label the ceiling is not evaluated).
	const qualified = purposeMatched.filter(({ record }) => {
		if (classification === undefined) return true;
		const resourceRank = CLASSIFICATION_ORDER[classification];
		if (resourceRank === undefined) return false;
		const ceilingRank = CLASSIFICATION_ORDER[record.grant.classificationCeiling];
		if (ceilingRank === undefined) return false;
		return ceilingRank >= resourceRank;
	});
	if (classification !== undefined && qualified.length === 0) {
		return deny("classification-above-ceiling", purposeMatched.map(grantPointer));
	}
	return {
		ok: true,
		verdict: "allow",
		subject,
		resource,
		purpose,
		...(classification ? { classification } : {}),
		grant: qualified[0].record.grant.metadata.id,
		grantPointer: grantPointer(qualified[0]),
		validUntil: qualified[0].record.grant.validUntil,
		checkedAt: at,
		...(runId ? { runId } : {}),
		reportOnly: true,
	};

	function grantPointer({ entry, record }) {
		return `context-grant:${entry.id}#${record.snapshotHash}`;
	}
}

module.exports = {
	admitContextGrant,
	inspectContextGrant,
	listContextGrants,
	revokeContextGrant,
	checkContextAccess,
	CLASSIFICATION_ORDER,
	DENY_REASONS,
	CODE_IMMUTABLE,
	CODE_NOT_FOUND,
	CODE_CORRUPT,
	CODE_ALREADY_REVOKED,
	CODE_INVALID_ARG,
};
