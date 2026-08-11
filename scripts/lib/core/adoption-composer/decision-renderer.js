"use strict";

// decision-renderer.js
// Renders adoption decision records, apply plans, and file selection proposals.

const { ADOPTION_WRITE_BOUNDARY_KEYS, MESSAGES } = require("../terminology");

const {
	renderMarkdown,
	pushBoundaryBlock,
	pushGateFindings,
	pushStarterFileList,
	pushOptionalStarterWikiFiles,
	pushPlainFileList,
	pushCheckboxFileList,
} = require("./shared-helpers");

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
		pushCheckboxFileList(lines, proposal.supportFiles, selected, "## Support Files");
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

module.exports = {
	renderAdoptionDecisionRecord,
	renderAdoptionApplyPlan,
	renderAdoptionSelectedFiles,
};
