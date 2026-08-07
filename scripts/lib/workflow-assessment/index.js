"use strict";

const { buildFindingDraft, buildReport, compareReports } = require("./internal/review");
const {
	DEFAULT_REPEAT_THRESHOLD,
	detectNoProgress,
	detectRepeatedToolCalls,
	toolTargetFromEvent,
} = require("./internal/no-progress");

function assess(targetRoot, options = {}) {
	return buildReport(targetRoot, options);
}

function compare(baseline, current) {
	return compareReports(baseline, current);
}

function findings(report) {
	const items = Array.isArray(report?.findings) ? report.findings : [];
	return {
		target: report?.target || ".",
		findings: items,
		count: items.length,
	};
}

function buildDraft(report, findingId, targetFallback = ".") {
	const finding = (report?.findings || []).find((item) => item.id === findingId);
	if (!finding) {
		return {
			ok: false,
			findingId,
			errors: [`Finding ${findingId} not found.`],
		};
	}
	return {
		ok: true,
		findingId,
		draft: buildFindingDraft(report?.target || targetFallback, finding),
	};
}

module.exports = {
	DEFAULT_REPEAT_THRESHOLD,
	assess,
	buildDraft,
	compare,
	detectNoProgress,
	detectRepeatedToolCalls,
	findings,
	toolTargetFromEvent,
};
