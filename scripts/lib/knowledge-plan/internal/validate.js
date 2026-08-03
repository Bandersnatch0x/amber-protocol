"use strict";

const fs = require("node:fs");
const path = require("node:path");

const Ajv = require("ajv");
const addFormats = require("ajv-formats");

// Load schema once at require time (fail fast on broken install).
const schemaPath = path.join(__dirname, "../../../../schemas/knowledge-plan.schema.json");
let knowledgePlanSchema;
try {
	knowledgePlanSchema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (e) {
	throw new Error(
		`Failed to load knowledge-plan schema from ${schemaPath}: ${e.message}. ` +
			"Re-run 'node scripts/amber.js init' (or npm install) to restore schema files.",
		{ cause: e },
	);
}

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validateKnowledgePlan = ajv.compile(knowledgePlanSchema);

/**
 * Validate raw plan data against the schema.
 * @param {unknown} data
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateKnowledgePlanData(data) {
	const valid = validateKnowledgePlan(data);
	if (!valid) {
		const errors = (validateKnowledgePlan.errors || []).map((err) => {
			const instancePath = err.instancePath || "(root)";
			return `${instancePath} ${err.message}`;
		});
		return { valid: false, errors };
	}
	return { valid: true, errors: [] };
}

module.exports = {
	validateKnowledgePlanData,
};
