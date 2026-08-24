"use strict";

const path = require("node:path");

const { loadYamlFile } = require("../../core/simple-yaml");
const { pathExists, readJson, resolveTarget } = require("../../core/fs-utils");
const { validateKnowledgePlanData } = require("./validate");
const { statePath } = require("../../state-dir-resolver");

const KNOWLEDGE_PLAN_RELATIVE = path.join("docs", "wiki", "knowledge-plan.json");
const KNOWLEDGE_PLAN_YAML_RELATIVE = path.join("docs", "wiki", "knowledge-plan.yaml");

/**
 * Normalize a parsed (yaml or json) plan into the internal shape we validate against.
 */
function normalizePlan(raw) {
	if (!raw) return null;
	// Support our canonical "knowledgePlan" section
	let planSection = raw.knowledgePlan;
	if (planSection && Array.isArray(planSection.documents)) {
		// also support knowledgecard -> knowledgeCards alias
		if (raw.knowledgecard && !raw.knowledgeCards) {
			raw = { ...raw, knowledgeCards: raw.knowledgecard };
		}
		return raw;
	}
	return raw;
}

/**
 * Load and validate the Knowledge Plan from the target repo (if present).
 * Checks (in order):
 *   docs/wiki/knowledge-plan.json
 *   docs/wiki/knowledge-plan.yaml
 *   .amber/knowledge-plan.yaml (read through the state-dir seam)
 */
function loadKnowledgePlan(target) {
	const targetRoot = resolveTarget(target);

	const candidates = [
		{ path: path.join(targetRoot, KNOWLEDGE_PLAN_RELATIVE), kind: "json" },
		{ path: path.join(targetRoot, KNOWLEDGE_PLAN_YAML_RELATIVE), kind: "yaml" },
		{ path: statePath(targetRoot, "knowledge-plan.yaml"), kind: "yaml" },
	];

	let chosen = null;
	for (const c of candidates) {
		if (pathExists(c.path)) {
			chosen = c;
			break;
		}
	}

	if (!chosen) {
		return { target: targetRoot, found: false, plan: null, errors: [], warnings: [], source: null };
	}

	let raw;
	try {
		if (chosen.kind === "json") {
			raw = readJson(chosen.path);
		} else {
			raw = loadYamlFile(chosen.path);
		}
	} catch (e) {
		return {
			target: targetRoot,
			found: true,
			plan: null,
			errors: [`Failed to read or parse ${path.relative(targetRoot, chosen.path)}: ${e.message}`],
			warnings: [],
			source: chosen.path,
		};
	}

	raw = normalizePlan(raw);

	const validation = validateKnowledgePlanData(raw);
	if (!validation.valid) {
		return {
			target: targetRoot,
			found: true,
			plan: raw,
			errors: validation.errors.map((e) => `${path.relative(targetRoot, chosen.path)}: ${e}`),
			warnings: [],
			source: chosen.path,
		};
	}

	return {
		target: targetRoot,
		found: true,
		plan: raw,
		errors: [],
		warnings: [],
		source: chosen.path,
	};
}

module.exports = {
	KNOWLEDGE_PLAN_RELATIVE,
	KNOWLEDGE_PLAN_YAML_RELATIVE,
	normalizePlan,
	loadKnowledgePlan,
};
