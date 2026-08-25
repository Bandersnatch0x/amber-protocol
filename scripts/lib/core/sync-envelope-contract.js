"use strict";

// Single runtime structural validator for sync envelopes (F035 S2).
//
// schemas/sync-envelope.schema.json is the SSOT. Since F042 the Ajv compile,
// format registration, and error mapper live in the one schema-contract seam;
// this module is the envelope-named specialization and owns no Ajv plumbing.

const { validate: validateWith, formatErrors: sharedFormatErrors } = require("./schema-contract");

/**
 * Validate an envelope against schemas/sync-envelope.schema.json.
 * @param {*} envelope - The envelope to validate.
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateSyncEnvelope(envelope) {
	return validateWith("sync-envelope", envelope);
}

// Historical export: shape raw Ajv diagnostics with the envelope root label.
function formatErrors(ajvErrors) {
	return sharedFormatErrors(ajvErrors, "envelope");
}

module.exports = { validateSyncEnvelope, formatErrors };
