"use strict";

/**
 * Knowledge Plan root facade (F013).
 *
 * Exposes explicit use cases that return structured outcomes and never write
 * to the console. Parsing, schema validation, lookup precedence, and report
 * mechanics live under internal/ and are not part of this public surface.
 *
 * F013-K1: read-only use cases (inspect, report, validate).
 * Write-capable use cases (scaffold, build, plan) land in a later slice.
 */

const { loadKnowledgePlan } = require("./internal/load");
const { buildKnowledgeReport } = require("./internal/report");

/**
 * Inspect the Knowledge Plan for a target repository.
 * Structured outcome matches the historical loadKnowledgePlan shape.
 *
 * @param {string} target
 * @returns {{
 *   target: string,
 *   found: boolean,
 *   plan: object|null,
 *   errors: string[],
 *   warnings: string[],
 *   source: string|null,
 * }}
 */
function inspect(target) {
	return loadKnowledgePlan(target);
}

/**
 * Build a read-only coverage/content report for the Knowledge Plan.
 *
 * @param {string} target
 * @returns {object} structured report (no console I/O)
 */
function report(target) {
	return buildKnowledgeReport(target);
}

/**
 * Validate the Knowledge Plan present in a target repository (if any).
 *
 * @param {string} target
 * @returns {{
 *   target: string,
 *   found: boolean,
 *   valid: boolean,
 *   errors: string[],
 *   warnings: string[],
 * }}
 */
function validate(target) {
	const loaded = loadKnowledgePlan(target);
	return {
		target: loaded.target,
		found: loaded.found,
		valid: loaded.errors.length === 0,
		errors: loaded.errors,
		warnings: loaded.warnings,
	};
}

module.exports = {
	inspect,
	report,
	validate,
};
