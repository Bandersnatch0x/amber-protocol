"use strict";

// Compile once at require time (fail fast on broken install) through the one
// schema-contract seam.
const { compileSchema } = require("../../core/schema-contract");

const validateKnowledgePlan = compileSchema("knowledge-plan");

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
