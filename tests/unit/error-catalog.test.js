"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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

test("every public Context Loadout error code is registered", () => {
	for (const code of [
		"AMBER_E_CONTEXT_LOADOUT_ROUTE",
		"AMBER_E_CONTEXT_LOADOUT_REQUIRED",
		"AMBER_E_CONTEXT_LOADOUT_REQUIRED_OVERFLOW",
		"AMBER_E_CONTEXT_LOADOUT_MISSING",
		"AMBER_E_CONTEXT_LOADOUT_CORRUPT",
	]) {
		assert.ok(getEntry(code), `${code} must be explainable`);
	}
});

test("every ledger-corruption error code is registered", () => {
	for (const code of ["AMBER_E_KB_CORRUPT", "AMBER_E_ORG_CORRUPT"]) {
		assert.ok(getEntry(code), `${code} must be explainable`);
	}
});

test("every production Context error code is registered", () => {
	const libRoot = path.join(__dirname, "..", "..", "scripts", "lib");
	const discovered = new Set();
	const visit = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) visit(full);
			else if (entry.name.endsWith(".js") && entry.name !== "error-catalog.js") {
				for (const match of fs.readFileSync(full, "utf8").matchAll(/AMBER_E_CONTEXT_[A-Z_]+/g)) {
					discovered.add(match[0]);
				}
			}
		}
	};
	visit(libRoot);
	for (const code of [...discovered].sort()) {
		assert.ok(getEntry(code), `${code} must be explainable`);
	}
});
