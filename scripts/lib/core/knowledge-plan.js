"use strict";

/**
 * Knowledge Plan compatibility module (legacy CommonJS surface).
 *
 * F013-K1/K2 moved load/validate/report/scaffold/materialize/propose into
 * scripts/lib/knowledge-plan/. This file remains the documented require path
 * for package consumers during the expand step. Prefer the root facade
 * (`scripts/lib/knowledge-plan`) for new call sites.
 *
 * Deprecated helper exports are forwarded without runtime deprecation noise
 * for one major cycle. Legacy removal is deferred to a later contract step.
 */

// Minimal YAML loader for plan files lives in ./simple-yaml (extracted so YAML
// mechanics stay out of plan/knowledge-base domain logic). Re-exported below
// for existing direct importers.
const { parseSimpleYaml } = require("./simple-yaml");

// Implementation lives in the deep Knowledge Plan module (F013-K1/K2).
const {
	KNOWLEDGE_PLAN_RELATIVE,
	KNOWLEDGE_PLAN_YAML_RELATIVE,
	loadKnowledgePlan,
} = require("../knowledge-plan/internal/load");
const { validateKnowledgePlanData } = require("../knowledge-plan/internal/validate");
const {
	buildKnowledgeReport,
	formatKnowledgeReportText,
} = require("../knowledge-plan/internal/report");
const { scaffoldKnowledgePlan } = require("../knowledge-plan/internal/scaffold");
const { materializeKnowledgeBase } = require("../knowledge-plan/internal/build");
const { proposeKnowledgePlan, planToSimpleYaml } = require("../knowledge-plan/internal/propose");

module.exports = {
	KNOWLEDGE_PLAN_RELATIVE,
	KNOWLEDGE_PLAN_YAML_RELATIVE,
	scaffoldKnowledgePlan,
	loadKnowledgePlan,
	validateKnowledgePlanData,
	buildKnowledgeReport,
	formatKnowledgeReportText,
	materializeKnowledgeBase,
	proposeKnowledgePlan,
	parseSimpleYaml,
	planToSimpleYaml,
};
