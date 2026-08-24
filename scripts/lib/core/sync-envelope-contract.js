"use strict";

// Single runtime structural validator for sync envelopes (F035 S2).
//
// schemas/sync-envelope.schema.json is the SSOT: this adapter compiles it
// once and caches the compiled validator, so the runtime can never drift
// from the published schema the way the previous hand-written rules did.

const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("ajv");

const SCHEMA_PATH = path.join(__dirname, "..", "..", "..", "schemas", "sync-envelope.schema.json");

// RFC 3339 date-time; AJV 8 ships no built-in formats, so "format:
// date-time" in the schema throws at compile time unless registered.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

let compiled = null;

function getValidator() {
	if (!compiled) {
		const ajv = new Ajv({ allErrors: true });
		ajv.addFormat("date-time", {
			validate: (data) => typeof data === "string" && ISO_DATE_TIME.test(data),
		});
		const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
		compiled = ajv.compile(schema);
	}
	return compiled;
}

/**
 * Convert AJV diagnostics into deterministic, user-facing error strings.
 * @param {Array<object>} ajvErrors - Errors from a compiled AJV validator.
 * @returns {string[]}
 */
function formatErrors(ajvErrors) {
	const errors = [];
	for (const err of ajvErrors || []) {
		const where = err.instancePath
			? err.instancePath.replace(/^\//, "").replace(/\//g, ".")
			: "envelope";
		switch (err.keyword) {
			case "required":
				errors.push(`${where} missing required field "${err.params.missingProperty}"`);
				break;
			case "additionalProperties":
				errors.push(`${where} has additional property "${err.params.additionalProperty}"`);
				break;
			case "pattern":
				errors.push(`${where} "${err.data}" does not match required pattern`);
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
			default:
				errors.push(`${where} ${err.message}`);
		}
	}
	return errors;
}

/**
 * Validate an envelope against schemas/sync-envelope.schema.json.
 * @param {*} envelope - The envelope to validate.
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateSyncEnvelope(envelope) {
	const validate = getValidator();
	if (validate(envelope)) {
		return { valid: true, errors: [] };
	}
	return { valid: false, errors: formatErrors(validate.errors) };
}

module.exports = { validateSyncEnvelope, formatErrors };
