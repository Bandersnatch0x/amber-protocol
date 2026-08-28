"use strict";

// F051 — read-only Adapter registry, read receipts, and migration candidates.
//
// Adapters are pre-Cutover readers. They declare who owns the source, what
// record shapes they can read, how identities map, how freshness and permission
// bounds apply, then append receipts for every read. Adapter reads only write
// adapter governance ledgers; migration candidates must pass through normal
// Canonical Artifact admission before any canonical state changes.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { appendJSONL, readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { resolvePathWithin } = require("./fs-utils");
const { typedError } = require("./error-catalog");
const { bodyHash, listArtifactRevisions } = require("./canonical-artifacts");
const { canonicalJson } = require("./context-hash");
const {
	GENESIS_HASH,
	chainHash,
	chainHeadHash,
	acquireLedgerLock,
	appendWithinCeiling: sharedAppendWithinCeiling,
} = require("./registry-ledger");

const ADAPTER_SCHEMA_VERSION = 1;
const ADAPTER_READ_RECEIPT_SCHEMA_VERSION = 2;
const ADAPTER_SHADOW_COMPARISON_SCHEMA_VERSION = 1;
const SUPPORTED_ADAPTER_SCHEMA_VERSIONS = Object.freeze([1]);
const SUPPORTED_ADAPTER_READ_RECEIPT_SCHEMA_VERSIONS = Object.freeze([1, 2]);
const SUPPORTED_ADAPTER_SHADOW_COMPARISON_SCHEMA_VERSIONS = Object.freeze([1]);
const DEFAULT_MAX_ADAPTER_BYTES = 1024 * 1024;
const LOCK_STALE_MS = 30_000;

const REGISTRY_CORRUPT_CODE = "AMBER_E_ADAPTER_REGISTRY_CORRUPT";
const REGISTRY_LOCK_CODE = "AMBER_E_ADAPTER_REGISTRY_LOCK";
const SIZE_CEILING_CODE = "AMBER_E_ADAPTER_SIZE_CEILING";
const RECEIPT_CORRUPT_CODE = "AMBER_E_ADAPTER_READ_RECEIPT_CORRUPT";
const RECEIPT_LOCK_CODE = "AMBER_E_ADAPTER_READ_RECEIPT_LOCK";
const RECEIPT_SIZE_CEILING_CODE = "AMBER_E_ADAPTER_READ_RECEIPT_SIZE_CEILING";
const COMPARISON_CORRUPT_CODE = "AMBER_E_ADAPTER_COMPARISON_CORRUPT";
const COMPARISON_LOCK_CODE = "AMBER_E_ADAPTER_COMPARISON_LOCK";
const COMPARISON_SIZE_CEILING_CODE = "AMBER_E_ADAPTER_COMPARISON_SIZE_CEILING";
const COMPARISON_INVALID_CODE = "AMBER_E_ADAPTER_COMPARISON_INVALID";
const COMPARISON_COVERAGE_MISSING_CODE = "AMBER_E_ADAPTER_COMPARISON_COVERAGE_MISSING";
const INVALID_CODE = "AMBER_E_ADAPTER_INVALID";
const NOT_FOUND_CODE = "AMBER_E_ADAPTER_NOT_FOUND";
const READ_FORBIDDEN_CODE = "AMBER_E_ADAPTER_READ_FORBIDDEN";
const SOURCE_MISSING_CODE = "AMBER_E_ADAPTER_SOURCE_MISSING";
const STALE_CODE = "AMBER_E_ADAPTER_STALE";
const CONFLICT_CODE = "AMBER_E_ADAPTER_CONFLICT";
const UNMAPPED_CODE = "AMBER_E_ADAPTER_UNMAPPED";
const INVALID_ARG_CODE = "AMBER_E_INVALID_ARG";

const REGISTERED_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"adapter",
	"prevHash",
	"hash",
]);
const ADAPTER_FIELDS = Object.freeze([
	"id",
	"owner",
	"adapterVersion",
	"recordTypes",
	"scope",
	"identityMapping",
	"freshness",
	"permissions",
]);
const RECORD_TYPE_FIELDS = Object.freeze(["type", "versions"]);
const IDENTITY_MAPPING_FIELDS = Object.freeze(["strategy"]);
const FRESHNESS_FIELDS = Object.freeze(["maxAgeMs"]);
const PERMISSIONS_FIELDS = Object.freeze(["readOnly", "allowedPaths"]);
const RECEIPT_EVENT_FIELDS_V1 = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"adapterId",
	"adapterVersion",
	"recordId",
	"recordType",
	"recordVersion",
	"scope",
	"source",
	"sourceHash",
	"sourceBytes",
	"sourceByteLength",
	"status",
	"provenance",
	"prevHash",
	"hash",
]);
const RECEIPT_EVENT_FIELDS_V2 = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"adapterId",
	"adapterVersion",
	"recordId",
	"recordType",
	"recordVersion",
	"scope",
	"source",
	"sourceHash",
	"expectedSourceHash",
	"sourceBytes",
	"sourceByteLength",
	"status",
	"stateReason",
	"provenance",
	"prevHash",
	"hash",
]);
const READ_STATUSES_V1 = Object.freeze(["fresh", "stale", "unavailable"]);
const READ_STATUSES = Object.freeze(["fresh", "stale", "unavailable", "conflict", "unmapped"]);
const SOURCE_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ENVELOPE_HASH_PATTERN = /^(sha256:)?[0-9a-f]{64}$/;
const CANDIDATE_SOURCE_FIELDS = Object.freeze(["records"]);
const CANDIDATE_RECORD_FIELDS = Object.freeze([
	"id",
	"recordId",
	"scope",
	"tenant",
	"artifact",
	"artifactType",
	"artifactIdentity",
	"artifactScope",
	"body",
	"traces",
	"extensions",
	"transition",
	"idempotencyKey",
	"expectedHead",
	"supersedes",
]);
const CANDIDATE_ARTIFACT_FIELDS = Object.freeze([
	"type",
	"identity",
	"body",
	"scope",
	"traces",
	"extensions",
	"transition",
	"idempotencyKey",
	"expectedHead",
	"supersedes",
]);
const COMPARISON_STATUSES = Object.freeze([
	"mapped",
	"unmapped",
	"stale",
	"conflict",
	"unavailable",
]);
const COMPARISON_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"adapterId",
	"adapterVersion",
	"scope",
	"fixtureId",
	"fixtureHash",
	"comparisonHash",
	"sourceSetHash",
	"targetSetHash",
	"coverage",
	"items",
	"prevHash",
	"hash",
]);
const COMPARISON_COVERAGE_FIELDS = Object.freeze([
	"scope",
	"total",
	"mapped",
	"unmapped",
	"stale",
	"conflict",
	"unavailable",
]);
const COMPARISON_ITEM_FIELDS = Object.freeze([
	"itemIndex",
	"recordId",
	"source",
	"readReceiptIndex",
	"sourceStatus",
	"sourceHash",
	"target",
	"candidate",
	"status",
	"reason",
	"disposition",
]);
const COMPARISON_TARGET_FIELDS = Object.freeze([
	"type",
	"identity",
	"revision",
	"contentHash",
	"envelopeHash",
	"scope",
	"traces",
	"extensions",
	"transition",
	"supersedes",
]);
const COMPARISON_CANDIDATE_FIELDS = Object.freeze(["type", "identity", "bodyHash", "scope"]);
const COMPARISON_INPUT_FIELDS = Object.freeze([
	"id",
	"fixtureId",
	"scope",
	"expectedTotal",
	"items",
]);
const MAX_COMPARISON_ITEMS = 100;

function registryPath(cwd) {
	return statePathForCreate(cwd, "adapters", "registry.jsonl");
}

function receiptPath(cwd) {
	return statePathForCreate(cwd, "adapters", "read-receipts.jsonl");
}

function comparisonPath(cwd) {
	return statePathForCreate(cwd, "adapters", "shadow-comparisons.jsonl");
}

function adapterCorrupt(message) {
	return typedError(REGISTRY_CORRUPT_CODE, message);
}

function receiptCorrupt(message) {
	return typedError(RECEIPT_CORRUPT_CODE, message);
}

function comparisonCorrupt(message) {
	return typedError(COMPARISON_CORRUPT_CODE, message);
}

function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInt(value) {
	return Number.isInteger(value) && value > 0;
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

function unknownFieldProblem(value, fields, label) {
	const unknown = Object.keys(value)
		.filter((key) => !fields.includes(key))
		.sort();
	if (unknown.length === 0) return null;
	return `${label} carries unknown field${unknown.length > 1 ? "s" : ""} ${quotedList(unknown)}; the closed field set is ${fields.join(", ")}`;
}

function stringArrayProblem(value, label) {
	if (!Array.isArray(value) || value.length === 0) return `${label} must be a non-empty array`;
	for (const entry of value) {
		if (!isNonEmptyString(entry)) return `${label} entries must be non-empty strings`;
	}
	return null;
}

function recordTypeProblem(value, label) {
	if (!isPlainObject(value)) return `${label} must be an object`;
	const closed = closedFieldProblem(value, RECORD_TYPE_FIELDS, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(value.type)) return `${label}.type must be a non-empty string`;
	return stringArrayProblem(value.versions, `${label}.versions`);
}

function adapterProblem(adapter) {
	if (!isPlainObject(adapter)) return `adapter must be an object`;
	const closed = closedFieldProblem(adapter, ADAPTER_FIELDS, "adapter");
	if (closed !== null) return closed;
	for (const field of ["id", "owner", "adapterVersion", "scope"]) {
		if (!isNonEmptyString(adapter[field])) return `adapter.${field} must be a non-empty string`;
	}
	if (!Array.isArray(adapter.recordTypes) || adapter.recordTypes.length === 0) {
		return "adapter.recordTypes must be a non-empty array";
	}
	for (let index = 0; index < adapter.recordTypes.length; index += 1) {
		const problem = recordTypeProblem(adapter.recordTypes[index], `adapter.recordTypes[${index}]`);
		if (problem !== null) return problem;
	}
	if (!isPlainObject(adapter.identityMapping)) return "adapter.identityMapping must be an object";
	const mappingClosed = closedFieldProblem(
		adapter.identityMapping,
		IDENTITY_MAPPING_FIELDS,
		"adapter.identityMapping",
	);
	if (mappingClosed !== null) return mappingClosed;
	if (!isNonEmptyString(adapter.identityMapping.strategy))
		return "adapter.identityMapping.strategy must be a non-empty string";
	if (!isPlainObject(adapter.freshness)) return "adapter.freshness must be an object";
	const freshnessClosed = closedFieldProblem(
		adapter.freshness,
		FRESHNESS_FIELDS,
		"adapter.freshness",
	);
	if (freshnessClosed !== null) return freshnessClosed;
	if (!isPositiveInt(adapter.freshness.maxAgeMs))
		return "adapter.freshness.maxAgeMs must be a positive integer";
	if (!isPlainObject(adapter.permissions)) return "adapter.permissions must be an object";
	const permissionsClosed = closedFieldProblem(
		adapter.permissions,
		PERMISSIONS_FIELDS,
		"adapter.permissions",
	);
	if (permissionsClosed !== null) return permissionsClosed;
	if (adapter.permissions.readOnly !== true) return "adapter.permissions.readOnly must be true";
	if (adapter.permissions.allowedPaths !== null) {
		const allowed = stringArrayProblem(
			adapter.permissions.allowedPaths,
			"adapter.permissions.allowedPaths",
		);
		if (allowed !== null) return allowed;
	}
	return null;
}

function acquireAdapterLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(registryPath(cwd)),
		lockName: "registry.lock",
		conflictCode: REGISTRY_LOCK_CODE,
		corruptCode: REGISTRY_CORRUPT_CODE,
		label: "adapter registry",
		staleMs: LOCK_STALE_MS,
	});
}

function acquireReceiptLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(receiptPath(cwd)),
		lockName: "read-receipts.lock",
		conflictCode: RECEIPT_LOCK_CODE,
		corruptCode: RECEIPT_CORRUPT_CODE,
		label: "adapter read receipt ledger",
		staleMs: LOCK_STALE_MS,
	});
}

function acquireComparisonLock(cwd) {
	return acquireLedgerLock({
		dirPath: path.dirname(comparisonPath(cwd)),
		lockName: "shadow-comparisons.lock",
		conflictCode: COMPARISON_LOCK_CODE,
		corruptCode: COMPARISON_CORRUPT_CODE,
		label: "adapter shadow comparison ledger",
		staleMs: LOCK_STALE_MS,
	});
}

function appendAdapterWithinCeiling(cwd, event) {
	return sharedAppendWithinCeiling({
		ledgerPath: registryPath(cwd),
		event,
		envName: "AMBER_ADAPTER_MAX_REGISTRY_BYTES",
		defaultBytes: DEFAULT_MAX_ADAPTER_BYTES,
		label: "adapter registry",
	});
}

function appendReceiptWithinCeiling(cwd, event) {
	return sharedAppendWithinCeiling({
		ledgerPath: receiptPath(cwd),
		event,
		envName: "AMBER_ADAPTER_MAX_RECEIPT_BYTES",
		defaultBytes: DEFAULT_MAX_ADAPTER_BYTES,
		label: "adapter read receipt ledger",
	});
}

function appendComparisonWithinCeiling(cwd, event) {
	return sharedAppendWithinCeiling({
		ledgerPath: comparisonPath(cwd),
		event,
		envName: "AMBER_ADAPTER_MAX_COMPARISON_BYTES",
		defaultBytes: DEFAULT_MAX_ADAPTER_BYTES,
		label: "adapter shadow comparison ledger",
	});
}

function foldAdapters(cwd) {
	const events = readLedgerFailClosed(registryPath(cwd), REGISTRY_CORRUPT_CODE, "adapter registry");
	const records = [];
	let prevHash = GENESIS_HASH;
	for (let index = 0; index < events.length; index += 1) {
		const event = events[index];
		const lineIndex = index + 1;
		if (!isPlainObject(event))
			throw adapterCorrupt(`adapter registry event ${lineIndex} is not an object`);
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash)
			throw adapterCorrupt(`adapter registry event ${lineIndex} breaks the hash chain`);
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash)
			throw adapterCorrupt(
				`adapter registry event ${lineIndex} carries a hash that does not match its content`,
			);
		const closed = closedFieldProblem(
			event,
			REGISTERED_EVENT_FIELDS,
			`adapter registry event ${lineIndex}`,
		);
		if (closed !== null) throw adapterCorrupt(closed);
		if (event.kind !== "registered")
			throw adapterCorrupt(
				`adapter registry event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
			);
		if (!SUPPORTED_ADAPTER_SCHEMA_VERSIONS.includes(event.schemaVersion))
			throw adapterCorrupt(
				`adapter registry event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
			);
		if (!isNonEmptyString(event.at))
			throw adapterCorrupt(`adapter registry event ${lineIndex} has no timestamp`);
		const problem = adapterProblem(event.adapter);
		if (problem !== null) throw adapterCorrupt(`adapter registry event ${lineIndex} ${problem}`);
		if (records.some((record) => record.id === event.adapter.id))
			throw adapterCorrupt(`adapter "${event.adapter.id}" is registered more than once`);
		records.push({ ...event.adapter, registeredAt: event.at });
		prevHash = event.hash;
	}
	return records;
}

function receiptFieldsForVersion(schemaVersion) {
	return schemaVersion === 1 ? RECEIPT_EVENT_FIELDS_V1 : RECEIPT_EVENT_FIELDS_V2;
}

function receiptEventProblem(event, lineIndex) {
	if (!isPlainObject(event)) return `adapter read receipt ${lineIndex} is not an object`;
	if (event.kind !== "read")
		return `adapter read receipt ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`;
	if (!SUPPORTED_ADAPTER_READ_RECEIPT_SCHEMA_VERSIONS.includes(event.schemaVersion))
		return `adapter read receipt ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`;
	const closed = closedFieldProblem(
		event,
		receiptFieldsForVersion(event.schemaVersion),
		`adapter read receipt ${lineIndex}`,
	);
	if (closed !== null) return closed;
	for (const field of [
		"at",
		"adapterId",
		"adapterVersion",
		"recordId",
		"recordType",
		"recordVersion",
		"scope",
		"source",
		"provenance",
	]) {
		if (!isNonEmptyString(event[field]))
			return `adapter read receipt ${lineIndex}.${field} must be a non-empty string`;
	}
	const statuses = event.schemaVersion === 1 ? READ_STATUSES_V1 : READ_STATUSES;
	if (!statuses.includes(event.status))
		return `adapter read receipt ${lineIndex}.status must be one of ${statuses.join(", ")}`;
	if (event.sourceHash !== null && !SOURCE_HASH_PATTERN.test(event.sourceHash))
		return `adapter read receipt ${lineIndex}.sourceHash must be null or a sha256:<64-hex> string`;
	if (event.schemaVersion >= 2) {
		if (event.expectedSourceHash !== null && !SOURCE_HASH_PATTERN.test(event.expectedSourceHash))
			return `adapter read receipt ${lineIndex}.expectedSourceHash must be null or a sha256:<64-hex> string`;
		if (event.stateReason !== null && !isNonEmptyString(event.stateReason))
			return `adapter read receipt ${lineIndex}.stateReason must be null or a non-empty string`;
		if (event.status === "fresh" && event.stateReason !== null)
			return `adapter read receipt ${lineIndex} with status fresh must not carry stateReason`;
		if (event.status !== "fresh" && event.stateReason === null)
			return `adapter read receipt ${lineIndex} with status ${event.status} must carry stateReason`;
	}
	if (event.status === "unavailable") {
		if (event.sourceHash !== null || event.sourceBytes !== null || event.sourceByteLength !== 0)
			return `adapter read receipt ${lineIndex} with status unavailable must carry null sourceHash/sourceBytes and byte length 0`;
		return null;
	}
	if (event.sourceHash === null || event.sourceBytes === null)
		return `adapter read receipt ${lineIndex} with status ${event.status} must carry sourceHash and sourceBytes`;
	let decoded;
	try {
		decoded = Buffer.from(event.sourceBytes, "base64");
	} catch (_err) {
		return `adapter read receipt ${lineIndex}.sourceBytes must be canonical base64`;
	}
	if (decoded.toString("base64") !== event.sourceBytes)
		return `adapter read receipt ${lineIndex}.sourceBytes must be canonical base64`;
	if (decoded.length !== event.sourceByteLength)
		return `adapter read receipt ${lineIndex}.sourceByteLength must match decoded sourceBytes length`;
	if (sha256Bytes(decoded) !== event.sourceHash)
		return `adapter read receipt ${lineIndex}.sourceHash must match decoded sourceBytes`;
	return null;
}

function foldReadReceipts(cwd) {
	const events = readLedgerFailClosed(
		receiptPath(cwd),
		RECEIPT_CORRUPT_CODE,
		"adapter read receipt ledger",
	);
	let prevHash = GENESIS_HASH;
	return events.map((event, index) => {
		const lineIndex = index + 1;
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash)
			throw receiptCorrupt(`adapter read receipt ${lineIndex} breaks the hash chain`);
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash)
			throw receiptCorrupt(
				`adapter read receipt ${lineIndex} carries a hash that does not match its content`,
			);
		const problem = receiptEventProblem(event, lineIndex);
		if (problem !== null) throw receiptCorrupt(problem);
		prevHash = event.hash;
		return { ...event, index };
	});
}

function countProblem(value, label) {
	return Number.isInteger(value) && value >= 0 ? null : `${label} must be a non-negative integer`;
}

function hashProblem(value, label, { nullable = false } = {}) {
	if (value === null && nullable) return null;
	return SOURCE_HASH_PATTERN.test(value) ? null : `${label} must be a sha256:<64-hex> string`;
}

function comparisonTargetProblem(value, label) {
	if (value === null) return null;
	if (!isPlainObject(value)) return `${label} must be null or an object`;
	const closed = closedFieldProblem(value, COMPARISON_TARGET_FIELDS, label);
	if (closed !== null) return closed;
	for (const field of ["type", "identity", "contentHash", "envelopeHash"]) {
		if (!isNonEmptyString(value[field])) return `${label}.${field} must be a non-empty string`;
	}
	if (!Number.isInteger(value.revision) || value.revision < 1)
		return `${label}.revision must be a positive integer`;
	if (value.scope !== null && !isNonEmptyString(value.scope))
		return `${label}.scope must be null or a non-empty string`;
	if (!Array.isArray(value.traces)) return `${label}.traces must be an array`;
	if (value.extensions !== null && !isPlainObject(value.extensions))
		return `${label}.extensions must be null or an object`;
	if (value.transition !== null && !isNonEmptyString(value.transition))
		return `${label}.transition must be null or a non-empty string`;
	if (value.supersedes !== null && (!Number.isInteger(value.supersedes) || value.supersedes < 1))
		return `${label}.supersedes must be null or a positive integer`;
	const contentProblem = hashProblem(value.contentHash, `${label}.contentHash`);
	if (contentProblem !== null) return contentProblem;
	return ENVELOPE_HASH_PATTERN.test(value.envelopeHash)
		? null
		: `${label}.envelopeHash must be a 64-hex hash or sha256:<64-hex> string`;
}

function comparisonCandidateProblem(value, label) {
	if (value === null) return null;
	if (!isPlainObject(value)) return `${label} must be null or an object`;
	const closed = closedFieldProblem(value, COMPARISON_CANDIDATE_FIELDS, label);
	if (closed !== null) return closed;
	for (const field of ["type", "identity", "bodyHash"]) {
		if (!isNonEmptyString(value[field])) return `${label}.${field} must be a non-empty string`;
	}
	if (value.scope !== null && !isNonEmptyString(value.scope))
		return `${label}.scope must be null or a non-empty string`;
	return hashProblem(value.bodyHash, `${label}.bodyHash`);
}

function comparisonItemProblem(item, lineIndex, itemIndex) {
	if (!isPlainObject(item))
		return `adapter shadow comparison ${lineIndex}.items[${itemIndex}] must be an object`;
	const label = `adapter shadow comparison ${lineIndex}.items[${itemIndex}]`;
	const closed = closedFieldProblem(item, COMPARISON_ITEM_FIELDS, label);
	if (closed !== null) return closed;
	if (!Number.isInteger(item.itemIndex) || item.itemIndex !== itemIndex)
		return `${label}.itemIndex must equal its zero-based array index`;
	for (const field of ["recordId", "source", "sourceStatus", "status"]) {
		if (!isNonEmptyString(item[field])) return `${label}.${field} must be a non-empty string`;
	}
	if (!READ_STATUSES.includes(item.sourceStatus))
		return `${label}.sourceStatus must be one of ${READ_STATUSES.join(", ")}`;
	if (!COMPARISON_STATUSES.includes(item.status))
		return `${label}.status must be one of ${COMPARISON_STATUSES.join(", ")}`;
	if (!Number.isInteger(item.readReceiptIndex) || item.readReceiptIndex < 0)
		return `${label}.readReceiptIndex must be a non-negative integer`;
	const sourceHashIssue = hashProblem(item.sourceHash, `${label}.sourceHash`, { nullable: true });
	if (sourceHashIssue !== null) return sourceHashIssue;
	if (item.status !== "unavailable" && item.sourceHash === null)
		return `${label}.sourceHash must be present unless the item is unavailable`;
	if (item.status === "mapped" && (item.target === null || item.candidate === null))
		return `${label} with status mapped must carry target and candidate hashes`;
	if (item.reason !== null && !isNonEmptyString(item.reason))
		return `${label}.reason must be null or a non-empty string`;
	if (item.disposition !== null && !isNonEmptyString(item.disposition))
		return `${label}.disposition must be null or a non-empty string`;
	if (item.status === "unmapped" && item.disposition === null)
		return `${label} with status unmapped must carry disposition`;
	return (
		comparisonTargetProblem(item.target, `${label}.target`) ??
		comparisonCandidateProblem(item.candidate, `${label}.candidate`)
	);
}

function comparisonCoverageProblem(coverage, lineIndex, items) {
	if (!isPlainObject(coverage))
		return `adapter shadow comparison ${lineIndex}.coverage must be an object`;
	const closed = closedFieldProblem(
		coverage,
		COMPARISON_COVERAGE_FIELDS,
		`adapter shadow comparison ${lineIndex}.coverage`,
	);
	if (closed !== null) return closed;
	if (!isNonEmptyString(coverage.scope))
		return `adapter shadow comparison ${lineIndex}.coverage.scope must be a non-empty string`;
	for (const field of ["total", "mapped", "unmapped", "stale", "conflict", "unavailable"]) {
		const problem = countProblem(
			coverage[field],
			`adapter shadow comparison ${lineIndex}.coverage.${field}`,
		);
		if (problem !== null) return problem;
	}
	if (coverage.total !== items.length)
		return `adapter shadow comparison ${lineIndex}.coverage.total must match item count`;
	const counted =
		coverage.mapped + coverage.unmapped + coverage.stale + coverage.conflict + coverage.unavailable;
	if (counted !== coverage.total)
		return `adapter shadow comparison ${lineIndex}.coverage counts must sum to total`;
	const actual = { mapped: 0, unmapped: 0, stale: 0, conflict: 0, unavailable: 0 };
	for (const item of items) actual[item.status] += 1;
	for (const field of Object.keys(actual)) {
		if (coverage[field] !== actual[field])
			return `adapter shadow comparison ${lineIndex}.coverage.${field} does not match items`;
	}
	return null;
}

function comparisonEventProblem(event, lineIndex) {
	if (!isPlainObject(event)) return `adapter shadow comparison ${lineIndex} is not an object`;
	const closed = closedFieldProblem(
		event,
		COMPARISON_EVENT_FIELDS,
		`adapter shadow comparison ${lineIndex}`,
	);
	if (closed !== null) return closed;
	if (event.kind !== "shadow-comparison")
		return `adapter shadow comparison ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`;
	if (!SUPPORTED_ADAPTER_SHADOW_COMPARISON_SCHEMA_VERSIONS.includes(event.schemaVersion))
		return `adapter shadow comparison ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`;
	for (const field of ["at", "adapterId", "adapterVersion", "scope", "fixtureId"]) {
		if (!isNonEmptyString(event[field]))
			return `adapter shadow comparison ${lineIndex}.${field} must be a non-empty string`;
	}
	for (const field of ["fixtureHash", "comparisonHash", "sourceSetHash", "targetSetHash"]) {
		const problem = hashProblem(event[field], `adapter shadow comparison ${lineIndex}.${field}`);
		if (problem !== null) return problem;
	}
	if (!Array.isArray(event.items) || event.items.length === 0)
		return `adapter shadow comparison ${lineIndex}.items must be a non-empty array`;
	for (let itemIndex = 0; itemIndex < event.items.length; itemIndex += 1) {
		const problem = comparisonItemProblem(event.items[itemIndex], lineIndex, itemIndex);
		if (problem !== null) return problem;
	}
	const coverageProblem = comparisonCoverageProblem(event.coverage, lineIndex, event.items);
	if (coverageProblem !== null) return coverageProblem;
	const sourceSetHash = compareHash(
		event.items.map((item) => ({
			recordId: item.recordId,
			sourceHash: item.sourceHash,
			sourceStatus: item.sourceStatus,
		})),
	);
	if (sourceSetHash !== event.sourceSetHash)
		return `adapter shadow comparison ${lineIndex}.sourceSetHash does not match its items`;
	const targetSetHash = compareHash(
		event.items.map((item) => ({ recordId: item.recordId, target: item.target })),
	);
	if (targetSetHash !== event.targetSetHash)
		return `adapter shadow comparison ${lineIndex}.targetSetHash does not match its items`;
	const hashItems = event.items.map(({ readReceiptIndex: _readReceiptIndex, ...item }) => item);
	const comparisonHash = compareHash({
		fixtureHash: event.fixtureHash,
		sourceSetHash: event.sourceSetHash,
		targetSetHash: event.targetSetHash,
		coverage: event.coverage,
		items: hashItems,
	});
	if (comparisonHash !== event.comparisonHash)
		return `adapter shadow comparison ${lineIndex}.comparisonHash does not match its content`;
	return null;
}

function foldShadowComparisons(cwd) {
	const events = readLedgerFailClosed(
		comparisonPath(cwd),
		COMPARISON_CORRUPT_CODE,
		"adapter shadow comparison ledger",
	);
	let prevHash = GENESIS_HASH;
	return events.map((event, index) => {
		const lineIndex = index + 1;
		if (!isPlainObject(event))
			throw comparisonCorrupt(`adapter shadow comparison ${lineIndex} is not an object`);
		if (typeof event.prevHash !== "string" || event.prevHash !== prevHash)
			throw comparisonCorrupt(`adapter shadow comparison ${lineIndex} breaks the hash chain`);
		if (typeof event.hash !== "string" || chainHash(event, prevHash) !== event.hash)
			throw comparisonCorrupt(
				`adapter shadow comparison ${lineIndex} carries a hash that does not match its content`,
			);
		const problem = comparisonEventProblem(event, lineIndex);
		if (problem !== null) throw comparisonCorrupt(problem);
		prevHash = event.hash;
		return { ...event, index };
	});
}

function appendShadowComparison(cwd, body) {
	let release;
	try {
		release = acquireComparisonLock(cwd);
	} catch (err) {
		return {
			ok: false,
			code: err.amberCode || COMPARISON_CORRUPT_CODE,
			receipt: null,
			errors: [err.message || String(err)],
		};
	}
	try {
		let current;
		try {
			current = foldShadowComparisons(cwd);
		} catch (err) {
			return {
				ok: false,
				code: err.amberCode || COMPARISON_CORRUPT_CODE,
				receipt: null,
				errors: [err.message || String(err)],
			};
		}
		const prevHash = current.length > 0 ? current[current.length - 1].hash : GENESIS_HASH;
		const event = { ...body, prevHash, hash: chainHash(body, prevHash) };
		let ceiling;
		try {
			ceiling = appendComparisonWithinCeiling(cwd, event);
		} catch (err) {
			return {
				ok: false,
				code: err.amberCode || COMPARISON_CORRUPT_CODE,
				receipt: null,
				errors: [err.message || String(err)],
			};
		}
		if (ceiling.wouldExceed)
			return {
				ok: false,
				code: COMPARISON_SIZE_CEILING_CODE,
				receipt: null,
				errors: [`adapter shadow comparison would exceed ${ceiling.ceiling} bytes`],
			};
		try {
			appendJSONL(comparisonPath(cwd), event);
		} catch (err) {
			return {
				ok: false,
				code: COMPARISON_CORRUPT_CODE,
				receipt: null,
				errors: [err.message || String(err)],
			};
		}
		return { ok: true, code: null, receipt: { ...event, index: current.length }, errors: [] };
	} finally {
		release();
	}
}

function registerAdapter(cwd, input = {}, opts = {}) {
	const adapter = {
		id: input.id,
		owner: input.owner,
		adapterVersion: input.adapterVersion || "1",
		recordTypes: input.recordTypes,
		scope: input.scope,
		identityMapping: input.identityMapping,
		freshness: input.freshness,
		permissions: input.permissions,
	};
	const problem = adapterProblem(adapter);
	if (problem !== null) return { ok: false, code: INVALID_CODE, adapter: null, errors: [problem] };
	let release;
	try {
		release = acquireAdapterLock(cwd);
	} catch (err) {
		return {
			ok: false,
			code: err.amberCode || REGISTRY_CORRUPT_CODE,
			adapter: null,
			errors: [err.message || String(err)],
		};
	}
	try {
		let current;
		try {
			current = foldAdapters(cwd);
		} catch (err) {
			return {
				ok: false,
				code: err.amberCode || REGISTRY_CORRUPT_CODE,
				adapter: null,
				errors: [err.message || String(err)],
			};
		}
		if (current.some((record) => record.id === adapter.id))
			return {
				ok: false,
				code: INVALID_CODE,
				adapter: null,
				errors: [`adapter "${adapter.id}" is already registered`],
			};
		const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
		const body = { kind: "registered", schemaVersion: ADAPTER_SCHEMA_VERSION, at, adapter };
		const prevHash = chainHeadHash(registryPath(cwd), REGISTRY_CORRUPT_CODE, "adapter registry");
		const event = { ...body, prevHash, hash: chainHash(body, prevHash) };
		let ceiling;
		try {
			ceiling = appendAdapterWithinCeiling(cwd, event);
		} catch (err) {
			return {
				ok: false,
				code: err.amberCode || REGISTRY_CORRUPT_CODE,
				adapter: null,
				errors: [err.message || String(err)],
			};
		}
		if (ceiling.wouldExceed)
			return {
				ok: false,
				code: SIZE_CEILING_CODE,
				adapter: null,
				errors: [
					`registering adapter "${adapter.id}" would exceed the adapter registry ceiling of ${ceiling.ceiling} bytes`,
				],
			};
		try {
			appendJSONL(registryPath(cwd), event);
		} catch (err) {
			return {
				ok: false,
				code: REGISTRY_CORRUPT_CODE,
				adapter: null,
				errors: [err.message || String(err)],
			};
		}
		return { ok: true, code: null, adapter: { ...adapter, registeredAt: at }, errors: [] };
	} finally {
		release();
	}
}

function showAdapter(cwd, id) {
	return foldAdapters(cwd).find((record) => record.id === id) ?? null;
}

function listAdapters(cwd) {
	return foldAdapters(cwd);
}

function sha256Bytes(buffer) {
	return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

function relativePathForAllowedCheck(value) {
	const normalized = path.posix.normalize(String(value).replace(/\\/g, "/"));
	return normalized === "." ? "" : normalized;
}

function allowedByAdapter(adapter, source) {
	const allowed = adapter.permissions.allowedPaths;
	if (allowed === null) return true;
	const actual = relativePathForAllowedCheck(source);
	return allowed.some((prefix) => {
		const root = relativePathForAllowedCheck(prefix).replace(/\/$/, "");
		return root.length > 0 && (actual === root || actual.startsWith(`${root}/`));
	});
}

function canonicalValue(value) {
	return canonicalJson(JSON.stringify(value));
}

function hasOwn(value, key) {
	return Object.prototype.hasOwnProperty.call(value, key);
}

function valuesConflict(left, right) {
	if (left === undefined || right === undefined) return false;
	return canonicalValue(left) !== canonicalValue(right);
}

function nullOrString(value, label) {
	if (value === undefined || value === null) return { value: null };
	if (!isNonEmptyString(value))
		return { error: `${label} must be a non-empty string when provided` };
	return { value: String(value) };
}

function nullOrPositiveInt(value, label) {
	if (value === undefined || value === null) return { value: null };
	if (!Number.isInteger(value) || value < 1)
		return { error: `${label} must be a positive integer revision number when provided` };
	return { value };
}

function optionalArray(value, label) {
	if (value === undefined || value === null) return { value: [] };
	if (!Array.isArray(value)) return { error: `${label} must be an array when provided` };
	return { value };
}

function optionalObject(value, label) {
	if (value === undefined || value === null) return { value: null };
	if (!isPlainObject(value)) return { error: `${label} must be an object when provided` };
	return { value };
}

function candidateState(status, code, message) {
	return { ok: false, status, code, errors: [message] };
}

function candidateRecordsFromSource(sourceText) {
	let parsed;
	try {
		parsed = JSON.parse(sourceText);
	} catch (err) {
		return candidateState(
			"unmapped",
			UNMAPPED_CODE,
			`migration source is not valid JSON: ${err.message}`,
		);
	}
	if (!isPlainObject(parsed)) {
		return candidateState("unmapped", UNMAPPED_CODE, "migration source must be a JSON object");
	}
	if (Object.prototype.hasOwnProperty.call(parsed, "records")) {
		const closed = unknownFieldProblem(parsed, CANDIDATE_SOURCE_FIELDS, "migration source");
		if (closed !== null) return candidateState("unmapped", UNMAPPED_CODE, closed);
	}
	const records = Array.isArray(parsed.records) ? parsed.records : [parsed];
	if (records.length === 0) {
		return candidateState("unmapped", UNMAPPED_CODE, "migration source contains no records");
	}
	return { ok: true, records };
}

function normalizeCandidateRecord(record, index, adapterScope) {
	if (!isPlainObject(record)) {
		return candidateState(
			"unmapped",
			UNMAPPED_CODE,
			`migration record ${index + 1} must be an object`,
		);
	}
	const recordClosed = unknownFieldProblem(
		record,
		CANDIDATE_RECORD_FIELDS,
		`migration record ${index + 1}`,
	);
	if (recordClosed !== null) return candidateState("unmapped", UNMAPPED_CODE, recordClosed);
	if (valuesConflict(record.scope, record.tenant)) {
		return candidateState(
			"conflict",
			CONFLICT_CODE,
			`migration record ${index + 1} carries contradictory scope and tenant values`,
		);
	}
	const artifact = record.artifact === undefined ? null : record.artifact;
	if (artifact !== null && !isPlainObject(artifact)) {
		return candidateState(
			"unmapped",
			UNMAPPED_CODE,
			`migration record ${index + 1}.artifact must be an object`,
		);
	}
	if (artifact !== null) {
		const artifactClosed = unknownFieldProblem(
			artifact,
			CANDIDATE_ARTIFACT_FIELDS,
			`migration record ${index + 1}.artifact`,
		);
		if (artifactClosed !== null) return candidateState("unmapped", UNMAPPED_CODE, artifactClosed);
		for (const [nested, flat] of [
			["type", "artifactType"],
			["identity", "artifactIdentity"],
			["body", "body"],
			["scope", "artifactScope"],
			["traces", "traces"],
			["extensions", "extensions"],
			["transition", "transition"],
			["idempotencyKey", "idempotencyKey"],
			["expectedHead", "expectedHead"],
			["supersedes", "supersedes"],
		]) {
			if (
				hasOwn(artifact, nested) &&
				hasOwn(record, flat) &&
				valuesConflict(artifact[nested], record[flat])
			) {
				return candidateState(
					"conflict",
					CONFLICT_CODE,
					`migration record ${index + 1} carries contradictory artifact.${nested} and ${flat} values`,
				);
			}
		}
	}
	if (
		hasOwn(record, "id") &&
		hasOwn(record, "recordId") &&
		valuesConflict(record.id, record.recordId)
	) {
		return candidateState(
			"conflict",
			CONFLICT_CODE,
			`migration record ${index + 1} carries contradictory id and recordId values`,
		);
	}
	if (
		valuesConflict(
			artifact?.supersedes ?? record.supersedes,
			artifact?.expectedHead ?? record.expectedHead,
		)
	) {
		return candidateState(
			"conflict",
			CONFLICT_CODE,
			`migration record ${index + 1} carries contradictory supersedes and expectedHead values`,
		);
	}
	const legacyId = record.recordId ?? record.id;
	if (!isNonEmptyString(legacyId)) {
		return candidateState(
			"unmapped",
			UNMAPPED_CODE,
			`migration record ${index + 1} must carry a non-empty id or recordId`,
		);
	}
	const recordScope = record.scope ?? record.tenant ?? null;
	const parsedRecordScope = nullOrString(recordScope, `migration record ${index + 1}.scope`);
	if (parsedRecordScope.error)
		return candidateState("unmapped", UNMAPPED_CODE, parsedRecordScope.error);
	const type = artifact?.type ?? record.artifactType;
	const identity = artifact?.identity ?? record.artifactIdentity;
	const body = artifact?.body ?? record.body;
	if (!isNonEmptyString(type)) {
		return candidateState(
			"unmapped",
			UNMAPPED_CODE,
			`migration record ${index + 1} must carry artifact.type or artifactType`,
		);
	}
	if (!isNonEmptyString(identity)) {
		return candidateState(
			"unmapped",
			UNMAPPED_CODE,
			`migration record ${index + 1} must carry artifact.identity or artifactIdentity`,
		);
	}
	if (typeof body !== "string" || body.length === 0) {
		return candidateState(
			"unmapped",
			UNMAPPED_CODE,
			`migration record ${index + 1} must carry a non-empty artifact body`,
		);
	}
	const artifactScope = artifact?.scope ?? record.artifactScope ?? parsedRecordScope.value;
	const parsedArtifactScope = nullOrString(
		artifactScope,
		`migration record ${index + 1}.artifact.scope`,
	);
	if (parsedArtifactScope.error)
		return candidateState("unmapped", UNMAPPED_CODE, parsedArtifactScope.error);
	const scope = parsedArtifactScope.value ?? adapterScope;
	const traces = optionalArray(
		artifact?.traces ?? record.traces,
		`migration record ${index + 1}.artifact.traces`,
	);
	if (traces.error) return candidateState("unmapped", UNMAPPED_CODE, traces.error);
	const extensions = optionalObject(
		artifact?.extensions ?? record.extensions,
		`migration record ${index + 1}.artifact.extensions`,
	);
	if (extensions.error) return candidateState("unmapped", UNMAPPED_CODE, extensions.error);
	const transition = nullOrString(
		artifact?.transition ?? record.transition,
		`migration record ${index + 1}.artifact.transition`,
	);
	if (transition.error) return candidateState("unmapped", UNMAPPED_CODE, transition.error);
	const idempotencyKey = nullOrString(
		artifact?.idempotencyKey ?? record.idempotencyKey,
		`migration record ${index + 1}.artifact.idempotencyKey`,
	);
	if (idempotencyKey.error) return candidateState("unmapped", UNMAPPED_CODE, idempotencyKey.error);
	const expectedHead = nullOrPositiveInt(
		artifact?.expectedHead ?? record.expectedHead,
		`migration record ${index + 1}.artifact.expectedHead`,
	);
	if (expectedHead.error) return candidateState("unmapped", UNMAPPED_CODE, expectedHead.error);
	const supersedes = nullOrPositiveInt(
		artifact?.supersedes ?? record.supersedes,
		`migration record ${index + 1}.artifact.supersedes`,
	);
	if (supersedes.error) return candidateState("unmapped", UNMAPPED_CODE, supersedes.error);
	return {
		ok: true,
		record: {
			legacyId: String(legacyId),
			recordScope: parsedRecordScope.value,
			type: String(type),
			identity: String(identity),
			body,
			scope,
			traces: traces.value,
			extensions: extensions.value,
			transition: transition.value,
			idempotencyKey: idempotencyKey.value,
			expectedHead: expectedHead.value,
			supersedes: supersedes.value,
		},
	};
}

function migrationCandidateFromSource(sourceText, recordId, adapterScope) {
	const sourceRecords = candidateRecordsFromSource(sourceText);
	if (!sourceRecords.ok) return sourceRecords;
	const normalized = [];
	for (let index = 0; index < sourceRecords.records.length; index += 1) {
		const result = normalizeCandidateRecord(sourceRecords.records[index], index, adapterScope);
		if (!result.ok) return result;
		normalized.push(result.record);
	}
	const identities = new Set();
	for (const record of normalized) {
		if (identities.has(record.identity)) {
			return candidateState(
				"conflict",
				CONFLICT_CODE,
				`migration source maps more than one record to artifact identity ${JSON.stringify(record.identity)}`,
			);
		}
		identities.add(record.identity);
	}
	const matches = normalized.filter((record) => record.legacyId === recordId);
	if (matches.length === 0) {
		return candidateState(
			"unmapped",
			UNMAPPED_CODE,
			`migration source does not map record id ${JSON.stringify(recordId)}`,
		);
	}
	if (matches.length > 1) {
		const first = canonicalValue(matches[0]);
		const contradictory = matches.some((record) => canonicalValue(record) !== first);
		return candidateState(
			"conflict",
			CONFLICT_CODE,
			contradictory
				? `migration source carries contradictory records for id ${JSON.stringify(recordId)}`
				: `migration source carries duplicate records for id ${JSON.stringify(recordId)}`,
		);
	}
	const candidate = matches[0];
	if (candidate.recordScope !== null && candidate.recordScope !== adapterScope) {
		return candidateState(
			"conflict",
			CONFLICT_CODE,
			`migration record ${JSON.stringify(recordId)} is scoped to ${JSON.stringify(candidate.recordScope)}, not adapter scope ${JSON.stringify(adapterScope)}`,
		);
	}
	if (candidate.scope !== adapterScope) {
		return candidateState(
			"conflict",
			CONFLICT_CODE,
			`migration candidate ${JSON.stringify(candidate.identity)} is scoped to ${JSON.stringify(candidate.scope)}, not adapter scope ${JSON.stringify(adapterScope)}`,
		);
	}
	return { ok: true, candidate };
}

function adapterStateCode(status) {
	if (status === "stale") return STALE_CODE;
	if (status === "unavailable") return SOURCE_MISSING_CODE;
	if (status === "conflict") return CONFLICT_CODE;
	if (status === "unmapped") return UNMAPPED_CODE;
	return null;
}

function sourcePayload(bytes, sourceHash) {
	return {
		bytes: bytes.toString("utf8"),
		bytesBase64: bytes.toString("base64"),
		hash: sourceHash,
		byteLength: bytes.length,
	};
}

function appendReadReceipt(cwd, body) {
	let release;
	try {
		release = acquireReceiptLock(cwd);
	} catch (err) {
		return {
			ok: false,
			code: err.amberCode || RECEIPT_CORRUPT_CODE,
			receipt: null,
			errors: [err.message || String(err)],
		};
	}
	try {
		let current;
		try {
			current = foldReadReceipts(cwd);
		} catch (err) {
			return {
				ok: false,
				code: err.amberCode || RECEIPT_CORRUPT_CODE,
				receipt: null,
				errors: [err.message || String(err)],
			};
		}
		const prevHash = current.length > 0 ? current[current.length - 1].hash : GENESIS_HASH;
		const event = { ...body, prevHash, hash: chainHash(body, prevHash) };
		let ceiling;
		try {
			ceiling = appendReceiptWithinCeiling(cwd, event);
		} catch (err) {
			return {
				ok: false,
				code: err.amberCode || RECEIPT_CORRUPT_CODE,
				receipt: null,
				errors: [err.message || String(err)],
			};
		}
		if (ceiling.wouldExceed) {
			return {
				ok: false,
				code: RECEIPT_SIZE_CEILING_CODE,
				receipt: null,
				errors: [`adapter read receipt would exceed ${ceiling.ceiling} bytes`],
			};
		}
		try {
			appendJSONL(receiptPath(cwd), event);
		} catch (err) {
			return {
				ok: false,
				code: RECEIPT_CORRUPT_CODE,
				receipt: null,
				errors: [err.message || String(err)],
			};
		}
		return { ok: true, code: null, receipt: { ...event, index: current.length }, errors: [] };
	} finally {
		release();
	}
}

function prepareAdapterRead(
	cwd,
	{
		id,
		source,
		recordId,
		recordType = null,
		recordVersion = null,
		expectedSourceHash = null,
		scope = null,
	} = {},
	opts = {},
) {
	if (!isNonEmptyString(id))
		return {
			ok: false,
			code: INVALID_ARG_CODE,
			state: null,
			receiptBody: null,
			source: null,
			errors: [`id must be a non-empty adapter id`],
		};
	if (!isNonEmptyString(source))
		return {
			ok: false,
			code: INVALID_ARG_CODE,
			state: null,
			receiptBody: null,
			source: null,
			errors: [`source must be a non-empty path`],
		};
	if (!isNonEmptyString(recordId))
		return {
			ok: false,
			code: INVALID_ARG_CODE,
			state: null,
			receiptBody: null,
			source: null,
			errors: [`recordId must be a non-empty string`],
		};
	if (expectedSourceHash !== null && !SOURCE_HASH_PATTERN.test(expectedSourceHash))
		return {
			ok: false,
			code: INVALID_ARG_CODE,
			state: null,
			receiptBody: null,
			source: null,
			errors: [`expectedSourceHash must be null or a sha256:<64-hex> string`],
		};
	for (const [value, label] of [
		[recordType, "recordType"],
		[recordVersion, "recordVersion"],
		[scope, "scope"],
	]) {
		if (value !== null && !isNonEmptyString(value))
			return {
				ok: false,
				code: INVALID_ARG_CODE,
				state: null,
				receiptBody: null,
				source: null,
				errors: [`${label} must be null or a non-empty string`],
			};
	}
	let adapter;
	try {
		adapter = showAdapter(cwd, id);
	} catch (err) {
		return {
			ok: false,
			code: err.amberCode || REGISTRY_CORRUPT_CODE,
			state: null,
			receiptBody: null,
			source: null,
			errors: [err.message || String(err)],
		};
	}
	if (adapter === null)
		return {
			ok: false,
			code: NOT_FOUND_CODE,
			state: null,
			receiptBody: null,
			source: null,
			errors: [`adapter "${id}" is not registered`],
		};
	const effectiveScope = scope ?? adapter.scope;
	if (effectiveScope !== adapter.scope)
		return {
			ok: false,
			code: READ_FORBIDDEN_CODE,
			state: null,
			receiptBody: null,
			source: null,
			errors: [
				`adapter "${id}" is scoped to ${JSON.stringify(adapter.scope)}, not ${JSON.stringify(effectiveScope)}`,
			],
		};
	const effectiveRecordType = recordType ?? adapter.recordTypes[0].type;
	const effectiveTypeEntry = adapter.recordTypes.find(
		(entry) => entry.type === effectiveRecordType,
	);
	if (!effectiveTypeEntry)
		return {
			ok: false,
			code: READ_FORBIDDEN_CODE,
			state: null,
			receiptBody: null,
			source: null,
			errors: [
				`adapter "${id}" does not declare record type ${JSON.stringify(effectiveRecordType)}`,
			],
		};
	const effectiveRecordVersion = recordVersion ?? effectiveTypeEntry.versions[0];
	if (!effectiveTypeEntry.versions.includes(effectiveRecordVersion))
		return {
			ok: false,
			code: READ_FORBIDDEN_CODE,
			state: null,
			receiptBody: null,
			source: null,
			errors: [
				`adapter "${id}" does not declare record version ${JSON.stringify(effectiveRecordVersion)} for type ${JSON.stringify(effectiveRecordType)}`,
			],
		};
	let fullPath;
	try {
		fullPath = resolvePathWithin(cwd, source, { label: "Adapter source", canonicalExisting: true });
	} catch (err) {
		return {
			ok: false,
			code: READ_FORBIDDEN_CODE,
			state: null,
			receiptBody: null,
			source: null,
			errors: [err.message || String(err)],
		};
	}
	if (!allowedByAdapter(adapter, source))
		return {
			ok: false,
			code: READ_FORBIDDEN_CODE,
			state: null,
			receiptBody: null,
			source: null,
			errors: [`adapter "${id}" is not permitted to read ${JSON.stringify(source)}`],
		};
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	const baseReceipt = {
		kind: "read",
		schemaVersion: ADAPTER_READ_RECEIPT_SCHEMA_VERSION,
		at,
		adapterId: adapter.id,
		adapterVersion: adapter.adapterVersion,
		recordId,
		recordType: effectiveRecordType,
		recordVersion: effectiveRecordVersion,
		scope: adapter.scope,
		source,
		provenance: `adapter:${adapter.id}@${adapter.adapterVersion}`,
		expectedSourceHash,
		stateReason: null,
	};
	let bytes;
	let stat;
	try {
		stat = fs.statSync(fullPath);
		bytes = fs.readFileSync(fullPath);
	} catch (err) {
		if (err.code === "ENOENT" || err.code === "ENOTDIR") {
			const stateReason = `source not found: ${source}`;
			return {
				ok: false,
				code: SOURCE_MISSING_CODE,
				state: "unavailable",
				receiptBody: {
					...baseReceipt,
					status: "unavailable",
					sourceHash: null,
					sourceBytes: null,
					sourceByteLength: 0,
					stateReason,
				},
				source: null,
				errors: [stateReason],
			};
		}
		return {
			ok: false,
			code: READ_FORBIDDEN_CODE,
			state: null,
			receiptBody: null,
			source: null,
			errors: [err.message || String(err)],
		};
	}
	const sourceHash = sha256Bytes(bytes);
	const nowMs = opts.now instanceof Date ? opts.now.getTime() : Date.now();
	const stale = nowMs - stat.mtimeMs > adapter.freshness.maxAgeMs;
	const hashConflict = expectedSourceHash !== null && expectedSourceHash !== sourceHash;
	const status = hashConflict ? "conflict" : stale ? "stale" : "fresh";
	const stateReason = hashConflict
		? `source ${JSON.stringify(source)} hash changed for adapter "${id}": expected ${expectedSourceHash}, got ${sourceHash}`
		: stale
			? `source ${JSON.stringify(source)} is stale for adapter "${id}"`
			: null;
	return {
		ok: status === "fresh",
		code: adapterStateCode(status),
		state: status,
		receiptBody: {
			...baseReceipt,
			status,
			sourceHash,
			sourceBytes: bytes.toString("base64"),
			sourceByteLength: bytes.length,
			stateReason,
		},
		source: sourcePayload(bytes, sourceHash),
		errors: stateReason === null ? [] : [stateReason],
	};
}

function finishRead(cwd, prepared) {
	if (prepared.receiptBody === null) {
		return {
			ok: false,
			code: prepared.code,
			receipt: null,
			source: prepared.source,
			errors: prepared.errors,
		};
	}
	const appended = appendReadReceipt(cwd, prepared.receiptBody);
	if (!appended.ok) return { ...appended, source: prepared.source };
	return {
		ok: prepared.ok,
		code: prepared.code,
		receipt: appended.receipt,
		source: prepared.source,
		errors: prepared.errors,
	};
}

function readAdapterRecord(cwd, input = {}, opts = {}) {
	return finishRead(cwd, prepareAdapterRead(cwd, input, opts));
}

function candidateAdmissionPayload(candidate, receipt) {
	return {
		type: candidate.type,
		identity: candidate.identity,
		body: candidate.body,
		provenance: {
			source: receipt.provenance,
			adapter: {
				id: receipt.adapterId,
				version: receipt.adapterVersion,
				scope: receipt.scope,
				recordId: receipt.recordId,
				recordType: receipt.recordType,
				recordVersion: receipt.recordVersion,
				source: receipt.source,
				sourceHash: receipt.sourceHash,
				readReceiptIndex: receipt.index,
			},
		},
		scope: candidate.scope,
		traces: candidate.traces,
		extensions: candidate.extensions,
		transition: candidate.transition,
		idempotencyKey: candidate.idempotencyKey,
		expectedHead: candidate.expectedHead,
		supersedes: candidate.supersedes,
	};
}

function prepareMigrationCandidate(cwd, input = {}, opts = {}) {
	const prepared = prepareAdapterRead(cwd, input, opts);
	if (prepared.receiptBody === null) {
		return {
			ok: false,
			code: prepared.code,
			state: prepared.state,
			receipt: null,
			source: prepared.source,
			candidate: null,
			errors: prepared.errors,
		};
	}
	if (!prepared.ok) {
		const read = finishRead(cwd, prepared);
		return { ...read, state: prepared.state, candidate: null };
	}
	const parsed = migrationCandidateFromSource(
		prepared.source.bytes,
		input.recordId,
		prepared.receiptBody.scope,
	);
	if (!parsed.ok) {
		const read = finishRead(cwd, {
			...prepared,
			ok: false,
			code: parsed.code,
			state: parsed.status,
			receiptBody: {
				...prepared.receiptBody,
				status: parsed.status,
				stateReason: parsed.errors[0],
			},
			errors: parsed.errors,
		});
		return { ...read, state: parsed.status, candidate: null };
	}
	const read = finishRead(cwd, prepared);
	if (!read.ok) return { ...read, state: prepared.state, candidate: null };
	return {
		ok: true,
		code: null,
		state: "fresh",
		receipt: read.receipt,
		source: read.source,
		candidate: candidateAdmissionPayload(parsed.candidate, read.receipt),
		errors: [],
	};
}

function compareHash(value) {
	return sha256Bytes(Buffer.from(canonicalJson(JSON.stringify(value))));
}

function comparisonTargetInputProblem(target, label) {
	if (target === undefined || target === null) return null;
	if (!isPlainObject(target)) return `${label} must be null or an object`;
	const unknown = unknownFieldProblem(target, ["type", "identity", "revision"], label);
	if (unknown !== null) return unknown;
	if (!isNonEmptyString(target.type)) return `${label}.type must be a non-empty string`;
	if (!isNonEmptyString(target.identity)) return `${label}.identity must be a non-empty string`;
	if (!Number.isInteger(target.revision) || target.revision < 1)
		return `${label}.revision must be a positive integer`;
	return null;
}

function comparisonItemInputProblem(item, index) {
	if (!isPlainObject(item)) return `items[${index}] must be an object`;
	const unknown = unknownFieldProblem(
		item,
		[
			"recordId",
			"source",
			"recordType",
			"recordVersion",
			"expectedSourceHash",
			"target",
			"disposition",
		],
		`items[${index}]`,
	);
	if (unknown !== null) return unknown;
	for (const field of ["recordId", "source"]) {
		if (!isNonEmptyString(item[field]))
			return `items[${index}].${field} must be a non-empty string`;
	}
	for (const field of ["recordType", "recordVersion", "disposition"]) {
		if (item[field] !== undefined && item[field] !== null && !isNonEmptyString(item[field]))
			return `items[${index}].${field} must be null or a non-empty string`;
	}
	if (item.expectedSourceHash !== undefined && item.expectedSourceHash !== null) {
		if (!SOURCE_HASH_PATTERN.test(item.expectedSourceHash))
			return `items[${index}].expectedSourceHash must be a sha256:<64-hex> string`;
	}
	return comparisonTargetInputProblem(item.target, `items[${index}].target`);
}

function targetReceiptFromArtifact(artifact) {
	if (artifact === null) return null;
	return {
		type: artifact.type,
		identity: artifact.identity,
		revision: artifact.revision,
		contentHash: artifact.contentHash,
		envelopeHash: artifact.envelopeHash,
		scope: artifact.scope ?? null,
		traces: artifact.traces || [],
		extensions: artifact.extensions ?? null,
		transition: artifact.transition ?? null,
		supersedes: artifact.supersedes ?? null,
	};
}

function readTargetArtifact(cwd, target) {
	if (target === undefined || target === null) return { ok: true, target: null };
	try {
		const revisions = listArtifactRevisions(cwd).filter(
			(revision) => revision.type === target.type && revision.identity === target.identity,
		);
		if (revisions.length === 0) return { ok: true, target: null };
		if (target.revision !== undefined && target.revision !== null) {
			return {
				ok: true,
				target: revisions.find((revision) => revision.revision === target.revision) ?? null,
			};
		}
		return { ok: true, target: revisions[revisions.length - 1] };
	} catch (err) {
		return {
			ok: false,
			code: err.amberCode || "AMBER_E_ARTIFACT_JOURNAL_CORRUPT",
			errors: [err.message || String(err)],
		};
	}
}

function coverageSeed(scope) {
	return { scope, total: 0, mapped: 0, unmapped: 0, stale: 0, conflict: 0, unavailable: 0 };
}

function itemDisposition(item) {
	return item.disposition === undefined ? null : item.disposition;
}

function compareItemStatus({ read, parsed, target, item }) {
	if (read.receipt.status !== "fresh") {
		return {
			status: read.receipt.status,
			reason: read.receipt.stateReason,
			candidate: null,
		};
	}
	if (!parsed.ok) {
		return { status: parsed.status, reason: parsed.errors[0], candidate: null };
	}
	const candidate = parsed.candidate;
	const candidateReceipt = {
		type: candidate.type,
		identity: candidate.identity,
		bodyHash: bodyHash(candidate.body),
		scope: candidate.scope,
	};
	if (target === null && item.target !== undefined && item.target !== null) {
		return {
			status: "conflict",
			reason: `declared canonical target ${JSON.stringify(`${item.target.type}:${item.target.identity}@${item.target.revision}`)} was not found`,
			candidate: candidateReceipt,
		};
	}
	if (target === null) {
		return {
			status: "unmapped",
			reason: `no canonical target declared for ${JSON.stringify(item.recordId)}`,
			candidate: candidateReceipt,
		};
	}
	const mismatches = [];
	if (candidate.type !== target.type) mismatches.push("type");
	if (candidate.identity !== target.identity) mismatches.push("identity");
	if ((candidate.scope ?? null) !== (target.scope ?? null)) mismatches.push("scope");
	if (candidateReceipt.bodyHash !== target.contentHash) mismatches.push("contentHash");
	if (canonicalValue(candidate.traces) !== canonicalValue(target.traces || []))
		mismatches.push("traces");
	if (canonicalValue(candidate.extensions) !== canonicalValue(target.extensions ?? null))
		mismatches.push("extensions");
	if ((candidate.transition ?? null) !== (target.transition ?? null)) mismatches.push("transition");
	if ((candidate.supersedes ?? candidate.expectedHead ?? null) !== (target.supersedes ?? null))
		mismatches.push("supersedes");
	if (mismatches.length > 0) {
		return {
			status: "conflict",
			reason: `candidate and canonical target differ on ${mismatches.join(", ")}`,
			candidate: candidateReceipt,
		};
	}
	return { status: "mapped", reason: null, candidate: candidateReceipt };
}

function compareAdapterShadow(cwd, input = {}, opts = {}) {
	if (!isPlainObject(input))
		return {
			ok: false,
			code: COMPARISON_INVALID_CODE,
			receipt: null,
			errors: ["comparison input must be an object"],
		};
	const inputClosed = unknownFieldProblem(input, COMPARISON_INPUT_FIELDS, "comparison input");
	if (inputClosed !== null)
		return { ok: false, code: COMPARISON_INVALID_CODE, receipt: null, errors: [inputClosed] };
	if (!isNonEmptyString(input.id))
		return {
			ok: false,
			code: INVALID_ARG_CODE,
			receipt: null,
			errors: [`id must be a non-empty adapter id`],
		};
	if (!Array.isArray(input.items) || input.items.length === 0)
		return {
			ok: false,
			code: COMPARISON_INVALID_CODE,
			receipt: null,
			errors: ["items must be a non-empty comparison fixture array"],
		};
	if (!Number.isInteger(input.expectedTotal) || input.expectedTotal < 1)
		return {
			ok: false,
			code: COMPARISON_COVERAGE_MISSING_CODE,
			receipt: null,
			errors: ["expectedTotal must be a positive integer matching the bounded fixture size"],
		};
	if (input.expectedTotal !== input.items.length)
		return {
			ok: false,
			code: COMPARISON_COVERAGE_MISSING_CODE,
			receipt: null,
			errors: [
				`expectedTotal ${input.expectedTotal} does not match ${input.items.length} comparison items`,
			],
		};
	if (input.items.length > MAX_COMPARISON_ITEMS)
		return {
			ok: false,
			code: COMPARISON_INVALID_CODE,
			receipt: null,
			errors: [`items must contain at most ${MAX_COMPARISON_ITEMS} entries`],
		};
	if (!isNonEmptyString(input.fixtureId))
		return {
			ok: false,
			code: COMPARISON_INVALID_CODE,
			receipt: null,
			errors: ["fixtureId must be a non-empty string"],
		};
	const fixtureId = input.fixtureId;
	let adapter;
	try {
		adapter = showAdapter(cwd, input.id);
	} catch (err) {
		return {
			ok: false,
			code: err.amberCode || REGISTRY_CORRUPT_CODE,
			receipt: null,
			errors: [err.message || String(err)],
		};
	}
	if (adapter === null)
		return {
			ok: false,
			code: NOT_FOUND_CODE,
			receipt: null,
			errors: [`adapter "${input.id}" is not registered`],
		};
	if (input.scope !== undefined && input.scope !== null && !isNonEmptyString(input.scope))
		return {
			ok: false,
			code: COMPARISON_INVALID_CODE,
			receipt: null,
			errors: ["scope must be null or a non-empty string"],
		};
	const scope = input.scope ?? adapter.scope;
	if (scope !== adapter.scope)
		return {
			ok: false,
			code: READ_FORBIDDEN_CODE,
			receipt: null,
			errors: [
				`adapter "${input.id}" is scoped to ${JSON.stringify(adapter.scope)}, not ${JSON.stringify(scope)}`,
			],
		};
	const targets = [];
	for (let index = 0; index < input.items.length; index += 1) {
		const item = input.items[index];
		const problem = comparisonItemInputProblem(item, index);
		if (problem !== null)
			return { ok: false, code: COMPARISON_INVALID_CODE, receipt: null, errors: [problem] };
		if (
			(item.target === undefined || item.target === null) &&
			!isNonEmptyString(itemDisposition(item))
		) {
			return {
				ok: false,
				code: COMPARISON_COVERAGE_MISSING_CODE,
				receipt: null,
				errors: [`comparison item ${index} is unmapped and must record a disposition`],
			};
		}
		const targetRead = readTargetArtifact(cwd, item.target ?? null);
		if (!targetRead.ok)
			return { ok: false, code: targetRead.code, receipt: null, errors: targetRead.errors };
		targets.push(targetReceiptFromArtifact(targetRead.target));
	}
	const coverage = coverageSeed(scope);
	const pending = [];
	for (let index = 0; index < input.items.length; index += 1) {
		const item = input.items[index];
		const prepared = prepareAdapterRead(
			cwd,
			{
				id: input.id,
				source: item.source,
				recordId: item.recordId,
				recordType: item.recordType === undefined ? null : item.recordType,
				recordVersion: item.recordVersion === undefined ? null : item.recordVersion,
				expectedSourceHash: item.expectedSourceHash === undefined ? null : item.expectedSourceHash,
				scope,
			},
			opts,
		);
		if (prepared.receiptBody === null)
			return { ok: false, code: prepared.code, receipt: null, errors: prepared.errors };
		const parsed = prepared.ok
			? migrationCandidateFromSource(prepared.source.bytes, item.recordId, scope)
			: { ok: false, status: prepared.state, errors: prepared.errors };
		const status = compareItemStatus({
			read: { receipt: prepared.receiptBody },
			parsed,
			target: targets[index],
			item,
		});
		const disposition = itemDisposition(item);
		if (status.status === "unmapped" && !isNonEmptyString(disposition)) {
			return {
				ok: false,
				code: COMPARISON_COVERAGE_MISSING_CODE,
				receipt: null,
				errors: [`comparison item ${index} is unmapped and must record a disposition`],
			};
		}
		pending.push({ index, item, prepared, status, target: targets[index], disposition });
	}
	const results = [];
	for (const entry of pending) {
		const read = finishRead(cwd, entry.prepared);
		if (read.receipt === null)
			return { ok: false, code: read.code, receipt: null, errors: read.errors };
		coverage.total += 1;
		coverage[entry.status.status] += 1;
		results.push({
			itemIndex: entry.index,
			recordId: entry.item.recordId,
			source: entry.item.source,
			readReceiptIndex: read.receipt.index,
			sourceStatus: read.receipt.status,
			sourceHash: read.receipt.sourceHash,
			target: entry.target,
			candidate: entry.status.candidate,
			status: entry.status.status,
			reason: entry.status.reason,
			disposition: entry.disposition,
		});
	}
	const fixtureHash = compareHash({
		fixtureId,
		adapterId: input.id,
		scope,
		expectedTotal: input.expectedTotal,
		items: input.items,
	});
	const sourceSetHash = compareHash(
		results.map((item) => ({
			recordId: item.recordId,
			sourceHash: item.sourceHash,
			sourceStatus: item.sourceStatus,
		})),
	);
	const targetSetHash = compareHash(
		results.map((item) => ({ recordId: item.recordId, target: item.target })),
	);
	const hashItems = results.map(({ readReceiptIndex: _readReceiptIndex, ...item }) => item);
	const comparisonHash = compareHash({
		fixtureHash,
		sourceSetHash,
		targetSetHash,
		coverage,
		items: hashItems,
	});
	const body = {
		kind: "shadow-comparison",
		schemaVersion: ADAPTER_SHADOW_COMPARISON_SCHEMA_VERSION,
		at: (opts.now instanceof Date ? opts.now : new Date()).toISOString(),
		adapterId: adapter.id,
		adapterVersion: adapter.adapterVersion,
		scope,
		fixtureId,
		fixtureHash,
		comparisonHash,
		sourceSetHash,
		targetSetHash,
		coverage,
		items: results,
	};
	const appended = appendShadowComparison(cwd, body);
	if (!appended.ok) return appended;
	return { ok: true, code: null, receipt: appended.receipt, errors: [] };
}

function listShadowComparisons(cwd, { adapterId = null, scope = null } = {}) {
	return foldShadowComparisons(cwd).filter(
		(receipt) =>
			(adapterId === null || receipt.adapterId === adapterId) &&
			(scope === null || receipt.scope === scope),
	);
}

function listReadReceipts(cwd, { adapterId = null } = {}) {
	return foldReadReceipts(cwd).filter(
		(receipt) => adapterId === null || receipt.adapterId === adapterId,
	);
}

module.exports = {
	ADAPTER_SCHEMA_VERSION,
	ADAPTER_READ_RECEIPT_SCHEMA_VERSION,
	SUPPORTED_ADAPTER_SCHEMA_VERSIONS,
	SUPPORTED_ADAPTER_READ_RECEIPT_SCHEMA_VERSIONS,
	DEFAULT_MAX_ADAPTER_BYTES,
	GENESIS_HASH,
	chainHash,
	registerAdapter,
	showAdapter,
	listAdapters,
	readAdapterRecord,
	prepareMigrationCandidate,
	compareAdapterShadow,
	listShadowComparisons,
	listReadReceipts,
	registryPath,
	receiptPath,
	comparisonPath,
};
