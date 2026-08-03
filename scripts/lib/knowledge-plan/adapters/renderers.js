"use strict";

// Governance Console presentation for Knowledge Plan read flows.
// Renderers consume structured facade outcomes and produce strings only —
// they never write to the console themselves.

const { formatKnowledgeReportText } = require("../internal/report");

/**
 * Human-readable (and JSON-pretty) presentation for `wiki knowledge inspect`
 * when not using the standard --json envelope.
 *
 * Preserves pre-deepening operator-visible facts:
 * - found plan → pretty-printed plan JSON
 * - errors → joined error lines
 * - missing → "No knowledge-plan.json found."
 *
 * @param {{ found: boolean, plan: object|null, errors?: string[] }} loaded
 * @returns {string}
 */
function renderInspectText(loaded) {
	if (loaded.found && loaded.plan) {
		return JSON.stringify(loaded.plan, null, 2);
	}
	if (loaded.errors?.length) {
		return loaded.errors.join("\n");
	}
	return "No knowledge-plan.json found.";
}

/**
 * Human-readable presentation for `wiki knowledge report` when not --json.
 *
 * @param {object} report structured report from the facade
 * @returns {string}
 */
function renderReportText(report) {
	return formatKnowledgeReportText(report);
}

module.exports = {
	renderInspectText,
	renderReportText,
	// Re-export for adapters/tests that want the report formatter by name.
	formatKnowledgeReportText,
};
