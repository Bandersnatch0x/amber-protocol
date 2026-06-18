"use strict";

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
	listTemplateFiles,
	scaffoldHarness,
} = require("./scaffold");

const {
	MESSAGES,
	defaultAdoptionWriteBoundaries,
} = require("./terminology");

const {
	renderAdoptionApplyPlan,
	renderAdoptionDecisionRecord,
	renderAdoptionSelectedFiles,
} = require("./adoption-artifact-composer");

const {
	writeAdoptionBundleArtifact,
} = require("./adoption-bundle-artifact");

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

function writeAdoptionDecisionRecord(options = {}) {
	return writeAdoptionBundleArtifact(options, {
		command: "adoption decision-record",
		outputExistsLabel: "Decision record",
		emptyResult: adoptionDecisionRecordErrorResult,
		render: renderAdoptionDecisionRecord,
		build: (manifest, ctx) => {
			const decisions = adoptionDecisionRecordDecisions();
			const decisionSpecs = Array.isArray(options.decisions)
				? options.decisions
				: options.decision
					? [options.decision]
					: [];
			ctx.errors.push(...applyAdoptionDecisionSpecs(decisions, decisionSpecs));
			if (ctx.errors.length > 0) {
				return null;
			}

			const gateMarkdown = ctx.readBundleFile("gate.md");
			return {
				kind: "adoption-decision-record",
				target: manifest.target || "unknown",
				bundleDir: ctx.bundleDir,
				outputPath: ctx.outputPath,
				latestReport: manifest.latestReport || null,
				gateDecision: manifest.gateDecision || "wait",
				nextSafeAction:
					manifest.nextSafeAction || MESSAGES.adoptionReviewBeforeChange,
				approvalStatus: adoptionDecisionApprovalStatus(decisions),
				decisions,
				findings: gateMarkdown
					? extractAdoptionGateFindings(gateMarkdown)
					: [],
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

function adoptionApplyPlanBoundaries() {
	return defaultAdoptionWriteBoundaries();
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

function writeAdoptionApplyPlan(options = {}) {
	const dryRun = options.dryRun === true;
	return writeAdoptionBundleArtifact(options, {
		command: "adoption apply-plan",
		outputExistsLabel: "Apply plan",
		emptyResult: (fields, errors, warnings) =>
			adoptionApplyPlanErrorResult({ ...fields, dryRun }, errors, warnings),
		validate: () =>
			dryRun ? [] : ["adoption apply-plan requires --dry-run in V1."],
		render: renderAdoptionApplyPlan,
		build: (manifest, ctx) => {
			if (!manifest.target) {
				ctx.errors.push("Bundle manifest must include target.");
				return null;
			}

			const preview = scaffoldHarness(manifest.target, { dryRun: true });
			return {
				kind: "adoption-apply-plan",
				target: path.resolve(manifest.target),
				bundleDir: ctx.bundleDir,
				outputPath: ctx.outputPath,
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
				errors: ctx.errors,
				warnings: ctx.warnings,
			};
		},
	});
}

function adoptionSelectedFilesBoundaries() {
	return defaultAdoptionWriteBoundaries();
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

function writeAdoptionSelectedFiles(options = {}) {
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
	return writeAdoptionBundleArtifact(options, {
		command: "adoption selected-files",
		outputExistsLabel: "Selected-files proposal",
		emptyResult: adoptionSelectedFilesErrorResult,
		render: renderAdoptionSelectedFiles,
		build: (manifest, ctx) => {
			const templateFiles = listTemplateFiles()
				.map((item) => item.relativePath)
				.sort();
			const selectable = new Set(templateFiles);
			for (const filePath of selectedFiles) {
				if (!isSafeSelectableHarnessPath(filePath)) {
					ctx.errors.push(`Unsafe selected file path: ${filePath}`);
				} else if (!selectable.has(filePath)) {
					ctx.errors.push(`Unknown selected file: ${filePath}`);
				}
			}
			if (ctx.errors.length > 0) {
				return null;
			}

			const requiredSet = new Set(REQUIRED_HARNESS_FILES);
			const optionalSet = new Set(OPTIONAL_STARTER_WIKI_FILES);
			const supportFiles = templateFiles.filter(
				(filePath) => !requiredSet.has(filePath) && !optionalSet.has(filePath),
			);
			return {
				kind: "adoption-selected-files",
				target: manifest.target || "unknown",
				bundleDir: ctx.bundleDir,
				outputPath: ctx.outputPath,
				selectedFiles,
				requiredSelected: selectedFiles.filter((filePath) =>
					requiredSet.has(filePath),
				),
				optionalSelected: selectedFiles.filter((filePath) =>
					optionalSet.has(filePath),
				),
				supportSelected: selectedFiles.filter(
					(filePath) =>
						!requiredSet.has(filePath) && !optionalSet.has(filePath),
				),
				requiredHarnessFiles: REQUIRED_HARNESS_FILES,
				optionalStarterWikiFiles: OPTIONAL_STARTER_WIKI_FILES,
				supportFiles,
				boundaries: adoptionSelectedFilesBoundaries(),
				errors: ctx.errors,
				warnings: ctx.warnings,
			};
		},
	});
}

module.exports = {
	ADOPTION_DECISION_GATE_IDS,
	ADOPTION_DECISION_STATUSES,
	adoptionDecisionRecordDecisions,
	applyAdoptionDecisionSpecs,
	adoptionDecisionApprovalStatus,
	adoptionDecisionRecordErrorResult,
	writeAdoptionDecisionRecord,
	adoptionApplyPlanBoundaries,
	adoptionApplyPlanErrorResult,
	writeAdoptionApplyPlan,
	adoptionSelectedFilesBoundaries,
	isSafeSelectableHarnessPath,
	adoptionSelectedFilesErrorResult,
	writeAdoptionSelectedFiles,
};
