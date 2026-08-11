"use strict";

// shared-helpers.js
// Common rendering utilities used across all adoption artifact renderers.

const { ADOPTION_BOUNDARY_KEYS, MESSAGES, formatAdoptionBoundaryLines } = require("../terminology");

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
	const { heading = "Boundary", keys = ADOPTION_BOUNDARY_KEYS, preamble } = options;
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

module.exports = {
	renderMarkdown,
	pushSection,
	pushBulletList,
	pushBoundaryBlock,
	pushGateFindings,
	pushStarterFileList,
	pushPlainFileList,
	pushOptionalStarterWikiFiles,
	pushCheckboxFileList,
	pushCandidateCommands,
	pushUnknowns,
	pushHumanApprovalGates,
	pushMetrics,
	pushBlockers,
};
