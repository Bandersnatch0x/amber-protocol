"use strict";

// Single runtime structural validator for the sync transport report (F040,
// ADR-0020 adjudication 5).
//
// schemas/sync-transport-report.schema.json is the SSOT: this adapter compiles
// it once and caches the compiled validator, mirroring sync-envelope-contract.js,
// so the runtime can never drift from the published contract.

const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("ajv");

const SCHEMA_PATH = path.join(
	__dirname,
	"..",
	"..",
	"..",
	"schemas",
	"sync-transport-report.schema.json",
);

let compiled = null;

function getValidator() {
	if (!compiled) {
		const ajv = new Ajv({ allErrors: true });
		const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
		compiled = ajv.compile(schema);
	}
	return compiled;
}

/**
 * Convert AJV diagnostics into deterministic, user-facing error strings.
 * @param {Array<object>} ajvErrors - Errors from a compiled AJV validator.
 * @param {string} label - Instance label used for the root path ("report").
 * @returns {string[]}
 */
function formatErrors(ajvErrors, label = "report") {
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
			default:
				errors.push(`${where} ${err.message}`);
		}
	}
	return errors;
}

/**
 * Validate a transport report against schemas/sync-transport-report.schema.json.
 * @param {*} report - The report to validate.
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateSyncTransportReport(report) {
	const validate = getValidator();
	if (validate(report)) {
		return { valid: true, errors: [] };
	}
	return { valid: false, errors: formatErrors(validate.errors) };
}

module.exports = { validateSyncTransportReport, formatErrors };
