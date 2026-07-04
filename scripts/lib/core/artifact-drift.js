"use strict";

// Artifact-vs-reality drift detector. For each feature_list feature, compare the
// latest commit touching its declared `paths` against the feature's most recent
// evidence date. Uses committer date (%cI): it reflects when code LANDED on this
// branch (rebase refreshes it), whereas author date (%aI) lags across
// rebase/cherry-pick. Both sides are parsed to epoch ms via Date.parse so the
// comparison is timezone-homogeneous — the evidence anchor (date-only) parses as
// UTC midnight, %cI carries its own offset. HEURISTIC, not tamper-proof:
// evidence.date is hand-editable; the governance ledger is the tamper-evident layer.
const { resolveTarget } = require("./fs-utils");
const { loadFeatureList } = require("./validators");
const { gitOutput } = require("./git-exec");
const { isGitRepository } = require("./git-workflow-detector");
const { classifyTarget } = require("./target-classification");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function maxEvidenceDate(feature) {
	if (!Array.isArray(feature.evidence) || feature.evidence.length === 0) return null;
	const dates = feature.evidence
		.map((e) => e && e.date)
		.filter((d) => typeof d === "string" && DATE_RE.test(d))
		.sort();
	if (dates.length === 0) return "INVALID";
	return dates[dates.length - 1];
}

function classifyFeature(targetRoot, feature) {
	const paths = Array.isArray(feature.paths) ? feature.paths.filter(Boolean) : [];
	if (paths.length === 0) return { classification: "untracked" };

	const anchor = maxEvidenceDate(feature);
	if (anchor === null) return { classification: "no-evidence" };
	if (anchor === "INVALID") return { classification: "anchor-invalid" };

	// pathspec passed as an array (spawnSync, no shell) -> space/glob-safe, no injection.
	const lastCommitRaw = gitOutput(targetRoot, ["log", "-1", "--format=%cI", "--", ...paths]);
	if (!lastCommitRaw) {
		// exit 0 + empty stdout (gitOutput returns "") means no commit ever touched paths.
		return { classification: "path-unknown", anchorDate: anchor, lastCommitDate: null };
	}
	const commitMs = Date.parse(lastCommitRaw);
	const anchorMs = Date.parse(anchor); // date-only -> UTC midnight
	const drifted = Number.isFinite(commitMs) && Number.isFinite(anchorMs) && commitMs > anchorMs;
	return {
		classification: drifted ? "drifted" : "aligned",
		anchorDate: anchor,
		lastCommitDate: lastCommitRaw,
	};
}

function detectArtifactDrift(target) {
	const targetRoot = resolveTarget(target);
	const unavailable = (note) => ({ target: targetRoot, available: false, note });

	let data;
	try {
		data = loadFeatureList(targetRoot);
	} catch {
		return unavailable("feature_list.json not found or unreadable");
	}
	if (!data || !Array.isArray(data.features)) {
		return unavailable("feature_list.json has no features array");
	}
	if (!isGitRepository(targetRoot)) return unavailable("n/a (non-git)");
	if (classifyTarget(targetRoot).type === "product-repo") {
		return unavailable("n/a (product-repo)");
	}

	const counts = { drifted: 0, aligned: 0, skipped: 0 };
	const skippedBreakdown = { noEvidence: 0, untracked: 0, pathUnknown: 0, anchorInvalid: 0 };
	const features = [];

	for (const feature of data.features) {
		if (!feature) continue;
		const c = classifyFeature(targetRoot, feature);
		const row = { id: feature.id, classification: c.classification, paths: feature.paths || [] };
		if (c.anchorDate !== undefined) row.anchorDate = c.anchorDate;
		if (c.lastCommitDate !== undefined) row.lastCommitDate = c.lastCommitDate;
		features.push(row);

		if (c.classification === "drifted") counts.drifted++;
		else if (c.classification === "aligned") counts.aligned++;
		else {
			counts.skipped++;
			if (c.classification === "no-evidence") skippedBreakdown.noEvidence++;
			else if (c.classification === "untracked") skippedBreakdown.untracked++;
			else if (c.classification === "path-unknown") skippedBreakdown.pathUnknown++;
			else if (c.classification === "anchor-invalid") skippedBreakdown.anchorInvalid++;
		}
	}

	return { target: targetRoot, available: true, counts, skippedBreakdown, features };
}

module.exports = { detectArtifactDrift };
