"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
	auditProject,
} = require("./audit");

const {
	REPO_ROOT,
} = require("./constants");

const {
	pathExists,
	readText,
	relativeSlash,
	resolveTarget,
} = require("./fs-utils");

const {
	inspectMaintenance,
} = require("./maintenance");

const {
	scaffoldHarness,
} = require("./scaffold");

const {
	renderAdoptionReport,
	renderAdoptionReportDiff,
	renderAdoptionReportsIndex,
} = require("./adoption-artifact-composer");

const {
	inspectTeamDistribution,
	latestTeamVersion,
	updateTeamDistribution,
} = require("./team");

const {
	buildAdoptionAuditMetrics,
	parseAdoptionMetricsBlock,
} = require("./adoption-metrics");

const {
	extractMarkdownLinks,
	extractMarkdownListUnderSubheading,
	isInsideDirectory,
	slugify,
	timestampForFileName,
} = require("./text-utils");

const ADOPTION_COMPARE_METRICS = [
	["existingHarnessFiles", "Existing Amber starter files"],
	["missingHarnessFiles", "Missing Amber starter files"],
	["templateStarterFilesPresent", "Template starter files present"],
	["templateStarterFilesMissing", "Template starter files missing"],
	["existingDocs", "Existing docs"],
	["wikiLikeFiles", "Wiki-like files"],
	["conflicts", "Conflicts"],
	["staleDocs", "Stale docs"],
];

function uniqueAdoptionReportPath(targetRoot, outputDir) {
	const directory = path.resolve(outputDir);
	const baseName = `${slugify(path.basename(targetRoot))}-adoption-report-${timestampForFileName()}`;
	let candidate = path.join(directory, `${baseName}.md`);
	let counter = 2;

	while (pathExists(candidate)) {
		candidate = path.join(directory, `${baseName}-${counter}.md`);
		counter += 1;
	}

	return candidate;
}

function parseAdoptionReportMetadata(filePath) {
	const content = readText(filePath);
	const lines = content.split(/\r?\n/).slice(0, 40);
	if (
		!lines.some((line) => line.trim() === "# Amber Protocol Adoption Report")
	) {
		return null;
	}

	const targetLine = lines.find((line) => line.startsWith("Target:"));
	const generatedLine = lines.find((line) => line.startsWith("Generated:"));
	const fallbackGeneratedAt = fs.statSync(filePath).mtime.toISOString();
	const parsedGeneratedAt = generatedLine
		? generatedLine.replace(/^Generated:\s*/, "").trim()
		: "";
	const generatedAt = Number.isNaN(Date.parse(parsedGeneratedAt))
		? fallbackGeneratedAt
		: parsedGeneratedAt;

	return {
		file: path.resolve(filePath),
		target: targetLine
			? targetLine.replace(/^Target:\s*/, "").trim()
			: "unknown",
		generatedAt,
	};
}

function listAdoptionReports(options = {}) {
	const reportsDir = options.reportsDir ? path.resolve(options.reportsDir) : "";
	const errors = [];
	const warnings = [];
	const reports = [];

	if (!reportsDir) {
		errors.push("adoption list requires --reports-dir.");
		return {
			target: "n/a",
			reportsDir,
			reports,
			readOnlyReportsDir: true,
			errors,
			warnings,
		};
	}

	if (!pathExists(reportsDir) || !fs.statSync(reportsDir).isDirectory()) {
		errors.push(`Reports directory does not exist: ${reportsDir}`);
		return {
			target: reportsDir,
			reportsDir,
			reports,
			readOnlyReportsDir: true,
			errors,
			warnings,
		};
	}

	for (const entry of fs.readdirSync(reportsDir, { withFileTypes: true })) {
		if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
			continue;
		}

		const filePath = path.join(reportsDir, entry.name);
		const metadata = parseAdoptionReportMetadata(filePath);
		if (metadata) {
			reports.push(metadata);
		}
	}

	reports.sort((left, right) => {
		const byGeneratedAt =
			Date.parse(right.generatedAt) - Date.parse(left.generatedAt);
		if (byGeneratedAt !== 0) {
			return byGeneratedAt;
		}
		return left.file.localeCompare(right.file);
	});

	return {
		target: reportsDir,
		reportsDir,
		reports,
		readOnlyReportsDir: true,
		errors,
		warnings,
	};
}

function writeAdoptionReportsIndex(options = {}) {
	const reportsDir = options.reportsDir ? path.resolve(options.reportsDir) : "";
	const outputPath = options.output ? path.resolve(options.output) : "";
	const errors = [];
	const warnings = [];

	if (!reportsDir) {
		errors.push("adoption index requires --reports-dir.");
	}
	if (!outputPath) {
		errors.push("adoption index requires --output.");
	}
	if (outputPath && pathExists(outputPath)) {
		errors.push(`Index already exists: ${outputPath}`);
	}
	if (errors.length > 0) {
		return {
			target: reportsDir || "n/a",
			reportsDir,
			outputPath,
			reports: [],
			errors,
			warnings,
		};
	}

	const listing = listAdoptionReports({ reportsDir });
	if (listing.errors.length > 0) {
		return { ...listing, outputPath };
	}

	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(
		outputPath,
		renderAdoptionReportsIndex(listing, outputPath),
	);

	return {
		...listing,
		outputPath,
	};
}

function validateAdoptionReports(options = {}) {
	const reportsDir = options.reportsDir ? path.resolve(options.reportsDir) : "";
	const indexPath = options.index ? path.resolve(options.index) : "";
	const errors = [];
	const warnings = [];
	const invalidReports = [];
	const indexLinks = [];

	if (!reportsDir) {
		errors.push("adoption validate requires --reports-dir.");
		return {
			target: "n/a",
			reportsDir,
			indexPath,
			checkedIndex: Boolean(indexPath),
			valid: false,
			reports: [],
			invalidReports,
			indexLinks,
			readOnlyReportsDir: true,
			errors,
			warnings,
		};
	}

	const listing = listAdoptionReports({ reportsDir });
	errors.push(...listing.errors);
	warnings.push(...listing.warnings);

	if (errors.length === 0) {
		for (const entry of fs.readdirSync(reportsDir, { withFileTypes: true })) {
			if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
				continue;
			}

			const filePath = path.join(reportsDir, entry.name);
			if (indexPath && path.resolve(filePath) === indexPath) {
				continue;
			}
			if (!parseAdoptionReportMetadata(filePath)) {
				invalidReports.push(filePath);
				errors.push(`Invalid adoption report metadata: ${filePath}`);
			}
		}
	}

	if (indexPath) {
		if (!pathExists(indexPath)) {
			errors.push(`Index does not exist: ${indexPath}`);
		} else {
			const reportFiles = new Set(
				listing.reports.map((report) => path.resolve(report.file)),
			);
			for (const linkTarget of extractMarkdownLinks(readText(indexPath))) {
				const cleanTarget = linkTarget.split(/[?#]/)[0];
				const resolvedLink = path.resolve(path.dirname(indexPath), cleanTarget);
				indexLinks.push({ target: linkTarget, file: resolvedLink });

				if (!isInsideDirectory(reportsDir, resolvedLink)) {
					errors.push(
						`Index link points outside reports directory: ${linkTarget}`,
					);
				} else if (!pathExists(resolvedLink)) {
					errors.push(`Index link target does not exist: ${linkTarget}`);
				} else if (!reportFiles.has(resolvedLink)) {
					errors.push(
						`Index link target is not a valid adoption report: ${linkTarget}`,
					);
				}
			}

			for (const report of listing.reports) {
				if (
					!indexLinks.some(
						(link) => path.resolve(link.file) === path.resolve(report.file),
					)
				) {
					errors.push(`Index is missing report: ${path.basename(report.file)}`);
				}
			}
		}
	}

	return {
		...listing,
		target: reportsDir,
		indexPath,
		checkedIndex: Boolean(indexPath),
		valid: errors.length === 0,
		invalidReports,
		indexLinks,
		errors,
		warnings,
	};
}

function readAdoptionReportMetric(markdown, label) {
	const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = markdown.match(
		new RegExp(`^\\s*-\\s+${escapedLabel}:\\s+(.+?)\\s*$`, "im"),
	);
	if (!match) {
		return null;
	}

	const numeric = Number(match[1]);
	return Number.isNaN(numeric) ? match[1] : numeric;
}

function parseAdoptionReportForComparison(filePath) {
	const resolved = path.resolve(filePath);
	if (!pathExists(resolved)) {
		return { error: `Report does not exist: ${resolved}` };
	}

	const metadata = parseAdoptionReportMetadata(resolved);
	if (!metadata) {
		return { error: `Invalid adoption report metadata: ${resolved}` };
	}

	const markdown = readText(resolved);
	// Prefer the structured metrics block when present; fall back to prose-label
	// parsing for reports written before the block existed. The block is the
	// data contract, prose is presentation.
	const embedded = parseAdoptionMetricsBlock(markdown);
	const metrics = {};
	for (const [key, label] of ADOPTION_COMPARE_METRICS) {
		metrics[key] =
			embedded && key in embedded
				? embedded[key]
				: readAdoptionReportMetric(markdown, label);
	}

	const targetType = readAdoptionReportMetric(markdown, "Target type");

	return {
		report: {
			...metadata,
			targetType,
			metrics,
			candidateCommands: extractMarkdownListUnderSubheading(
				markdown,
				"Candidate Commands",
			),
			unknowns: extractMarkdownListUnderSubheading(markdown, "Unknowns"),
			rulePackDrift: readAdoptionReportMetric(markdown, "Rule-pack drift"),
			teamInstalled: readAdoptionReportMetric(markdown, "Installed"),
		},
	};
}

function compareStringLists(baseItems, headItems) {
	const baseSet = new Set(baseItems);
	const headSet = new Set(headItems);
	return {
		added: headItems.filter((item) => !baseSet.has(item)),
		removed: baseItems.filter((item) => !headSet.has(item)),
		unchanged: headItems.filter((item) => baseSet.has(item)),
	};
}

function buildMetricComparison(baseMetrics, headMetrics) {
	const metrics = {};
	for (const [key, label] of ADOPTION_COMPARE_METRICS) {
		const baseValue = baseMetrics[key];
		const headValue = headMetrics[key];
		metrics[key] = {
			label,
			base: baseValue,
			head: headValue,
			delta:
				typeof baseValue === "number" && typeof headValue === "number"
					? headValue - baseValue
					: null,
		};
	}
	return metrics;
}

function compareAdoptionReports(options = {}) {
	const reportsDir = options.reportsDir ? path.resolve(options.reportsDir) : "";
	const outputPath = options.output ? path.resolve(options.output) : "";
	const errors = [];
	const warnings = [];
	let basePath = options.base ? path.resolve(options.base) : "";
	let headPath = options.head ? path.resolve(options.head) : "";

	if (outputPath && pathExists(outputPath)) {
		errors.push(`Diff already exists: ${outputPath}`);
	}

	if (reportsDir && (!basePath || !headPath)) {
		const listing = listAdoptionReports({ reportsDir });
		errors.push(...listing.errors);
		warnings.push(...listing.warnings);
		if (listing.reports.length < 2) {
			errors.push(
				`Need at least two adoption reports to compare in: ${reportsDir}`,
			);
		} else {
			headPath = listing.reports[0].file;
			basePath = listing.reports[1].file;
		}
	}

	if (!basePath || !headPath) {
		errors.push(
			"adoption compare requires --reports-dir or both --base and --head.",
		);
	}

	if (errors.length > 0) {
		return {
			target: reportsDir || "n/a",
			reportsDir,
			outputPath,
			base: null,
			head: null,
			errors,
			warnings,
		};
	}

	const baseParsed = parseAdoptionReportForComparison(basePath);
	const headParsed = parseAdoptionReportForComparison(headPath);
	if (baseParsed.error) {
		errors.push(baseParsed.error);
	}
	if (headParsed.error) {
		errors.push(headParsed.error);
	}
	if (errors.length > 0) {
		return {
			target: reportsDir || "n/a",
			reportsDir,
			outputPath,
			base: null,
			head: null,
			errors,
			warnings,
		};
	}

	const base = baseParsed.report;
	const head = headParsed.report;
	const comparison = {
		target: head.target,
		reportsDir,
		outputPath,
		base: {
			file: base.file,
			target: base.target,
			generatedAt: base.generatedAt,
		},
		head: {
			file: head.file,
			target: head.target,
			generatedAt: head.generatedAt,
		},
		sameTarget: base.target === head.target,
		generatedOrder:
			Date.parse(head.generatedAt) >= Date.parse(base.generatedAt)
				? "head-after-base"
				: "head-before-base",
		metrics: buildMetricComparison(base.metrics, head.metrics),
		candidateCommands: compareStringLists(
			base.candidateCommands,
			head.candidateCommands,
		),
		unknowns: compareStringLists(base.unknowns, head.unknowns),
		statusChanges: {
			teamInstalled: {
				base: base.teamInstalled,
				head: head.teamInstalled,
				changed: base.teamInstalled !== head.teamInstalled,
			},
			rulePackDrift: {
				base: base.rulePackDrift,
				head: head.rulePackDrift,
				changed: base.rulePackDrift !== head.rulePackDrift,
			},
		},
		errors,
		warnings,
	};

	if (outputPath) {
		fs.mkdirSync(path.dirname(outputPath), { recursive: true });
		fs.writeFileSync(outputPath, renderAdoptionReportDiff(comparison));
	}

	return comparison;
}

function generateAdoptionReport(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const errors = [];
	const outputPath = (() => {
		if (options.output && options.outputDir) {
			errors.push("Use either --output or --output-dir, not both.");
			return path.resolve(options.output);
		}
		if (options.output) {
			return path.resolve(options.output);
		}
		if (options.outputDir) {
			return uniqueAdoptionReportPath(targetRoot, options.outputDir);
		}
		return path.join(
			REPO_ROOT,
			"docs",
			"examples",
			`${slugify(path.basename(targetRoot))}-adoption-report.md`,
		);
	})();
	const warnings = [];

	if (errors.length > 0) {
		return { target: targetRoot, reportPath: outputPath, errors, warnings };
	}

	if (pathExists(outputPath)) {
		errors.push(`Report already exists: ${outputPath}`);
		return { target: targetRoot, reportPath: outputPath, errors, warnings };
	}

	const audit = auditProject(targetRoot);
	const initDryRun =
		audit.auditMode === "product-repo"
			? {
					created: [],
					skipped: [],
					notApplicable: true,
					reason:
						"Product repository distributes starter scaffolds from templates/; root init is not applicable.",
				}
			: scaffoldHarness(targetRoot, { dryRun: true });
	const team = inspectTeamDistribution(targetRoot, options);
	let teamUpdatePreview = null;
	const previewVersion =
		team.installed && team.lock && team.registry
			? latestTeamVersion(team.registry)
			: null;
	if (previewVersion && team.registry.versions[previewVersion]) {
		teamUpdatePreview = updateTeamDistribution(targetRoot, {
			...options,
			version: previewVersion,
			dryRun: true,
		});
	}
	const maintenance = inspectMaintenance(targetRoot, options);

	errors.push(...(team.errors || []), ...(maintenance.errors || []));
	warnings.push(...(team.warnings || []), ...(maintenance.warnings || []));
	if (teamUpdatePreview) {
		errors.push(...(teamUpdatePreview.errors || []));
		warnings.push(...(teamUpdatePreview.warnings || []));
	}
	if (errors.length > 0) {
		return { target: targetRoot, reportPath: outputPath, errors, warnings };
	}

	const content = renderAdoptionReport({
		targetRoot,
		audit,
		initDryRun,
		team,
		teamUpdatePreview,
		maintenance,
	});
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, content);

	return {
		target: targetRoot,
		reportPath: outputPath,
		readOnlyTargetRoot: true,
		sections: [
			{ id: "audit", status: "included" },
			{ id: "init-dry-run", status: "included" },
			{ id: "team", status: "included" },
			{ id: "maintenance", status: "included" },
		],
		errors,
		warnings,
	};
}

module.exports = {
	ADOPTION_COMPARE_METRICS,
	buildAdoptionAuditMetrics,
	uniqueAdoptionReportPath,
	parseAdoptionReportMetadata,
	listAdoptionReports,
	writeAdoptionReportsIndex,
	validateAdoptionReports,
	readAdoptionReportMetric,
	parseAdoptionReportForComparison,
	compareStringLists,
	buildMetricComparison,
	compareAdoptionReports,
	generateAdoptionReport,
};
