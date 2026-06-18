"use strict";

const path = require("node:path");

const {
	ADOPTION_BOUNDARY_KEYS,
	ADOPTION_WRITE_BOUNDARY_KEYS,
	MESSAGES,
	formatAdoptionBoundaryLines,
} = require("./terminology");

const { relativeSlash } = require("./fs-utils");

const {
	escapeMarkdownTableCell,
	formatCommandList,
	formatList,
} = require("./text-utils");

const {
	buildAdoptionAuditMetrics,
	serializeAdoptionMetricsBlock,
} = require("./adoption-metrics");

function renderMarkdown(lines) {
	return lines.join("\n");
}

function pushSection(lines, heading, level = 2) {
	lines.push("", `${"#".repeat(level)} ${heading}`, "");
}

function pushBulletList(lines, items, options = {}) {
	const { empty = "- none", formatItem } = options;
	if (!items || items.length === 0) {
		lines.push(empty);
		return;
	}
	for (const item of items) {
		lines.push(formatItem ? formatItem(item) : `- ${item}`);
	}
}

function pushBoundaryBlock(lines, boundaries, options = {}) {
	const {
		heading = "Boundary",
		keys = ADOPTION_BOUNDARY_KEYS,
		preamble,
	} = options;
	pushSection(lines, heading);
	if (preamble) {
		lines.push(preamble, "");
	}
	lines.push(...formatAdoptionBoundaryLines(boundaries, keys));
	lines.push("");
}

function pushGateFindings(lines, findings, heading = "Gate Findings") {
	pushSection(lines, heading);
	pushBulletList(lines, findings, {
		formatItem: (finding) => `- ${finding.id}: ${finding.message}`,
	});
	lines.push("");
}

function pushStarterFileList(lines, files, heading = MESSAGES.requiredStarterFiles) {
	lines.push("", heading, "");
	pushBulletList(lines, files, {
		formatItem: (relativePath) => `- \`${relativePath}\``,
	});
}

function pushPlainFileList(lines, files, heading) {
	lines.push("", heading, "");
	pushBulletList(lines, files);
}

function pushOptionalStarterWikiFiles(lines, files) {
	pushStarterFileList(lines, files, "## Optional Starter Wiki Files");
}

function pushCheckboxFileList(lines, files, selectedSet, heading) {
	lines.push("", heading, "");
	for (const filePath of files) {
		lines.push(`- [${selectedSet.has(filePath) ? "x" : " "}] ${filePath}`);
	}
}

function pushCandidateCommands(lines, commands) {
	pushSection(lines, "Candidate Command To Confirm");
	if (commands.length === 0) {
		lines.push("- none detected");
	} else {
		for (const command of commands) {
			lines.push(`- ${command}`);
		}
	}
	lines.push(
		"",
		"Confirmation needed:",
		"",
		"- Is this the correct default verification command?",
		"- Should it run from the repository root or a subdirectory?",
		"- Does it require a virtual environment, environment variables, data files, or external services?",
		"- Is there a lighter smoke command that should run before the full suite?",
		"",
	);
}

function pushUnknowns(lines, unknowns) {
	pushSection(lines, "Unknowns To Resolve");
	pushBulletList(lines, unknowns);
	lines.push("");
}

function pushHumanApprovalGates(lines, gates) {
	pushSection(lines, "Human Approval Gates");
	for (const gate of gates) {
		lines.push(`- ${gate.id}: ${gate.question}`);
	}
	lines.push("");
}

function pushMetrics(lines, metrics) {
	pushSection(lines, "Metrics");
	for (const metric of Object.values(metrics)) {
		lines.push(`- ${metric.label}: ${metric.value ?? "n/a"}`);
	}
	lines.push("");
}

function pushBlockers(lines, blockers) {
	pushSection(lines, "Blockers");
	pushBulletList(lines, blockers, {
		formatItem: (blocker) => `- ${blocker.id}: ${blocker.message}`,
	});
}

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
		lines.push(
			`- Candidate commands added: ${status.compare.candidateCommands.added.length}`,
		);
		lines.push(`- Unknowns removed: ${status.compare.unknowns.removed.length}`);
	}
	lines.push("");
	return renderMarkdown(lines);
}

function renderAdoptionBundleReadme(bundle) {
	const lines = [
		"# Adoption Review Bundle",
		"",
		`Target: ${bundle.target}`,
		`Generated: ${bundle.generatedAt}`,
		`Reports directory: ${bundle.reportsDir}`,
		`Latest report: ${bundle.latestReport || "none"}`,
		`Gate decision: ${bundle.gateDecision}`,
		`Next safe action: ${bundle.nextSafeAction}`,
		"",
		"## Files",
		"",
	];
	for (const file of bundle.files) {
		lines.push(`- [${file.relativePath}](${file.relativePath})`);
	}
	pushBoundaryBlock(lines, bundle.boundaries, { heading: "V1 Boundaries" });
	lines.push(MESSAGES.adoptionReadOnlyBundleNotice, "");
	return renderMarkdown(lines);
}

function renderAdoptionNextActionsDocument(nextActions) {
	const lines = [
		"# Adoption Next Actions",
		"",
		"Status: review only",
		"",
		`Target: ${nextActions.target}`,
		`Bundle: ${nextActions.bundleDir}`,
		`Latest report: ${nextActions.latestReport || "none"}`,
		`Gate decision: ${nextActions.gateDecision}`,
		`Next safe action: ${nextActions.nextSafeAction}`,
		"",
	];
	pushBoundaryBlock(lines, nextActions.boundaries, {
		preamble: "This document is a read-only planning artifact.",
	});
	pushGateFindings(lines, nextActions.findings);
	pushStarterFileList(
		lines,
		nextActions.requiredHarnessFiles,
		MESSAGES.requiredStarterFilesPendingApproval,
	);
	pushOptionalStarterWikiFiles(lines, nextActions.optionalStarterWikiFiles);
	pushCandidateCommands(lines, nextActions.candidateCommands);
	pushUnknowns(lines, nextActions.unknowns);
	pushHumanApprovalGates(lines, nextActions.approvalGates);
	lines.push(
		"## Recommended Next Sequence",
		"",
		"1. Human reviews this document and answers the approval gates.",
		"2. If writes are approved, confirm the target path and exact file list before running init.",
		"3. Re-run adoption report, index, status, gate, and bundle after any approved target change.",
		"4. Treat target command execution as a separate approval step after the command is confirmed.",
		"",
		MESSAGES.adoptionCommandsOutsideArtifact,
		"",
	);
	return renderMarkdown(lines);
}

function renderAdoptionDecisionRecord(record) {
	const lines = [
		"# Adoption Decision Record",
		"",
		`Status: ${record.approvalStatus}`,
		"",
		`Target: ${record.target}`,
		`Bundle: ${record.bundleDir}`,
		`Latest report: ${record.latestReport || "none"}`,
		`Gate decision: ${record.gateDecision}`,
		`Next safe action: ${record.nextSafeAction}`,
		"",
	];
	pushBoundaryBlock(lines, record.boundaries);
	pushGateFindings(lines, record.findings);
	lines.push("## Decisions", "");
	for (const decision of record.decisions) {
		lines.push(`### ${decision.title}`, "");
		lines.push(`Status: ${decision.status}`, "");
		lines.push(`Decision: ${decision.decision}`, "");
		if (decision.note) {
			lines.push(`Note: ${decision.note}`, "");
		}
		lines.push("Evidence:", "");
		lines.push(`- Bundle: ${record.bundleDir}`);
		lines.push(`- Gate decision: ${record.gateDecision}`);
		lines.push("");
	}
	lines.push(
		"## Required User Action",
		"",
		"- Fill in Gate A, Gate B, and Gate C before any target write or target command execution.",
		`- ${MESSAGES.adoptionKeepReadOnly}`,
		"",
		"This record does not approve target writes or command execution by itself.",
		"",
	);
	return renderMarkdown(lines);
}

function renderAdoptionApplyPlan(plan) {
	const lines = [
		"# Adoption Apply Plan",
		"",
		`Target: ${plan.target}`,
		`Bundle: ${plan.bundleDir}`,
		`Gate decision: ${plan.gateDecision}`,
		`Dry run: ${plan.dryRun}`,
		`Apply ready: ${plan.applyReady}`,
		"",
	];
	pushBoundaryBlock(lines, plan.boundaries, {
		keys: ADOPTION_WRITE_BOUNDARY_KEYS,
	});
	pushPlainFileList(lines, plan.preview.created, "## Created Preview");
	pushPlainFileList(lines, plan.preview.skipped, "## Skipped Existing Files");
	pushStarterFileList(lines, plan.requiredHarnessFiles);
	pushOptionalStarterWikiFiles(lines, plan.optionalStarterWikiFiles);
	lines.push(
		"## Required User Action",
		"",
		"- Review this dry-run plan before approving any target write.",
		"- Run a separate approved command for any future non-dry-run target change.",
		"- Treat target command execution as a separate approval step.",
		"",
		"This plan does not write target files or run target commands.",
		"",
	);
	return renderMarkdown(lines);
}

function renderAdoptionSelectedFiles(proposal) {
	const selected = new Set(proposal.selectedFiles);
	const lines = [
		"# Adoption Selected Files Proposal",
		"",
		`Target: ${proposal.target}`,
		`Bundle: ${proposal.bundleDir}`,
		`Selected files: ${proposal.selectedFiles.length}`,
		"",
	];
	pushBoundaryBlock(lines, proposal.boundaries, {
		keys: ADOPTION_WRITE_BOUNDARY_KEYS,
	});
	pushPlainFileList(lines, proposal.selectedFiles, "## Selected Files");
	pushCheckboxFileList(
		lines,
		proposal.requiredHarnessFiles,
		selected,
		MESSAGES.requiredStarterFiles,
	);
	pushCheckboxFileList(
		lines,
		proposal.optionalStarterWikiFiles,
		selected,
		"## Optional Starter Wiki Files",
	);
	if (proposal.supportFiles.length > 0) {
		pushCheckboxFileList(
			lines,
			proposal.supportFiles,
			selected,
			"## Support Files",
		);
	}
	lines.push(
		"## Required User Action",
		"",
		"- Review selected files before approving any target write.",
		"- Generate a new apply-plan dry-run after changing selected files.",
		"- Treat target writes and target command execution as separate approval steps.",
		"",
		"This proposal does not write target files or run target commands.",
		"",
	);
	return renderMarkdown(lines);
}

function buildInitDryRunSection(initDryRun) {
	if (initDryRun.notApplicable) {
		return [
			"## Init Dry Run",
			"",
			`- Not applicable: ${initDryRun.reason}`,
			"",
		];
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

function buildAuditSummaryLines(audit) {
	const metrics = buildAdoptionAuditMetrics(audit);
	const lines = [
		`- Read-only: ${audit.readOnly}`,
		`- Target type: ${audit.classification.type}`,
	];

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
	const {
		targetRoot,
		audit,
		initDryRun,
		team,
		teamUpdatePreview,
		maintenance,
	} = parts;
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
		...buildAuditSummaryLines(audit),
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
			"- Suggested install: `node scripts/amber.js team install --target <target> --version 1.0.0 --preset safe-bootstrap`",
		);
	}

	if (teamUpdatePreview && teamUpdatePreview.preview) {
		lines.push(
			`- Update preview: ${teamUpdatePreview.preview.fromVersion} -> ${teamUpdatePreview.preview.toVersion}`,
		);
		lines.push(
			`- Update would write immediately: ${teamUpdatePreview.preview.willWrite}`,
		);
		lines.push(
			`- Customizations preserved: ${teamUpdatePreview.preview.customizationsPreserved}`,
		);
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
	const metrics = {
		...buildAdoptionAuditMetrics(audit),
		staleDocs: maintenance.staleDocs.length,
	};
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
	renderMarkdown,
	pushSection,
	pushBulletList,
	pushBoundaryBlock,
	pushGateFindings,
	pushStarterFileList,
	pushOptionalStarterWikiFiles,
	pushCheckboxFileList,
	pushCandidateCommands,
	pushUnknowns,
	pushHumanApprovalGates,
	renderAdoptionGateDocument,
	renderAdoptionStatusDocument,
	renderAdoptionBundleReadme,
	renderAdoptionNextActionsDocument,
	renderAdoptionDecisionRecord,
	renderAdoptionApplyPlan,
	renderAdoptionSelectedFiles,
	renderAdoptionReport,
	renderAdoptionReportsIndex,
	renderAdoptionReportDiff,
};