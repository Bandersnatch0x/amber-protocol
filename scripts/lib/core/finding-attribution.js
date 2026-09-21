"use strict";

// Shared finding-attribution vocabulary and validator (trusted-control
// evolution contract §3, docs/specs/trusted-control-evolution-contract.md).
//
// One value shape, defined once, referenced by existing proposal consumers
// (F064 suggestion card, maintenance proposal, structured evolution Finding).
// The attribution block is a CLAIM about where a friction is attributed —
// never a permission and never an apply-path selector (spec E1).
//
// The enums and the validator are the single authority. Consumers embed the
// block beside their own fields; the web surface reaches this module through
// the scripts/lib/web-adapter.js seam (seam guard: no direct scripts/lib
// imports from apps/web/server). A thin TS typing mirror may exist beside it,
// but validation and vocabulary always resolve here.

// Closed enum sets (spec §3 — extensions require a spec change, not an
// implementation-side addition). Frozen so no consumer can widen them.
const ENTRY_SURFACES = Object.freeze([
	"instruction-surface",
	"tool-output",
	"policy-rule",
	"capability-request",
]);
const IMPACT_SURFACES = Object.freeze(["target-repo", "context", "external", "governance-state"]);
const RESPONSIBLE_ARTIFACTS = Object.freeze([
	"instruction-surface",
	"rules",
	"memory",
	"capability-registry",
	"wiki",
	"route",
	"loop-contract",
]);

// The closed field set of the findingAttribution block.
const FIELDS = Object.freeze([
	"entrySurface",
	"impactSurface",
	"failureMode",
	"responsibleArtifact",
]);

const ENUM_BY_FIELD = Object.freeze({
	entrySurface: ENTRY_SURFACES,
	impactSurface: IMPACT_SURFACES,
	responsibleArtifact: RESPONSIBLE_ARTIFACTS,
});

// A valid block must be a plain object whose four fields are OWN, serializable
// properties. An inherited-only carrier (Object.create(validBlock)) has none of
// the fields on itself, serializes to {}, and must not impersonate a block.
function isPlainObject(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

// Describe a rejected value for an error message by TYPE ONLY. Rejected
// free-text values and untrusted property names are never echoed: an invalid
// block may carry credential material in any string position (a short token
// a partial pattern would miss, a property name, a long value), so the error
// path reports what was expected and what type was observed — never the
// content. The caller holds the input; the error never copies it.
function describeValue(value) {
	if (value === null) return "null";
	if (Array.isArray(value)) return "an array";
	if (typeof value === "function") return "a function";
	if (typeof value === "object") return "an object";
	return `a value of type ${typeof value}`;
}

/**
 * Validate a findingAttribution block.
 *
 * @param {unknown} value - The supplied block.
 * @returns {string|null} A repo-style problem string, or null when the block is valid.
 *   The input is never mutated; nothing is coerced and no value is defaulted —
 *   a malformed block is the caller's explicit error, never a silent repair.
 *   Problem strings never echo free-text input, so a secret-bearing invalid
 *   block cannot leak through the error path either.
 */
function attributionProblem(value) {
	if (!isPlainObject(value)) {
		return `findingAttribution must be a plain object carrying the four fields (${FIELDS.join(", ")}) as its own properties; got ${describeValue(value)}`;
	}
	const own = FIELDS.filter((field) => Object.hasOwn(value, field));
	if (own.length < FIELDS.length) {
		const missing = FIELDS.filter((field) => !Object.hasOwn(value, field));
		return `findingAttribution must carry the four fields as own properties; missing ${missing.map((field) => `"${field}"`).join(", ")} (inherited-only or non-plain carriers are not a valid block)`;
	}
	const unknownCount = Object.keys(value).filter((key) => !FIELDS.includes(key)).length;
	if (unknownCount > 0) {
		// Unknown property NAMES are untrusted caller input (a secret can ride
		// a key as easily as a value) — the count is reported, never the names.
		return `findingAttribution carries ${unknownCount} unknown field${unknownCount > 1 ? "s" : ""} beyond the closed field set (${FIELDS.join(", ")})`;
	}
	for (const field of Object.keys(ENUM_BY_FIELD)) {
		const allowed = ENUM_BY_FIELD[field];
		if (typeof value[field] !== "string" || !allowed.includes(value[field])) {
			return `${field} must be one of the closed set (${allowed.join(" | ")}); got ${describeValue(value[field])}`;
		}
	}
	if (typeof value.failureMode !== "string" || value.failureMode.trim().length === 0) {
		return `failureMode must be a non-empty string (deterministically extracted from the finding); got ${describeValue(value.failureMode)}`;
	}
	return null;
}

module.exports = {
	ENTRY_SURFACES,
	IMPACT_SURFACES,
	RESPONSIBLE_ARTIFACTS,
	FIELDS,
	attributionProblem,
};
