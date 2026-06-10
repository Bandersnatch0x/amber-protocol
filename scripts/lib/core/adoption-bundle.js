"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
	buildAdoptionGateContent,
	buildAdoptionStatusContent,
	gateAdoptionReport,
	statusAdoptionReports,
} = require("./adoption-gate");

const {
	buildAdoptionReportDiffContent,
	buildAdoptionReportsIndexContent,
	listAdoptionReports,
	parseAdoptionReportForComparison,
} = require("./adoption-reports");

const {
	OPTIONAL_STARTER_WIKI_FILES,
	REQUIRED_HARNESS_FILES,
} = require("./constants");

const {
	pathExists,
	readJson,
	readText,
	writeJson,
} = require("./fs-utils");

const {
	getSectionBody,
} = require("./text-utils");

function adoptionBundleBoundaries() {
	return {
		targetProjectFilesCopied: false,
		targetProjectCommandsExecuted: false,
		dynamicWorkflowExecuted: false,
		liveSubagentsInvoked: false,
	};
}

function buildAdoptionBundleDiffFallbackContent(status) {
	const lines = [
		"# Adoption Report Diff",
		"",
		"No diff was generated for this bundle.",
		"",
		"## Reason",
		"",
	];

	if (status.reports.count < 2) {
		lines.push("- Need at least two adoption reports to compare.");
	} else if (
		status.compare &&
		Array.isArray(status.compare.errors) &&
		status.compare.errors.length > 0
	) {
		for (const error of status.compare.errors) {
			lines.push(`- ${error}`);
		}
	} else {
		lines.push("- Compare data was unavailable.");
	}

	lines.push("");
	return lines.join("\n");
}

function buildAdoptionBundleReadmeContent(bundle) {
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

	lines.push(
		"",
		"## V1 Boundaries",
		"",
		`- Target project files copied: ${bundle.boundaries.targetProjectFilesCopied}`,
		`- Target project commands executed: ${bundle.boundaries.targetProjectCommandsExecuted}`,
		`- Dynamic Workflow executed: ${bundle.boundaries.dynamicWorkflowExecuted}`,
		`- Live subagents invoked: ${bundle.boundaries.liveSubagentsInvoked}`,
		"",
		"This bundle is a read-only review artifact. It does not copy files from the target project and does not run target project commands.",
		"",
	);

	return lines.join("\n");
}

function adoptionBundleErrorResult(fields, errors, warnings) {
	const outputDir = fields.outputDir || "";
	return {
		kind: "adoption-bundle",
		target: fields.target || fields.reportsDir || "n/a",
		reportsDir: fields.reportsDir || "",
		indexPath: fields.indexPath || "",
		outputDir,
		latestReport: null,
		gateDecision: "wait",
		nextSafeAction: "Fix adoption bundle errors before sharing this bundle.",
		files: [],
		manifestPath: outputDir ? path.join(outputDir, "manifest.json") : "",
		boundaries: adoptionBundleBoundaries(),
		errors,
		warnings,
	};
}

function bundleAdoptionArtifacts(options = {}) {
	const reportsDir = options.reportsDir ? path.resolve(options.reportsDir) : "";
	const indexPath = options.index ? path.resolve(options.index) : "";
	const outputDir = options.outputDir ? path.resolve(options.outputDir) : "";
	const errors = [];
	const warnings = [];

	if (!reportsDir) {
		errors.push("adoption bundle requires --reports-dir.");
	}
	if (!outputDir) {
		errors.push("adoption bundle requires --output-dir.");
	}
	if (outputDir && pathExists(outputDir)) {
		errors.push(`Bundle output directory already exists: ${outputDir}`);
	}
	if (errors.length > 0) {
		return adoptionBundleErrorResult(
			{ reportsDir, indexPath, outputDir },
			errors,
			warnings,
		);
	}

	const status = statusAdoptionReports({ reportsDir, index: indexPath });
	warnings.push(...(status.warnings || []));
	errors.push(...(status.errors || []));
	if (errors.length > 0) {
		return adoptionBundleErrorResult(
			{ target: status.target, reportsDir, indexPath, outputDir },
			errors,
			warnings,
		);
	}

	const listing = listAdoptionReports({ reportsDir });
	warnings.push(...listing.warnings);
	errors.push(...listing.errors);
	if (errors.length > 0) {
		return adoptionBundleErrorResult(
			{ target: status.target, reportsDir, indexPath, outputDir },
			errors,
			warnings,
		);
	}

	const gate = status.latestReport
		? gateAdoptionReport({ report: status.latestReport.file })
		: null;
	if (gate) {
		warnings.push(...(gate.warnings || []));
		errors.push(...(gate.errors || []));
	}
	if (errors.length > 0) {
		return adoptionBundleErrorResult(
			{ target: status.target, reportsDir, indexPath, outputDir },
			errors,
			warnings,
		);
	}

	const relativePaths = [
		"README.md",
		"status.md",
		"index.md",
		"diff.md",
		"gate.md",
		"manifest.json",
	];
	const files = relativePaths.map((relativePath) => ({
		relativePath,
		path: path.join(outputDir, relativePath),
	}));
	const manifestPath = path.join(outputDir, "manifest.json");
	const generatedAt = new Date().toISOString();
	const boundaries = adoptionBundleBoundaries();
	const bundle = {
		kind: "adoption-bundle",
		generatedAt,
		target: status.target,
		reportsDir,
		indexPath,
		outputDir,
		latestReport: status.latestReport ? status.latestReport.file : null,
		gateDecision: status.gate.decision,
		nextSafeAction: status.nextSafeAction,
		files,
		manifestPath,
		boundaries,
		errors,
		warnings,
	};

	const manifest = {
		kind: bundle.kind,
		generatedAt,
		target: bundle.target,
		reportsDir,
		indexPath,
		outputDir,
		latestReport: bundle.latestReport,
		gateDecision: bundle.gateDecision,
		nextSafeAction: bundle.nextSafeAction,
		files,
		sources: {
			reports: listing.reports.map((report) => ({
				file: report.file,
				target: report.target,
				generatedAt: report.generatedAt,
			})),
			index: indexPath || null,
		},
		boundaries,
	};

	fs.mkdirSync(path.dirname(outputDir), { recursive: true });
	fs.mkdirSync(outputDir);
	fs.writeFileSync(
		path.join(outputDir, "README.md"),
		buildAdoptionBundleReadmeContent(bundle),
	);
	fs.writeFileSync(
		path.join(outputDir, "status.md"),
		buildAdoptionStatusContent(status),
	);
	fs.writeFileSync(
		path.join(outputDir, "index.md"),
		buildAdoptionReportsIndexContent(listing, path.join(outputDir, "index.md")),
	);
	fs.writeFileSync(
		path.join(outputDir, "diff.md"),
		status.compare
			? buildAdoptionReportDiffContent(status.compare)
			: buildAdoptionBundleDiffFallbackContent(status),
	);
	fs.writeFileSync(
		path.join(outputDir, "gate.md"),
		gate
			? buildAdoptionGateContent(gate)
			: "# Adoption Gate Report\n\nNo latest report was available.\n",
	);
	writeJson(manifestPath, manifest);

	return bundle;
}

function extractAdoptionGateFindings(markdown) {
	const body = getSectionBody(markdown, "Findings");
	if (!body) {
		return [];
	}

	return body
		.split(/\r?\n/)
		.map((line) => line.match(/^\s*-\s+([^:]+):\s+(.+?)\s*$/))
		.filter(Boolean)
		.map((match) => ({ id: match[1].trim(), message: match[2].trim() }));
}

function extractAdoptionGateMetrics(markdown) {
	const body = getSectionBody(markdown, "Metrics");
	if (!body) {
		return [];
	}

	return body
		.split(/\r?\n/)
		.map((line) => line.match(/^\s*-\s+([^:]+):\s+(.+?)\s*$/))
		.filter(Boolean)
		.map((match) => {
			const value = Number(match[2].trim());
			return {
				label: match[1].trim(),
				value: Number.isNaN(value) ? match[2].trim() : value,
			};
		});
}

function adoptionNextActionsApprovalGates() {
	return [
		{
			id: "command-confirmation",
			question:
				"Confirm, replace, or reject the candidate verification command.",
		},
		{
			id: "bootstrap-write",
			question:
				"Approve full init, selected manual patches, or keep the target read-only.",
		},
		{
			id: "wiki-scope",
			question:
				"Choose required files only, required plus optional wiki starters, or defer wiki starters.",
		},
	];
}

function adoptionNextActionsErrorResult(fields, errors, warnings) {
	return {
		kind: "adoption-next-actions",
		target: fields.target || "n/a",
		bundleDir: fields.bundleDir || "",
		outputPath: fields.outputPath || "",
		latestReport: null,
		gateDecision: "wait",
		nextSafeAction:
			"Fix adoption next-actions errors before sharing this checklist.",
		findings: [],
		metrics: [],
		requiredHarnessFiles: REQUIRED_HARNESS_FILES,
		optionalStarterWikiFiles: OPTIONAL_STARTER_WIKI_FILES,
		candidateCommands: [],
		unknowns: [],
		approvalGates: adoptionNextActionsApprovalGates(),
		boundaries: adoptionBundleBoundaries(),
		errors,
		warnings,
	};
}

function buildAdoptionNextActionsContent(nextActions) {
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
		"## Boundary",
		"",
		"This document is a read-only planning artifact.",
		"",
		`- Target project files copied: ${nextActions.boundaries.targetProjectFilesCopied}`,
		`- Target project commands executed: ${nextActions.boundaries.targetProjectCommandsExecuted}`,
		`- Dynamic Workflow executed: ${nextActions.boundaries.dynamicWorkflowExecuted}`,
		`- Live subagents invoked: ${nextActions.boundaries.liveSubagentsInvoked}`,
		"",
		"## Gate Findings",
		"",
	];

	if (nextActions.findings.length === 0) {
		lines.push("- none");
	} else {
		for (const finding of nextActions.findings) {
			lines.push(`- ${finding.id}: ${finding.message}`);
		}
	}

	lines.push("", "## Required Harness Files Pending Approval", "");
	for (const relativePath of nextActions.requiredHarnessFiles) {
		lines.push(`- \`${relativePath}\``);
	}

	lines.push("", "## Optional Starter Wiki Files", "");
	for (const relativePath of nextActions.optionalStarterWikiFiles) {
		lines.push(`- \`${relativePath}\``);
	}

	lines.push("", "## Candidate Command To Confirm", "");
	if (nextActions.candidateCommands.length === 0) {
		lines.push("- none detected");
	} else {
		for (const command of nextActions.candidateCommands) {
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
		"## Unknowns To Resolve",
		"",
	);

	if (nextActions.unknowns.length === 0) {
		lines.push("- none");
	} else {
		for (const unknown of nextActions.unknowns) {
			lines.push(`- ${unknown}`);
		}
	}

	lines.push("", "## Human Approval Gates", "");
	for (const gate of nextActions.approvalGates) {
		lines.push(`- ${gate.id}: ${gate.question}`);
	}

	lines.push(
		"",
		"## Recommended Next Sequence",
		"",
		"1. Human reviews this document and answers the approval gates.",
		"2. If writes are approved, confirm the target path and exact file list before running init.",
		"3. Re-run adoption report, index, status, gate, and bundle after any approved target change.",
		"4. Treat target command execution as a separate approval step after the command is confirmed.",
		"",
		"Commands that write to the target project or execute its tests remain outside this artifact.",
		"",
	);

	return lines.join("\n");
}

function writeAdoptionNextActions(options = {}) {
	const bundleDir = options.bundleDir ? path.resolve(options.bundleDir) : "";
	const outputPath = options.output ? path.resolve(options.output) : "";
	const errors = [];
	const warnings = [];

	if (!bundleDir) {
		errors.push("adoption next-actions requires --bundle-dir.");
	}
	if (!outputPath) {
		errors.push("adoption next-actions requires --output.");
	}
	if (
		bundleDir &&
		(!pathExists(bundleDir) || !fs.statSync(bundleDir).isDirectory())
	) {
		errors.push(`Bundle directory does not exist: ${bundleDir}`);
	}
	if (outputPath && pathExists(outputPath)) {
		errors.push(`Next-actions output already exists: ${outputPath}`);
	}
	if (errors.length > 0) {
		return adoptionNextActionsErrorResult(
			{ bundleDir, outputPath },
			errors,
			warnings,
		);
	}

	const manifestPath = path.join(bundleDir, "manifest.json");
	if (!pathExists(manifestPath)) {
		errors.push(`Bundle manifest is missing: ${manifestPath}`);
		return adoptionNextActionsErrorResult(
			{ bundleDir, outputPath },
			errors,
			warnings,
		);
	}

	let manifest;
	try {
		manifest = readJson(manifestPath);
	} catch (error) {
		errors.push(`Cannot read bundle manifest: ${error.message}`);
		return adoptionNextActionsErrorResult(
			{ bundleDir, outputPath },
			errors,
			warnings,
		);
	}

	const latestReport = manifest.latestReport
		? path.isAbsolute(manifest.latestReport)
			? manifest.latestReport
			: path.resolve(bundleDir, manifest.latestReport)
		: "";
	let candidateCommands = [];
	let unknowns = [];
	if (latestReport && pathExists(latestReport)) {
		const parsed = parseAdoptionReportForComparison(latestReport);
		if (parsed.error) {
			warnings.push(parsed.error);
		} else {
			candidateCommands = parsed.report.candidateCommands;
			unknowns = parsed.report.unknowns;
		}
	} else if (latestReport) {
		warnings.push(`Latest report is missing: ${latestReport}`);
	}

	const gatePath = path.join(bundleDir, "gate.md");
	const gateMarkdown = pathExists(gatePath) ? readText(gatePath) : "";
	const findings = gateMarkdown
		? extractAdoptionGateFindings(gateMarkdown)
		: [];
	const metrics = gateMarkdown ? extractAdoptionGateMetrics(gateMarkdown) : [];
	const approvalGates = adoptionNextActionsApprovalGates();
	const nextActions = {
		kind: "adoption-next-actions",
		target: manifest.target || "unknown",
		bundleDir,
		outputPath,
		latestReport: latestReport || null,
		gateDecision: manifest.gateDecision || "wait",
		nextSafeAction:
			manifest.nextSafeAction ||
			"Review adoption gate findings before initializing or changing the target project.",
		findings,
		metrics,
		requiredHarnessFiles: REQUIRED_HARNESS_FILES,
		optionalStarterWikiFiles: OPTIONAL_STARTER_WIKI_FILES,
		candidateCommands,
		unknowns,
		approvalGates,
		boundaries: {
			...adoptionBundleBoundaries(),
			...(manifest.boundaries || {}),
		},
		errors,
		warnings,
	};

	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, buildAdoptionNextActionsContent(nextActions));

	return nextActions;
}

module.exports = {
	adoptionBundleBoundaries,
	buildAdoptionBundleDiffFallbackContent,
	buildAdoptionBundleReadmeContent,
	adoptionBundleErrorResult,
	bundleAdoptionArtifacts,
	extractAdoptionGateFindings,
	extractAdoptionGateMetrics,
	adoptionNextActionsApprovalGates,
	adoptionNextActionsErrorResult,
	buildAdoptionNextActionsContent,
	writeAdoptionNextActions,
};
