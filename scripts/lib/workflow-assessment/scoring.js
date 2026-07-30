"use strict";

// ADR-0008 P1: scoring aggregation. check → dimension score/coverage/confidence.
// score: integer 0-100 | null. confidence: low|medium|high. coverage: the
// CoverageState enum. No overall score ships until P3 calibration.
//
// Rules (per ADR-0008 §"P1 boundary" and research scoring rules):
// - all checks not-applicable → score null, coverage not-applicable, confidence
//   stays as the highest confidenceImpact among checks (or "high" if none) —
//   not-applicable does not penalize.
// - some checks pass/partial/fail, some not-applicable → coverage partial,
//   confidence capped at medium (partial evidence cannot support high).
// - all checks pass/partial/fail → coverage covered.
// - score is a weighted blend of pass/partial/fail among *applicable* checks.
//   pass=1, partial=0.5, fail=0. null evidence (not-applicable) excluded from
//   the denominator. If no applicable checks, score=null.

const STATUS_WEIGHTS = {
	pass: 1,
	partial: 0.5,
	fail: 0,
};

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };
const RANK_CONFIDENCE = ["low", "medium", "high"];

function applicableChecks(checks) {
	return checks.filter((c) => c.status !== "not-applicable");
}

function maxConfidence(confidences) {
	if (confidences.length === 0) return "high";
	const max = Math.max(...confidences.map((c) => CONFIDENCE_RANK[c] ?? 0));
	return RANK_CONFIDENCE[max];
}

function scoreDimension(checks) {
	const applicable = applicableChecks(checks);
	const allNotApplicable = applicable.length === 0;

	if (allNotApplicable) {
		return {
			score: null,
			confidence: "high",
			coverage: "not-applicable",
			evidenceRefs: [],
			checks,
		};
	}

	const weighted = applicable.reduce((sum, c) => sum + (STATUS_WEIGHTS[c.status] ?? 0), 0);
	const score = Math.round((weighted / applicable.length) * 100);
	const allApplicable = checks.length === applicable.length;
	const coverage = allApplicable ? "covered" : "partial";

	// confidence: the strongest confidenceImpact among applicable checks,
	// capped at medium when coverage is partial (partial evidence cannot
	// support high per ADR-0008).
	const confidences = applicable
		.map((c) => c.confidenceImpact)
		.filter(Boolean);
	let confidence = maxConfidence(confidences);
	if (coverage === "partial" && confidence === "high") confidence = "medium";

	const evidenceRefs = [...new Set(applicable.flatMap((c) => c.evidenceRefs || []))];

	return { score, confidence, coverage, evidenceRefs, checks };
}

function scoreDimensions(checksByDimension) {
	const result = {};
	for (const [dim, checks] of Object.entries(checksByDimension)) {
		result[dim] = scoreDimension(checks);
	}
	return result;
}

module.exports = { scoreDimension, scoreDimensions, applicableChecks, maxConfidence };
