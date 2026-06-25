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
	getSectionBody,
	hasSectionWithBody,
	slugify,
} = require("./text-utils");

const EVIDENCE_SCHEMA_FIELDS = ["Command", "Result", "Date"];

const {
	findFeatureById,
} = require("./validators");

const {
	MESSAGES,
} = require("./terminology");

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
		MESSAGES.planGuardrailsCheck,
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

	// buildPlanContent maps feature.verification unconditionally (its pinned
	// contract assumes a valid feature). feature_list.json is untrusted target
	// input, so a feature missing its verification array would crash the pure
	// builder here at the command boundary. Surface a clean error via the
	// envelope instead of letting the TypeError escape to the top-level catch.
	if (!Array.isArray(feature.verification)) {
		errors.push(
			`Feature ${featureId} has no verification array in feature_list.json; run validate-feature-list to fix it.`,
		);
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

// Pure core of validatePlanGate: given the plan content and an injected feature
// resolver, produce the gate errors/warnings without touching the filesystem.
// resolveFeature(featureId) => { found: boolean, error: string|null } where a
// non-null error means feature_list.json could not be read. Extracted so the
// validation branching (feature field, feature lookup, required sections, user
// confirmation) is unit-testable.
function validatePlanContent({ content, resolveFeature }) {
	const errors = [];
	const warnings = [];
	const featureId = readPlanField(content, "Feature");
	const userConfirmation = readPlanField(content, "User Confirmation");

	if (!featureId) {
		errors.push("Plan must include a Feature field.");
	} else {
		const { found, error } = resolveFeature(featureId);
		if (error) {
			errors.push(`Cannot read feature_list.json: ${error}`);
		} else if (!found) {
			errors.push(
				`Plan feature ${featureId} was not found in feature_list.json.`,
			);
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

	return { feature: featureId || null, errors, warnings };
}

function validatePlanGate(target, planRelativePath) {
	const targetRoot = resolveTarget(target);

	if (!planRelativePath) {
		return {
			target: targetRoot,
			plan: null,
			errors: ["Gate requires --plan <relative-plan-path>."],
			warnings: [],
		};
	}

	const planPath = path.resolve(targetRoot, planRelativePath);
	if (!planPath.startsWith(targetRoot)) {
		return {
			target: targetRoot,
			plan: planRelativePath,
			errors: ["Plan path must stay inside the target repository."],
			warnings: [],
		};
	}
	if (!pathExists(planPath)) {
		return {
			target: targetRoot,
			plan: planRelativePath,
			errors: [`Plan file is missing: ${planRelativePath}`],
			warnings: [],
		};
	}

	const content = readText(planPath);
	const result = validatePlanContent({
		content,
		resolveFeature: (featureId) => {
			try {
				const feature = findFeatureById(targetRoot, featureId);
				return { found: Boolean(feature), error: null };
			} catch (error) {
				return { found: false, error: error.message };
			}
		},
	});

	return {
		target: targetRoot,
		plan: planRelativePath,
		...result,
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

function evaluateStandardCheck(content, checkId) {
	switch (checkId) {
		case "user-confirmation":
			if (!/^confirmed$/i.test(readPlanField(content, "User Confirmation"))) {
				return {
					pass: false,
					message:
						"Implementation-ready plans require explicit user confirmation.",
				};
			}
			return { pass: true };
		case "verification-evidence": {
			if (!hasSectionWithBody(content, "Verification")) {
				return {
					pass: false,
					message:
						"Plans must define a non-empty Verification section before acceptance.",
				};
			}
			const evidenceBody = getSectionBody(content, "Evidence Schema");
			if (!evidenceBody || !evidenceBody.trim()) {
				return {
					pass: false,
					message:
						"Plans must define an Evidence Schema section before acceptance.",
				};
			}
			const missingFields = EVIDENCE_SCHEMA_FIELDS.filter(
				(field) =>
					!new RegExp(`^\\s*-\\s*${field}:`, "im").test(evidenceBody),
			);
			if (missingFields.length > 0) {
				return {
					pass: false,
					message: `Evidence Schema must define ${missingFields.join(", ")} fields before acceptance.`,
				};
			}
			return { pass: true };
		}
		case "scope-boundary": {
			const acceptanceBody = getSectionBody(content, "Acceptance Criteria");
			if (!acceptanceBody || !acceptanceBody.trim()) {
				return {
					pass: false,
					message:
						"Plans must acknowledge scope boundaries in Acceptance Criteria before acceptance.",
				};
			}
			const acknowledgesBoundary =
				/guardrails/i.test(acceptanceBody) ||
				/phase boundary/i.test(acceptanceBody);
			if (!acknowledgesBoundary) {
				return {
					pass: false,
					message:
						"Acceptance Criteria must preserve the current phase boundary (include guardrails or phase-boundary acknowledgment).",
				};
			}
			return { pass: true };
		}
		default:
			return { pass: true };
	}
}

// Pure evaluator for loaded standards against plan content. Each check returns
// a finding when it fails; unknown check ids are treated as passing so future
// standards can be added without breaking review.
function evaluateStandardChecks({ content, standards }) {
	const findings = [];
	for (const standard of standards) {
		for (const check of standard.checks) {
			const result = evaluateStandardCheck(content, check.id);
			if (!result.pass) {
				findings.push({
					severity: "error",
					checkId: check.id,
					standard: standard.id,
					message: result.message,
				});
			}
		}
	}
	return findings;
}

// Pure core of reviewPlan: given a gate result and the loaded standards, build
// the review object — classify gate errors into findings (user-confirmation vs
// plan-gate), evaluate standards against plan content, expand standards into
// applicable checks, and compute the required user action and release readiness.
// Extracted so the review assembly is unit-testable without discoverStandards/
// validatePlanGate hitting disk.
function buildReviewResult({
	targetRoot,
	planRelativePath,
	gateResult,
	standards,
	content = "",
}) {
	const gateFindings = gateResult.errors.map((message) => ({
		severity: "error",
		checkId: /User confirmation/.test(message)
			? "user-confirmation"
			: "plan-gate",
		message,
	}));
	const gateCheckIds = new Set(gateFindings.map((finding) => finding.checkId));
	const standardFindings = content
		? evaluateStandardChecks({ content, standards }).filter(
				(finding) => !gateCheckIds.has(finding.checkId),
			)
		: [];
	const findings = [...gateFindings, ...standardFindings];

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

function reviewPlan(target, planRelativePath) {
	const targetRoot = resolveTarget(target);
	const standards = discoverStandards();
	const gateResult = validatePlanGate(targetRoot, planRelativePath);
	let content = "";
	if (gateResult.plan) {
		const planPath = path.join(targetRoot, gateResult.plan);
		if (pathExists(planPath)) {
			content = readText(planPath);
		}
	}
	return buildReviewResult({
		targetRoot,
		planRelativePath,
		gateResult,
		standards,
		content,
	});
}

function confirmPlanGate(target, planRelativePath) {
	const targetRoot = resolveTarget(target);

	if (!planRelativePath) {
		return {
			target: targetRoot,
			plan: null,
			confirmed: false,
			errors: ["confirm requires --plan <relative-plan-path>."],
			warnings: [],
		};
	}

	const planPath = path.resolve(targetRoot, planRelativePath);
	if (!planPath.startsWith(targetRoot)) {
		return {
			target: targetRoot,
			plan: planRelativePath,
			confirmed: false,
			errors: ["Plan path must stay inside the target repository."],
			warnings: [],
		};
	}
	if (!pathExists(planPath)) {
		return {
			target: targetRoot,
			plan: planRelativePath,
			confirmed: false,
			errors: [`Plan file is missing: ${planRelativePath}`],
			warnings: [],
		};
	}

	let content = readText(planPath);
	const updated = content.replace(
		/^User\s*Confirmation\s*:\s*.+$/m,
		"User Confirmation: confirmed",
	);

	if (updated === content) {
		return {
			target: targetRoot,
			plan: planRelativePath,
			confirmed: false,
			errors: [
				"Plan does not contain a 'User Confirmation:' field to confirm.",
			],
			warnings: [],
		};
	}

	fs.writeFileSync(planPath, updated);

	return {
		target: targetRoot,
		plan: planRelativePath,
		confirmed: true,
		errors: [],
		warnings: [],
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

	const planPath = path.join(targetRoot, planRelativePath);
	const planContent = readText(planPath);
	const featureId = readPlanField(planContent, "Feature");
	let featureUpdated = false;

	// Update feature_list.json with immutable pattern.
	if (featureId) {
		try {
			const feature = findFeatureById(targetRoot, featureId);
			if (feature) {
				const featureListPath = path.join(targetRoot, "feature_list.json");
				const data = readJson(featureListPath);
				const idx = data.features.findIndex(
					(f) => f && f.id === featureId,
				);
				if (idx !== -1 && data.features[idx].status !== "accepted") {
					const updatedFeatures = data.features.map((f, i) =>
						i === idx
							? { ...f, status: "accepted", updated: new Date().toISOString().slice(0, 10) }
							: f,
					);
					fs.writeFileSync(
						featureListPath,
						JSON.stringify({ ...data, features: updatedFeatures }, null, 2) + "\n",
					);
					featureUpdated = true;
				}
			}
		} catch (err) {
			// If feature_list.json is missing or corrupt, accept still succeeds
			// — the evolution log is the durable record.
		}
	}

	// Update the plan's own Status field to reflect acceptance.
	try {
		const updatedPlan = planContent.replace(
			/^Status:\s*.+$/m,
			"Status: accepted",
		);
		if (updatedPlan !== planContent) {
			fs.writeFileSync(planPath, updatedPlan);
		}
	} catch (err) {
		// Non-critical — the plan update is cosmetic.
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
		featureUpdated
			? `- Feature: ${featureId} status → accepted in feature_list.json`
			: "- Required user action: none",
		"",
	].join("\n");

	fs.mkdirSync(path.dirname(evolutionPath), { recursive: true });
	if (!pathExists(evolutionPath)) {
		fs.writeFileSync(evolutionPath, `${MESSAGES.evolutionLogHeading}\n${entry}`);
	} else {
		fs.appendFileSync(evolutionPath, entry);
	}

	return {
		target: targetRoot,
		plan: planRelativePath,
		accepted: true,
		featureId: featureId || null,
		featureUpdated,
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
	validatePlanContent,
	validatePlanGate,
	confirmPlanGate,
	discoverStandards,
	evaluateStandardChecks,
	buildReviewResult,
	reviewPlan,
	acceptPlan,
};
