"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { gateAdoptionReport, statusAdoptionReports } = require("./adoption-gate");

const { listAdoptionReports, parseAdoptionReportForComparison } = require("./adoption-reports");

const { OPTIONAL_STARTER_WIKI_FILES, REQUIRED_HARNESS_FILES } = require("./constants");

const { pathExists, writeJson } = require("./fs-utils");

const { getSectionBody } = require("./text-utils");

const { MESSAGES, defaultAdoptionBoundaries } = require("./terminology");

const {
	renderAdoptionBundleReadme,
	renderAdoptionNextActionsDocument,
	renderAdoptionGateDocument,
	renderAdoptionReportDiff,
	renderAdoptionReportsIndex,
	renderAdoptionStatusDocument,
	writeAdoptionBundleArtifact,
} = require("./adoption-composer/index");

function adoptionBundleBoundaries() {
	return defaultAdoptionBoundaries();
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
		return adoptionBundleErrorResult({ reportsDir, indexPath, outputDir }, errors, warnings);
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
	fs.writeFileSync(path.join(outputDir, "README.md"), renderAdoptionBundleReadme(bundle));
	fs.writeFileSync(path.join(outputDir, "status.md"), renderAdoptionStatusDocument(status));
	fs.writeFileSync(
		path.join(outputDir, "index.md"),
		renderAdoptionReportsIndex(listing, path.join(outputDir, "index.md")),
	);
	fs.writeFileSync(
		path.join(outputDir, "diff.md"),
		status.compare
			? renderAdoptionReportDiff(status.compare)
			: buildAdoptionBundleDiffFallbackContent(status),
	);
	fs.writeFileSync(
		path.join(outputDir, "gate.md"),
		gate
			? renderAdoptionGateDocument(gate)
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
			question: "Confirm, replace, or reject the candidate verification command.",
		},
		{
			id: "bootstrap-write",
			question: "Approve full init, selected manual patches, or keep the target read-only.",
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
		nextSafeAction: "Fix adoption next-actions errors before sharing this checklist.",
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

function writeAdoptionNextActions(options = {}) {
	return writeAdoptionBundleArtifact(options, {
		command: "adoption next-actions",
		outputExistsLabel: "Next-actions output",
		emptyResult: adoptionNextActionsErrorResult,
		render: renderAdoptionNextActionsDocument,
		build: (manifest, ctx) => {
			const latestReport = manifest.latestReport
				? path.isAbsolute(manifest.latestReport)
					? manifest.latestReport
					: path.resolve(ctx.bundleDir, manifest.latestReport)
				: "";
			let candidateCommands = [];
			let unknowns = [];
			if (latestReport && pathExists(latestReport)) {
				const parsed = parseAdoptionReportForComparison(latestReport);
				if (parsed.error) {
					ctx.warnings.push(parsed.error);
				} else {
					candidateCommands = parsed.report.candidateCommands;
					unknowns = parsed.report.unknowns;
				}
			} else if (latestReport) {
				ctx.warnings.push(`Latest report is missing: ${latestReport}`);
			}

			const gateMarkdown = ctx.readBundleFile("gate.md");
			const findings = gateMarkdown ? extractAdoptionGateFindings(gateMarkdown) : [];
			const metrics = gateMarkdown ? extractAdoptionGateMetrics(gateMarkdown) : [];
			return {
				kind: "adoption-next-actions",
				target: manifest.target || "unknown",
				bundleDir: ctx.bundleDir,
				outputPath: ctx.outputPath,
				latestReport: latestReport || null,
				gateDecision: manifest.gateDecision || "wait",
				nextSafeAction: manifest.nextSafeAction || MESSAGES.adoptionReviewBeforeChange,
				findings,
				metrics,
				requiredHarnessFiles: REQUIRED_HARNESS_FILES,
				optionalStarterWikiFiles: OPTIONAL_STARTER_WIKI_FILES,
				candidateCommands,
				unknowns,
				approvalGates: adoptionNextActionsApprovalGates(),
				boundaries: {
					...adoptionBundleBoundaries(),
					...(manifest.boundaries || {}),
				},
				errors: ctx.errors,
				warnings: ctx.warnings,
			};
		},
	});
}

module.exports = {
	adoptionBundleBoundaries,
	buildAdoptionBundleDiffFallbackContent,
	adoptionBundleErrorResult,
	bundleAdoptionArtifacts,
	extractAdoptionGateFindings,
	extractAdoptionGateMetrics,
	adoptionNextActionsApprovalGates,
	adoptionNextActionsErrorResult,
	writeAdoptionNextActions,
};
