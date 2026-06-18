"use strict";

// Pure metric extraction from an auditProject() result. Keys align with
// ADOPTION_COMPARE_METRICS in adoption-reports.js so compare/gate can consume
// structured values instead of re-parsing markdown labels.
function buildAdoptionAuditMetrics(audit) {
	const metrics = {
		existingHarnessFiles: 0,
		missingHarnessFiles: 0,
		templateStarterFilesPresent: 0,
		templateStarterFilesMissing: 0,
		existingDocs: audit.docs.length,
		wikiLikeFiles: audit.wikiLikeFiles.length,
		conflicts: audit.conflicts.length,
		staleDocs: null,
	};

	if (audit.auditMode === "product-repo") {
		metrics.templateStarterFilesPresent =
			audit.templateStarterFiles.existing.length;
		metrics.templateStarterFilesMissing =
			audit.templateStarterFiles.missing.length;
	} else {
		metrics.existingHarnessFiles = audit.existing.length;
		metrics.missingHarnessFiles = audit.missing.length;
	}

	return metrics;
}

// Shared marker for the machine-readable metrics block embedded in an adoption
// report. Named once here so the writer (renderAdoptionReport) and the reader
// (parseAdoptionReportForComparison) cannot drift apart — the same class of
// label-drift bug that re-parsing prose was prone to.
const ADOPTION_METRICS_BLOCK = "amber:metrics:v1";

const METRICS_BLOCK_PATTERN = new RegExp(
	`<!--\\s*${ADOPTION_METRICS_BLOCK}\\s*([\\s\\S]*?)-->`,
);

// Serialize a metrics object into an HTML comment so it carries structured data
// without rendering in a markdown viewer. The block is the data seam: compare
// and gate read it instead of re-parsing prose labels.
function serializeAdoptionMetricsBlock(metrics) {
	return `<!-- ${ADOPTION_METRICS_BLOCK}\n${JSON.stringify(metrics)}\n-->`;
}

// Recover the metrics object from report content. Returns null when no block is
// present (older reports) or the embedded JSON is malformed, so callers can fall
// back to prose parsing rather than crash.
function parseAdoptionMetricsBlock(content) {
	if (typeof content !== "string") {
		return null;
	}
	const match = content.match(METRICS_BLOCK_PATTERN);
	if (!match) {
		return null;
	}
	try {
		return JSON.parse(match[1]);
	} catch {
		return null;
	}
}

module.exports = {
	ADOPTION_METRICS_BLOCK,
	buildAdoptionAuditMetrics,
	serializeAdoptionMetricsBlock,
	parseAdoptionMetricsBlock,
};