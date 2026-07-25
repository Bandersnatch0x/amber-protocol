"use strict";

// Maintenance proposal authoring — extracted from maintenance.js so the
// proposal-rendering + priority-filter logic (buildMaintenanceProposalContent +
// proposeMaintenance) lives behind its own seam. inspectMaintenance is NOT
// moved: it is a shared core interface (governance-report, adoption-reports)
// and stays in maintenance.js. proposeMaintenance receives it by injection to
// avoid a circular require and to keep the inspect stub seam intact.

const fs = require("node:fs");
const path = require("node:path");
const { resolveStateDirForCreate } = require("../state-dir-resolver");
const { relativeSlash } = require("./fs-utils");
const { MESSAGES } = require("./terminology");

function buildMaintenanceProposalContent(inspection) {
	const lines = [
		MESSAGES.maintenanceProposalTitle,
		"",
		`Target: ${inspection.target}`,
		`Generated: ${new Date().toISOString()}`,
		"",
		"## Stale Docs",
		"",
	];

	if (inspection.staleDocs.length === 0) {
		lines.push("- None detected.");
	} else {
		for (const doc of inspection.staleDocs) {
			lines.push(`- ${doc.path}: ${doc.reason}`);
		}
	}

	lines.push("", "## Upgrade Assistant", "");
	lines.push(
		`- Current: ${inspection.upgradeAssistant.currentVersion || "not installed"}`,
	);
	lines.push(`- Latest: ${inspection.upgradeAssistant.latestVersion}`);
	if (inspection.upgradeAssistant.previewCommand) {
		lines.push(`- Preview: \`${inspection.upgradeAssistant.previewCommand}\``);
	}

	lines.push("", "## Rule-Pack Drift", "");
	lines.push(`- Drifted: ${inspection.rulePackDrift.drifted}`);
	lines.push(
		`- Expected: ${(inspection.rulePackDrift.expected || []).join(", ") || "none"}`,
	);
	lines.push(
		`- Actual: ${(inspection.rulePackDrift.actual || []).join(", ") || "none"}`,
	);

	lines.push("", "## Evolution Rollup", "");
	if (inspection.evolutionRollup.length === 0) {
		lines.push("- No repeated findings detected.");
	} else {
		for (const item of inspection.evolutionRollup) {
			lines.push(`- ${item.finding} (${item.count} occurrences)`);
		}
	}

	lines.push("", "## Regression Proposals", "");
	if (
		!Array.isArray(inspection.regressionProposals) ||
		inspection.regressionProposals.length === 0
	) {
		lines.push("- No trace-derived regression proposals detected.");
	} else {
		for (const proposal of inspection.regressionProposals) {
			lines.push(`- ${proposal.taskId}: ${proposal.assertion}`);
			lines.push(`  - Trace input: ${proposal.traceInput}`);
			lines.push(`  - Agent config: ${proposal.agentConfig}`);
			lines.push(`  - Source: ${proposal.source}`);
			lines.push(`  - Modifies tests: ${proposal.modifiesTests}`);
			lines.push(`  - Approval required: ${proposal.approvalRequired}`);
		}
	}

	lines.push("", "## Suggested Standards Diff", "", "```diff");
	if (inspection.evolutionRollup.length === 0) {
		lines.push("# No repeated delivery findings to promote.");
	} else {
		lines.push("--- standards/amber-delivery.json");
		lines.push("+++ standards/amber-delivery.json");
		for (const item of inspection.evolutionRollup) {
			lines.push(`+ delivery finding: ${item.finding}`);
		}
	}
	lines.push(
		"```",
		"",
		"No source docs or standards were changed by this proposal.",
		"",
	);

	return lines.join("\n");
}

// inspectMaintenance is injected (not required) so this module does not depend
// back on maintenance.js. The dispatch caller passes maintenance's exported
// inspect binding, preserving the test stub seam.
function proposeMaintenance(target, registryPath, priority, inspectMaintenance) {
	const inspection = inspectMaintenance(target, registryPath);
	if (inspection.errors.length > 0) {
		return {
			target: inspection.target,
			errors: inspection.errors,
			warnings: inspection.warnings,
		};
	}

	// Apply priority filter if specified
	let filteredInspection = inspection;
	if (priority) {
		// Validate the requested priority up front. An unrecognized value used to
		// fall through every branch, leaving allowedCategories empty so each
		// section was zeroed and a blank proposal was written with no error — a
		// silent failure. Fail fast with a clear message instead.
		if (!['high', 'medium', 'low'].includes(priority)) {
			return {
				target: inspection.target,
				errors: [
					`Unknown priority "${priority}". Use high, medium, or low.`,
				],
				warnings: inspection.warnings,
			};
		}

		const priorityLevels = {
			high: ['staleDocs', 'rulePackDrift'],
			medium: ['upgradeAssistant', 'evolutionRollup'],
			low: ['regressionProposals'],
		};

		const allowedCategories = [];
		if (priority === 'high') {
			allowedCategories.push(...priorityLevels.high);
		} else if (priority === 'medium') {
			allowedCategories.push(...priorityLevels.high, ...priorityLevels.medium);
		} else if (priority === 'low') {
			allowedCategories.push(...priorityLevels.high, ...priorityLevels.medium, ...priorityLevels.low);
		}

		filteredInspection = { ...inspection };
		if (!allowedCategories.includes('staleDocs')) filteredInspection.staleDocs = [];
		if (!allowedCategories.includes('rulePackDrift')) filteredInspection.rulePackDrift = { drifted: false, expected: [], actual: [] };
		if (!allowedCategories.includes('upgradeAssistant')) filteredInspection.upgradeAssistant = { currentVersion: null, latestVersion: null };
		if (!allowedCategories.includes('evolutionRollup')) filteredInspection.evolutionRollup = [];
		if (!allowedCategories.includes('regressionProposals')) filteredInspection.regressionProposals = [];
	}

	const proposalRoot = path.join(
		resolveStateDirForCreate(filteredInspection.target),
		"maintenance",
		"proposals",
	);
	const proposalPath = path.join(
		proposalRoot,
		`${new Date().toISOString().replace(/[:.]/g, "-")}-maintenance-proposal.md`,
	);
	fs.mkdirSync(proposalRoot, { recursive: true });
	fs.writeFileSync(proposalPath, buildMaintenanceProposalContent(filteredInspection));

	return {
		target: filteredInspection.target,
		proposalPath: relativeSlash(filteredInspection.target, proposalPath),
		reviewable: true,
		sourceFilesChanged: false,
		inspection: filteredInspection,
		priority: priority || 'all',
		errors: [],
		warnings: filteredInspection.warnings,
	};
}

module.exports = { buildMaintenanceProposalContent, proposeMaintenance };
