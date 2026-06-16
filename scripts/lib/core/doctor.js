"use strict";

const path = require("node:path");

const {
	fileMentionsWiki,
	hasNextAction,
	hasVerificationCommand,
	validateHandoff,
} = require("./audit");

const {
	REQUIRED_HARNESS_FILES,
} = require("./constants");

const {
	pathExists,
	resolveTarget,
} = require("./fs-utils");

const { validateManifests } = require("./manifests");
const { classifyTarget } = require("./target-classification");

const {
	inspectProjectProfile,
} = require("./profiles");

const {
	validateContinuousImprovementStateFile,
	validateFeatureListFile,
	validateWiki,
} = require("./validators");

const {
	inspectWorkflowPack,
} = require("./workflow-packs");

function hasPluginManifestDirectory(targetRoot) {
	return (
		pathExists(path.join(targetRoot, ".codex-plugin")) ||
		pathExists(path.join(targetRoot, ".claude-plugin"))
	);
}

function doctorProductRepo(targetRoot, classification) {
	const errors = [];
	const warnings = [];
	const productChecks = [];

	if (hasPluginManifestDirectory(targetRoot)) {
		const manifestResult = validateManifests(targetRoot);
		errors.push(...manifestResult.errors);
		warnings.push(...manifestResult.warnings);
		productChecks.push({
			name: "plugin-manifests",
			errors: manifestResult.errors.length,
			warnings: manifestResult.warnings.length,
		});
	}

	const samplePackPath = path.join(
		targetRoot,
		"workflow-packs",
		"safe-amber-bootstrap.pack.json",
	);
	const sampleProfilePath = path.join(
		targetRoot,
		"profiles",
		"default.profile.json",
	);
	const packResult = inspectWorkflowPack(samplePackPath);
	const profileResult = inspectProjectProfile(sampleProfilePath);
	errors.push(...packResult.errors);
	warnings.push(...packResult.warnings);
	errors.push(...profileResult.errors);
	warnings.push(...profileResult.warnings);
	productChecks.push({
		name: "workflow-pack-smoke",
		errors: packResult.errors.length,
		warnings: packResult.warnings.length,
	});
	productChecks.push({
		name: "project-profile-smoke",
		errors: profileResult.errors.length,
		warnings: profileResult.warnings.length,
	});

	return {
		target: targetRoot,
		classification,
		productChecks,
		errors,
		warnings,
	};
}

function doctor(target) {
	const targetRoot = resolveTarget(target);
	const classification = classifyTarget(targetRoot);
	if (classification.type === "product-repo") {
		return doctorProductRepo(targetRoot, classification);
	}

	const errors = [];
	const warnings = [];

	for (const relativePath of REQUIRED_HARNESS_FILES) {
		if (!pathExists(path.join(targetRoot, relativePath))) {
			// Forced-migration hint: when the new-name agent wiki page is the
			// missing file but the legacy page exists, point at migrate wiki.
			if (
				relativePath === "docs/wiki/agent/amber.md" &&
				pathExists(path.join(targetRoot, "docs", "wiki", "agent", "harness.md"))
			) {
				errors.push(
					`Missing required file: ${relativePath} (legacy harness.md found — run: amber migrate wiki --target .)`,
				);
				continue;
			}
			errors.push(`Missing required file: ${relativePath}`);
		}
	}

	const featureResult = validateFeatureListFile(
		path.join(targetRoot, "feature_list.json"),
	);
	errors.push(...featureResult.errors);
	warnings.push(...featureResult.warnings);

	const continuousImprovementResult = validateContinuousImprovementStateFile(
		path.join(targetRoot, ".workflow", "continuous-improvement", "state.json"),
	);
	errors.push(...continuousImprovementResult.errors);
	warnings.push(...continuousImprovementResult.warnings);

	const wikiResult = validateWiki(targetRoot);
	errors.push(...wikiResult.errors);
	warnings.push(...wikiResult.warnings);

	if (!fileMentionsWiki(path.join(targetRoot, "AGENTS.md"))) {
		errors.push("AGENTS.md does not route agents to docs/wiki.");
	}

	if (
		pathExists(path.join(targetRoot, "CLAUDE.md")) &&
		!fileMentionsWiki(path.join(targetRoot, "CLAUDE.md"))
	) {
		errors.push("CLAUDE.md does not route agents to docs/wiki.");
	}

	if (!hasVerificationCommand(targetRoot)) {
		errors.push(
			"docs/wiki/engineering/verification.md does not contain a verification command block.",
		);
	}

	if (!hasNextAction(path.join(targetRoot, "PROGRESS.md"))) {
		errors.push("PROGRESS.md does not contain a next action.");
	}

	const handoffResult = validateHandoff(targetRoot);
	errors.push(...handoffResult.errors);
	warnings.push(...handoffResult.warnings);

	if (hasPluginManifestDirectory(targetRoot)) {
		const manifestResult = validateManifests(targetRoot);
		errors.push(...manifestResult.errors);
		warnings.push(...manifestResult.warnings);
	}

	return { target: targetRoot, classification, errors, warnings };
}

module.exports = {
	hasPluginManifestDirectory,
	doctorProductRepo,
	doctor,
};
