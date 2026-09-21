"use strict";

// Trusted-control context/runtime contract §6.2 — the Research citation
// store: `.amber/research/citations.jsonl`, append-only, one citation per
// line, written through the ledger-family factory (0045: no new ledger
// implementations outside `ledger-family`). This is the ONLY write path for
// `cite` outputs. Each entry carries minimal provenance — the source
// reference, the exact fetched bytes' rawHash, the retrieval instant (never
// merged with the recording instant), the locator, and the claim reference.

const { defineLedgerFamily } = require("./ledger-family");
const { isNonEmptyString, isPlainObject } = require("./registry-ledger");

const CITATION_CORRUPT_CODE = "AMBER_E_RESEARCH_CITATIONS_CORRUPT";
const CITATION_LOCK_CODE = "AMBER_E_RESEARCH_CITATIONS_LOCK";
const CITATION_CEILING_CODE = "AMBER_E_RESEARCH_CITATIONS_CEILING";
const CITATION_INVALID_CODE = "AMBER_E_RESEARCH_CITATION_INVALID";

const DEFAULT_MAX_CITATION_BYTES = 1024 * 1024;
const CEILING_ENV_NAME = "AMBER_RESEARCH_CITATIONS_MAX_BYTES";

const CITATION_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"citationId",
	"sourceRef",
	"rawHash",
	"retrievedAt",
	"locator",
	"claimRef",
	"requestHash",
	"prevHash",
	"hash",
]);

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

function citationEventProblem(event, lineIndex) {
	const label = `research citation event ${lineIndex}`;
	if (event.kind !== "citation")
		return `${label} carries unknown kind ${JSON.stringify(event.kind)}; the store records citations only`;
	const closed = closedFieldCheck(event, label);
	if (closed !== null) return closed;
	if (!isNonEmptyString(event.at) || Number.isNaN(Date.parse(event.at)))
		return `${label}.at must be an ISO-8601 timestamp`;
	if (!isNonEmptyString(event.citationId)) return `${label}.citationId must be a non-empty string`;
	if (!isNonEmptyString(event.sourceRef)) return `${label}.sourceRef must be a non-empty string`;
	if (!SHA256_PATTERN.test(event.rawHash ?? ""))
		return `${label}.rawHash must be a sha256:<64-hex> digest of the exact fetched bytes`;
	if (!isNonEmptyString(event.retrievedAt) || Number.isNaN(Date.parse(event.retrievedAt)))
		return `${label}.retrievedAt must be an ISO-8601 timestamp — when the search/extract actually fetched the content`;
	if (!isNonEmptyString(event.locator)) return `${label}.locator must be a non-empty string`;
	if (!isNonEmptyString(event.requestHash))
		return `${label}.requestHash must name the F052 request that produced the citation`;
	return null;
}

function closedFieldCheck(event, label) {
	const unknown = Object.keys(event).filter((key) => !CITATION_EVENT_FIELDS.includes(key));
	if (unknown.length > 0)
		return `${label} carries unknown field(s) ${unknown.join(", ")}; the closed field set is ${CITATION_EVENT_FIELDS.join(", ")}`;
	const missing = CITATION_EVENT_FIELDS.filter((field) => !(field in event));
	if (missing.length > 0) return `${label} is missing field(s) ${missing.join(", ")}`;
	return null;
}

const CITATION_FAMILY = defineLedgerFamily({
	dir: "research",
	label: "research citation store",
	ledgers: [
		{
			name: "citations",
			fileName: "citations.jsonl",
			lockName: "citations.lock",
			conflictCode: CITATION_LOCK_CODE,
			corruptCode: CITATION_CORRUPT_CODE,
			sizeCeilingCode: CITATION_CEILING_CODE,
			ceiling: { envName: CEILING_ENV_NAME, defaultBytes: DEFAULT_MAX_CITATION_BYTES },
			label: "research citation store",
			eventLabel: "research citation event",
			fold: {
				init: () => [],
				apply: (citations, event, lineIndex) => {
					const problem = citationEventProblem(event, lineIndex);
					if (problem !== null) {
						throw Object.assign(new Error(problem), { amberCode: CITATION_CORRUPT_CODE });
					}
					citations.push({ ...event });
				},
				result: (citations) => citations,
			},
		},
	],
});

const CITATIONS_LEDGER = CITATION_FAMILY.ledgers.citations;

function citationLedgerPath(cwd) {
	return CITATIONS_LEDGER.path(cwd);
}

/**
 * Validate one citation input and build its event body (without chain
 * fields). `retrievedAt` is the per-source fetch instant; `at` is stamped at
 * recording — the two timestamps are never merged (§6.1).
 */
function citationEventBody(input, now) {
	if (!isPlainObject(input)) return { problem: "citation input must be an object" };
	for (const field of ["citationId", "sourceRef", "retrievedAt", "locator", "requestHash"]) {
		if (!isNonEmptyString(input[field]))
			return { problem: `citation ${field} must be a non-empty string` };
	}
	if (!SHA256_PATTERN.test(input.rawHash ?? ""))
		return {
			problem: "citation rawHash must be a sha256:<64-hex> digest of the exact fetched bytes",
		};
	if (Number.isNaN(Date.parse(input.retrievedAt)))
		return { problem: "citation retrievedAt must be an ISO-8601 timestamp" };
	const at = now.toISOString();
	return {
		body: {
			kind: "citation",
			at,
			citationId: input.citationId,
			sourceRef: input.sourceRef,
			rawHash: input.rawHash,
			retrievedAt: input.retrievedAt,
			locator: input.locator,
			claimRef: input.claimRef ?? null,
			requestHash: input.requestHash,
		},
	};
}

/**
 * Append one citation to the store. The fold refuses a duplicate citationId
 * (a citation is recorded once; a re-record is a conflict, not an update).
 * @returns {{ ok: true, record: object } | { ok: false, code: string, errors: string[] }}
 */
function recordCitation(cwd, input, opts = {}) {
	const now = opts.now instanceof Date ? opts.now : new Date();
	if (Number.isNaN(now.getTime())) {
		return { ok: false, code: CITATION_INVALID_CODE, errors: ["now must be a valid clock"] };
	}
	const { body, problem } = citationEventBody(input, now);
	if (problem) return { ok: false, code: CITATION_INVALID_CODE, errors: [problem] };
	return CITATIONS_LEDGER.append(
		cwd,
		{ ...body, schemaVersion: 1 },
		(fold) =>
			fold.some((entry) => entry.citationId === body.citationId)
				? {
						ok: false,
						code: CITATION_INVALID_CODE,
						errors: [
							`citation ${JSON.stringify(body.citationId)} is already recorded; a citation is recorded once — a changed claim is a new citation id`,
						],
					}
				: null,
		(fold) => fold.find((entry) => entry.citationId === body.citationId) ?? null,
	);
}

/**
 * Fold the citation store fail-closed. A missing store reads as empty;
 * corruption throws the typed corrupt code.
 * @returns {Array<object>}
 */
function foldCitations(cwd) {
	return CITATIONS_LEDGER.fold(cwd);
}

/**
 * `citation_exists` (§6.3): deterministic — parse the store and look the id
 * up. Any principal may run it.
 */
function citationExists(cwd, citationId) {
	if (!isNonEmptyString(citationId))
		return { exists: false, reason: "citation id must be a non-empty string" };
	const citations = foldCitations(cwd);
	const found = citations.find((entry) => entry.citationId === citationId);
	return found ? { exists: true, citation: found } : { exists: false };
}

module.exports = {
	CITATION_EVENT_FIELDS,
	citationLedgerPath,
	recordCitation,
	foldCitations,
	citationExists,
	CITATION_CORRUPT_CODE,
	CITATION_LOCK_CODE,
	CITATION_CEILING_CODE,
	CITATION_INVALID_CODE,
};
