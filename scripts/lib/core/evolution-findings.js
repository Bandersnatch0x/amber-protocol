"use strict";

// Amber Evolution finding collectors (F014-M2 extraction).
//
// Shared by the legacy Maintenance surface (core/maintenance.js) and the
// focused Maintenance evidence facade (maintenance/internal/evidence.js).
// Extracted so the facade can consume the same collectors without a circular
// require back into core/maintenance.js.
//
// Semantics are unchanged: count "Finding: <text>" occurrences in
// harness-evolution.md, sorted by count (desc) then text (asc); a finding is
// "significant" once it recurs (EVOLUTION_FINDING_MIN_COUNT). Returns [] when
// the file is absent.

const path = require("node:path");

const { pathExists, readText } = require("./fs-utils");

const EVOLUTION_FINDING_MIN_COUNT = 2;

function countEvolutionFindings(targetRoot) {
	const filePath = path.join(targetRoot, "docs", "wiki", "engineering", "harness-evolution.md");
	if (!pathExists(filePath)) {
		return [];
	}

	const counts = new Map();
	for (const line of readText(filePath).split(/\r?\n/)) {
		const match = line.match(/Finding:\s*(.+?)\s*$/);
		if (match) {
			const finding = match[1].trim();
			counts.set(finding, (counts.get(finding) || 0) + 1);
		}
	}

	return [...counts.entries()]
		.map(([finding, count]) => ({ finding, count }))
		.sort((left, right) => right.count - left.count || left.finding.localeCompare(right.finding));
}

// Findings that recur at least minCount times. The single filtering point for
// both lineage adapters and the CLI rollup, so the cutoff lives in one place.
function significantEvolutionFindings(targetRoot, minCount) {
	return countEvolutionFindings(targetRoot).filter((item) => item.count >= minCount);
}

function extractEvolutionFindings(targetRoot) {
	return significantEvolutionFindings(targetRoot, EVOLUTION_FINDING_MIN_COUNT);
}

module.exports = {
	EVOLUTION_FINDING_MIN_COUNT,
	countEvolutionFindings,
	extractEvolutionFindings,
	significantEvolutionFindings,
};
