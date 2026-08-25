"use strict";

// Single runtime structural validator for the sync transport report (F040,
// ADR-0020 adjudication 5).
//
// schemas/sync-transport-report.schema.json is the SSOT. Since F042 the Ajv
// compile, format registration, and error mapper live in the one
// schema-contract seam; this module is the report-named specialization.

const { validate: validateWith, formatErrors: sharedFormatErrors } = require("./schema-contract");

/**
 * Shape raw Ajv diagnostics with the report root label (historical export).
 * @param {Array<object>} ajvErrors
 * @param {string} label
 * @returns {string[]}
 */
function formatErrors(ajvErrors, label = "report") {
	return sharedFormatErrors(ajvErrors, label);
}

/**
 * Validate a transport report against schemas/sync-transport-report.schema.json.
 * @param {*} report - The report to validate.
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateSyncTransportReport(report) {
	return validateWith("sync-transport-report", report);
}

module.exports = { validateSyncTransportReport, formatErrors };
