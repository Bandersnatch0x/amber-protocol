"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
	adoptionBundleBoundaries,
	extractAdoptionGateFindings,
} = require("./adoption-bundle");

const {
	OPTIONAL_STARTER_WIKI_FILES,
	REQUIRED_HARNESS_FILES,
} = require("./constants");

const {
	pathExists,
	readJson,
	readText,
} = require("./fs-utils");

const {
	listTemplateFiles,
	scaffoldHarness,
} = require("./scaffold");

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

module.exports = {
	ADOPTION_DECISION_GATE_IDS,
	ADOPTION_DECISION_STATUSES,
	adoptionDecisionRecordDecisions,
	applyAdoptionDecisionSpecs,
	adoptionDecisionApprovalStatus,
	adoptionDecisionRecordErrorResult,
	buildAdoptionDecisionRecordContent,
	writeAdoptionDecisionRecord,
	adoptionApplyPlanBoundaries,
	adoptionApplyPlanErrorResult,
	buildAdoptionApplyPlanContent,
	writeAdoptionApplyPlan,
	adoptionSelectedFilesBoundaries,
	isSafeSelectableHarnessPath,
	adoptionSelectedFilesErrorResult,
	buildAdoptionSelectedFilesContent,
	writeAdoptionSelectedFiles,
};
