"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
	REPO_ROOT,
} = require("./constants");

const {
	pathExists,
	readJson,
	readText,
	relativeSlash,
	resolveTarget,
	walkFiles,
} = require("./fs-utils");

const {
	hasSectionWithBody,
	slugify,
} = require("./text-utils");

const {
	findFeatureById,
} = require("./validators");

function buildPlanContent(feature, title) {
	return [
		`# Plan: ${title}`,
		"",
		`Feature: ${feature.id}`,
		"Status: implementation-ready",
		"User Confirmation: pending",
		"",
		"## Goal",
		"",
		feature.user_visible_behavior || "Describe the user-visible outcome.",
		"",
		"## High Level Design",
		"",
		"- Context:",
		"- Proposed approach:",
		"- Risks:",
		"",
		"## Vertical Slices",
		"",
		"- [ ] Slice 1: make the smallest safe change that advances the feature.",
		"",
		"## Acceptance Criteria",
		"",
		"- The user-visible behavior is demonstrably satisfied.",
		"- Existing Harness guardrails still pass.",
		"",
		"## Verification",
		"",
		...feature.verification.map((step) => `- ${step}`),
		"",
		"## Evidence Schema",
		"",
		"- Command:",
		"- Result:",
		"- Date:",
		"- Notes:",
		"",
	].join("\n");
}

function scaffoldPlan(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const errors = [];
	const warnings = [];
	const created = [];
	const skipped = [];
	const featureId = options.feature;

	if (!featureId) {
		errors.push("Plan requires --feature <feature-id>.");
		return { target: targetRoot, created, skipped, errors, warnings };
	}

	let feature;
	try {
		feature = findFeatureById(targetRoot, featureId);
	} catch (error) {
		errors.push(`Cannot read feature_list.json: ${error.message}`);
		return { target: targetRoot, created, skipped, errors, warnings };
	}

	if (!feature) {
		errors.push(`Feature ${featureId} was not found in feature_list.json.`);
		return { target: targetRoot, created, skipped, errors, warnings };
	}

	const title = options.title || feature.title;
	const relativePath = path.join(
		"docs",
		"plans",
		`${feature.id}-${slugify(title)}.md`,
	);
	const destination = path.join(targetRoot, relativePath);

	if (pathExists(destination)) {
		skipped.push(relativePath);
	} else {
		created.push(relativePath);
		if (!options.dryRun) {
			fs.mkdirSync(path.dirname(destination), { recursive: true });
			fs.writeFileSync(destination, buildPlanContent(feature, title));
		}
	}

	return {
		target: targetRoot,
		plan: relativePath,
		created,
		skipped,
		errors,
		warnings,
	};
}

function readPlanField(content, field) {
	const pattern = new RegExp(
		`^${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(.+)$`,
		"im",
	);
	const match = content.match(pattern);
	return match ? match[1].trim() : "";
}

function validatePlanGate(target, planRelativePath) {
	const targetRoot = resolveTarget(target);
	const errors = [];
	const warnings = [];

	if (!planRelativePath) {
		return {
			target: targetRoot,
			plan: null,
			errors: ["Gate requires --plan <relative-plan-path>."],
			warnings,
		};
	}

	const planPath = path.resolve(targetRoot, planRelativePath);
	if (!planPath.startsWith(targetRoot)) {
		return {
			target: targetRoot,
			plan: planRelativePath,
			errors: ["Plan path must stay inside the target repository."],
			warnings,
		};
	}
	if (!pathExists(planPath)) {
		return {
			target: targetRoot,
			plan: planRelativePath,
			errors: [`Plan file is missing: ${planRelativePath}`],
			warnings,
		};
	}

	const content = readText(planPath);
	const featureId = readPlanField(content, "Feature");
	const userConfirmation = readPlanField(content, "User Confirmation");

	if (!featureId) {
		errors.push("Plan must include a Feature field.");
	} else {
		try {
			if (!findFeatureById(targetRoot, featureId)) {
				errors.push(
					`Plan feature ${featureId} was not found in feature_list.json.`,
				);
			}
		} catch (error) {
			errors.push(`Cannot read feature_list.json: ${error.message}`);
		}
	}

	for (const section of [
		"High Level Design",
		"Vertical Slices",
		"Acceptance Criteria",
		"Verification",
		"Evidence Schema",
	]) {
		if (!hasSectionWithBody(content, section)) {
			errors.push(`Plan must include a non-empty ${section} section.`);
		}
	}

	if (!/^confirmed$/i.test(userConfirmation)) {
		errors.push(
			"User confirmation is required before implementation-ready status.",
		);
	}

	return {
		target: targetRoot,
		plan: planRelativePath,
		feature: featureId || null,
		errors,
		warnings,
	};
}

function discoverStandards() {
	const standardsRoot = path.join(REPO_ROOT, "standards");
	return walkFiles(standardsRoot)
		.filter((filePath) => filePath.endsWith(".json"))
		.map((filePath) => {
			try {
				const data = readJson(filePath);
				return {
					id: data.id,
					title: data.title,
					checks: Array.isArray(data.checks) ? data.checks : [],
					file: relativeSlash(REPO_ROOT, filePath),
				};
			} catch (error) {
				return {
					id: relativeSlash(REPO_ROOT, filePath),
					title: "Invalid standard",
					checks: [],
					file: relativeSlash(REPO_ROOT, filePath),
					error: error.message,
				};
			}
		});
}

function reviewPlan(target, planRelativePath) {
	const targetRoot = resolveTarget(target);
	const standards = discoverStandards();
	const gateResult = validatePlanGate(targetRoot, planRelativePath);
	const findings = gateResult.errors.map((message) => ({
		severity: "error",
		checkId: /User confirmation/.test(message)
			? "user-confirmation"
			: "plan-gate",
		message,
	}));

	const applicableChecks = standards.flatMap((standard) =>
		standard.checks.map((check) => ({
			standard: standard.id,
			id: check.id,
			description: check.description,
		})),
	);

	const requiredUserAction =
		findings.length > 0
			? ["Confirm the plan and resolve review findings before acceptance."]
			: [];

	return {
		target: targetRoot,
		plan: planRelativePath,
		loadedStandards: standards.map((standard) => standard.id),
		applicableChecks,
		nonApplicableChecks: [],
		findings,
		requiredUserAction,
		releaseReadiness: { status: findings.length > 0 ? "blocked" : "ready" },
		errors: findings.map((finding) => finding.message),
		warnings: gateResult.warnings,
	};
}

function acceptPlan(target, planRelativePath) {
	const targetRoot = resolveTarget(target);
	const review = reviewPlan(targetRoot, planRelativePath);
	if (review.errors.length > 0) {
		return {
			target: targetRoot,
			plan: planRelativePath,
			accepted: false,
			errors: review.errors,
			warnings: review.warnings,
			review,
		};
	}

	const evolutionRelativePath = path.join(
		"docs",
		"wiki",
		"engineering",
		"harness-evolution.md",
	);
	const evolutionPath = path.join(targetRoot, evolutionRelativePath);
	const date = new Date().toISOString().slice(0, 10);
	const entry = [
		"",
		`## ${date} ${planRelativePath}`,
		"",
		`- Plan: \`${planRelativePath}\``,
		"- Review status: ready",
		"- Required user action: none",
		"",
	].join("\n");

	fs.mkdirSync(path.dirname(evolutionPath), { recursive: true });
	if (!pathExists(evolutionPath)) {
		fs.writeFileSync(evolutionPath, `# Harness Evolution Log\n${entry}`);
	} else {
		fs.appendFileSync(evolutionPath, entry);
	}

	return {
		target: targetRoot,
		plan: planRelativePath,
		accepted: true,
		evolutionLog: evolutionRelativePath,
		errors: [],
		warnings: review.warnings,
		review,
	};
}

module.exports = {
	buildPlanContent,
	scaffoldPlan,
	readPlanField,
	validatePlanGate,
	discoverStandards,
	reviewPlan,
	acceptPlan,
};
