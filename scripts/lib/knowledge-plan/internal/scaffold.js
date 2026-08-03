"use strict";

const path = require("node:path");

const { TEMPLATE_ROOT } = require("../../core/constants");
const { resolveTarget } = require("../../core/fs-utils");
const { listTemplateFiles, copyTemplateFiles } = require("../../core/scaffold");
const {
	KNOWLEDGE_PLAN_RELATIVE,
	KNOWLEDGE_PLAN_YAML_RELATIVE,
	loadKnowledgePlan,
} = require("./load");

/**
 * Scaffold the Knowledge Plan (JSON by default, or yaml if requested).
 *
 * @param {string} target
 * @param {{ dryRun?: boolean, yaml?: boolean, yml?: boolean, force?: boolean }} [options]
 * @returns {{
 *   target: string,
 *   created: string[],
 *   skipped: string[],
 *   errors: string[],
 *   warnings: string[],
 * }}
 */
function scaffoldKnowledgePlan(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const useYaml = Boolean(options.yaml || options.yml);

	const wikiTemplateRoot = path.join(TEMPLATE_ROOT, "docs", "wiki");
	const all = listTemplateFiles(wikiTemplateRoot);

	const templateName = useYaml ? "knowledge-plan.yaml" : "knowledge-plan.json";
	const planItem = all.find((item) => item.relativePath === templateName);

	if (!planItem) {
		return {
			target: targetRoot,
			created: [],
			skipped: [],
			errors: [`${templateName} template not found in templates/docs/wiki/`],
			warnings: [],
		};
	}

	const destRel = useYaml ? KNOWLEDGE_PLAN_YAML_RELATIVE : KNOWLEDGE_PLAN_RELATIVE;

	const items = [{ source: planItem.source, relativePath: destRel }];

	const result = copyTemplateFiles(targetRoot, items, options);

	let validation = { errors: [], warnings: [] };
	if (!options.dryRun) {
		const loaded = loadKnowledgePlan(targetRoot);
		validation.errors = loaded.errors;
		validation.warnings = loaded.warnings;
	}

	return {
		target: targetRoot,
		created: result.created,
		skipped: result.skipped,
		errors: validation.errors,
		warnings: validation.warnings,
	};
}

module.exports = {
	scaffoldKnowledgePlan,
};
