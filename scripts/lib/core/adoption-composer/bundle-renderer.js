"use strict";

// bundle-renderer.js
// Renders adoption bundle artifacts (README, next actions).

const fs = require("node:fs");
const path = require("node:path");

const { MESSAGES } = require("../terminology");
const { pathExists, readJson, readText } = require("../fs-utils");

const {
	renderMarkdown,
	pushBoundaryBlock,
	pushGateFindings,
	pushStarterFileList,
	pushOptionalStarterWikiFiles,
	pushCandidateCommands,
	pushUnknowns,
	pushHumanApprovalGates,
} = require("./shared-helpers");

function renderAdoptionBundleReadme(bundle) {
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
	pushBoundaryBlock(lines, bundle.boundaries, { heading: "V1 Boundaries" });
	lines.push(MESSAGES.adoptionReadOnlyBundleNotice, "");
	return renderMarkdown(lines);
}

function renderAdoptionNextActionsDocument(nextActions) {
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
	];
	pushBoundaryBlock(lines, nextActions.boundaries, {
		preamble: "This document is a read-only planning artifact.",
	});
	pushGateFindings(lines, nextActions.findings);
	pushStarterFileList(
		lines,
		nextActions.requiredHarnessFiles,
		MESSAGES.requiredStarterFilesPendingApproval,
	);
	pushOptionalStarterWikiFiles(lines, nextActions.optionalStarterWikiFiles);
	pushCandidateCommands(lines, nextActions.candidateCommands);
	pushUnknowns(lines, nextActions.unknowns);
	pushHumanApprovalGates(lines, nextActions.approvalGates);
	lines.push(
		"## Recommended Next Sequence",
		"",
		"1. Human reviews this document and answers the approval gates.",
		"2. If writes are approved, confirm the target path and exact file list before running init.",
		"3. Re-run adoption report, index, status, gate, and bundle after any approved target change.",
		"4. Treat target command execution as a separate approval step after the command is confirmed.",
		"",
		MESSAGES.adoptionCommandsOutsideArtifact,
		"",
	);
	return renderMarkdown(lines);
}

function writeAdoptionBundleArtifact(options = {}, spec) {
	const {
		command,
		outputExistsLabel,
		emptyResult,
		validate,
		build,
		render,
	} = spec;

	const bundleDir = options.bundleDir ? path.resolve(options.bundleDir) : "";
	const outputPath = options.output ? path.resolve(options.output) : "";
	const errors = [];
	const warnings = [];

	if (!bundleDir) {
		errors.push(`${command} requires --bundle-dir.`);
	}
	if (!outputPath) {
		errors.push(`${command} requires --output.`);
	}
	if (typeof validate === "function") {
		errors.push(...validate(options));
	}
	if (
		bundleDir &&
		(!pathExists(bundleDir) || !fs.statSync(bundleDir).isDirectory())
	) {
		errors.push(`Bundle directory does not exist: ${bundleDir}`);
	}
	if (outputPath && pathExists(outputPath)) {
		errors.push(`${outputExistsLabel} already exists: ${outputPath}`);
	}
	if (errors.length > 0) {
		return emptyResult({ bundleDir, outputPath }, errors, warnings);
	}

	const manifestPath = path.join(bundleDir, "manifest.json");
	if (!pathExists(manifestPath)) {
		errors.push(`Bundle manifest is missing: ${manifestPath}`);
		return emptyResult({ bundleDir, outputPath }, errors, warnings);
	}

	let manifest;
	try {
		manifest = readJson(manifestPath);
	} catch (error) {
		errors.push(`Cannot read bundle manifest: ${error.message}`);
		return emptyResult({ bundleDir, outputPath }, errors, warnings);
	}

	const ctx = {
		bundleDir,
		outputPath,
		options,
		errors,
		warnings,
		readBundleFile(relativePath) {
			const filePath = path.join(bundleDir, relativePath);
			return pathExists(filePath) ? readText(filePath) : "";
		},
	};

	const record = build(manifest, ctx);
	if (errors.length > 0) {
		return emptyResult(
			{ target: manifest.target, bundleDir, outputPath },
			errors,
			warnings,
		);
	}

	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, render(record));

	return record;
}

module.exports = {
	renderAdoptionBundleReadme,
	renderAdoptionNextActionsDocument,
	writeAdoptionBundleArtifact,
};
