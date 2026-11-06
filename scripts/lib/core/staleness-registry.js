"use strict";

// F050 ticket 6 (#231) — append-only staleness / invalidation receipts.
// Historical passes and Decisions are never rewritten; when Policy/Evidence or
// other explicit dependencies change, Amber records a scoped invalidation
// receipt. Strict queries consume this read-side evidence and fail closed for
// affected scopes instead of silently satisfying a Gate with stale data.
//
// ADR-0028: this is a governed chained ledger, so the lock → fold → chain-walk
// → ceiling → append ritual comes from `defineLedgerFamily` and is not written
// here. Only the domain half of the fold is local: the closed field set, the
// single `invalidated` kind, the supported schema versions, and the dependency
// shape. The recorded refusal wording stays byte-identical through the
// factory's `chainWording` / `ceiling.message` overrides, which exist for
// exactly this (ADR-0028 Amendments).

const { typedError } = require("./error-catalog");
const {
	GENESIS_HASH,
	chainHash,
	isPlainObject,
	isNonEmptyString,
	quotedList,
	closedFieldProblem,
} = require("./registry-ledger");
const { defineLedgerFamily } = require("./ledger-family");

const STALENESS_SCHEMA_VERSION = 1;
const SUPPORTED_STALENESS_SCHEMA_VERSIONS = Object.freeze([1]);
const DEFAULT_MAX_STALENESS_BYTES = 1024 * 1024;

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

function corrupt(message) {
	return typedError(REGISTRY_CORRUPT_CODE, message);
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

function rawDependencyUnknownProblem(dependency) {
	if (!isPlainObject(dependency)) return null;
	const unknown = Object.keys(dependency)
		.filter((key) => !DEPENDENCY_FIELDS.includes(key))
		.sort();
	if (unknown.length === 0) return null;
	return `dependency carries unknown field${unknown.length > 1 ? "s" : ""} ${quotedList(unknown)}; the closed field set is ${DEPENDENCY_FIELDS.join(", ")}`;
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

// The recorded per-event refusal texts (before ADR-0028 the fold wrote these
// inline). Each kind overrides the factory's shared chain-link wording so the
// published messages keep their exact bytes.
function chainWording(kind, _event, lineIndex) {
	const head = `staleness receipt ${lineIndex}`;
	if (kind === "not-object") return `${head} is not an object`;
	if (kind === "broken") return `${head} breaks the hash chain`;
	if (kind === "mismatch") return `${head} carries a hash that does not match its content`;
	return null;
}

// The domain half of the fold: the chain walk has already succeeded, so this
// sees only a hash-verified event. Every failure is the ledger's corrupt code.
function applyReceipt(state, event, lineIndex) {
	const label = `staleness receipt ${lineIndex}`;
	const closed = closedFieldProblem(event, EVENT_FIELDS, label);
	if (closed !== null) throw corrupt(closed);
	if (event.kind !== "invalidated")
		throw corrupt(`${label} carries unknown kind ${JSON.stringify(event.kind)}`);
	if (!SUPPORTED_STALENESS_SCHEMA_VERSIONS.includes(event.schemaVersion)) {
		throw corrupt(
			`${label} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
		);
	}
	if (!isNonEmptyString(event.at)) throw corrupt(`${label} has no timestamp`);
	if (!isNonEmptyString(event.subject)) throw corrupt(`${label} has no subject`);
	const dep = dependencyProblem(event.dependency, `${label}.dependency`);
	if (dep !== null) throw corrupt(dep);
	if (!isNonEmptyString(event.reason)) throw corrupt(`${label} has no reason`);
	state.push({ ...event, index: lineIndex - 1 });
}

const FAMILY = defineLedgerFamily({
	dir: "staleness",
	label: "staleness receipt ledger",
	ledgers: [
		{
			name: "receipts",
			fileName: "receipts.jsonl",
			lockName: "receipts.lock",
			conflictCode: REGISTRY_LOCK_CODE,
			corruptCode: REGISTRY_CORRUPT_CODE,
			sizeCeilingCode: SIZE_CEILING_CODE,
			ceiling: {
				envName: "AMBER_STALENESS_MAX_RECEIPT_BYTES",
				defaultBytes: DEFAULT_MAX_STALENESS_BYTES,
				message: (_event, ceiling) =>
					`appending the staleness receipt would exceed ${ceiling} bytes`,
			},
			label: "staleness receipt ledger",
			eventLabel: "staleness receipt",
			fold: {
				init: () => [],
				apply: applyReceipt,
				result: (state) => state,
				chainWording,
			},
		},
	],
});

const RECEIPTS = FAMILY.ledgers.receipts;

function ledgerPath(cwd) {
	return RECEIPTS.path(cwd);
}

function foldStalenessReceipts(cwd) {
	return RECEIPTS.fold(cwd);
}

function recordInvalidation(cwd, { subject, dependency, reason }, opts = {}) {
	const rawDependencyProblem = rawDependencyUnknownProblem(dependency || {});
	if (rawDependencyProblem !== null)
		return { ok: false, code: INVALID_ARG_CODE, receipt: null, errors: [rawDependencyProblem] };
	const dep = normalizedDependency(dependency || {});
	const problem = inputProblem({ subject, dependency: dep, reason });
	if (problem !== null)
		return { ok: false, code: INVALID_ARG_CODE, receipt: null, errors: [problem] };
	const at = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
	// The factory owns the lock, the in-lock fold, the chain hash, the ceiling,
	// the append, and the re-fold; `body` is redacted there. The guard has no
	// domain refusal to add, and `derive` picks the event just appended.
	let result;
	try {
		result = RECEIPTS.append(
			cwd,
			{
				kind: "invalidated",
				schemaVersion: STALENESS_SCHEMA_VERSION,
				at,
				subject,
				dependency: dep,
				reason,
			},
			() => null,
			(events) => events[events.length - 1],
		);
	} catch (err) {
		// The shared append deliberately rethrows a malformed size-ceiling as an
		// argument error; this surface has always reported it as a structured
		// refusal instead, so keep that shape.
		return {
			ok: false,
			code: err.amberCode || REGISTRY_CORRUPT_CODE,
			receipt: null,
			errors: [err.message || String(err)],
		};
	}
	return { ok: result.ok, code: result.code, receipt: result.record, errors: result.errors };
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
