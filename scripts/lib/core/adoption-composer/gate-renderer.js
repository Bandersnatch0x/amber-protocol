"use strict";

// gate-renderer.js
// Renders adoption gate documents and status documents.

const { renderMarkdown, pushGateFindings, pushMetrics, pushBlockers } = require("./shared-helpers");

function renderAdoptionGateDocument(gate) {
	const lines = [
		"# Adoption Gate Report",
		"",
		`Report: ${gate.report.file}`,
		`Target: ${gate.report.target}`,
		`Generated: ${gate.report.generatedAt}`,
		`Decision: ${gate.decision}`,
		"",
	];
	pushGateFindings(lines, gate.findings, "Findings");
	pushMetrics(lines, gate.metrics);
	return renderMarkdown(lines);
}

function renderAdoptionStatusDocument(status) {
	const lines = [
		"# Adoption Status",
		"",
		`Reports directory: ${status.reportsDir}`,
		`Reports: ${status.reports.count}`,
		`Latest report: ${status.latestReport ? status.latestReport.file : "none"}`,
		`Index checked: ${status.index.checked}`,
		`Index valid: ${status.index.valid ?? "n/a"}`,
		`Gate decision: ${status.gate.decision}`,
		`Next safe action: ${status.nextSafeAction}`,
		"",
	];
	pushBlockers(lines, status.blockers);
	lines.push("", "## Compare Summary", "");
	if (!status.compare) {
		lines.push("- Not enough reports to compare.");
	} else {
		lines.push(`- Base: ${status.compare.base.file}`);
		lines.push(`- Head: ${status.compare.head.file}`);
		lines.push(
			`- Missing Amber starter files delta: ${status.compare.metrics.missingHarnessFiles.delta ?? "n/a"}`,
		);
		lines.push(`- Candidate commands added: ${status.compare.candidateCommands.added.length}`);
		lines.push(`- Unknowns removed: ${status.compare.unknowns.removed.length}`);
	}
	lines.push("");
	return renderMarkdown(lines);
}

module.exports = {
	renderAdoptionGateDocument,
	renderAdoptionStatusDocument,
};
