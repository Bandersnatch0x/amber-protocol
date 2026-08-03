"use strict";

/**
 * Governance Console command adapter for Knowledge Plan read flows (F013-K1).
 *
 * Owns subcommand mapping for inspect/report/validate, structured command
 * envelopes, human-readable rendering, bypassPrint/onBypass parity, and
 * unknown read-action errors. Never performs domain I/O itself — delegates
 * to the root facade.
 */

const { inspect, report, validate } = require("..");
const { renderInspectText, renderReportText } = require("./renderers");

const READ_ACTIONS = new Set(["inspect", "report", "validate"]);

/**
 * @param {string|undefined|null} action
 * @returns {boolean}
 */
function isKnowledgeReadAction(action) {
	return READ_ACTIONS.has(action);
}

/**
 * Dispatch a Knowledge Plan read action.
 *
 * @param {string|undefined|null} action subcommand (inspect|report|validate)
 * @param {object} args parsed CLI args (must include target; may include json)
 * @returns {{
 *   result: object,
 *   exitCode?: number,
 *   bypassPrint?: boolean,
 *   onBypass?: () => void,
 * }}
 */
function knowledgeDispatch(action, args) {
	if (action === "inspect") {
		const loaded = inspect(args.target);
		return {
			result: loaded,
			bypassPrint: !args.json,
			onBypass: () => {
				console.log(renderInspectText(loaded));
			},
		};
	}

	if (action === "report") {
		const built = report(args.target);
		return {
			result: built,
			bypassPrint: !args.json,
			onBypass: () => {
				console.log(renderReportText(built));
			},
		};
	}

	if (action === "validate") {
		const result = validate(args.target);
		return { result };
	}

	const label = action == null || action === "" ? "" : String(action);
	return {
		result: {
			target: args.target,
			errors: [
				`Unknown knowledge read action: ${label}. Supported read actions: inspect, report, validate.`,
			],
			warnings: [],
		},
	};
}

module.exports = {
	knowledgeDispatch,
	isKnowledgeReadAction,
	READ_ACTIONS,
};
