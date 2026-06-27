"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	CATALOG,
	codedError,
	getEntry,
	listCodes,
} = require("../../scripts/lib/core/error-catalog");

test("every catalog entry has the required fields", () => {
	for (const [code, entry] of Object.entries(CATALOG)) {
		assert.match(code, /^AMBER_E_[A-Z_]+$/, `${code} format`);
		for (const field of ["title", "cause", "remedy", "layer"]) {
			assert.ok(entry[field] && typeof entry[field] === "string", `${code}.${field}`);
		}
		assert.ok(Array.isArray(entry.related), `${code}.related is array`);
	}
});

test("related codes all reference real catalog entries", () => {
	for (const [code, entry] of Object.entries(CATALOG)) {
		for (const rel of entry.related) {
			assert.ok(CATALOG[rel], `${code} relates to unknown ${rel}`);
		}
	}
});

test("codedError formats <head> [CODE] -> fix: <remedy>", () => {
	const s = codedError("AMBER_E_FEATURE_NO_EVIDENCE", "Feature F1 has no evidence");
	assert.ok(s.includes("[AMBER_E_FEATURE_NO_EVIDENCE]"));
	assert.ok(s.includes("→ fix: "));
	assert.ok(s.startsWith("Feature F1 has no evidence "));
});

test("codedError falls back to the entry title when no message given", () => {
	const s = codedError("AMBER_E_FEATURE_NO_EVIDENCE");
	assert.ok(s.startsWith(CATALOG.AMBER_E_FEATURE_NO_EVIDENCE.title));
});

test("codedError returns the raw message for an unknown code", () => {
	assert.equal(codedError("AMBER_E_NOPE", "boom"), "boom");
});

test("getEntry accepts the bare suffix, case-insensitively", () => {
	assert.equal(getEntry("feature_no_evidence"), CATALOG.AMBER_E_FEATURE_NO_EVIDENCE);
	assert.equal(getEntry("AMBER_E_FEATURE_NO_EVIDENCE"), CATALOG.AMBER_E_FEATURE_NO_EVIDENCE);
	assert.equal(getEntry("nope"), null);
});

test("listCodes returns all codes sorted", () => {
	const codes = listCodes();
	assert.deepEqual(codes, [...codes].sort());
	assert.ok(codes.includes("AMBER_E_HOOK_PRECOMMIT_BLOCKED"));
});
