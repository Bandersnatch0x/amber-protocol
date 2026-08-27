"use strict";

// F051 ticket 1 (#233) — read-only Adapter registry and read receipts.
//
// Adapters are pre-Cutover readers. They declare who owns the source, what
// record shapes they can read, how identities map, freshness and permission
// bounds, then append receipts for every read. The only writes here are the
// adapter governance ledgers themselves; no path reaches Canonical Artifact
// admission, so the external source remains authoritative until a future
// Cutover Decision.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { appendJSONL, readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { resolvePathWithin } = require("./fs-utils");
const { typedError } = require("./error-catalog");
const {
	GENESIS_HASH,
	chainHash,
	chainHeadHash,
	acquireLedgerLock,
	appendWithinCeiling: sharedAppendWithinCeiling,
} = require("./registry-ledger");

const ADAPTER_SCHEMA_VERSION = 1;
const ADAPTER_READ_RECEIPT_SCHEMA_VERSION = 1;
const SUPPORTED_ADAPTER_SCHEMA_VERSIONS = Object.freeze([1]);
const SUPPORTED_ADAPTER_READ_RECEIPT_SCHEMA_VERSIONS = Object.freeze([1]);
const DEFAULT_MAX_ADAPTER_BYTES = 1024 * 1024;
const LOCK_STALE_MS = 30_000;

const REGISTRY_CORRUPT_CODE = "AMBER_E_ADAPTER_REGISTRY_CORRUPT";
const REGISTRY_LOCK_CODE = "AMBER_E_ADAPTER_REGISTRY_LOCK";
const SIZE_CEILING_CODE = "AMBER_E_ADAPTER_SIZE_CEILING";
const RECEIPT_CORRUPT_CODE = "AMBER_E_ADAPTER_READ_RECEIPT_CORRUPT";
const RECEIPT_LOCK_CODE = "AMBER_E_ADAPTER_READ_RECEIPT_LOCK";
const RECEIPT_SIZE_CEILING_CODE = "AMBER_E_ADAPTER_READ_RECEIPT_SIZE_CEILING";
const INVALID_CODE = "AMBER_E_ADAPTER_INVALID";
const NOT_FOUND_CODE = "AMBER_E_ADAPTER_NOT_FOUND";
const READ_FORBIDDEN_CODE = "AMBER_E_ADAPTER_READ_FORBIDDEN";
const SOURCE_MISSING_CODE = "AMBER_E_ADAPTER_SOURCE_MISSING";
const STALE_CODE = "AMBER_E_ADAPTER_STALE";
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
const RECEIPT_EVENT_FIELDS = Object.freeze([
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
	"status",
	"sourceHash",
	"sourceBytes",
	"sourceByteLength",
	"provenance",
	"prevHash",
	"hash",
]);
const READ_STATUSES = Object.freeze(["fresh", "stale", "unavailable", "conflict", "unmapped"]);

function registryPath(cwd) {
	return statePathForCreate(cwd, "adapters", "registry.jsonl");
}

function receiptPath(cwd) {
	return statePathForCreate(cwd, "adapters", "read-receipts.jsonl");
}

function adapterCorrupt(message) {
	return typedError(REGISTRY_CORRUPT_CODE, message);
}

function receiptCorrupt(message) {
	return typedError(RECEIPT_CORRUPT_CODE, message);
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

function receiptEventProblem(event, lineIndex) {
	if (!isPlainObject(event)) return `adapter read receipt ${lineIndex} is not an object`;
	const closed = closedFieldProblem(
		event,
		RECEIPT_EVENT_FIELDS,
		`adapter read receipt ${lineIndex}`,
	);
	if (closed !== null) return closed;
	if (event.kind !== "read")
		return `adapter read receipt ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`;
	if (!SUPPORTED_ADAPTER_READ_RECEIPT_SCHEMA_VERSIONS.includes(event.schemaVersion))
		return `adapter read receipt ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`;
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
	if (!READ_STATUSES.includes(event.status))
		return `adapter read receipt ${lineIndex}.status must be one of ${READ_STATUSES.join(", ")}`;
	if (event.sourceHash !== null && !isNonEmptyString(event.sourceHash))
		return `adapter read receipt ${lineIndex}.sourceHash must be null or a non-empty string`;
	if (event.sourceBytes !== null && typeof event.sourceBytes !== "string")
		return `adapter read receipt ${lineIndex}.sourceBytes must be null or a base64 string`;
	if (!Number.isInteger(event.sourceByteLength) || event.sourceByteLength < 0)
		return `adapter read receipt ${lineIndex}.sourceByteLength must be a non-negative integer`;
	if (event.status !== "unavailable" && (event.sourceHash === null || event.sourceBytes === null))
		return `adapter read receipt ${lineIndex} with status ${event.status} must carry sourceHash and sourceBytes`;
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

function readAdapterRecord(
	cwd,
	{ id, source, recordId, recordType, recordVersion = null, scope = null },
	opts = {},
) {
	if (!isNonEmptyString(id))
		return {
			ok: false,
			code: INVALID_ARG_CODE,
			receipt: null,
			source: null,
			errors: [`id must be a non-empty adapter id`],
		};
	if (!isNonEmptyString(source))
		return {
			ok: false,
			code: INVALID_ARG_CODE,
			receipt: null,
			source: null,
			errors: [`source must be a non-empty path`],
		};
	if (!isNonEmptyString(recordId))
		return {
			ok: false,
			code: INVALID_ARG_CODE,
			receipt: null,
			source: null,
			errors: [`recordId must be a non-empty string`],
		};
	let adapter;
	try {
		adapter = showAdapter(cwd, id);
	} catch (err) {
		return {
			ok: false,
			code: err.amberCode || REGISTRY_CORRUPT_CODE,
			receipt: null,
			source: null,
			errors: [err.message || String(err)],
		};
	}
	if (adapter === null)
		return {
			ok: false,
			code: NOT_FOUND_CODE,
			receipt: null,
			source: null,
			errors: [`adapter "${id}" is not registered`],
		};
	const effectiveScope = scope || adapter.scope;
	if (effectiveScope !== adapter.scope)
		return {
			ok: false,
			code: READ_FORBIDDEN_CODE,
			receipt: null,
			source: null,
			errors: [
				`adapter "${id}" is scoped to ${JSON.stringify(adapter.scope)}, not ${JSON.stringify(effectiveScope)}`,
			],
		};
	const effectiveRecordType = recordType || adapter.recordTypes[0].type;
	const effectiveTypeEntry = adapter.recordTypes.find(
		(entry) => entry.type === effectiveRecordType,
	);
	if (!effectiveTypeEntry)
		return {
			ok: false,
			code: READ_FORBIDDEN_CODE,
			receipt: null,
			source: null,
			errors: [
				`adapter "${id}" does not declare record type ${JSON.stringify(effectiveRecordType)}`,
			],
		};
	const effectiveRecordVersion = recordVersion || effectiveTypeEntry.versions[0];
	if (!effectiveTypeEntry.versions.includes(effectiveRecordVersion))
		return {
			ok: false,
			code: READ_FORBIDDEN_CODE,
			receipt: null,
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
			receipt: null,
			source: null,
			errors: [err.message || String(err)],
		};
	}
	if (!allowedByAdapter(adapter, source))
		return {
			ok: false,
			code: READ_FORBIDDEN_CODE,
			receipt: null,
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
	};
	let bytes;
	let stat;
	try {
		stat = fs.statSync(fullPath);
		bytes = fs.readFileSync(fullPath);
	} catch (err) {
		if (err.code === "ENOENT" || err.code === "ENOTDIR") {
			const appended = appendReadReceipt(cwd, {
				...baseReceipt,
				status: "unavailable",
				sourceHash: null,
				sourceBytes: null,
				sourceByteLength: 0,
			});
			if (!appended.ok) return { ...appended, source: null };
			return {
				ok: false,
				code: SOURCE_MISSING_CODE,
				receipt: appended.receipt,
				source: null,
				errors: [`source not found: ${source}`],
			};
		}
		return {
			ok: false,
			code: READ_FORBIDDEN_CODE,
			receipt: null,
			source: null,
			errors: [err.message || String(err)],
		};
	}
	const sourceHash = sha256Bytes(bytes);
	const nowMs = opts.now instanceof Date ? opts.now.getTime() : Date.now();
	const stale = nowMs - stat.mtimeMs > adapter.freshness.maxAgeMs;
	const status = stale ? "stale" : "fresh";
	const appended = appendReadReceipt(cwd, {
		...baseReceipt,
		status,
		sourceHash,
		sourceBytes: bytes.toString("base64"),
		sourceByteLength: bytes.length,
	});
	if (!appended.ok) return { ...appended, source: null };
	return {
		ok: !stale,
		code: stale ? STALE_CODE : null,
		receipt: appended.receipt,
		source: {
			bytes: bytes.toString("utf8"),
			bytesBase64: bytes.toString("base64"),
			hash: sourceHash,
			byteLength: bytes.length,
		},
		errors: stale ? [`source ${JSON.stringify(source)} is stale for adapter "${id}"`] : [],
	};
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
	listReadReceipts,
	registryPath,
	receiptPath,
};
