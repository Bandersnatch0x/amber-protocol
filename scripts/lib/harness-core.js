"use strict";

const fs = require("node:fs");
const path = require("node:path");

// __CORE_REQUIRES__
const {
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
} = require("./core/adoption-bundle");
const {
	adoptionGateFindings,
	buildAdoptionGateContent,
	gateAdoptionReport,
	nextAdoptionStatusAction,
	buildAdoptionStatusContent,
	statusAdoptionReports,
} = require("./core/adoption-gate");
const {
	ADOPTION_COMPARE_METRICS,
	buildAdoptionReportContent,
	uniqueAdoptionReportPath,
	parseAdoptionReportMetadata,
	listAdoptionReports,
	buildAdoptionReportsIndexContent,
	writeAdoptionReportsIndex,
	validateAdoptionReports,
	readAdoptionReportMetric,
	parseAdoptionReportForComparison,
	compareStringLists,
	buildMetricComparison,
	buildAdoptionReportDiffContent,
	compareAdoptionReports,
	generateAdoptionReport,
} = require("./core/adoption-reports");
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
