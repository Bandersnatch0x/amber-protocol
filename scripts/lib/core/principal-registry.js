"use strict";

/**
 * Principal registry (F050 "Decisions, Gates & Evidence Assurance", ticket 1,
 * #226).
 *
 * A Principal is a human or a service identity that can act with authority
 * inside one repository: every Decision artifact (canonical-artifacts.js,
 * type `decision`) binds the Principal that acted, and that binding is
 * verified against THIS registry at admission time. The registry is therefore
 * governed state, not incidental metadata:
 *
 * - Storage is an append-only event ledger at
 *   `.amber/principals/registry.jsonl` (the knowledge-base ledger pattern,
 *   F035-S5): each line is one immutable event — `registered` (carrying the
 *   full principal record) or `revoked`. There is no in-place mutation path;
 *   the current state is the deterministic fold of the events.
 * - A principal id is registered at most once and revocation is terminal: a
 *   `registered` event for an id the fold already knows, or a `revoked` event
 *   for an unknown or already-revoked id, is a sequence the register/revoke
 *   writers could never have produced — the fold fails closed as corruption
 *   instead of guessing (AMBER_E_PRINCIPAL_REGISTRY_CORRUPT).
 * - Version negotiation is fail-closed per event: an event declaring a
 *   schemaVersion this reader does not support is rejected with
 *   AMBER_E_PRINCIPAL_REGISTRY_UNSUPPORTED_VERSION, never reinterpreted.
 * - The ledger's closed field set is enforced on read: an event carrying a
 *   field outside its kind's contract is corruption, never silently dropped.
 * - Reads are deterministic: only an ABSENT registry is a legitimate empty
 *   state; the fold is a pure function of the event list (first-seen order,
 *   last event per id wins its state).
 * - The registry has a size ceiling (default 1 MiB, env
 *   AMBER_PRINCIPAL_MAX_REGISTRY_BYTES, positive-integer overrides only):
 *   an append that would exceed it is refused before any durable state is
 *   touched (AMBER_E_PRINCIPAL_REGISTRY_CEILING).
 *
 * Validity windows are half-open [validFrom, validTo): null bounds are open,
 * `validTo` itself is already expired. Window evaluation happens at the
 * caller's `now` — decision admission passes the admission-time clock, `show`
 * passes the read clock. Which clock a durable record should carry
 * (validAt/recordedAt separation) is F050 ticket 4's contract; this module
 * only evaluates the window against the clock it is handed.
 *
 * `status` (active | revoked | expired | not-yet-valid) is DERIVED, never
 * stored: the folded record carries the stored revocation state
 * (revokedAt/revokedReason) and the validity bounds, and the read/verify seams
 * (listPrincipals, showPrincipal, resolveActivePrincipal) evaluate status
 * against the clock they are handed. The register/revoke writers return the
 * folded record itself, so the event log, the fold, and the write seams all
 * stay free of clock-dependent state — one clock per evaluation, never a
 * status frozen at write time.
 */

const fs = require("node:fs");
const { appendJSONL, readLedgerFailClosed } = require("./jsonl");
const { statePathForCreate } = require("../state-dir-resolver");
const { typedError } = require("./error-catalog");
const { resolvePositiveIntCeiling } = require("./resource-ceilings");

const REGISTRY_CORRUPT_CODE = "AMBER_E_PRINCIPAL_REGISTRY_CORRUPT";
const UNSUPPORTED_VERSION_CODE = "AMBER_E_PRINCIPAL_REGISTRY_UNSUPPORTED_VERSION";
const SIZE_CEILING_CODE = "AMBER_E_PRINCIPAL_REGISTRY_CEILING";
const ALREADY_REGISTERED_CODE = "AMBER_E_PRINCIPAL_ALREADY_REGISTERED";
const NOT_FOUND_CODE = "AMBER_E_PRINCIPAL_NOT_FOUND";
const ALREADY_REVOKED_CODE = "AMBER_E_PRINCIPAL_ALREADY_REVOKED";
const REVOKED_CODE = "AMBER_E_PRINCIPAL_REVOKED";
const EXPIRED_CODE = "AMBER_E_PRINCIPAL_EXPIRED";
const NOT_YET_VALID_CODE = "AMBER_E_PRINCIPAL_NOT_YET_VALID";
const INVALID_ARG_CODE = "AMBER_E_INVALID_ARG";

/** Version of the registry event contract this module writes and reads. */
const REGISTRY_SCHEMA_VERSION = 1;

/** Every registry event schemaVersion this reader can interpret, ascending. */
const SUPPORTED_REGISTRY_SCHEMA_VERSIONS = Object.freeze([1]);

/** The closed set of Principal kinds: humans and service identities. */
const PRINCIPAL_KINDS = Object.freeze(["human", "service"]);

/**
 * Registry size ceiling, in bytes (documented default; deliberate overrides
 * via the environment). Checked BEFORE any durable state is touched, so an
 * oversized registry never grows past its bound.
 */
const DEFAULT_MAX_REGISTRY_BYTES = 1024 * 1024;

// Closed field sets per event kind: an event carrying a top-level field
// outside its kind's contract is corruption on read, never silently dropped.
const REGISTERED_EVENT_FIELDS = Object.freeze(["kind", "schemaVersion", "at", "principal"]);
const REVOKED_EVENT_FIELDS = Object.freeze(["kind", "schemaVersion", "at", "id", "reason"]);
const PRINCIPAL_FIELDS = Object.freeze([
	"id",
	"principalKind",
	"role",
	"membership",
	"capability",
	"validFrom",
	"validTo",
	"issuer",
]);

// ISO-8601 calendar date, optionally with a time and zone offset. Dates
// without a time parse as UTC midnight, so a bare date is a usable bound.
const ISO_TIMESTAMP_PATTERN =
	/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/;

function registryPath(cwd) {
	return statePathForCreate(cwd, "principals", "registry.jsonl");
}

function registryCorrupt(message) {
	return typedError(REGISTRY_CORRUPT_CODE, message);
}

/**
 * Parse one ISO-8601 date or date-time bound to epoch milliseconds.
 * @returns {number|null} Epoch milliseconds, or null when unparseable.
 */
function parseTimestamp(value) {
	if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) return null;
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? null : parsed;
}

function isNullableNonEmptyString(value) {
	return value === null || (typeof value === "string" && value.length > 0);
}

/**
 * Validate one caller-supplied principal record (argument level — malformed
 * input is rejected as AMBER_E_INVALID_ARG before any registry state is
 * touched; this is the register command's input contract).
 * @returns {string|null} The problem message, or null when well-formed.
 */
function principalInputProblem({
	id,
	principalKind,
	role,
	membership,
	capability,
	validFrom,
	validTo,
	issuer,
}) {
	if (typeof id !== "string" || id.trim().length === 0) {
		return `principal id must be a non-empty string; got ${JSON.stringify(id)}`;
	}
	if (!PRINCIPAL_KINDS.includes(principalKind)) {
		return `principalKind must be one of the closed set (${PRINCIPAL_KINDS.join(", ")}); got ${JSON.stringify(principalKind)}`;
	}
	for (const [label, value] of [
		["role", role],
		["membership", membership],
		["capability", capability],
		["issuer", issuer],
	]) {
		if (!isNullableNonEmptyString(value)) {
			return `${label} must be a non-empty string or null; got ${JSON.stringify(value)}`;
		}
	}
	for (const [label, value] of [
		["validFrom", validFrom],
		["validTo", validTo],
	]) {
		if (value === null || value === undefined) continue;
		if (parseTimestamp(value) === null) {
			return `${label} must be an ISO-8601 date or date-time (e.g. 2026-01-31 or 2026-01-31T09:00:00Z) or null; got ${JSON.stringify(value)}`;
		}
	}
	const from = validFrom ? parseTimestamp(validFrom) : null;
	const to = validTo ? parseTimestamp(validTo) : null;
	if (from !== null && to !== null && to <= from) {
		return `validTo must be after validFrom (the validity window is half-open and must be non-empty); got validFrom ${JSON.stringify(validFrom)} and validTo ${JSON.stringify(validTo)}`;
	}
	return null;
}

function principalRecordOf(principal) {
	return {
		id: principal.id,
		principalKind: principal.principalKind,
		role: principal.role ?? null,
		membership: principal.membership ?? null,
		capability: principal.capability ?? null,
		validFrom: principal.validFrom ?? null,
		validTo: principal.validTo ?? null,
		issuer: principal.issuer ?? null,
	};
}

/**
 * Validate the SHAPE of one stored registered-event principal record (read
 * level — a stored record outside the closed field set or with wrong types is
 * corruption; null is legitimate for every optional field).
 * @returns {string|null} The corruption message, or null when well-formed.
 */
function storedPrincipalProblem(principal, lineIndex) {
	if (principal === null || typeof principal !== "object" || Array.isArray(principal)) {
		return `registry event ${lineIndex} carries a malformed principal record: expected an object; got ${JSON.stringify(principal)}`;
	}
	const unknown = Object.keys(principal)
		.filter((key) => !PRINCIPAL_FIELDS.includes(key))
		.sort();
	if (unknown.length > 0) {
		return `registry event ${lineIndex} carries a principal record with unknown field${unknown.length > 1 ? "s" : ""} ${unknown.map((field) => `"${field}"`).join(", ")}; the closed field set is ${PRINCIPAL_FIELDS.join(", ")}`;
	}
	if (typeof principal.id !== "string" || principal.id.length === 0) {
		return `registry event ${lineIndex} carries a principal record whose id is not a non-empty string`;
	}
	if (!PRINCIPAL_KINDS.includes(principal.principalKind)) {
		return `registry event ${lineIndex} carries a principal record whose principalKind ${JSON.stringify(principal.principalKind)} is outside the closed set (${PRINCIPAL_KINDS.join(", ")})`;
	}
	for (const field of ["role", "membership", "capability", "validFrom", "validTo", "issuer"]) {
		if (!isNullableNonEmptyString(principal[field])) {
			return `registry event ${lineIndex} carries a principal record whose ${field} is neither null nor a non-empty string; got ${JSON.stringify(principal[field])}`;
		}
	}
	return null;
}

/**
 * Fold the append-only registry events to the current state of every
 * principal, first-seen (registration) order. Fail-closed sequence
 * invariants: the register/revoke writers check the current state BEFORE
 * appending, so the ledger can only ever hold, per id, one `registered` event
 * followed by at most one `revoked` event — anything else was hand-edited.
 * @param {string} cwd - Repository root.
 * @returns {Array<object>} Current principal records (see principalStatus).
 * @throws {Error} Typed AMBER_E_PRINCIPAL_REGISTRY_CORRUPT /
 *         AMBER_E_PRINCIPAL_REGISTRY_UNSUPPORTED_VERSION when the ledger is
 *         corrupt or declares an unsupported version.
 */
function foldRegistry(cwd) {
	const events = readLedgerFailClosed(
		registryPath(cwd),
		REGISTRY_CORRUPT_CODE,
		"principal registry",
	);
	const byId = new Map();
	for (let index = 0; index < events.length; index += 1) {
		const lineIndex = index + 1;
		const event = events[index];
		if (event === null || typeof event !== "object" || Array.isArray(event)) {
			throw registryCorrupt(
				`principal registry event ${lineIndex} is not an object; got ${JSON.stringify(event)}`,
			);
		}
		const schemaVersion = event.schemaVersion;
		if (!Number.isInteger(schemaVersion)) {
			throw registryCorrupt(
				`principal registry event ${lineIndex} carries no integer schemaVersion; got ${JSON.stringify(schemaVersion)}`,
			);
		}
		if (!SUPPORTED_REGISTRY_SCHEMA_VERSIONS.includes(schemaVersion)) {
			throw typedError(
				UNSUPPORTED_VERSION_CODE,
				`principal registry event ${lineIndex} declares schemaVersion ${JSON.stringify(schemaVersion)}, but this reader supports ${SUPPORTED_REGISTRY_SCHEMA_VERSIONS.join(", ")}; an event this reader cannot interpret is rejected rather than reinterpreted — upgrade amber or rebuild the registry under the supported schema version`,
			);
		}
		if (typeof event.at !== "string" || event.at.length === 0) {
			throw registryCorrupt(
				`principal registry event ${lineIndex} carries no timestamp ("at"); got ${JSON.stringify(event.at)}`,
			);
		}
		if (event.kind === "registered") {
			const unknown = Object.keys(event)
				.filter((key) => !REGISTERED_EVENT_FIELDS.includes(key))
				.sort();
			if (unknown.length > 0) {
				throw registryCorrupt(
					`principal registry event ${lineIndex} is a registered event carrying unknown field${unknown.length > 1 ? "s" : ""} ${unknown.map((field) => `"${field}"`).join(", ")}; the closed field set is ${REGISTERED_EVENT_FIELDS.join(", ")}`,
				);
			}
			const principalProblem = storedPrincipalProblem(event.principal, lineIndex);
			if (principalProblem !== null) throw registryCorrupt(principalProblem);
			const id = event.principal.id;
			if (byId.has(id)) {
				throw registryCorrupt(
					`principal registry event ${lineIndex} registers "${id}" a second time; a principal id is registered exactly once and revocation is terminal, so the writers can never append this — the ledger was edited in place`,
				);
			}
			byId.set(id, {
				...principalRecordOf(event.principal),
				registeredAt: event.at,
				revokedAt: null,
				revokedReason: null,
			});
		} else if (event.kind === "revoked") {
			const unknown = Object.keys(event)
				.filter((key) => !REVOKED_EVENT_FIELDS.includes(key))
				.sort();
			if (unknown.length > 0) {
				throw registryCorrupt(
					`principal registry event ${lineIndex} is a revoked event carrying unknown field${unknown.length > 1 ? "s" : ""} ${unknown.map((field) => `"${field}"`).join(", ")}; the closed field set is ${REVOKED_EVENT_FIELDS.join(", ")}`,
				);
			}
			if (typeof event.id !== "string" || event.id.length === 0) {
				throw registryCorrupt(
					`principal registry event ${lineIndex} is a revoked event whose id is not a non-empty string; got ${JSON.stringify(event.id)}`,
				);
			}
			if (!isNullableNonEmptyString(event.reason)) {
				throw registryCorrupt(
					`principal registry event ${lineIndex} is a revoked event whose reason is neither null nor a non-empty string; got ${JSON.stringify(event.reason)}`,
				);
			}
			const record = byId.get(event.id);
			if (record === undefined) {
				throw registryCorrupt(
					`principal registry event ${lineIndex} revokes "${event.id}", which was never registered; the revoke writer only appends for a registered principal — the ledger was edited in place`,
				);
			}
			if (record.revokedAt !== null) {
				throw registryCorrupt(
					`principal registry event ${lineIndex} revokes "${event.id}" a second time; revocation is append-once per principal, so the writers can never append this — the ledger was edited in place`,
				);
			}
			record.revokedAt = event.at;
			record.revokedReason = event.reason ?? null;
		} else {
			throw registryCorrupt(
				`principal registry event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}; the closed kind set is registered, revoked`,
			);
		}
	}
	return [...byId.values()];
}

/**
 * The current status of one principal record against a clock: revoked wins
 * over the validity window (a revoked principal holds no authority even
 * inside its window), then the half-open window [validFrom, validTo).
 * @param {object} record - A folded principal record.
 * @param {Date|number} [now] - Clock to evaluate against.
 * @returns {"active"|"revoked"|"expired"|"not-yet-valid"}
 */
function principalStatus(record, now = new Date()) {
	if (record.revokedAt !== null) return "revoked";
	const at = now instanceof Date ? now.getTime() : new Date(now).getTime();
	const from = record.validFrom ? parseTimestamp(record.validFrom) : null;
	const to = record.validTo ? parseTimestamp(record.validTo) : null;
	if (to !== null && at >= to) return "expired";
	if (from !== null && at < from) return "not-yet-valid";
	return "active";
}

function withStatus(record, now) {
	return { ...record, status: principalStatus(record, now) };
}

/** Read the registry's current state (fold). */
function listPrincipals(cwd) {
	return foldRegistry(cwd).map((record) => withStatus(record, new Date()));
}

/**
 * Read one principal's current record, or null when the id was never
 * registered. The returned record carries its evaluated `status`.
 * @throws {Error} Typed registry corruption errors.
 */
function showPrincipal(cwd, id) {
	for (const record of foldRegistry(cwd)) {
		if (record.id === id) return withStatus(record, new Date());
	}
	return null;
}

/**
 * Resolve one principal against the registry for authority binding
 * (decision admission): the principal must be registered, unrevoked, and
 * inside its validity window at `now`.
 * @param {string} cwd - Repository root.
 * @param {string} id - Principal id.
 * @param {object} [options]
 * @param {Date|number} [options.now] - Admission-time clock.
 * @returns {{ok: true, principal: object} |
 *           {ok: false, code: string, message: string}}
 * @throws {Error} Typed registry corruption errors.
 */
function resolveActivePrincipal(cwd, id, { now = new Date() } = {}) {
	if (typeof id !== "string" || id.length === 0) {
		return {
			ok: false,
			code: INVALID_ARG_CODE,
			message: `principal must be a non-empty id string; got ${JSON.stringify(id)}`,
		};
	}
	let record = null;
	for (const candidate of foldRegistry(cwd)) {
		if (candidate.id === id) {
			record = candidate;
			break;
		}
	}
	if (record === null) {
		return {
			ok: false,
			code: NOT_FOUND_CODE,
			message: `principal "${id}" is not registered; a Decision binds a Principal verified against the registry, so an unregistered principal cannot occupy a decision slot — register it first (amber principal register)`,
		};
	}
	const status = principalStatus(record, now);
	if (status === "revoked") {
		return {
			ok: false,
			code: REVOKED_CODE,
			message: `principal "${id}" was revoked at ${record.revokedAt}${record.revokedReason ? ` (${record.revokedReason})` : ""}; a revoked principal holds no authority, so the Decision cannot bind it`,
		};
	}
	if (status === "expired") {
		return {
			ok: false,
			code: EXPIRED_CODE,
			message: `principal "${id}" expired: its validity window [${record.validFrom ?? "open"}, ${record.validTo ?? "open"}) ended at ${record.validTo}; a Decision cannot bind an expired principal`,
		};
	}
	if (status === "not-yet-valid") {
		return {
			ok: false,
			code: NOT_YET_VALID_CODE,
			message: `principal "${id}" is not valid yet: its validity window opens at ${record.validFrom}; a Decision cannot bind a principal outside its validity window`,
		};
	}
	return { ok: true, principal: principalRecordOf(record) };
}

// The registry append ceiling: refuse an event that would grow the ledger
// past its bound BEFORE any durable state is touched.
function registryAppendWithinCeiling(cwd, event) {
	const ceiling = resolvePositiveIntCeiling(
		"AMBER_PRINCIPAL_MAX_REGISTRY_BYTES",
		DEFAULT_MAX_REGISTRY_BYTES,
		"principal registry size ceiling",
	);
	const line = `${JSON.stringify(event)}\n`;
	let currentBytes = 0;
	try {
		currentBytes = fs.existsSync(registryPath(cwd)) ? fs.statSync(registryPath(cwd)).size : 0;
	} catch {
		currentBytes = 0;
	}
	return { ceiling, wouldExceed: currentBytes + Buffer.byteLength(line, "utf8") > ceiling };
}

/**
 * Register one Principal: validate the record, then append one immutable
 * `registered` event. A principal id is registered at most once (revocation
 * is terminal, so a revoked id cannot be re-registered either).
 *
 * The returned record is the FOLD (stored state only — no derived `status`);
 * read seams derive status against their own clock.
 *
 * @param {string} cwd - Repository root.
 * @param {object} input - { id, principalKind, role, membership, capability,
 *        validFrom, validTo, issuer } (optional fields null by default).
 * @returns {{ok: boolean, code: string|null, record: object|null, errors: string[]}}
 * @throws {Error} Typed AMBER_E_INVALID_ARG when the ceiling override env is
 *         set but garbage (resolvePositiveIntCeiling's contract: a typo'd
 *         bound is an argument error, never a silent default).
 */
function registerPrincipal(
	cwd,
	{
		id,
		principalKind,
		role = null,
		membership = null,
		capability = null,
		validFrom = null,
		validTo = null,
		issuer = null,
	},
) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	const input = { id, principalKind, role, membership, capability, validFrom, validTo, issuer };
	const inputProblem = principalInputProblem(input);
	if (inputProblem !== null) return fail(INVALID_ARG_CODE, [inputProblem]);

	let current;
	try {
		current = foldRegistry(cwd);
	} catch (err) {
		return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
	}
	const existing = current.find((record) => record.id === id);
	if (existing) {
		return fail(ALREADY_REGISTERED_CODE, [
			`principal "${id}" is already registered${existing.revokedAt !== null ? ` and revoked at ${existing.revokedAt} (revocation is terminal, so the id cannot be re-registered)` : ""}; a principal id is registered at most once — register a distinct id`,
		]);
	}

	const at = new Date().toISOString();
	const event = {
		kind: "registered",
		schemaVersion: REGISTRY_SCHEMA_VERSION,
		at,
		principal: principalRecordOf(input),
	};
	// The ceiling resolution throws its typed argument error (garbage env
	// override), never a silent default — the writer propagates it.
	const ceilingCheck = registryAppendWithinCeiling(cwd, event);
	if (ceilingCheck.wouldExceed) {
		return fail(SIZE_CEILING_CODE, [
			`appending the registration for "${id}" would grow the principal registry beyond its size ceiling of ${ceilingCheck.ceiling} bytes (AMBER_PRINCIPAL_MAX_REGISTRY_BYTES); the write is refused before any durable state is touched — split principals across repositories or raise the ceiling deliberately`,
		]);
	}
	try {
		appendJSONL(registryPath(cwd), event);
	} catch (err) {
		return fail(REGISTRY_CORRUPT_CODE, [
			`failed to append the registration event for "${id}" to the principal registry: ${err.message}`,
		]);
	}
	return {
		ok: true,
		code: null,
		record: {
			...principalRecordOf(input),
			registeredAt: at,
			revokedAt: null,
			revokedReason: null,
		},
		errors: [],
	};
}

/**
 * Revoke one Principal: append one immutable `revoked` event. Revocation is
 * terminal and the record is never rewritten — the fold keeps the full
 * lineage and the current state carries revokedAt/revokedReason. The returned
 * record is the post-revocation FOLD (stored state only — no derived
 * `status`); read seams derive status against their own clock.
 * @param {string} cwd - Repository root.
 * @param {object} input - { id, reason }.
 * @returns {{ok: boolean, code: string|null, record: object|null, errors: string[]}}
 * @throws {Error} Typed AMBER_E_INVALID_ARG when the ceiling override env is
 *         set but garbage (resolvePositiveIntCeiling's contract).
 */
function revokePrincipal(cwd, { id, reason = null }) {
	const fail = (code, errors) => ({ ok: false, code, record: null, errors });
	if (typeof id !== "string" || id.trim().length === 0) {
		return fail(INVALID_ARG_CODE, [
			`principal id must be a non-empty string; got ${JSON.stringify(id)}`,
		]);
	}
	if (reason !== null && reason !== undefined) {
		if (typeof reason !== "string" || reason.trim().length === 0) {
			return fail(INVALID_ARG_CODE, [
				`reason must be a non-empty string when provided; got ${JSON.stringify(reason)}`,
			]);
		}
	}
	let current;
	try {
		current = foldRegistry(cwd);
	} catch (err) {
		return fail(err.amberCode || REGISTRY_CORRUPT_CODE, [err.message]);
	}
	const existing = current.find((record) => record.id === id);
	if (!existing) {
		return fail(NOT_FOUND_CODE, [
			`principal "${id}" is not registered; revocation applies to a registered principal — register it first (amber principal register)`,
		]);
	}
	if (existing.revokedAt !== null) {
		return fail(ALREADY_REVOKED_CODE, [
			`principal "${id}" was already revoked at ${existing.revokedAt}; revocation is terminal`,
		]);
	}

	const at = new Date().toISOString();
	const event = {
		kind: "revoked",
		schemaVersion: REGISTRY_SCHEMA_VERSION,
		at,
		id,
		reason: reason ?? null,
	};
	// The ceiling resolution throws its typed argument error (garbage env
	// override), never a silent default — the writer propagates it.
	const ceilingCheck = registryAppendWithinCeiling(cwd, event);
	if (ceilingCheck.wouldExceed) {
		return fail(SIZE_CEILING_CODE, [
			`appending the revocation for "${id}" would grow the principal registry beyond its size ceiling of ${ceilingCheck.ceiling} bytes (AMBER_PRINCIPAL_MAX_REGISTRY_BYTES); the write is refused before any durable state is touched`,
		]);
	}
	try {
		appendJSONL(registryPath(cwd), event);
	} catch (err) {
		return fail(REGISTRY_CORRUPT_CODE, [
			`failed to append the revocation event for "${id}" to the principal registry: ${err.message}`,
		]);
	}
	return {
		ok: true,
		code: null,
		record: { ...existing, revokedAt: at, revokedReason: reason ?? null },
		errors: [],
	};
}

module.exports = {
	PRINCIPAL_KINDS,
	REGISTRY_SCHEMA_VERSION,
	SUPPORTED_REGISTRY_SCHEMA_VERSIONS,
	DEFAULT_MAX_REGISTRY_BYTES,
	parseTimestamp,
	principalStatus,
	listPrincipals,
	showPrincipal,
	registerPrincipal,
	revokePrincipal,
	resolveActivePrincipal,
};
