"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	ADOPTION_COMPARE_METRICS,
	readAdoptionReportMetric,
	compareStringLists,
	buildMetricComparison,
	parseAdoptionReportMetadata,
	parseAdoptionReportForComparison,
} = require("../../scripts/lib/core/adoption-reports");
const {
	serializeAdoptionMetricsBlock,
} = require("../../scripts/lib/core/adoption-metrics");

function writeTempReport(body) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-report-"));
	const file = path.join(dir, "report.md");
	fs.writeFileSync(file, body);
	return file;
}
test("parseAdoptionReportMetadata accepts legacy Coding Harness report title", () => {
	const file = writeTempReport(
		[
			"# Coding Harness Adoption Report", // legacy title
			"",
			"Target: /legacy-repo",
			"Generated: 2026-06-09T01:36:09.558Z",
			"",
		].join("\n"),
	);

	const metadata = parseAdoptionReportMetadata(file);
	assert.equal(metadata.target, "/legacy-repo");
	assert.equal(metadata.generatedAt, "2026-06-09T01:36:09.558Z");
});

// Characterization tests for the pure comparison/parsing helpers exported from
// adoption-reports.js. These functions had zero coverage; they are the testable
// seam behind the fs-coupled report writers. Pin current behavior before any
// future refactor of the report-diff pipeline.

test("readAdoptionReportMetric parses a numeric value", () => {
	const markdown = "- Existing docs: 12\n";
	assert.equal(readAdoptionReportMetric(markdown, "Existing docs"), 12);
});

test("readAdoptionReportMetric parses a non-numeric value as a string", () => {
	const markdown = "- Target type: product-repo\n";
	assert.equal(readAdoptionReportMetric(markdown, "Target type"), "product-repo");
});

test("readAdoptionReportMetric returns null when the label is absent", () => {
	const markdown = "- Existing docs: 12\n";
	assert.equal(readAdoptionReportMetric(markdown, "Missing label"), null);
});

test("readAdoptionReportMetric matches case-insensitively", () => {
	const markdown = "- existing docs: 12\n";
	assert.equal(readAdoptionReportMetric(markdown, "Existing Docs"), 12);
});

test("readAdoptionReportMetric requires the label immediately before the colon", () => {
	// The regex anchors the label to a literal ':'; a space before the colon
	// breaks the match. Pin this so a future loosening is a deliberate change.
	const markdown = "- Existing docs : 3\n";
	assert.equal(readAdoptionReportMetric(markdown, "Existing docs"), null);
});

test("readAdoptionReportMetric escapes regex metacharacters in the label", () => {
	// A label containing a regex metacharacter must be matched literally, not
	// interpreted as a pattern.
	const markdown = "- Rule-pack drift: 2\n";
	assert.equal(readAdoptionReportMetric(markdown, "Rule-pack drift"), 2);
});

test("ADOPTION_COMPARE_METRICS pairs each key with a human label", () => {
	assert.ok(Array.isArray(ADOPTION_COMPARE_METRICS));
	assert.ok(ADOPTION_COMPARE_METRICS.length > 0);
	for (const [key, label] of ADOPTION_COMPARE_METRICS) {
		assert.equal(typeof key, "string");
		assert.ok(key.length > 0);
		assert.equal(typeof label, "string");
		assert.ok(label.length > 0);
	}
});

test("compareStringLists reports added, removed, and unchanged items", () => {
	const result = compareStringLists(["a", "b", "c"], ["b", "c", "d"]);
	assert.deepEqual(result.added, ["d"]);
	assert.deepEqual(result.removed, ["a"]);
	assert.deepEqual(result.unchanged, ["b", "c"]);
});

test("compareStringLists with identical lists has no adds or removes", () => {
	const result = compareStringLists(["a", "b"], ["a", "b"]);
	assert.deepEqual(result.added, []);
	assert.deepEqual(result.removed, []);
	assert.deepEqual(result.unchanged, ["a", "b"]);
});

test("compareStringLists with an empty head removes everything", () => {
	const result = compareStringLists(["a", "b"], []);
	assert.deepEqual(result.added, []);
	assert.deepEqual(result.removed, ["a", "b"]);
	assert.deepEqual(result.unchanged, []);
});

test("buildMetricComparison computes numeric deltas and nulls non-numeric", () => {
	const base = { existingDocs: 5, conflicts: 0, staleDocs: "n/a" };
	const head = { existingDocs: 8, conflicts: 0, staleDocs: "n/a" };
	const result = buildMetricComparison(base, head);

	assert.equal(result.existingDocs.delta, 3);
	assert.equal(result.conflicts.delta, 0);
	// "n/a" is non-numeric on both sides -> delta is null
	assert.equal(result.staleDocs.delta, null);
	assert.equal(result.existingDocs.base, 5);
	assert.equal(result.existingDocs.head, 8);
});

test("buildMetricComparison nulls the delta when one side is missing", () => {
	const base = { existingDocs: 5 };
	const head = {};
	const result = buildMetricComparison(base, head);
	assert.equal(result.existingDocs.delta, null);
	assert.equal(result.existingDocs.base, 5);
	assert.equal(result.existingDocs.head, undefined);
});

test("buildMetricComparison covers every ADOPTION_COMPARE_METRICS key", () => {
	const result = buildMetricComparison({}, {});
	for (const [key, label] of ADOPTION_COMPARE_METRICS) {
		assert.ok(Object.prototype.hasOwnProperty.call(result, key), `missing key ${key}`);
		assert.equal(result[key].label, label);
	}
});

// ---- parseAdoptionReportForComparison: structured metrics block precedence ----

test("parseAdoptionReportForComparison prefers the embedded metrics block over prose labels", () => {
	const block = serializeAdoptionMetricsBlock({
		existingHarnessFiles: 1,
		missingHarnessFiles: 0,
		templateStarterFilesPresent: 0,
		templateStarterFilesMissing: 0,
		existingDocs: 5,
		wikiLikeFiles: 2,
		conflicts: 0,
		staleDocs: 3,
	});
	// Prose deliberately disagrees (99) to prove the block wins, not the label.
	const file = writeTempReport(
		[
			"# Amber Protocol Adoption Report",
			"",
			"Target: /repo",
			"Generated: 2026-06-18T00:00:00.000Z",
			"",
			"- Existing docs: 99",
			"- Stale docs: 99",
			"",
			block,
			"",
		].join("\n"),
	);
	const { report } = parseAdoptionReportForComparison(file);
	assert.equal(report.metrics.existingDocs, 5);
	assert.equal(report.metrics.staleDocs, 3);
});

test("parseAdoptionReportForComparison falls back to prose labels when no block is present", () => {
	const file = writeTempReport(
		[
			"# Amber Protocol Adoption Report",
			"",
			"Target: /repo",
			"Generated: 2026-06-18T00:00:00.000Z",
			"",
			"- Existing docs: 7",
			"",
		].join("\n"),
	);
	const { report } = parseAdoptionReportForComparison(file);
	assert.equal(report.metrics.existingDocs, 7);
});
