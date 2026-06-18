"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	buildAdoptionAuditMetrics,
	serializeAdoptionMetricsBlock,
	parseAdoptionMetricsBlock,
} = require("../../scripts/lib/core/adoption-metrics");

test("buildAdoptionAuditMetrics maps target-repo audit fields", () => {
	const metrics = buildAdoptionAuditMetrics({
		auditMode: "target-repo",
		existing: ["AGENTS.md", "feature_list.json"],
		missing: ["PROGRESS.md"],
		docs: ["README.md", "docs/wiki/index.md"],
		wikiLikeFiles: ["docs/wiki/index.md"],
		conflicts: ["CLAUDE.md"],
	});
	assert.deepEqual(metrics, {
		existingHarnessFiles: 2,
		missingHarnessFiles: 1,
		templateStarterFilesPresent: 0,
		templateStarterFilesMissing: 0,
		existingDocs: 2,
		wikiLikeFiles: 1,
		conflicts: 1,
		staleDocs: null,
	});
});

test("buildAdoptionAuditMetrics maps product-repo template starter fields", () => {
	const metrics = buildAdoptionAuditMetrics({
		auditMode: "product-repo",
		existing: [],
		missing: [],
		templateStarterFiles: {
			existing: ["AGENTS.md"],
			missing: ["PROGRESS.md"],
		},
		docs: [],
		wikiLikeFiles: [],
		conflicts: [],
	});
	assert.deepEqual(metrics, {
		existingHarnessFiles: 0,
		missingHarnessFiles: 0,
		templateStarterFilesPresent: 1,
		templateStarterFilesMissing: 1,
		existingDocs: 0,
		wikiLikeFiles: 0,
		conflicts: 0,
		staleDocs: null,
	});
});

// ---- serialize/parse: the machine-readable metrics block (data contract) ----

test("metrics survive a serialize -> parse round-trip", () => {
	const metrics = {
		existingHarnessFiles: 2,
		missingHarnessFiles: 1,
		templateStarterFilesPresent: 0,
		templateStarterFilesMissing: 0,
		existingDocs: 5,
		wikiLikeFiles: 3,
		conflicts: 1,
		staleDocs: 4,
	};
	assert.deepEqual(parseAdoptionMetricsBlock(serializeAdoptionMetricsBlock(metrics)), metrics);
});

test("parseAdoptionMetricsBlock finds the block embedded in surrounding markdown", () => {
	const metrics = { existingDocs: 5, conflicts: 0, staleDocs: 2 };
	const report = [
		"# Amber Protocol Adoption Report",
		"",
		"Target: /repo",
		"Generated: 2026-06-18T00:00:00.000Z",
		"",
		"## Audit Summary",
		"- Existing docs: 5",
		"",
		serializeAdoptionMetricsBlock(metrics),
		"",
	].join("\n");
	assert.deepEqual(parseAdoptionMetricsBlock(report), metrics);
});

test("parseAdoptionMetricsBlock returns null when no block is present", () => {
	assert.equal(parseAdoptionMetricsBlock("# Report\n- Existing docs: 5\n"), null);
	assert.equal(parseAdoptionMetricsBlock(undefined), null);
});

test("parseAdoptionMetricsBlock returns null when the embedded JSON is malformed", () => {
	const corrupt = "<!-- amber:metrics:v1\n{not valid json}\n-->";
	assert.equal(parseAdoptionMetricsBlock(corrupt), null);
});

test("serializeAdoptionMetricsBlock wraps the JSON in an HTML comment so it does not render", () => {
	const block = serializeAdoptionMetricsBlock({ existingDocs: 1 });
	assert.ok(block.startsWith("<!--"));
	assert.ok(block.trimEnd().endsWith("-->"));
});