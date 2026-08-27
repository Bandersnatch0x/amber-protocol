"use strict";

// F050 ticket 6 (#231) — append-only staleness / invalidation receipts.
// Historical passes and Decisions are never rewritten; when Policy/Evidence or
// other explicit dependencies change, Amber records a scoped invalidation
// receipt. Strict queries consume this read-side evidence and fail closed for
// affected scopes instead of silently satisfying a Gate with stale data.

const path = require("node:path");
const { appendJSONL, readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { typedError } = require("./error-catalog");
const {
	GENESIS_HASH,
	chainHash,
	acquireLedgerLock,
	appendWithinCeiling: sharedAppendWithinCeiling,
} = require("./registry-ledger");

const STALENESS_SCHEMA_VERSION = 1;
const SUPPORTED_STALENESS_SCHEMA_VERSIONS = Object.freeze([1]);
const DEFAULT_MAX_STALENESS_BYTES = 1024 * 1024;
const LOCK_STALE_MS = 30_000;

const REGISTRY_CORRUPT_CODE = "AMBER_E_STALENESS_REGISTRY_CORRUPT";
const REGISTRY_LOCK_CODE = "AMBER_E_STALENESS_REGISTRY_LOCK";
const SIZE_CEILING_CODE = "AMBER_E_STALENESS_SIZE_CEILING";
const INVALID_ARG_CODE = "AMBER_E_INVALID_ARG";

const EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"subject",
	"dependency",
	"reason",
	"prevHash",
	"hash",
]);
const DEPENDENCY_FIELDS = Object.freeze(["type", "identity", "revision", "contentHash"]);

function ledgerPath(cwd) {
	return statePathForCreate(cwd, "staleness", "receipts.jsonl");
}

function corrupt(message) {
	return typedError(REGISTRY_CORRUPT_CODE, message);
}

function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function quotedList(values) {
	return values.map((value) => `"${value}"`).join(", ");
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

function dependencyProblem(dependency, label = "dependency") {
	if (!isPlainObject(dependency))
		return `${label} must be an object; got ${JSON.stringify(dependency)}`;
	const closed = closedFieldProblem(dependency, DEPENDENCY_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(dependency.type)) return `${label}.type must be a non-empty string`;
	if (!isNonEmptyString(dependency.identity)) return `${label}.identity must be a non-empty string`;
	if (
		dependency.revision !== null &&
		(!Number.isInteger(dependency.revision) || dependency.revision < 1)
	) {
		return `${label}.revision must be null or a positive integer; got ${JSON.stringify(dependency.revision)}`;
	}
	if (dependency.contentHash !== null && !isNonEmptyString(dependency.contentHash)) {
		return `${label}.contentHash must be null or a non-empty string`;
	}
	return null;
}

function normalizedDependency(input) {
	return {
		type: input.type,
		identity: input.identity,
		revision: input.revision === undefined ? null : input.revision,
		contentHash: input.contentHash === undefined ? null : input.contentHash,
	};
}

function inputProblem({ subject, dependency, reason }) {
	if (!isNonEmptyString(subject))
		return `subject must be a non-empty string; got ${JSON.stringify(subject)}`;
	const dep = dependencyProblem(dependency);
	if (dep !== null) return dep;
	if (!isNonEmptyString(reason))
		return `reason must be a non-empty string; got ${JSON.stringify(reason)}`;
	return null;
}

function acquireLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(ledgerPath(cwd)),
		lockName: "receipts.lock",
		conflictCode: REGISTRY_LOCK_CODE,
		corruptCode: REGISTRY_CORRUPT_CODE,
		label: "staleness receipt ledger",
		staleMs: LOCK_STALE_MS,
	});
}

function appendWithinCeiling(cwd, event) {
	return sharedAppendWithinCeiling({
		ledgerPath: ledgerPath(cwd),
		event,
		envName: "AMBER_STALENESS_MAX_RECEIPT_BYTES",
		defaultBytes: DEFAULT_MAX_STALENESS_BYTES,
		label: "staleness receipt ledger",
	});
}

function foldStalenessReceipts(cwd) {
	const events = readLedgerFailClosed(
		ledgerPath(cwd),
		REGISTRY_CORRUPT_CODE,
		"staleness receipt ledger",
	);
	let prevHash = GENESIS_HASH;
	return events.map((event, index) => {
		const lineIndex = index + 1;
		if (!isPlainObject(event)) throw corrupt(`staleness receipt ${lineIndex} is not an object`);
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash) {
			throw corrupt(`staleness receipt ${lineIndex} breaks the hash chain`);
		}
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash) {
			throw corrupt(
				`staleness receipt ${lineIndex} carries a hash that does not match its content`,
			);
		}
		const closed = closedFieldProblem(event, EVENT_FIELDS, `staleness receipt ${lineIndex}`);
		if (closed !== null) throw corrupt(closed);
		if (event.kind !== "invalidated")
			throw corrupt(
				`staleness receipt ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
			);
		if (!SUPPORTED_STALENESS_SCHEMA_VERSIONS.includes(event.schemaVersion)) {
			throw corrupt(
				`staleness receipt ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		}
		if (!isNonEmptyString(event.at))
			throw corrupt(`staleness receipt ${lineIndex} has no timestamp`);
		if (!isNonEmptyString(event.subject))
			throw corrupt(`staleness receipt ${lineIndex} has no subject`);
		const dep = dependencyProblem(event.dependency, `staleness receipt ${lineIndex}.dependency`);
		if (dep !== null) throw corrupt(dep);
		if (!isNonEmptyString(event.reason))
			throw corrupt(`staleness receipt ${lineIndex} has no reason`);
		prevHash = event.hash;
		return { ...event, index };
	});
}

function recordInvalidation(cwd, { subject, dependency, reason }, opts = {}) {
	const dep = normalizedDependency(dependency || {});
	const problem = inputProblem({ subject, dependency: dep, reason });
	if (problem !== null)
		return { ok: false, code: INVALID_ARG_CODE, receipt: null, errors: [problem] };
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	let release;
	try {
		release = acquireLock(cwd);
	} catch (err) {
		return {
			ok: false,
			code: err.amberCode || REGISTRY_CORRUPT_CODE,
			receipt: null,
			errors: [err.message || String(err)],
		};
	}
	try {
		let folded;
		try {
			folded = foldStalenessReceipts(cwd);
		} catch (err) {
			return {
				ok: false,
				code: err.amberCode || REGISTRY_CORRUPT_CODE,
				receipt: null,
				errors: [err.message || String(err)],
			};
		}
		const body = {
			kind: "invalidated",
			schemaVersion: STALENESS_SCHEMA_VERSION,
			at,
			subject,
			dependency: dep,
			reason,
		};
		const prevHash = folded.length > 0 ? folded[folded.length - 1].hash : GENESIS_HASH;
		const event = { ...body, prevHash, hash: chainHash(body, prevHash) };
		const ceiling = appendWithinCeiling(cwd, event);
		if (ceiling.wouldExceed) {
			return {
				ok: false,
				code: SIZE_CEILING_CODE,
				receipt: null,
				errors: [`appending the staleness receipt would exceed ${ceiling.ceiling} bytes`],
			};
		}
		appendJSONL(ledgerPath(cwd), event);
		return { ok: true, code: null, receipt: { ...event, index: folded.length }, errors: [] };
	} finally {
		release();
	}
}

function listInvalidations(cwd, { subject = null } = {}) {
	return foldStalenessReceipts(cwd).filter(
		(receipt) => subject === null || receipt.subject === subject,
	);
}

function invalidationsForSubject(cwd, subject) {
	return listInvalidations(cwd, { subject });
}

module.exports = {
	STALENESS_SCHEMA_VERSION,
	SUPPORTED_STALENESS_SCHEMA_VERSIONS,
	DEFAULT_MAX_STALENESS_BYTES,
	GENESIS_HASH,
	chainHash,
	ledgerPath,
	recordInvalidation,
	listInvalidations,
	invalidationsForSubject,
};
