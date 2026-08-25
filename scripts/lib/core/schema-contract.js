"use strict";

// The one JSON-schema validation seam (F042, survey Finding 3).
//
// Every schema compile in the runtime routes through this module: one shared
// Ajv instance (allErrors: true always), ajv-formats registered once plus the
// strict RFC 3339 date-time format, a compile-once cache keyed by schemaName,
// and the generalized formatErrors mapper (ex sync-envelope-contract). No
// module outside this seam may instantiate Ajv — the guard test in
// tests/unit/schema-contract-guard.test.js enforces it. Same move jsonl.js
// made for ledgers, applied to schemas.

const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const SCHEMAS_DIR = path.join(__dirname, "..", "..", "..", "schemas");

// Strict RFC 3339 date-time (the sync-envelope contract's historical
// hand-registered format, kept byte-identical by overriding ajv-formats'
// looser definition).
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

let ajv = null;
const cache = new Map();

function getAjv() {
	if (!ajv) {
		ajv = new Ajv({ allErrors: true });
		addFormats(ajv);
		ajv.addFormat("date-time", {
			validate: (data) => typeof data === "string" && ISO_DATE_TIME.test(data),
		});
	}
	return ajv;
}

function schemaPath(schemaName) {
	return path.join(SCHEMAS_DIR, `${schemaName}.schema.json`);
}

/**
 * Compile (once, cached) the schema named `<schemaName>.schema.json` from
 * schemas/. Throws when the file is missing or unparseable — a broken schema
 * is a startup defect, never a validation verdict.
 * @param {string} schemaName
 * @returns {Function} The compiled AJV validator.
 */
function compileSchema(schemaName) {
	let compiled = cache.get(schemaName);
	if (!compiled) {
		const file = schemaPath(schemaName);
		let schema;
		try {
			schema = JSON.parse(fs.readFileSync(file, "utf8"));
		} catch (e) {
			throw new Error(
				`schema-contract: cannot load schema "${schemaName}" from ${file}: ${e.message}`,
				{ cause: e },
			);
		}
		compiled = getAjv().compile(schema);
		cache.set(schemaName, compiled);
	}
	return compiled;
}

/**
 * Compile a dynamically-provided schema object (no schemas/ file) — used by
 * surfaces like the MCP registry that validate caller-supplied schemas.
 * Not cached: the caller owns the schema object's identity.
 * @param {object} schema
 * @returns {Function} The compiled AJV validator.
 */
function compileInline(schema) {
	return getAjv().compile(schema);
}

/**
 * Convert AJV diagnostics into deterministic, user-facing error strings.
 * @param {Array<object>} ajvErrors - Errors from a compiled AJV validator.
 * @param {string} label - Root label for instance paths (e.g. "envelope").
 * @returns {string[]}
 */
function formatErrors(ajvErrors, label = "schema") {
	const errors = [];
	for (const err of ajvErrors || []) {
		const where = err.instancePath
			? err.instancePath.replace(/^\//, `${label}.`).replace(/\//g, ".")
			: label;
		switch (err.keyword) {
			case "required":
				errors.push(`${where} missing required field "${err.params.missingProperty}"`);
				break;
			case "additionalProperties":
				errors.push(`${where} has additional property "${err.params.additionalProperty}"`);
				break;
			case "enum":
				errors.push(`${where} must be one of ${err.params.allowedValues.join(", ")}`);
				break;
			case "minLength":
				errors.push(`${where} must be at least ${err.params.limit} character(s)`);
				break;
			case "minItems":
				errors.push(`${where} must contain at least ${err.params.limit} item(s)`);
				break;
			case "minimum":
				errors.push(`${where} must be >= ${err.params.limit}`);
				break;
			case "type":
				errors.push(`${where} must be of type ${err.params.type}`);
				break;
			case "pattern":
				errors.push(`${where} "${err.data}" does not match required pattern`);
				break;
			case "format":
				errors.push(`${where} must match format "${err.params.format}"`);
				break;
			default:
				errors.push(`${where} ${err.message}`);
		}
	}
	return errors;
}

/**
 * Validate data against `<schemaName>.schema.json` from schemas/.
 * @param {string} schemaName
 * @param {*} data
 * @returns {{valid: boolean, errors: string[]}}
 */
function validate(schemaName, data) {
	let compiled;
	try {
		compiled = compileSchema(schemaName);
	} catch (e) {
		return { valid: false, errors: [e.message] };
	}
	if (compiled(data)) {
		return { valid: true, errors: [] };
	}
	return { valid: false, errors: formatErrors(compiled.errors, schemaName) };
}

module.exports = { validate, compileSchema, compileInline, formatErrors, SCHEMAS_DIR };
