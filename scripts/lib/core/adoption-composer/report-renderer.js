"use strict";

// report-renderer.js
// Renders adoption reports, report indexes, and report diffs.

const path = require("node:path");

const { MESSAGES } = require("../terminology");
const { relativeSlash } = require("../fs-utils");
const { escapeMarkdownTableCell, formatCommandList, formatList } = require("../text-utils");

const { buildAdoptionAuditMetrics, serializeAdoptionMetricsBlock } = require("../adoption-metrics");

const { renderMarkdown } = require("./shared-helpers");

function buildInitDryRunSection(initDryRun) {
	if (initDryRun.notApplicable) {
		return ["## Init Dry Run", "", `- Not applicable: ${initDryRun.reason}`, ""];
	}

	return [
		"## Init Dry Run",
		"",
		`- Would create: ${initDryRun.created.length}`,
		`- Would skip: ${initDryRun.skipped.length}`,
		"",
		"### First Suggested Additions",
		"",
		...formatList(initDryRun.created.slice(0, 10), "none"),
		"",
	];
}

function buildAuditSummaryLines(audit, metrics) {
	const lines = [`- Read-only: ${audit.readOnly}`, `- Target type: ${audit.classification.type}`];

	if (audit.auditMode === "product-repo") {
		lines.push(
			`- Template starter files present: ${metrics.templateStarterFilesPresent}`,
			`- Template starter files missing: ${metrics.templateStarterFilesMissing}`,
		);
	} else {
		lines.push(
			`- Existing Amber starter files: ${metrics.existingHarnessFiles}`,
			`- Missing Amber starter files: ${metrics.missingHarnessFiles}`,
		);
	}

	lines.push(
		`- Existing docs: ${metrics.existingDocs}`,
		`- Wiki-like files: ${metrics.wikiLikeFiles}`,
		`- Conflicts: ${metrics.conflicts}`,
	);

	return lines;
}

function renderAdoptionReport(parts) {
	const { targetRoot, audit, initDryRun, team, teamUpdatePreview, maintenance } = parts;
	// Defensive default: the engine layer normally passes precomputed metrics.
	// Fall back to deriving them here so a caller that omits metrics degrades
	// gracefully instead of throwing on metrics.* access. Mirrors the inline
	// computation from the pre-split adoption-composer.
	const metrics = parts.metrics ?? {
		...buildAdoptionAuditMetrics(audit),
		staleDocs: maintenance.staleDocs.length,
	};
	const lines = [
		"# Amber Protocol Adoption Report",
		"",
		`Target: ${targetRoot}`,
		`Generated: ${new Date().toISOString()}`,
		"",
		MESSAGES.adoptionReportNoInit,
		"",
		"## Audit Summary",
		"",
		...buildAuditSummaryLines(audit, metrics),
		"",
		"### Candidate Commands",
		"",
		...formatCommandList(audit.candidateCommands, "none"),
		"",
		"### Unknowns",
		"",
		...formatList(audit.unknowns, "none"),
		"",
		...buildInitDryRunSection(initDryRun),
		"## Team Distribution",
		"",
		`- Installed: ${team.installed}`,
		`- Registry: ${team.registry.name}`,
		`- Available versions: ${Object.keys(team.registry.versions || {}).join(", ") || "none"}`,
		"",
	];

	if (team.lock) {
		lines.push(`- Current version: ${team.lock.installedVersion}`);
	} else {
		lines.push("- Current version: not installed");
		lines.push(
			"- Suggested install: `node scripts/amber.js team install --target <target> --version 1.0.0 --preset safe-bootstrap --dry-run --json`",
		);
	}

	if (teamUpdatePreview && teamUpdatePreview.preview) {
		lines.push(
			`- Update preview: ${teamUpdatePreview.preview.fromVersion} -> ${teamUpdatePreview.preview.toVersion}`,
		);
		lines.push(`- Update would write immediately: ${teamUpdatePreview.preview.willWrite}`);
		lines.push(`- Customizations preserved: ${teamUpdatePreview.preview.customizationsPreserved}`);
	}

	lines.push(
		"",
		"## Maintenance",
		"",
		`- Stale docs: ${maintenance.staleDocs.length}`,
		`- Rule-pack drift: ${maintenance.rulePackDrift.drifted}`,
		`- Upgrade: ${maintenance.upgradeAssistant.currentVersion || "not installed"} -> ${maintenance.upgradeAssistant.latestVersion}`,
		"",
		"## Next Safe Commands",
		"",
		`- ${audit.nextSafeCommand}`,
		`- node scripts/amber.js init --target ${JSON.stringify(targetRoot)} --dry-run`,
		`- node scripts/amber.js maintenance inspect --target ${JSON.stringify(targetRoot)} --json`,
		"",
	);

	// Embed the compare metrics as structured data so `adoption compare`/`gate`
	// consume them directly instead of re-parsing the prose labels above. The
	// prose stays human-facing; this block is the data contract. staleDocs is
	// sourced from maintenance, not audit, so it is stamped on here.
	lines.push(serializeAdoptionMetricsBlock(metrics), "");

	return renderMarkdown(lines);
}

function renderAdoptionReportsIndex(listing, outputPath) {
	const outputDir = path.dirname(outputPath);
	const lines = [
		"# Adoption Reports Index",
		"",
		`Reports directory: ${listing.reportsDir}`,
		`Generated: ${new Date().toISOString()}`,
		"",
		"Reports are sorted newest first.",
		"",
	];

	if (listing.reports.length === 0) {
		lines.push("No adoption reports found.", "");
		return renderMarkdown(lines);
	}

	lines.push("| Generated | Target | Report |", "| --- | --- | --- |");
	for (const report of listing.reports) {
		const linkTarget = relativeSlash(outputDir, report.file);
		const fileName = path.basename(report.file);
		lines.push(
			`| ${escapeMarkdownTableCell(report.generatedAt)} | ${escapeMarkdownTableCell(report.target)} | [${escapeMarkdownTableCell(fileName)}](${linkTarget}) |`,
		);
	}
	lines.push("");
	return renderMarkdown(lines);
}

function renderAdoptionReportDiff(comparison) {
	const lines = [
		"# Adoption Report Diff",
		"",
		`Base: ${comparison.base.file}`,
		`Head: ${comparison.head.file}`,
		`Same target: ${comparison.sameTarget}`,
		"",
		"## Metric Deltas",
		"",
		"| Metric | Base | Head | Delta |",
		"| --- | ---: | ---: | ---: |",
	];

	for (const metric of Object.values(comparison.metrics)) {
		lines.push(
			`| ${metric.label} | ${metric.base ?? "n/a"} | ${metric.head ?? "n/a"} | ${metric.delta ?? "n/a"} |`,
		);
	}

	lines.push("", "## Candidate Commands Added", "");
	lines.push(...formatList(comparison.candidateCommands.added, "none"));
	lines.push("", "## Candidate Commands Removed", "");
	lines.push(...formatList(comparison.candidateCommands.removed, "none"));
	lines.push("", "## Unknowns Added", "");
	lines.push(...formatList(comparison.unknowns.added, "none"));
	lines.push("", "## Unknowns Removed", "");
	lines.push(...formatList(comparison.unknowns.removed, "none"));
	lines.push("");

	return renderMarkdown(lines);
}

module.exports = {
	renderAdoptionReport,
	renderAdoptionReportsIndex,
	renderAdoptionReportDiff,
};
