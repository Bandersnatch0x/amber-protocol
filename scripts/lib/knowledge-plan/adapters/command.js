"use strict";

/**
 * Governance Console command adapter for Knowledge Plan flows (F013).
 *
 * Owns subcommand mapping for all documented knowledge actions (read + write),
 * option mapping, aliases (materialize → build, default → scaffold), structured
 * command envelopes, human-readable rendering, bypassPrint/onBypass parity, and
 * unknown-action errors. Never performs domain I/O itself — delegates to the
 * root facade.
 */

const { inspect, report, validate, scaffold, build, plan } = require("..");
const { renderInspectText, renderReportText, renderPlanText } = require("./renderers");

const READ_ACTIONS = new Set(["inspect", "report", "validate"]);
const WRITE_ACTIONS = new Set(["scaffold", "build", "materialize", "plan"]);
const SUPPORTED_ACTIONS_LIST = "plan, scaffold, inspect, report, validate, build";

/**
 * @param {string|undefined|null} action
 * @returns {boolean}
 */
function isKnowledgeReadAction(action) {
	return READ_ACTIONS.has(action);
}

/**
 * @param {string|undefined|null} action
 * @returns {boolean}
 */
function isKnowledgeWriteAction(action) {
	return WRITE_ACTIONS.has(action) || action == null || action === "";
}

/**
 * Dispatch a Knowledge Plan action (read or write).
 *
 * Default / empty action maps to scaffold (historical `amber wiki knowledge`).
 * `materialize` is an alias of `build`.
 *
 * @param {string|undefined|null} action subcommand
 * @param {object} args parsed CLI args (must include target; may include json/dryRun/force/yaml)
 * @returns {{
 *   result: object,
 *   exitCode?: number,
 *   bypassPrint?: boolean,
 *   onBypass?: () => void,
 * }}
 */
function knowledgeDispatch(action, args) {
	// Default "amber wiki knowledge" and explicit scaffold (idempotent).
	if (action === "scaffold" || action == null || action === "") {
		const result = scaffold(args.target, {
			dryRun: Boolean(args.dryRun),
			yaml: Boolean(args.yaml || args.yml),
			yml: Boolean(args.yml),
			force: Boolean(args.force),
		});
		return { result };
	}

	if (action === "build" || action === "materialize") {
		const result = build(args.target, {
			dryRun: Boolean(args.dryRun),
		});
		return { result };
	}

	if (action === "plan") {
		const result = plan(args.target, {
			dryRun: Boolean(args.dryRun),
			force: Boolean(args.force),
		});
		// Preserve historical plan presentation: human text when not --json.
		// (When --json, the CLI envelope prints the structured result.)
		return {
			result,
			bypassPrint: !args.json,
			onBypass: () => {
				console.log(renderPlanText(result));
			},
		};
	}

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
			errors: [`Unknown knowledge action: ${label}. Supported: ${SUPPORTED_ACTIONS_LIST}.`],
			warnings: [],
		},
	};
}

module.exports = {
	knowledgeDispatch,
	isKnowledgeReadAction,
	isKnowledgeWriteAction,
	READ_ACTIONS,
	WRITE_ACTIONS,
	SUPPORTED_ACTIONS_LIST,
};
