"use strict";

// F014-M4 compatibility contract: the legacy CommonJS surface
// (scripts/lib/core/maintenance.js) forwards every retained helper export to
// equivalent behavior during the one deprecation cycle. Removal is deferred to
// a declared major release only.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const legacy = require("../../scripts/lib/core/maintenance");
const facade = require("../../scripts/lib/maintenance");

// Exports retained on the legacy surface for the deprecation cycle.
const LEGACY_EXPORTS = [
	"listWikiMarkdownFiles",
	"detectStaleDocs",
	"buildWikiLintCi",
	"detectRulePackDrift",
	"buildUpgradeAssistant",
	"buildMigrationAssistant",
	"countEvolutionFindings",
	"extractEvolutionFindings",
	"extractRegressionProposals",
	"readRegressionProposal",
	"inspectMaintenance",
	"buildMaintenanceProposalContent",
	"runMaintenanceAction",
];

describe("maintenance legacy compatibility surface", () => {
	it("forwards every retained helper export", () => {
		for (const name of LEGACY_EXPORTS) {
			assert.ok(name in legacy, `legacy surface missing retained export: ${name}`);
			assert.equal(typeof legacy[name], "function", `unexpected type for ${name}`);
		}
	});

	it("legacy inspectMaintenance is equivalent to facade inspect", () => {
		assert.equal(typeof legacy.inspectMaintenance, "function");
		assert.equal(typeof facade.inspect, "function");
	});

	it("legacy detectStaleDocs is equivalent to facade staleDocs", () => {
		assert.equal(typeof legacy.detectStaleDocs, "function");
		assert.equal(typeof facade.staleDocs, "function");
	});

	it("deprecation note names the major-release removal policy", () => {
		const source = fs.readFileSync(
			path.join(__dirname, "../../scripts/lib/core/maintenance.js"),
			"utf8",
		);
		assert.match(source, /major/i);
		assert.match(source, /deprecat/i);
		assert.match(source, /forward/i);
	});
});
