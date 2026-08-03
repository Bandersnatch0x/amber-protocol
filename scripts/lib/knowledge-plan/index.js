"use strict";

/**
 * Knowledge Plan root facade (F013).
 *
 * Exposes explicit use cases that return structured outcomes and never write
 * to the console. Parsing, schema validation, lookup precedence, scaffold,
 * materialize, and proposal mechanics live under internal/ and are not part
 * of this public surface.
 *
 * F013-K1: read-only use cases (inspect, report, validate).
 * F013-K2: write-capable use cases (scaffold, build, plan).
 */

const { loadKnowledgePlan } = require("./internal/load");
const { buildKnowledgeReport } = require("./internal/report");
const { scaffoldKnowledgePlan } = require("./internal/scaffold");
const { materializeKnowledgeBase } = require("./internal/build");
const { proposeKnowledgePlan } = require("./internal/propose");

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

/**
 * Scaffold a Knowledge Plan file (JSON by default; YAML when options.yaml/yml).
 *
 * @param {string} target
 * @param {{ dryRun?: boolean, yaml?: boolean, yml?: boolean, force?: boolean }} [options]
 * @returns {object} structured scaffold outcome (no console I/O)
 */
function scaffold(target, options = {}) {
	return scaffoldKnowledgePlan(target, options);
}

/**
 * Materialize knowledge pages under docs/wiki/knowledge/ from the plan.
 * Single use case for both `build` and `materialize` CLI aliases.
 *
 * @param {string} target
 * @param {{ dryRun?: boolean }} [options]
 * @returns {object} structured materialize outcome (no console I/O)
 */
function build(target, options = {}) {
	return materializeKnowledgeBase(target, options);
}

/**
 * Propose (and optionally write) a Knowledge Plan from native project inspection.
 *
 * @param {string} target
 * @param {{ dryRun?: boolean, force?: boolean }} [options]
 * @returns {object} structured proposal outcome (no console I/O)
 */
function plan(target, options = {}) {
	return proposeKnowledgePlan(target, options);
}

module.exports = {
	inspect,
	report,
	validate,
	scaffold,
	build,
	plan,
};
