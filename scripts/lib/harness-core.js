"use strict";

const fs = require("node:fs");
const path = require("node:path");

// __CORE_REQUIRES__
const {
	hasPluginManifestDirectory,
	doctorProductRepo,
	doctor,
} = require("./core/doctor");
const {
	validateProjectProfileData,
	inspectProjectProfile,
} = require("./core/profiles");
const {
	findLoopContract,
	buildLoopLedgerRecord,
	inspectLoopContract,
	dryRunLoopContract,
	recordLoopContract,
	inspectLoopLedger,
} = require("./core/loops");
const {
	validateWorkflowPackData,
	validateLoopContracts,
	describeLoopContracts,
	inspectLoopReadiness,
	validateWorkflowPackReferences,
	inspectWorkflowPack,
	inspectWorkflowPackReadiness,
} = require("./core/workflow-packs");
const {
	listWikiMarkdownFiles,
	detectStaleDocs,
	buildWikiLintCi,
	detectRulePackDrift,
	buildUpgradeAssistant,
	buildMigrationAssistant,
	extractEvolutionFindings,
	readRegressionProposal,
	extractRegressionProposals,
	inspectMaintenance,
	buildMaintenanceProposalContent,
	proposeMaintenance,
} = require("./core/maintenance");
const {
	resolveRegistryPath,
	validateTeamRegistryData,
	loadTeamRegistry,
	compareSemver,
	latestTeamVersion,
	findTeamVersion,
	teamStatePaths,
	summarizeTeamRegistry,
	buildCompatibilityMatrix,
	buildTeamLock,
	writeTeamSnapshot,
	loadTeamLock,
	inspectTeamDistribution,
	installTeamDistribution,
	diffArtifactLists,
	buildTeamUpdatePreview,
	updateTeamDistribution,
	pinTeamDistribution,
	rollbackTeamDistribution,
} = require("./core/team");
const {
	dispatchAgentTask,
	setAgentDispatchStatus,
	recordAgentReview,
} = require("./core/agent-orchestration");
const {
	prepareTaskExecution,
	inspectTaskResult,
	orchestrationPaths,
} = require("./core/task-execution");
const {
	buildPlanContent,
	scaffoldPlan,
	readPlanField,
	validatePlanGate,
	discoverStandards,
	reviewPlan,
	acceptPlan,
} = require("./core/planning");
const {
	loadManifest,
	requireManifestString,
	validateSkillsPath,
	validateCommonManifest,
	validateCodexManifest,
	validateManifests,
	classifyTarget,
} = require("./core/manifests");
const {
	detectCommands,
	detectToolingEvidence,
	addCandidateCommand,
	detectCandidateCommands,
	isLikelyDocumentation,
	listProjectDocs,
	isWikiLike,
	buildSuggestedPatches,
	buildAuditUnknowns,
	buildNextSafeCommand,
	auditProject,
	fileMentionsWiki,
	hasNextAction,
	hasVerificationCommand,
	validateHandoff,
} = require("./core/audit");
const {
	listTemplateFiles,
	copyTemplateFiles,
	scaffoldHarness,
	scaffoldWiki,
} = require("./core/scaffold");
const {
	loadFeatureList,
	findFeatureById,
	validateFeatureListData,
	validateFeatureListFile,
	validateContinuousImprovementStateFile,
	validateWiki,
} = require("./core/validators");
const {
	slugify,
	formatList,
	formatCommandList,
	timestampForFileName,
	escapeMarkdownTableCell,
	extractMarkdownLinks,
	isInsideDirectory,
	isExternalLink,
	stripAnchorAndQuery,
	getSectionBody,
	hasSectionWithBody,
	extractMarkdownListUnderSubheading,
} = require("./core/text-utils");
const {
	AUDIT_IGNORED_DIRECTORY_NAMES,
	resolveTarget,
	pathExists,
	readText,
	readJson,
	writeJson,
	walkFiles,
	isIgnoredAuditPath,
	walkProjectFiles,
	relativeSlash,
	repoRelativePath,
	fileContains,
} = require("./core/fs-utils");
const {
	REPO_ROOT,
	TEMPLATE_ROOT,
	DEFAULT_TEAM_REGISTRY,
	MINIMUM_HARNESS_FILES,
	OPTIONAL_STARTER_WIKI_FILES,
	REQUIRED_HARNESS_FILES,
	VALID_STATUSES,
	REQUIRED_HANDOFF_SECTIONS,
	WIKI_CONTEXT_STARTER_FILES,
	SEMVER_PATTERN,
} = require("./core/constants");


function buildAdoptionReportContent(parts) {
	const {
		targetRoot,
		audit,
		initDryRun,
		team,
		teamUpdatePreview,
		maintenance,
	} = parts;
	const lines = [
		"# Coding Harness Adoption Report",
		"",
		`Target: ${targetRoot}`,
		`Generated: ${new Date().toISOString()}`,
		"",
		"No target project files were initialized by this report.",
		"",
		"## Audit Summary",
		"",
		`- Read-only: ${audit.readOnly}`,
		`- Existing Harness files: ${audit.existing.length}`,
		`- Missing Harness files: ${audit.missing.length}`,
		`- Existing docs: ${audit.docs.length}`,
		`- Wiki-like files: ${audit.wikiLikeFiles.length}`,
		`- Conflicts: ${audit.conflicts.length}`,
		"",
		"### Candidate Commands",
		"",
		...formatCommandList(audit.candidateCommands, "none"),
		"",
		"### Unknowns",
		"",
		...formatList(audit.unknowns, "none"),
		"",
		"## Init Dry Run",
		"",
		`- Would create: ${initDryRun.created.length}`,
		`- Would skip: ${initDryRun.skipped.length}`,
		"",
		"### First Suggested Additions",
		"",
		...formatList(initDryRun.created.slice(0, 10), "none"),
		"",
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
			"- Suggested install: `node scripts/harness.js team install --target <target> --version 1.0.0 --preset safe-bootstrap`",
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
		`- node scripts/harness.js init --target ${JSON.stringify(targetRoot)} --dry-run`,
		`- node scripts/harness.js maintenance inspect --target ${JSON.stringify(targetRoot)} --json`,
		"",
	);

	return lines.join("\n");
}


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
		!lines.some((line) => line.trim() === "# Coding Harness Adoption Report")
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


function buildAdoptionReportsIndexContent(listing, outputPath) {
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
		return lines.join("\n");
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
	return lines.join("\n");
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
		buildAdoptionReportsIndexContent(listing, outputPath),
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

const ADOPTION_COMPARE_METRICS = [
	["existingHarnessFiles", "Existing Harness files"],
	["missingHarnessFiles", "Missing Harness files"],
	["existingDocs", "Existing docs"],
	["wikiLikeFiles", "Wiki-like files"],
	["conflicts", "Conflicts"],
	["staleDocs", "Stale docs"],
];

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
	const metrics = {};
	for (const [key, label] of ADOPTION_COMPARE_METRICS) {
		metrics[key] = readAdoptionReportMetric(markdown, label);
	}

	return {
		report: {
			...metadata,
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

function buildAdoptionReportDiffContent(comparison) {
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

	return lines.join("\n");
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
		fs.writeFileSync(outputPath, buildAdoptionReportDiffContent(comparison));
	}

	return comparison;
}

function adoptionGateFindings(report) {
	const findings = [];
	const missingHarnessFiles = report.metrics.missingHarnessFiles;
	const conflicts = report.metrics.conflicts;

	if (typeof missingHarnessFiles === "number" && missingHarnessFiles > 0) {
		findings.push({
			id: "missing-harness-files",
			severity: "wait",
			message: `${missingHarnessFiles} Harness files are still missing.`,
		});
	}

	if (typeof conflicts === "number" && conflicts > 0) {
		findings.push({
			id: "conflicts-present",
			severity: "wait",
			message: `${conflicts} conflicting files require manual review.`,
		});
	}

	if (report.candidateCommands.length > 0) {
		findings.push({
			id: "candidate-commands-unconfirmed",
			severity: "wait",
			message: `${report.candidateCommands.length} candidate command(s) require human confirmation.`,
		});
	}

	if (report.unknowns.length > 0) {
		findings.push({
			id: "unknowns-present",
			severity: "wait",
			message: `${report.unknowns.length} unknown(s) remain unresolved.`,
		});
	}

	return findings;
}

function buildAdoptionGateContent(gate) {
	const lines = [
		"# Adoption Gate Report",
		"",
		`Report: ${gate.report.file}`,
		`Target: ${gate.report.target}`,
		`Generated: ${gate.report.generatedAt}`,
		`Decision: ${gate.decision}`,
		"",
		"## Findings",
		"",
	];

	if (gate.findings.length === 0) {
		lines.push("- none");
	} else {
		for (const finding of gate.findings) {
			lines.push(`- ${finding.id}: ${finding.message}`);
		}
	}

	lines.push("", "## Metrics", "");
	for (const metric of Object.values(gate.metrics)) {
		lines.push(`- ${metric.label}: ${metric.value ?? "n/a"}`);
	}
	lines.push("");

	return lines.join("\n");
}

function gateAdoptionReport(options = {}) {
	const reportsDir = options.reportsDir ? path.resolve(options.reportsDir) : "";
	const outputPath = options.output ? path.resolve(options.output) : "";
	let reportPath = options.report ? path.resolve(options.report) : "";
	const errors = [];
	const warnings = [];

	if (outputPath && pathExists(outputPath)) {
		errors.push(`Gate report already exists: ${outputPath}`);
	}

	if (reportsDir && !reportPath) {
		const listing = listAdoptionReports({ reportsDir });
		errors.push(...listing.errors);
		warnings.push(...listing.warnings);
		if (listing.reports.length === 0) {
			errors.push(`No adoption reports found in: ${reportsDir}`);
		} else {
			reportPath = listing.reports[0].file;
		}
	}

	if (!reportPath) {
		errors.push("adoption gate requires --report or --reports-dir.");
	}

	if (errors.length > 0) {
		return {
			target: reportsDir || "n/a",
			reportsDir,
			outputPath,
			report: null,
			decision: "wait",
			findings: [],
			errors,
			warnings,
		};
	}

	const parsed = parseAdoptionReportForComparison(reportPath);
	if (parsed.error) {
		errors.push(parsed.error);
		return {
			target: reportsDir || "n/a",
			reportsDir,
			outputPath,
			report: null,
			decision: "wait",
			findings: [],
			errors,
			warnings,
		};
	}

	const report = parsed.report;
	const findings = adoptionGateFindings(report);
	const metrics = {};
	for (const [key, label] of ADOPTION_COMPARE_METRICS) {
		metrics[key] = { label, value: report.metrics[key] };
	}

	const gate = {
		target: report.target,
		reportsDir,
		outputPath,
		report: {
			file: report.file,
			target: report.target,
			generatedAt: report.generatedAt,
		},
		decision: findings.length === 0 ? "ready" : "wait",
		findings,
		metrics,
		candidateCommands: report.candidateCommands,
		unknowns: report.unknowns,
		errors,
		warnings,
	};

	if (outputPath) {
		fs.mkdirSync(path.dirname(outputPath), { recursive: true });
		fs.writeFileSync(outputPath, buildAdoptionGateContent(gate));
	}

	return gate;
}

function nextAdoptionStatusAction(status) {
	if (status.errors.length > 0) {
		return "Fix adoption status errors before sharing this summary.";
	}
	if (status.index.checked && !status.index.valid) {
		return "Fix adoption index links before relying on this status.";
	}
	if (status.gate.decision === "wait") {
		return "Review adoption gate findings before initializing or changing the target project.";
	}
	return "Ready for human approval of the next safe Harness action.";
}

function buildAdoptionStatusContent(status) {
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
		"## Blockers",
		"",
	];

	if (status.blockers.length === 0) {
		lines.push("- none");
	} else {
		for (const blocker of status.blockers) {
			lines.push(`- ${blocker.id}: ${blocker.message}`);
		}
	}

	lines.push("", "## Compare Summary", "");
	if (!status.compare) {
		lines.push("- Not enough reports to compare.");
	} else {
		lines.push(`- Base: ${status.compare.base.file}`);
		lines.push(`- Head: ${status.compare.head.file}`);
		lines.push(
			`- Missing Harness files delta: ${status.compare.metrics.missingHarnessFiles.delta ?? "n/a"}`,
		);
		lines.push(
			`- Candidate commands added: ${status.compare.candidateCommands.added.length}`,
		);
		lines.push(`- Unknowns removed: ${status.compare.unknowns.removed.length}`);
	}

	lines.push("");
	return lines.join("\n");
}

function statusAdoptionReports(options = {}) {
	const reportsDir = options.reportsDir ? path.resolve(options.reportsDir) : "";
	const indexPath = options.index ? path.resolve(options.index) : "";
	const outputPath = options.output ? path.resolve(options.output) : "";
	const errors = [];
	const warnings = [];

	if (!reportsDir) {
		errors.push("adoption status requires --reports-dir.");
	}
	if (outputPath && pathExists(outputPath)) {
		errors.push(`Status report already exists: ${outputPath}`);
	}
	if (errors.length > 0) {
		return {
			kind: "adoption-status",
			target: reportsDir || "n/a",
			reportsDir,
			outputPath,
			reports: { count: 0 },
			latestReport: null,
			index: { checked: Boolean(indexPath), valid: null, errors: [] },
			gate: { decision: "wait", findings: [] },
			compare: null,
			blockers: [],
			nextSafeAction: "Fix adoption status errors before sharing this summary.",
			errors,
			warnings,
		};
	}

	const listing = listAdoptionReports({ reportsDir });
	errors.push(...listing.errors);
	warnings.push(...listing.warnings);
	if (listing.reports.length === 0) {
		errors.push(`No adoption reports found in: ${reportsDir}`);
	}

	const latestReport = listing.reports[0] || null;
	const index = { checked: Boolean(indexPath), valid: null, errors: [] };
	if (indexPath) {
		const validation = validateAdoptionReports({
			reportsDir,
			index: indexPath,
		});
		index.valid = validation.errors.length === 0;
		index.errors = validation.errors;
		warnings.push(...validation.warnings);
	}

	const gate = latestReport
		? gateAdoptionReport({ report: latestReport.file })
		: { decision: "wait", findings: [] };
	warnings.push(...(gate.warnings || []));
	errors.push(...(gate.errors || []));

	let compare = null;
	if (listing.reports.length >= 2) {
		compare = compareAdoptionReports({ reportsDir });
		warnings.push(...(compare.warnings || []));
		errors.push(...(compare.errors || []));
	}

	const status = {
		kind: "adoption-status",
		target: latestReport ? latestReport.target : reportsDir,
		reportsDir,
		outputPath,
		reports: {
			count: listing.reports.length,
			files: listing.reports.map((report) => report.file),
		},
		latestReport,
		index,
		gate: {
			decision: gate.decision,
			findings: gate.findings || [],
		},
		compare,
		blockers: gate.findings || [],
		nextSafeAction: "",
		errors,
		warnings,
	};

	status.nextSafeAction = nextAdoptionStatusAction(status);

	if (outputPath && errors.length === 0) {
		fs.mkdirSync(path.dirname(outputPath), { recursive: true });
		fs.writeFileSync(outputPath, buildAdoptionStatusContent(status));
	}

	return status;
}

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

function adoptionDecisionRecordDecisions() {
	return [
		{
			id: "command-confirmation",
			title: "Gate A: Command Confirmation",
			status: "pending",
			decision: "Confirm, replace, or reject candidate verification commands.",
		},
		{
			id: "bootstrap-write",
			title: "Gate B: Bootstrap Write",
			status: "pending",
			decision:
				"Approve full init, selected manual patches, or keep the target read-only.",
		},
		{
			id: "wiki-scope",
			title: "Gate C: Wiki Scope",
			status: "pending",
			decision:
				"Choose required files only, required plus optional wiki starters, or defer wiki starters.",
		},
	];
}

const ADOPTION_DECISION_GATE_IDS = new Set([
	"command-confirmation",
	"bootstrap-write",
	"wiki-scope",
]);
const ADOPTION_DECISION_STATUSES = new Set([
	"pending",
	"approved",
	"rejected",
	"deferred",
]);

function applyAdoptionDecisionSpecs(decisions, specs) {
	const errors = [];
	const decisionById = new Map(
		decisions.map((decision) => [decision.id, decision]),
	);

	for (const spec of specs) {
		const raw = String(spec || "").trim();
		const separator = raw.indexOf("=");
		if (separator === -1) {
			errors.push(`Decision must use <gate>=<status>[:note]: ${raw}`);
			continue;
		}

		const gateId = raw.slice(0, separator).trim();
		const value = raw.slice(separator + 1).trim();
		const noteSeparator = value.indexOf(":");
		const status = (
			noteSeparator === -1 ? value : value.slice(0, noteSeparator)
		).trim();
		const note =
			noteSeparator === -1 ? "" : value.slice(noteSeparator + 1).trim();

		if (!ADOPTION_DECISION_GATE_IDS.has(gateId)) {
			errors.push(`Unknown decision gate: ${gateId}`);
			continue;
		}
		if (!ADOPTION_DECISION_STATUSES.has(status)) {
			errors.push(`Unknown decision status: ${status}`);
			continue;
		}

		const decision = decisionById.get(gateId);
		decision.status = status;
		if (note) {
			decision.note = note;
		}
	}

	return errors;
}

function adoptionDecisionApprovalStatus(decisions) {
	return decisions.some(
		(decision) => decision.status !== "pending" || decision.note,
	)
		? "recorded"
		: "pending";
}

function adoptionDecisionRecordErrorResult(fields, errors, warnings) {
	return {
		kind: "adoption-decision-record",
		target: fields.target || "n/a",
		bundleDir: fields.bundleDir || "",
		outputPath: fields.outputPath || "",
		latestReport: null,
		gateDecision: "wait",
		nextSafeAction:
			"Fix adoption decision-record errors before sharing this record.",
		approvalStatus: "pending",
		decisions: adoptionDecisionRecordDecisions(),
		findings: [],
		boundaries: adoptionBundleBoundaries(),
		errors,
		warnings,
	};
}

function buildAdoptionDecisionRecordContent(record) {
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
		"## Boundary",
		"",
		`- Target project files copied: ${record.boundaries.targetProjectFilesCopied}`,
		`- Target project commands executed: ${record.boundaries.targetProjectCommandsExecuted}`,
		`- Dynamic Workflow executed: ${record.boundaries.dynamicWorkflowExecuted}`,
		`- Live subagents invoked: ${record.boundaries.liveSubagentsInvoked}`,
		"",
		"## Gate Findings",
		"",
	];

	if (record.findings.length === 0) {
		lines.push("- none");
	} else {
		for (const finding of record.findings) {
			lines.push(`- ${finding.id}: ${finding.message}`);
		}
	}

	lines.push("", "## Decisions", "");
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
		"- Keep this record pending if the target project should remain read-only.",
		"",
		"This record does not approve target writes or command execution by itself.",
		"",
	);

	return lines.join("\n");
}

function writeAdoptionDecisionRecord(options = {}) {
	const bundleDir = options.bundleDir ? path.resolve(options.bundleDir) : "";
	const outputPath = options.output ? path.resolve(options.output) : "";
	const errors = [];
	const warnings = [];

	if (!bundleDir) {
		errors.push("adoption decision-record requires --bundle-dir.");
	}
	if (!outputPath) {
		errors.push("adoption decision-record requires --output.");
	}
	if (
		bundleDir &&
		(!pathExists(bundleDir) || !fs.statSync(bundleDir).isDirectory())
	) {
		errors.push(`Bundle directory does not exist: ${bundleDir}`);
	}
	if (outputPath && pathExists(outputPath)) {
		errors.push(`Decision record already exists: ${outputPath}`);
	}
	if (errors.length > 0) {
		return adoptionDecisionRecordErrorResult(
			{ bundleDir, outputPath },
			errors,
			warnings,
		);
	}

	const manifestPath = path.join(bundleDir, "manifest.json");
	if (!pathExists(manifestPath)) {
		errors.push(`Bundle manifest is missing: ${manifestPath}`);
		return adoptionDecisionRecordErrorResult(
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
		return adoptionDecisionRecordErrorResult(
			{ bundleDir, outputPath },
			errors,
			warnings,
		);
	}

	const gatePath = path.join(bundleDir, "gate.md");
	const gateMarkdown = pathExists(gatePath) ? readText(gatePath) : "";
	const decisions = adoptionDecisionRecordDecisions();
	const decisionSpecs = Array.isArray(options.decisions)
		? options.decisions
		: options.decision
			? [options.decision]
			: [];
	errors.push(...applyAdoptionDecisionSpecs(decisions, decisionSpecs));
	if (errors.length > 0) {
		return adoptionDecisionRecordErrorResult(
			{ target: manifest.target, bundleDir, outputPath },
			errors,
			warnings,
		);
	}

	const record = {
		kind: "adoption-decision-record",
		target: manifest.target || "unknown",
		bundleDir,
		outputPath,
		latestReport: manifest.latestReport || null,
		gateDecision: manifest.gateDecision || "wait",
		nextSafeAction:
			manifest.nextSafeAction ||
			"Review adoption gate findings before initializing or changing the target project.",
		approvalStatus: adoptionDecisionApprovalStatus(decisions),
		decisions,
		findings: gateMarkdown ? extractAdoptionGateFindings(gateMarkdown) : [],
		boundaries: {
			...adoptionBundleBoundaries(),
			...(manifest.boundaries || {}),
		},
		errors,
		warnings,
	};

	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, buildAdoptionDecisionRecordContent(record));

	return record;
}

function adoptionApplyPlanBoundaries() {
	return {
		targetProjectFilesWritten: false,
		targetProjectCommandsExecuted: false,
		dynamicWorkflowExecuted: false,
		liveSubagentsInvoked: false,
	};
}

function adoptionApplyPlanErrorResult(fields, errors, warnings) {
	return {
		kind: "adoption-apply-plan",
		target: fields.target || "n/a",
		bundleDir: fields.bundleDir || "",
		outputPath: fields.outputPath || "",
		dryRun: Boolean(fields.dryRun),
		gateDecision: "wait",
		applyReady: false,
		preview: { created: [], skipped: [] },
		requiredHarnessFiles: REQUIRED_HARNESS_FILES,
		optionalStarterWikiFiles: OPTIONAL_STARTER_WIKI_FILES,
		boundaries: adoptionApplyPlanBoundaries(),
		errors,
		warnings,
	};
}

function buildAdoptionApplyPlanContent(plan) {
	const lines = [
		"# Adoption Apply Plan",
		"",
		`Target: ${plan.target}`,
		`Bundle: ${plan.bundleDir}`,
		`Gate decision: ${plan.gateDecision}`,
		`Dry run: ${plan.dryRun}`,
		`Apply ready: ${plan.applyReady}`,
		"",
		"## Boundary",
		"",
		`- Target project files written: ${plan.boundaries.targetProjectFilesWritten}`,
		`- Target project commands executed: ${plan.boundaries.targetProjectCommandsExecuted}`,
		`- Dynamic Workflow executed: ${plan.boundaries.dynamicWorkflowExecuted}`,
		`- Live subagents invoked: ${plan.boundaries.liveSubagentsInvoked}`,
		"",
		"## Created Preview",
		"",
	];

	if (plan.preview.created.length === 0) {
		lines.push("- none");
	} else {
		for (const item of plan.preview.created) {
			lines.push(`- ${item}`);
		}
	}

	lines.push("", "## Skipped Existing Files", "");
	if (plan.preview.skipped.length === 0) {
		lines.push("- none");
	} else {
		for (const item of plan.preview.skipped) {
			lines.push(`- ${item}`);
		}
	}

	lines.push("", "## Required Harness Files", "");
	for (const item of plan.requiredHarnessFiles) {
		lines.push(`- ${item}`);
	}

	lines.push("", "## Optional Starter Wiki Files", "");
	for (const item of plan.optionalStarterWikiFiles) {
		lines.push(`- ${item}`);
	}

	lines.push(
		"",
		"## Required User Action",
		"",
		"- Review this dry-run plan before approving any target write.",
		"- Run a separate approved command for any future non-dry-run target change.",
		"- Treat target command execution as a separate approval step.",
		"",
		"This plan does not write target files or run target commands.",
		"",
	);

	return lines.join("\n");
}

function writeAdoptionApplyPlan(options = {}) {
	const bundleDir = options.bundleDir ? path.resolve(options.bundleDir) : "";
	const outputPath = options.output ? path.resolve(options.output) : "";
	const dryRun = options.dryRun === true;
	const errors = [];
	const warnings = [];

	if (!bundleDir) {
		errors.push("adoption apply-plan requires --bundle-dir.");
	}
	if (!outputPath) {
		errors.push("adoption apply-plan requires --output.");
	}
	if (!dryRun) {
		errors.push("adoption apply-plan requires --dry-run in V1.");
	}
	if (
		bundleDir &&
		(!pathExists(bundleDir) || !fs.statSync(bundleDir).isDirectory())
	) {
		errors.push(`Bundle directory does not exist: ${bundleDir}`);
	}
	if (outputPath && pathExists(outputPath)) {
		errors.push(`Apply plan already exists: ${outputPath}`);
	}
	if (errors.length > 0) {
		return adoptionApplyPlanErrorResult(
			{ bundleDir, outputPath, dryRun },
			errors,
			warnings,
		);
	}

	const manifestPath = path.join(bundleDir, "manifest.json");
	if (!pathExists(manifestPath)) {
		errors.push(`Bundle manifest is missing: ${manifestPath}`);
		return adoptionApplyPlanErrorResult(
			{ bundleDir, outputPath, dryRun },
			errors,
			warnings,
		);
	}

	let manifest;
	try {
		manifest = readJson(manifestPath);
	} catch (error) {
		errors.push(`Cannot read bundle manifest: ${error.message}`);
		return adoptionApplyPlanErrorResult(
			{ bundleDir, outputPath, dryRun },
			errors,
			warnings,
		);
	}

	if (!manifest.target) {
		errors.push("Bundle manifest must include target.");
		return adoptionApplyPlanErrorResult(
			{ bundleDir, outputPath, dryRun },
			errors,
			warnings,
		);
	}

	const preview = scaffoldHarness(manifest.target, { dryRun: true });
	const plan = {
		kind: "adoption-apply-plan",
		target: path.resolve(manifest.target),
		bundleDir,
		outputPath,
		dryRun: true,
		gateDecision: manifest.gateDecision || "wait",
		applyReady: false,
		preview: {
			created: preview.created,
			skipped: preview.skipped,
		},
		requiredHarnessFiles: REQUIRED_HARNESS_FILES,
		optionalStarterWikiFiles: OPTIONAL_STARTER_WIKI_FILES,
		boundaries: adoptionApplyPlanBoundaries(),
		errors,
		warnings,
	};

	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, buildAdoptionApplyPlanContent(plan));

	return plan;
}

function adoptionSelectedFilesBoundaries() {
	return {
		targetProjectFilesWritten: false,
		targetProjectCommandsExecuted: false,
		dynamicWorkflowExecuted: false,
		liveSubagentsInvoked: false,
	};
}

function isSafeSelectableHarnessPath(filePath) {
	const normalized = String(filePath || "").replace(/\\/g, "/");
	const segments = normalized.split("/").filter(Boolean);
	return (
		normalized === filePath &&
		normalized.length > 0 &&
		!path.win32.isAbsolute(filePath) &&
		!path.posix.isAbsolute(filePath) &&
		!segments.includes("..")
	);
}

function adoptionSelectedFilesErrorResult(fields, errors, warnings) {
	return {
		kind: "adoption-selected-files",
		target: fields.target || "n/a",
		bundleDir: fields.bundleDir || "",
		outputPath: fields.outputPath || "",
		selectedFiles: [],
		requiredSelected: [],
		optionalSelected: [],
		supportSelected: [],
		requiredHarnessFiles: REQUIRED_HARNESS_FILES,
		optionalStarterWikiFiles: OPTIONAL_STARTER_WIKI_FILES,
		boundaries: adoptionSelectedFilesBoundaries(),
		errors,
		warnings,
	};
}

function buildAdoptionSelectedFilesContent(proposal) {
	const selected = new Set(proposal.selectedFiles);
	const lines = [
		"# Adoption Selected Files Proposal",
		"",
		`Target: ${proposal.target}`,
		`Bundle: ${proposal.bundleDir}`,
		`Selected files: ${proposal.selectedFiles.length}`,
		"",
		"## Boundary",
		"",
		`- Target project files written: ${proposal.boundaries.targetProjectFilesWritten}`,
		`- Target project commands executed: ${proposal.boundaries.targetProjectCommandsExecuted}`,
		`- Dynamic Workflow executed: ${proposal.boundaries.dynamicWorkflowExecuted}`,
		`- Live subagents invoked: ${proposal.boundaries.liveSubagentsInvoked}`,
		"",
		"## Selected Files",
		"",
	];

	if (proposal.selectedFiles.length === 0) {
		lines.push("- none");
	} else {
		for (const filePath of proposal.selectedFiles) {
			lines.push(`- ${filePath}`);
		}
	}

	lines.push("", "## Required Harness Files", "");
	for (const filePath of proposal.requiredHarnessFiles) {
		lines.push(`- [${selected.has(filePath) ? "x" : " "}] ${filePath}`);
	}

	lines.push("", "## Optional Starter Wiki Files", "");
	for (const filePath of proposal.optionalStarterWikiFiles) {
		lines.push(`- [${selected.has(filePath) ? "x" : " "}] ${filePath}`);
	}

	if (proposal.supportFiles.length > 0) {
		lines.push("", "## Support Files", "");
		for (const filePath of proposal.supportFiles) {
			lines.push(`- [${selected.has(filePath) ? "x" : " "}] ${filePath}`);
		}
	}

	lines.push(
		"",
		"## Required User Action",
		"",
		"- Review selected files before approving any target write.",
		"- Generate a new apply-plan dry-run after changing selected files.",
		"- Treat target writes and target command execution as separate approval steps.",
		"",
		"This proposal does not write target files or run target commands.",
		"",
	);

	return lines.join("\n");
}

function writeAdoptionSelectedFiles(options = {}) {
	const bundleDir = options.bundleDir ? path.resolve(options.bundleDir) : "";
	const outputPath = options.output ? path.resolve(options.output) : "";
	const included = Array.isArray(options.includes)
		? options.includes
		: options.include
			? [options.include]
			: [];
	const selectedFiles = [
		...new Set(
			included.map((item) => String(item || "").trim()).filter(Boolean),
		),
	];
	const errors = [];
	const warnings = [];

	if (!bundleDir) {
		errors.push("adoption selected-files requires --bundle-dir.");
	}
	if (!outputPath) {
		errors.push("adoption selected-files requires --output.");
	}
	if (
		bundleDir &&
		(!pathExists(bundleDir) || !fs.statSync(bundleDir).isDirectory())
	) {
		errors.push(`Bundle directory does not exist: ${bundleDir}`);
	}
	if (outputPath && pathExists(outputPath)) {
		errors.push(`Selected-files proposal already exists: ${outputPath}`);
	}
	if (errors.length > 0) {
		return adoptionSelectedFilesErrorResult(
			{ bundleDir, outputPath },
			errors,
			warnings,
		);
	}

	const manifestPath = path.join(bundleDir, "manifest.json");
	if (!pathExists(manifestPath)) {
		errors.push(`Bundle manifest is missing: ${manifestPath}`);
		return adoptionSelectedFilesErrorResult(
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
		return adoptionSelectedFilesErrorResult(
			{ bundleDir, outputPath },
			errors,
			warnings,
		);
	}

	const templateFiles = listTemplateFiles()
		.map((item) => item.relativePath)
		.sort();
	const selectable = new Set(templateFiles);
	for (const filePath of selectedFiles) {
		if (!isSafeSelectableHarnessPath(filePath)) {
			errors.push(`Unsafe selected file path: ${filePath}`);
		} else if (!selectable.has(filePath)) {
			errors.push(`Unknown selected file: ${filePath}`);
		}
	}
	if (errors.length > 0) {
		return adoptionSelectedFilesErrorResult(
			{ target: manifest.target, bundleDir, outputPath },
			errors,
			warnings,
		);
	}

	const requiredSet = new Set(REQUIRED_HARNESS_FILES);
	const optionalSet = new Set(OPTIONAL_STARTER_WIKI_FILES);
	const supportFiles = templateFiles.filter(
		(filePath) => !requiredSet.has(filePath) && !optionalSet.has(filePath),
	);
	const proposal = {
		kind: "adoption-selected-files",
		target: manifest.target || "unknown",
		bundleDir,
		outputPath,
		selectedFiles,
		requiredSelected: selectedFiles.filter((filePath) =>
			requiredSet.has(filePath),
		),
		optionalSelected: selectedFiles.filter((filePath) =>
			optionalSet.has(filePath),
		),
		supportSelected: selectedFiles.filter(
			(filePath) => !requiredSet.has(filePath) && !optionalSet.has(filePath),
		),
		requiredHarnessFiles: REQUIRED_HARNESS_FILES,
		optionalStarterWikiFiles: OPTIONAL_STARTER_WIKI_FILES,
		supportFiles,
		boundaries: adoptionSelectedFilesBoundaries(),
		errors,
		warnings,
	};

	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, buildAdoptionSelectedFilesContent(proposal));

	return proposal;
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
	const initDryRun = scaffoldHarness(targetRoot, { dryRun: true });
	const team = inspectTeamDistribution(targetRoot, options);
	let teamUpdatePreview = null;
	if (team.installed && team.lock && team.registry.versions["1.1.0"]) {
		teamUpdatePreview = updateTeamDistribution(targetRoot, {
			...options,
			version: "1.1.0",
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

	const content = buildAdoptionReportContent({
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


function parseArgs(argv) {
	const args = { target: process.cwd(), json: false, dryRun: false };

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--target") {
			args.target = argv[index + 1];
			index += 1;
		} else if (arg === "--goal") {
			args.goal = argv[index + 1];
			index += 1;
		} else if (arg === "--route") {
			args.route = argv[index + 1];
			index += 1;
		} else if (arg === "--budget") {
			args.budget = argv[index + 1];
			index += 1;
		} else if (arg === "--worktree") {
			args.worktree = true;
		} else if (arg === "--mode") {
			args.mode = argv[index + 1];
			index += 1;
		} else if (arg === "--feature") {
			args.feature = argv[index + 1];
			index += 1;
		} else if (arg === "--title") {
			args.title = argv[index + 1];
			index += 1;
		} else if (arg === "--plan") {
			args.plan = argv[index + 1];
			index += 1;
		} else if (arg === "--file") {
			args.file = argv[index + 1];
			index += 1;
		} else if (arg === "--task") {
			args.task = argv[index + 1];
			index += 1;
		} else if (arg === "--worker") {
			args.worker = argv[index + 1];
			index += 1;
		} else if (arg === "--reviewer") {
			args.reviewer = argv[index + 1];
			index += 1;
		} else if (arg === "--backend") {
			args.backend = argv[index + 1];
			index += 1;
		} else if (arg === "--concurrency") {
			args.concurrency = argv[index + 1];
			index += 1;
		} else if (arg === "--decision") {
			args.decision = argv[index + 1];
			if (!Array.isArray(args.decisions)) {
				args.decisions = [];
			}
			args.decisions.push(argv[index + 1]);
			index += 1;
		} else if (arg === "--evidence") {
			args.evidence = argv[index + 1];
			index += 1;
		} else if (arg === "--version") {
			args.version = argv[index + 1];
			index += 1;
		} else if (arg === "--preset") {
			args.preset = argv[index + 1];
			index += 1;
		} else if (arg === "--registry") {
			args.registry = argv[index + 1];
			index += 1;
		} else if (arg === "--output") {
			args.output = argv[index + 1];
			index += 1;
		} else if (arg === "--output-dir") {
			args.outputDir = argv[index + 1];
			index += 1;
		} else if (arg === "--bundle-dir") {
			args.bundleDir = argv[index + 1];
			index += 1;
		} else if (arg === "--include") {
			args.include = argv[index + 1];
			if (!Array.isArray(args.includes)) {
				args.includes = [];
			}
			args.includes.push(argv[index + 1]);
			index += 1;
		} else if (arg === "--report") {
			args.report = argv[index + 1];
			index += 1;
		} else if (arg === "--base") {
			args.base = argv[index + 1];
			index += 1;
		} else if (arg === "--head") {
			args.head = argv[index + 1];
			index += 1;
		} else if (arg === "--index") {
			args.index = argv[index + 1];
			index += 1;
		} else if (arg === "--reports-dir") {
			args.reportsDir = argv[index + 1];
			index += 1;
		} else if (arg === "--trace-input") {
			args.traceInput = argv[index + 1];
			index += 1;
		} else if (arg === "--agent-config") {
			args.agentConfig = argv[index + 1];
			index += 1;
		} else if (arg === "--regression-assertion") {
			args.regressionAssertion = argv[index + 1];
			index += 1;
		} else if (arg === "--loop-contract") {
			args.loopContract = argv[index + 1];
			index += 1;
		} else if (arg === "--contract") {
			args.contract = argv[index + 1];
			index += 1;
		} else if (arg === "--ledger") {
			args.ledger = argv[index + 1];
			index += 1;
		} else if (arg === "--trigger-source") {
			args.triggerSource = argv[index + 1];
			index += 1;
		} else if (arg === "--stop-reason") {
			args.stopReason = argv[index + 1];
			index += 1;
		} else if (arg === "--hard-stop-status") {
			args.hardStopStatus = argv[index + 1];
			index += 1;
		} else if (arg === "--budget-status") {
			args.budgetStatus = argv[index + 1];
			index += 1;
		} else if (arg === "--review-bandwidth-status") {
			args.reviewBandwidthStatus = argv[index + 1];
			index += 1;
		} else if (arg === "--review-gate-status") {
			args.reviewGateStatus = argv[index + 1];
			index += 1;
		} else if (arg === "--json") {
			args.json = true;
		} else if (arg === "--dry-run") {
			args.dryRun = true;
		} else if (arg === "--confirm") {
			args.confirm = true;
		} else if (arg === "--summary") {
			args.summary = true;
		} else if (arg === "--help" || arg === "-h") {
			args.help = true;
		} else {
			args._ = args._ || [];
			args._.push(arg);
		}
	}

	return args;
}

function printAuditSummary(result) {
	console.log(`Audit summary: ${result.target}`);
	console.log(`Read-only: ${result.readOnly}`);
	console.log(`Existing Harness files: ${result.existing.length}`);
	console.log(`Missing Harness files: ${result.missing.length}`);
	console.log(
		`Suggested additions: ${Array.isArray(result.suggestedAdditions) ? result.suggestedAdditions.length : 0}`,
	);
	console.log(
		`Existing docs: ${Array.isArray(result.docs) ? result.docs.length : 0}`,
	);
	console.log(
		`Wiki-like files: ${Array.isArray(result.wikiLikeFiles) ? result.wikiLikeFiles.length : 0}`,
	);
	console.log(
		`Conflicts: ${Array.isArray(result.conflicts) ? result.conflicts.length : 0}`,
	);

	if (Array.isArray(result.commands) && result.commands.length > 0) {
		console.log("Detected commands:");
		for (const command of result.commands) {
			console.log(
				`  - ${command.source}: ${command.name} -> ${command.command}`,
			);
		}
	}

	if (
		Array.isArray(result.candidateCommands) &&
		result.candidateCommands.length > 0
	) {
		console.log("Candidate commands requiring confirmation:");
		for (const command of result.candidateCommands) {
			console.log(
				`  - ${command.source}: ${command.name} -> ${command.command}`,
			);
		}
	}

	if (
		Array.isArray(result.toolingEvidence) &&
		result.toolingEvidence.length > 0
	) {
		console.log("Tooling evidence:");
		for (const item of result.toolingEvidence) {
			console.log(`  - ${item.source}: ${item.name}`);
		}
	}

	if (Array.isArray(result.unknowns)) {
		console.log("Unknowns:");
		if (result.unknowns.length === 0) {
			console.log("  - none");
		} else {
			for (const item of result.unknowns) {
				console.log(`  - ${item}`);
			}
		}
	}

	if (typeof result.nextSafeCommand === "string") {
		console.log(`Next safe command: ${result.nextSafeCommand}`);
	}
}

function printResult(result, options = {}) {
	if (options.json) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}

	if (Array.isArray(result.created)) {
		const skipped = Array.isArray(result.skipped) ? result.skipped : [];
		console.log(`Target: ${result.target}`);
		console.log(`Created: ${result.created.length}`);
		for (const item of result.created) {
			console.log(`  + ${item}`);
		}
		console.log(`Skipped: ${skipped.length}`);
		for (const item of skipped) {
			console.log(`  - ${item}`);
		}
		if (Array.isArray(result.errors)) {
			if (result.errors.length === 0) {
				console.log("Errors: 0");
			} else {
				console.log(`Errors: ${result.errors.length}`);
				for (const error of result.errors) {
					console.log(`  - ${error}`);
				}
			}
		}
		if (Array.isArray(result.warnings) && result.warnings.length > 0) {
			console.log(`Warnings: ${result.warnings.length}`);
			for (const warning of result.warnings) {
				console.log(`  - ${warning}`);
			}
		}
		return;
	}

	if (Array.isArray(result.missing)) {
		if (options.summary) {
			printAuditSummary(result);
			return;
		}
		console.log(`Target: ${result.target}`);
		console.log(`Read-only: ${result.readOnly}`);
		console.log(`Existing Harness files: ${result.existing.length}`);
		console.log(`Missing Harness files: ${result.missing.length}`);
		for (const item of result.missing) {
			console.log(`  - ${item}`);
		}
		if (
			Array.isArray(result.suggestedAdditions) &&
			result.suggestedAdditions.length > 0
		) {
			console.log("Suggested additions:");
			for (const item of result.suggestedAdditions) {
				console.log(`  - ${item}`);
			}
		}
		if (result.commands.length > 0) {
			console.log("Detected commands:");
			for (const command of result.commands) {
				console.log(
					`  - ${command.source}: ${command.name} -> ${command.command}`,
				);
			}
		}
		if (
			Array.isArray(result.candidateCommands) &&
			result.candidateCommands.length > 0
		) {
			console.log("Candidate commands requiring confirmation:");
			for (const command of result.candidateCommands) {
				console.log(
					`  - ${command.source}: ${command.name} -> ${command.command}`,
				);
			}
		}
		if (
			Array.isArray(result.toolingEvidence) &&
			result.toolingEvidence.length > 0
		) {
			console.log("Tooling evidence:");
			for (const item of result.toolingEvidence) {
				console.log(`  - ${item.source}: ${item.name}`);
			}
		}
		if (Array.isArray(result.docs) && result.docs.length > 0) {
			console.log("Existing docs:");
			for (const item of result.docs) {
				console.log(`  - ${item}`);
			}
		}
		if (
			Array.isArray(result.wikiLikeFiles) &&
			result.wikiLikeFiles.length > 0
		) {
			console.log("Wiki-like files:");
			for (const item of result.wikiLikeFiles) {
				console.log(`  - ${item}`);
			}
		}
		if (
			Array.isArray(result.suggestedPatches) &&
			result.suggestedPatches.length > 0
		) {
			console.log("Suggested patches requiring approval:");
			for (const patch of result.suggestedPatches) {
				console.log(`  - ${patch.file}: ${patch.suggestion}`);
			}
		}
		if (Array.isArray(result.unknowns)) {
			console.log("Unknowns:");
			if (result.unknowns.length === 0) {
				console.log("  - none");
			} else {
				for (const item of result.unknowns) {
					console.log(`  - ${item}`);
				}
			}
		}
		if (result.conflicts.length > 0) {
			console.log("Files that will not be touched:");
			for (const item of result.conflicts) {
				console.log(`  - ${item}`);
			}
		}
		if (typeof result.nextSafeCommand === "string") {
			console.log(`Next safe command: ${result.nextSafeCommand}`);
		}
		return;
	}

	if (Array.isArray(result.reports)) {
		console.log(`Reports directory: ${result.reportsDir || "n/a"}`);
		if (result.outputPath) {
			console.log(`Index: ${result.outputPath}`);
		}
		if (result.indexPath) {
			console.log(`Index: ${result.indexPath}`);
		}
		if (typeof result.valid === "boolean") {
			console.log(`Valid: ${result.valid}`);
			console.log(`Index checked: ${result.checkedIndex}`);
		}
		console.log(`Reports: ${result.reports.length}`);
		for (const report of result.reports) {
			console.log(
				`  - ${report.generatedAt}: ${path.basename(report.file)} -> ${report.target}`,
			);
		}
		if (Array.isArray(result.errors) && result.errors.length > 0) {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		} else {
			console.log("Errors: 0");
		}
		if (Array.isArray(result.warnings) && result.warnings.length > 0) {
			console.log(`Warnings: ${result.warnings.length}`);
			for (const warning of result.warnings) {
				console.log(`  - ${warning}`);
			}
		}
		return;
	}

	if (result.base && result.head && result.metrics) {
		console.log(`Base: ${result.base.file}`);
		console.log(`Head: ${result.head.file}`);
		console.log(`Same target: ${result.sameTarget}`);
		if (result.outputPath) {
			console.log(`Diff: ${result.outputPath}`);
		}
		console.log("Metric deltas:");
		for (const metric of Object.values(result.metrics)) {
			console.log(
				`  - ${metric.label}: ${metric.base ?? "n/a"} -> ${metric.head ?? "n/a"} (${metric.delta ?? "n/a"})`,
			);
		}
		console.log(
			`Candidate commands added: ${result.candidateCommands.added.length}`,
		);
		console.log(`Unknowns removed: ${result.unknowns.removed.length}`);
		if (Array.isArray(result.errors) && result.errors.length > 0) {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		} else {
			console.log("Errors: 0");
		}
		return;
	}

	if (result.report && result.decision && Array.isArray(result.findings)) {
		console.log(`Report: ${result.report.file}`);
		console.log(`Target: ${result.report.target}`);
		console.log(`Decision: ${result.decision}`);
		if (result.outputPath) {
			console.log(`Gate report: ${result.outputPath}`);
		}
		console.log(`Findings: ${result.findings.length}`);
		for (const finding of result.findings) {
			console.log(`  - ${finding.id}: ${finding.message}`);
		}
		if (Array.isArray(result.errors) && result.errors.length > 0) {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		} else {
			console.log("Errors: 0");
		}
		return;
	}

	if (result.kind === "adoption-selected-files") {
		console.log(`Output: ${result.outputPath || "n/a"}`);
		console.log(`Target: ${result.target || "n/a"}`);
		console.log(`Bundle directory: ${result.bundleDir || "n/a"}`);
		console.log(
			`Selected files: ${Array.isArray(result.selectedFiles) ? result.selectedFiles.length : 0}`,
		);
		console.log(
			`Required selected: ${Array.isArray(result.requiredSelected) ? result.requiredSelected.length : 0}`,
		);
		console.log(
			`Optional selected: ${Array.isArray(result.optionalSelected) ? result.optionalSelected.length : 0}`,
		);
		if (Array.isArray(result.errors) && result.errors.length > 0) {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		} else {
			console.log("Errors: 0");
		}
		return;
	}

	if (result.kind === "adoption-apply-plan") {
		console.log(`Output: ${result.outputPath || "n/a"}`);
		console.log(`Target: ${result.target || "n/a"}`);
		console.log(`Bundle directory: ${result.bundleDir || "n/a"}`);
		console.log(`Dry run: ${result.dryRun}`);
		console.log(`Apply ready: ${result.applyReady}`);
		console.log(
			`Created preview: ${result.preview ? result.preview.created.length : 0}`,
		);
		console.log(
			`Skipped existing: ${result.preview ? result.preview.skipped.length : 0}`,
		);
		if (Array.isArray(result.errors) && result.errors.length > 0) {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		} else {
			console.log("Errors: 0");
		}
		return;
	}

	if (result.kind === "adoption-decision-record") {
		console.log(`Output: ${result.outputPath || "n/a"}`);
		console.log(`Target: ${result.target || "n/a"}`);
		console.log(`Bundle directory: ${result.bundleDir || "n/a"}`);
		console.log(`Gate decision: ${result.gateDecision}`);
		console.log(`Approval status: ${result.approvalStatus}`);
		console.log(
			`Decisions: ${Array.isArray(result.decisions) ? result.decisions.length : 0}`,
		);
		if (Array.isArray(result.decisions)) {
			for (const decision of result.decisions) {
				console.log(`  - ${decision.id}: ${decision.status}`);
			}
		}
		if (Array.isArray(result.errors) && result.errors.length > 0) {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		} else {
			console.log("Errors: 0");
		}
		return;
	}

	if (result.kind === "adoption-next-actions") {
		console.log(`Output: ${result.outputPath || "n/a"}`);
		console.log(`Target: ${result.target || "n/a"}`);
		console.log(`Bundle directory: ${result.bundleDir || "n/a"}`);
		console.log(`Gate decision: ${result.gateDecision}`);
		console.log(
			`Approval gates: ${Array.isArray(result.approvalGates) ? result.approvalGates.length : 0}`,
		);
		if (Array.isArray(result.approvalGates)) {
			for (const gate of result.approvalGates) {
				console.log(`  - ${gate.id}: ${gate.question}`);
			}
		}
		if (Array.isArray(result.errors) && result.errors.length > 0) {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		} else {
			console.log("Errors: 0");
		}
		return;
	}

	if (result.kind === "adoption-bundle") {
		console.log(`Bundle directory: ${result.outputDir || "n/a"}`);
		console.log(`Target: ${result.target || "n/a"}`);
		console.log(`Latest report: ${result.latestReport || "none"}`);
		console.log(`Gate decision: ${result.gateDecision}`);
		console.log(
			`Files: ${Array.isArray(result.files) ? result.files.length : 0}`,
		);
		if (Array.isArray(result.files)) {
			for (const file of result.files) {
				console.log(`  - ${file.relativePath}`);
			}
		}
		console.log(`Next safe action: ${result.nextSafeAction}`);
		if (Array.isArray(result.errors) && result.errors.length > 0) {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		} else {
			console.log("Errors: 0");
		}
		return;
	}

	if (result.kind === "adoption-status") {
		console.log(`Reports directory: ${result.reportsDir || "n/a"}`);
		console.log(`Reports: ${result.reports.count}`);
		console.log(
			`Latest report: ${result.latestReport ? result.latestReport.file : "none"}`,
		);
		console.log(`Index checked: ${result.index.checked}`);
		console.log(`Index valid: ${result.index.valid ?? "n/a"}`);
		console.log(`Gate decision: ${result.gate.decision}`);
		if (result.outputPath) {
			console.log(`Status report: ${result.outputPath}`);
		}
		console.log(`Blockers: ${result.blockers.length}`);
		for (const blocker of result.blockers) {
			console.log(`  - ${blocker.id}: ${blocker.message}`);
		}
		console.log(`Next safe action: ${result.nextSafeAction}`);
		if (Array.isArray(result.errors) && result.errors.length > 0) {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		} else {
			console.log("Errors: 0");
		}
		return;
	}

	console.log(`Target: ${result.target || "n/a"}`);
	if (result.classification && result.classification.type) {
		console.log(`Target type: ${result.classification.type}`);
	}
	if (Array.isArray(result.productChecks) && result.productChecks.length > 0) {
		console.log("Product checks:");
		for (const check of result.productChecks) {
			console.log(
				`  - ${check.name}: errors=${check.errors}, warnings=${check.warnings}`,
			);
		}
	}
	if (result.errors.length === 0) {
		console.log("Errors: 0");
	} else {
		console.log(`Errors: ${result.errors.length}`);
		for (const error of result.errors) {
			console.log(`  - ${error}`);
		}
	}

	if (result.warnings.length > 0) {
		console.log(`Warnings: ${result.warnings.length}`);
		for (const warning of result.warnings) {
			console.log(`  - ${warning}`);
		}
	}
}

module.exports = {
	MINIMUM_HARNESS_FILES,
	OPTIONAL_STARTER_WIKI_FILES,
	REQUIRED_HARNESS_FILES,
	REQUIRED_HANDOFF_SECTIONS,
	TEMPLATE_ROOT,
	DEFAULT_TEAM_REGISTRY,
	acceptPlan,
	auditProject,
	bundleAdoptionArtifacts,
	classifyTarget,
	compareAdoptionReports,
	dispatchAgentTask,
	doctor,
	dryRunLoopContract,
	inspectMaintenance,
	inspectLoopContract,
	inspectLoopLedger,
	inspectTeamDistribution,
	inspectProjectProfile,
	inspectWorkflowPack,
	inspectWorkflowPackReadiness,
	inspectTaskResult,
	generateAdoptionReport,
	gateAdoptionReport,
	installTeamDistribution,
	listAdoptionReports,
	listTemplateFiles,
	parseArgs,
	pinTeamDistribution,
	proposeMaintenance,
	printResult,
	prepareTaskExecution,
	recordLoopContract,
	recordAgentReview,
	reviewPlan,
	rollbackTeamDistribution,
	scaffoldPlan,
	scaffoldHarness,
	scaffoldWiki,
	setAgentDispatchStatus,
	statusAdoptionReports,
	updateTeamDistribution,
	validateContinuousImprovementStateFile,
	validateFeatureListData,
	validateFeatureListFile,
	validateHandoff,
	validateAdoptionReports,
	validateManifests,
	validatePlanGate,
	validateProjectProfileData,
	validateWorkflowPackData,
	writeAdoptionReportsIndex,
	writeAdoptionNextActions,
	writeAdoptionDecisionRecord,
	writeAdoptionApplyPlan,
	writeAdoptionSelectedFiles,
	validateWiki,
};
