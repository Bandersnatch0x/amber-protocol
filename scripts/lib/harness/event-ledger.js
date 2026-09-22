"use strict";

// Harness Event Ledger (F065 H0; ADR-0102).
//
// The `harness` ledger family, assembled through `defineLedgerFamily`
// (ADR-0028) — the one admission path for governed families. It rides the
// governed-ledger core for everything: the exclusive append lock, the
// tamper-evident chain hash, the ceiling-bounded append, and fail-closed
// reads whose chain walk precedes every domain check. There is deliberately
// no second hash implementation and no raw unwalked read anywhere in this
// file. Events are facts; any future metrics surface must be an aggregate
// folded from this ledger, never a parallel truth.

const { defineLedgerFamily } = require("../core/ledger-family");
const { compileSchema } = require("../core/schema-contract");

const HARNESS_LEDGER_LOCK_CODE = "AMBER_E_HARNESS_LEDGER_LOCKED";
const HARNESS_LEDGER_CORRUPT_CODE = "AMBER_E_HARNESS_LEDGER_CORRUPT";
const HARNESS_LEDGER_SIZE_CEILING_CODE = "AMBER_E_HARNESS_LEDGER_SIZE_CEILING";
const HARNESS_EVENT_INVALID_CODE = "AMBER_E_HARNESS_EVENT_INVALID";

const HARNESS_EVENT_SCHEMA_VERSION = 1;

// The closed event-type enum (ADR-0102, decision 2). Growth is additive:
// a new type arrives as a schema change plus this table, never as a
// free-form string.
const HARNESS_EVENT_TYPES = Object.freeze([
	"run.created",
	"run.admitted",
	"run.started",
	"run.resumed",
	"run.paused",
	"run.blocked",
	"run.failed",
	"run.completed",
	"run.cancelled",
	"run.expired",
	"policy.evaluated",
	"approval.requested",
	"approval.granted",
	"execution.started",
	"execution.completed",
	"execution.failed",
	"validation.completed",
]);

const HARNESS_FAMILY = defineLedgerFamily({
	dir: "harness",
	label: "harness event ledger",
	ledgers: [
		{
			name: "events",
			fileName: "events.jsonl",
			lockName: "events.lock",
			conflictCode: HARNESS_LEDGER_LOCK_CODE,
			corruptCode: HARNESS_LEDGER_CORRUPT_CODE,
			sizeCeilingCode: HARNESS_LEDGER_SIZE_CEILING_CODE,
			ceiling: {
				envName: "AMBER_HARNESS_MAX_EVENTS_BYTES",
				defaultBytes: 1024 * 1024,
			},
			label: "harness event ledger",
			eventLabel: "harness-event",
			fold: {
				init: () => ({ events: [] }),
				apply: (state, event, lineIndex) => {
					if (event.schemaVersion !== HARNESS_EVENT_SCHEMA_VERSION)
						throw EVENTS_LEDGER.corrupt(
							`harness-event event ${lineIndex} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
						);
					if (!HARNESS_EVENT_TYPES.includes(event.kind))
						throw EVENTS_LEDGER.corrupt(
							`harness-event event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
						);
					if (typeof event.at !== "string" || event.at.length === 0)
						throw EVENTS_LEDGER.corrupt(`harness-event event ${lineIndex} carries no timestamp`);
					if (typeof event.runId !== "string" || event.runId.length === 0)
						throw EVENTS_LEDGER.corrupt(
							`harness-event event ${lineIndex} is not run-scoped: runId is required`,
						);
					state.events.push(event);
				},
				result: (state) => state.events,
			},
		},
	],
});

const EVENTS_LEDGER = HARNESS_FAMILY.ledgers.events;

function eventProblem(candidate) {
	const validate = compileSchema("event");
	if (validate(candidate)) return null;
	const detail = (validate.errors || [])
		.map((e) => `${e.instancePath || "/"} ${e.message}`)
		.join("; ");
	return `${detail}`;
}

/**
 * Emit one harness event: schema-validate the body (the governed core adds
 * the chain fields), append through the family's governed append, and return
 * the appended record. The caller owns any run/domain precondition; the
 * ledger's own guard stays structural.
 * @param {string} targetRoot
 * @param {object} body - The event body (kind, schemaVersion, at, runId, ...).
 */
function emitHarnessEvent(targetRoot, body) {
	const problem = eventProblem(body);
	if (problem !== null) {
		const err = new Error(
			`harness event body does not satisfy schemas/event.schema.json: ${problem}`,
		);
		err.amberCode = HARNESS_EVENT_INVALID_CODE;
		throw err;
	}
	return EVENTS_LEDGER.append(
		targetRoot,
		() => body,
		() => null,
		(fold) => fold[fold.length - 1] ?? null,
	);
}

/**
 * Read the full event stream, fail closed (chain walk runs first).
 */
function readHarnessEvents(targetRoot) {
	return EVENTS_LEDGER.fold(targetRoot);
}

/**
 * Read one run's events, fail closed. Run attribution is enforced by the
 * fold itself (every event carries runId), so a run-scoped read is a filter
 * over a verified chain, never a partial read.
 */
function readRunEvents(targetRoot, runId) {
	return readHarnessEvents(targetRoot).filter((event) => event.runId === runId);
}

module.exports = {
	HARNESS_FAMILY,
	EVENTS_LEDGER,
	HARNESS_EVENT_TYPES,
	HARNESS_EVENT_SCHEMA_VERSION,
	HARNESS_LEDGER_LOCK_CODE,
	HARNESS_LEDGER_CORRUPT_CODE,
	HARNESS_LEDGER_SIZE_CEILING_CODE,
	HARNESS_EVENT_INVALID_CODE,
	emitHarnessEvent,
	readHarnessEvents,
	readRunEvents,
};
