"use strict";

// F061 T2 (#299) — the declarative admission path for governed ledger
// families (ADR-0028). `defineLedgerFamily` turns one data table — the
// family directory plus, per ledger, file/lock names, the three stable
// codes, the size ceiling, labels, and the domain fold — into the full
// ledger ritual every governed family hand-writes today: path resolution
// under the state dir, fail-closed chain-head reads, the governed append
// (lock + chain + ceiling through `appendLedgerEvent`), and the fold read
// whose chain walk (`chainLinkProblem`) precedes every family-owned domain
// check on every event. The factory carries exactly ONE dialect — full
// orchestration — and only composes the registry-ledger primitives; it
// never re-implements them, and it never exposes the append lock or a raw
// unwalked read, so a family assembled here cannot drift back into a
// private append or an unchained fold.
//
// ADR-0028 Amendments (2026-08-30): the declaration vocabulary carries
// CLOSED optional extensions demanded by recorded family test contracts.
// A ledger may declare `fold.preLink(event, lineIndex)`, executed per
// event immediately BEFORE the chain-link check, for families whose
// recorded contract adjudicates domain problems (e.g. an unsupported
// schemaVersion's dedicated code) ahead of chain problems; its throw
// semantics are `fold.apply`'s. A ledger may declare
// `fold.chainWording(kind, event, lineIndex, label)`, overriding the
// shared chain-link refusal wording per kind (`"not-object"` /
// `"broken"` / `"mismatch"`) so a family whose suite names `prevHash` or
// appends "edited in place" keeps that text (#307). And a ledger may
// declare `ceiling.message(event, ceiling)`, overriding the shared
// ceiling refusal wording with its recorded per-family text; absent,
// the shared orchestration wording rides unchanged. `preLink` never
// sees the previous hash, and `chainWording` only replaces text after
// the shared chain check has already fired, so neither reopens a path
// to a private append or an unchained read.
//
// A declaration problem is an assembly-time programming error, not a
// runtime governance refusal: the factory throws a plain TypeError at
// definition time, so a malformed family can never half-install. Runtime
// refusals keep riding the declared per-ledger codes untouched.

const path = require("node:path");

const { readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { typedError } = require("./error-catalog");
const {
	GENESIS_HASH,
	chainHeadHash,
	acquireLedgerLock,
	appendLedgerEvent,
	chainLinkProblem,
	isPlainObject,
	isNonEmptyString,
	closedFieldProblem,
} = require("./registry-ledger");

// The closed declaration vocabulary: a family is a directory, a label, and
// one entry per ledger — nothing else, so an unknown knob fails loudly
// instead of silently doing nothing.
const DECLARATION_FIELDS = Object.freeze(["dir", "label", "ledgers"]);
const LEDGER_FIELDS = Object.freeze([
	"name",
	"fileName",
	"lockName",
	"conflictCode",
	"corruptCode",
	"sizeCeilingCode",
	"ceiling",
	"label",
	"eventLabel",
	"fold",
]);
const CEILING_FIELDS = Object.freeze(["envName", "defaultBytes", "message"]);
// The optional knobs (ADR-0028 Amendment) validate against the full closed
// set only when declared; the required subsets keep every original field
// mandatory and the missing-field refusals byte-stable for the families
// that declare neither.
const REQUIRED_CEILING_FIELDS = Object.freeze(["envName", "defaultBytes"]);
const REQUIRED_FOLD_FIELDS = Object.freeze(["init", "apply", "result"]);
const OPTIONAL_FOLD_FIELDS = Object.freeze(["preLink", "chainWording"]);
// The uniqueness axes inside one family: two ledgers sharing a file or a
// lock would silently corrupt or serialize each other.
const UNIQUE_LEDGER_AXES = Object.freeze(["name", "fileName", "lockName"]);

function refuse(problem) {
	throw new TypeError(`defineLedgerFamily: ${problem}`);
}

// One grammar for every declaration name that becomes a filesystem
// segment: a directory, ledger file, or lock name can never escape the
// family's state directory.
function segmentProblem(value, label) {
	if (!isNonEmptyString(value)) return `${label} must be a non-empty string`;
	if (value === "." || value === ".." || /[\\/]/.test(value))
		return `${label} must be a bare name without path separators or "." / ".." segments`;
	return null;
}

function ceilingProblem(ceiling, label) {
	if (!isPlainObject(ceiling)) return `${label} must be an object`;
	const closed = closedFieldProblem(
		ceiling,
		"message" in ceiling ? CEILING_FIELDS : REQUIRED_CEILING_FIELDS,
		label,
	);
	if (closed !== null) return closed;
	if (!isNonEmptyString(ceiling.envName)) return `${label}.envName must be a non-empty string`;
	if (!Number.isInteger(ceiling.defaultBytes) || ceiling.defaultBytes < 1)
		return `${label}.defaultBytes must be a positive integer`;
	if ("message" in ceiling && typeof ceiling.message !== "function")
		return `${label}.message must be a function`;
	return null;
}

function declaredFoldFields(fold) {
	return REQUIRED_FOLD_FIELDS.concat(OPTIONAL_FOLD_FIELDS.filter((field) => field in fold));
}

function foldProblem(fold, label) {
	if (!isPlainObject(fold)) return `${label} must be an object`;
	const closed = closedFieldProblem(fold, declaredFoldFields(fold), label);
	if (closed !== null) return closed;
	for (const field of REQUIRED_FOLD_FIELDS) {
		if (typeof fold[field] !== "function") return `${label}.${field} must be a function`;
	}
	for (const field of OPTIONAL_FOLD_FIELDS) {
		if (field in fold && typeof fold[field] !== "function")
			return `${label}.${field} must be a function`;
	}
	return null;
}

function ledgerProblem(ledger, label) {
	if (!isPlainObject(ledger)) return `${label} must be an object`;
	const closed = closedFieldProblem(ledger, LEDGER_FIELDS, label);
	if (closed !== null) return closed;
	for (const field of [
		"name",
		"conflictCode",
		"corruptCode",
		"sizeCeilingCode",
		"label",
		"eventLabel",
	]) {
		if (!isNonEmptyString(ledger[field])) return `${label}.${field} must be a non-empty string`;
	}
	for (const field of ["fileName", "lockName"]) {
		const segment = segmentProblem(ledger[field], `${label}.${field}`);
		if (segment !== null) return segment;
	}
	const ceiling = ceilingProblem(ledger.ceiling, `${label}.ceiling`);
	if (ceiling !== null) return ceiling;
	return foldProblem(ledger.fold, `${label}.fold`);
}

// Assemble one ledger's ritual surface from its validated declaration.
// Everything here is composition: the primitives own the lock, chain,
// ceiling, and fail-closed read disciplines; the family's fold owns every
// domain rule.
function buildLedger(dir, ledger) {
	const { fileName, lockName, conflictCode, corruptCode, sizeCeilingCode, label, eventLabel } =
		ledger;
	const { envName, defaultBytes, message: ceilingMessage } = ledger.ceiling;
	const domainFold = ledger.fold;
	// The optional pre-link step and chain-wording override (ADR-0028
	// Amendments), captured at assembly time like the rest of the
	// declaration table.
	const preLink = domainFold.preLink ?? null;
	const chainWording = domainFold.chainWording ?? null;
	const ledgerPath = (cwd) => statePathForCreate(cwd, dir, fileName);
	const corrupt = (message) => typedError(corruptCode, message);
	// The append lock is deliberately NOT exposed on the surface: it exists
	// only inside the governed append, so no family can rebuild a private
	// append dialect around it.
	const acquire = (cwd) =>
		acquireLedgerLock({
			dirPath: path.dirname(ledgerPath(cwd)),
			lockName,
			conflictCode,
			corruptCode,
			label,
		});
	// The fold read: fail-closed raw read, then per event the declared
	// pre-link step (when the family's recorded contract adjudicates domain
	// problems ahead of chain problems), the chain link, and the family's
	// domain step — the same interleaving every hand-written family fold
	// performs, so corruption surfaces in ledger order, never grouped by
	// check.
	const fold = (cwd) => {
		const events = readLedgerFailClosed(ledgerPath(cwd), corruptCode, label);
		let prevHash = GENESIS_HASH;
		const state = domainFold.init();
		events.forEach((event, index) => {
			const lineIndex = index + 1;
			if (preLink !== null) preLink(event, lineIndex);
			const link = chainLinkProblem(event, prevHash, lineIndex, eventLabel, chainWording);
			if (link !== null) throw corrupt(link);
			domainFold.apply(state, event, lineIndex);
			prevHash = event.hash;
		});
		return domainFold.result(state);
	};
	// The appendLedgerEvent options table, shaped exactly like every
	// family's hand-written *_LEDGER constant; `ceilingMessage` is undefined
	// unless the ledger declared its own ceiling refusal wording.
	const options = Object.freeze({
		acquire,
		fold,
		path: ledgerPath,
		corruptCode,
		sizeCeilingCode,
		envName,
		defaultBytes,
		ceilingMessage,
		label,
	});
	return Object.freeze({
		name: ledger.name,
		label,
		eventLabel,
		conflictCode,
		corruptCode,
		sizeCeilingCode,
		ceiling: Object.freeze({ envName, defaultBytes }),
		path: ledgerPath,
		corrupt,
		chainHead: (cwd) => chainHeadHash(ledgerPath(cwd), corruptCode, label),
		fold,
		append: (cwd, body, guard, derive) => appendLedgerEvent(cwd, options, body, guard, derive),
	});
}

/**
 * Define one governed ledger family from a declaration table. The factory
 * validates the declaration fail-closed (closed field sets; missing,
 * unknown, or malformed fields throw a TypeError at definition time) and
 * returns the family's frozen ritual surface — full orchestration is the
 * only dialect.
 *
 * Declaration shape:
 *   {
 *     dir:    state subdirectory under `.amber/` (bare name),
 *     label:  the family's human-readable name,
 *     ledgers: [{
 *       name:            key of this ledger on `family.ledgers`,
 *       fileName:        JSONL file under `.amber/<dir>/` (bare name),
 *       lockName:        exclusive append lock file (bare name),
 *       conflictCode:    stable code for a fresh-lock conflict,
 *       corruptCode:     stable code every fail-closed read throws,
 *       sizeCeilingCode: stable code for a refused oversized append,
 *       ceiling:         { envName, defaultBytes } append-size bound;
 *                        optional `message(event, ceiling)` overrides the
 *                        shared ceiling refusal wording with the family's
 *                        recorded text (ADR-0028 Amendment) — `event` is
 *                        the exact chained line refused, `ceiling` the
 *                        resolved byte bound,
 *       label:           the ledger's name in lock/read/ceiling refusals,
 *       eventLabel:      the per-event prefix in chain-walk problems
 *                        ("<eventLabel> event <n> ..."),
 *       fold: {          the family-owned domain half of the fold read:
 *         init:   () => state              fresh state per read,
 *         preLink: (event, lineIndex)      OPTIONAL (ADR-0028 Amendment):
 *                 executed per event immediately BEFORE the chain-link
 *                 check, for families whose recorded contract adjudicates
 *                 domain problems ahead of chain problems; throw semantics
 *                 are `apply`'s (it never sees the previous hash, so it
 *                 can never stand in for the chain walk),
 *         chainWording: (kind, event, lineIndex, label)  OPTIONAL
 *                 (ADR-0028 Amendment, #307): overrides the shared
 *                 chain-link refusal wording per kind (`"not-object"` /
 *                 `"broken"` / `"mismatch"`); the shared chain check still
 *                 runs, so this cannot stand in for the walk,
 *         apply:  (state, event, lineIndex) domain-validate + apply one
 *                 chain-verified event (throw the ledger's corrupt error
 *                 on a domain impossibility),
 *         result: (state) => records       the fold's projection,
 *       },
 *     }],
 *   }
 *
 * Produced surface, per ledger under `family.ledgers.<name>`:
 *   path(cwd)      — the ledger file path under the state dir.
 *   chainHead(cwd) — last event hash or the genesis constant; fail-closed
 *                    with the ledger's corruptCode.
 *   fold(cwd)      — fail-closed read, chain walk, then the declared
 *                    domain fold; returns its records projection.
 *   append(cwd, body, guard, derive) — the governed append through
 *                    `appendLedgerEvent` (lock, guard-on-fold, chain hash,
 *                    ceiling, append, re-fold derive).
 *   corrupt(message) — the ledger's typed corruption error constructor.
 *   plus the declared name/labels/codes/ceiling, frozen, for read-only
 *   introspection.
 *
 * @param {object} declaration - The family declaration table.
 * @returns {{dir: string, label: string, ledgers: Object<string, object>}}
 * @throws {TypeError} When the declaration is missing, unknown, or malformed.
 */
function defineLedgerFamily(declaration) {
	if (!isPlainObject(declaration)) refuse("declaration must be an object");
	const closed = closedFieldProblem(declaration, DECLARATION_FIELDS, "declaration");
	if (closed !== null) refuse(closed);
	const dirProblem = segmentProblem(declaration.dir, "declaration.dir");
	if (dirProblem !== null) refuse(dirProblem);
	if (!isNonEmptyString(declaration.label)) refuse("declaration.label must be a non-empty string");
	if (!Array.isArray(declaration.ledgers) || declaration.ledgers.length === 0)
		refuse("declaration.ledgers must be a non-empty array");
	// A null prototype keeps every declared name an own key — a ledger name
	// can never shadow or pollute Object.prototype.
	const ledgers = Object.create(null);
	const seen = new Map(UNIQUE_LEDGER_AXES.map((axis) => [axis, new Set()]));
	declaration.ledgers.forEach((ledger, index) => {
		const label = `declaration.ledgers[${index}]`;
		const problem = ledgerProblem(ledger, label);
		if (problem !== null) refuse(problem);
		for (const axis of UNIQUE_LEDGER_AXES) {
			if (seen.get(axis).has(ledger[axis]))
				refuse(
					`${label}.${axis} reuses ${JSON.stringify(ledger[axis])}; every ledger in a family owns its own ${axis}`,
				);
			seen.get(axis).add(ledger[axis]);
		}
		ledgers[ledger.name] = buildLedger(declaration.dir, ledger);
	});
	return Object.freeze({
		dir: declaration.dir,
		label: declaration.label,
		ledgers: Object.freeze(ledgers),
	});
}

module.exports = { defineLedgerFamily };
