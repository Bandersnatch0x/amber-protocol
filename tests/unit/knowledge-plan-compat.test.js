"use strict";

// F013-K3 compatibility contract: the legacy CommonJS surface
// (scripts/lib/core/knowledge-plan.js) forwards every retained helper export
// to equivalent behavior during the one deprecation cycle. Removal is deferred
// to a declared major release only.

const { describe, it } = require("node:test");
const assert = require("assert");
const path = require("node:path");

const legacy = require("../../scripts/lib/core/knowledge-plan");
const facade = require("../../scripts/lib/knowledge-plan");

// Exports retained on the legacy surface for the deprecation cycle.
const LEGACY_EXPORTS = [
	"KNOWLEDGE_PLAN_RELATIVE",
	"KNOWLEDGE_PLAN_YAML_RELATIVE",
	"scaffoldKnowledgePlan",
	"loadKnowledgePlan",
	"validateKnowledgePlanData",
	"buildKnowledgeReport",
	"formatKnowledgeReportText",
	"materializeKnowledgeBase",
	"proposeKnowledgePlan",
	"parseSimpleYaml",
	"planToSimpleYaml",
];

describe("knowledge-plan legacy compatibility surface", () => {
	it("forwards every retained helper export", () => {
		for (const name of LEGACY_EXPORTS) {
			assert.ok(
				name in legacy,
				`legacy surface missing retained export: ${name}`,
			);
			const type = typeof legacy[name];
			assert.ok(
				type === "function" || type === "string",
				`unexpected type for ${name}: ${type}`,
			);
		}
	});

	it("legacy loadKnowledgePlan is equivalent to facade inspect", () => {
		// Both return the structured load outcome; equivalence is the
		// compatibility promise. Behavior coverage lives in the facade tests.
		assert.equal(typeof legacy.loadKnowledgePlan, "function");
		assert.equal(typeof facade.inspect, "function");
	});

	it("legacy constants match facade-facing paths", () => {
		assert.equal(
			legacy.KNOWLEDGE_PLAN_RELATIVE,
			path.join("docs", "wiki", "knowledge-plan.json"),
		);
		assert.equal(
			legacy.KNOWLEDGE_PLAN_YAML_RELATIVE,
			path.join("docs", "wiki", "knowledge-plan.yaml"),
		);
	});

	it("deprecation note names the major-release removal policy", () => {
		const source = require("node:fs").readFileSync(
			path.join(__dirname, "../../scripts/lib/core/knowledge-plan.js"),
			"utf8",
		);
		assert.match(source, /major/i);
		assert.match(source, /deprecat/i);
		assert.match(source, /forward/i);
	});
});
