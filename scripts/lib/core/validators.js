"use strict";

const path = require("node:path");

const {
	VALID_STATUSES,
	WIKI_CONTEXT_STARTER_FILES,
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
	extractMarkdownLinks,
	hasSectionWithBody,
	isExternalLink,
	stripAnchorAndQuery,
} = require("./text-utils");

const { validateOkfFrontmatter } = require("./okf-frontmatter");

function loadFeatureList(targetRoot) {
	return readJson(path.join(targetRoot, "feature_list.json"));
}

function findFeatureById(targetRoot, featureId) {
	const data = loadFeatureList(targetRoot);
	if (!Array.isArray(data.features)) {
		return null;
	}
	return (
		data.features.find((feature) => feature && feature.id === featureId) || null
	);
}

function validateFeatureListData(data) {
	const errors = [];
	const warnings = [];

	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return { errors: ["feature_list.json must contain an object."], warnings };
	}

	if (!Array.isArray(data.features)) {
		return {
			errors: ["feature_list.json must contain a features array."],
			warnings,
		};
	}

	const ids = new Set();
	let inProgressCount = 0;

	data.features.forEach((feature, index) => {
		const prefix = `features[${index}]`;
		if (!feature || typeof feature !== "object" || Array.isArray(feature)) {
			errors.push(`${prefix} must be an object.`);
			return;
		}

		for (const field of [
			"id",
			"area",
			"title",
			"user_visible_behavior",
			"status",
		]) {
			if (typeof feature[field] !== "string" || feature[field].trim() === "") {
				errors.push(`${prefix}.${field} must be a non-empty string.`);
			}
		}

		if (!Number.isInteger(feature.priority)) {
			errors.push(`${prefix}.priority must be an integer.`);
		}

		if (
			!Array.isArray(feature.verification) ||
			feature.verification.length === 0
		) {
			errors.push(`${prefix}.verification must contain at least one step.`);
		} else if (
			feature.verification.some(
				(step) => typeof step !== "string" || step.trim() === "",
			)
		) {
			errors.push(`${prefix}.verification steps must be non-empty strings.`);
		}

		if (!Array.isArray(feature.evidence)) {
			errors.push(`${prefix}.evidence must be an array.`);
		}

		if (!Array.isArray(feature.notes)) {
			errors.push(`${prefix}.notes must be an array.`);
		}

		if (typeof feature.id === "string") {
			if (ids.has(feature.id)) {
				errors.push(`${prefix}.id duplicates ${feature.id}.`);
			}
			ids.add(feature.id);
		}

		if (!VALID_STATUSES.has(feature.status)) {
			errors.push(
				`${prefix}.status must be one of ${Array.from(VALID_STATUSES).join(", ")}.`,
			);
		}

		if (feature.status === "in_progress") {
			inProgressCount += 1;
		}

		if (
			feature.status === "passing" &&
			(!Array.isArray(feature.evidence) || feature.evidence.length === 0)
		) {
			errors.push(`${prefix} is passing but has no evidence.`);
		}

		if (
			feature.status === "blocked" &&
			(!Array.isArray(feature.notes) || feature.notes.length === 0)
		) {
			warnings.push(`${prefix} is blocked but has no notes.`);
		}

		if (
			Array.isArray(feature.evidence) &&
			feature.evidence.length > 0 &&
			feature.status === "not_started"
		) {
			warnings.push(`${prefix} has evidence but status is still not_started.`);
		}
	});

	if (inProgressCount > 1) {
		errors.push("At most one feature can be in_progress.");
	}

	return { errors, warnings };
}

function validateFeatureListFile(filePath) {
	try {
		return validateFeatureListData(readJson(filePath));
	} catch (error) {
		return {
			errors: [`Cannot read feature_list.json: ${error.message}`],
			warnings: [],
		};
	}
}

function validateContinuousImprovementStateFile(filePath) {
	const errors = [];
	const warnings = [];
	let data;

	try {
		data = readJson(filePath);
	} catch (error) {
		return {
			errors: [
				`Cannot read .workflow/continuous-improvement/state.json: ${error.message}`,
			],
			warnings,
		};
	}

	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return {
			errors: [
				".workflow/continuous-improvement/state.json must contain an object.",
			],
			warnings,
		};
	}

	if (!Number.isInteger(data.version)) {
		errors.push(
			".workflow/continuous-improvement/state.json version must be an integer.",
		);
	}

	if (typeof data.mode !== "string" || data.mode.trim() === "") {
		errors.push(
			".workflow/continuous-improvement/state.json mode must be a non-empty string.",
		);
	}

	for (const field of ["queue", "approvalGates", "resultNotes"]) {
		if (!Array.isArray(data[field])) {
			errors.push(
				`.workflow/continuous-improvement/state.json ${field} must be an array.`,
			);
		}
	}

	if (
		data.activeWorkflow !== null &&
		data.activeWorkflow !== undefined &&
		typeof data.activeWorkflow !== "object"
	) {
		errors.push(
			".workflow/continuous-improvement/state.json activeWorkflow must be null or an object.",
		);
	}

	if (Array.isArray(data.queue)) {
		data.queue.forEach((item, index) => {
			if (!item || typeof item !== "object" || Array.isArray(item)) {
				errors.push(
					`.workflow/continuous-improvement/state.json queue[${index}] must be an object.`,
				);
				return;
			}
			for (const field of ["id", "title", "status"]) {
				if (typeof item[field] !== "string" || item[field].trim() === "") {
					errors.push(
						`.workflow/continuous-improvement/state.json queue[${index}].${field} must be a non-empty string.`,
					);
				}
			}
		});
	}

	return { errors, warnings };
}

function validateWiki(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const wikiRoot = path.join(targetRoot, "docs", "wiki");
	const errors = [];
	const warnings = [];
	const checkOkf = options.okf === true;

	if (!pathExists(wikiRoot)) {
		return {
			target: targetRoot,
			errors: ["docs/wiki directory is missing."],
			warnings,
		};
	}

	const markdownFiles = walkFiles(wikiRoot).filter((filePath) =>
		filePath.toLowerCase().endsWith(".md"),
	);
	if (markdownFiles.length === 0) {
		errors.push("docs/wiki has no markdown files.");
	}

	const indexPath = path.join(wikiRoot, "index.md");
	if (!pathExists(indexPath)) {
		errors.push("docs/wiki/index.md is missing.");
	}

	for (const filePath of markdownFiles) {
		const content = readText(filePath);
		const relativePath = relativeSlash(targetRoot, filePath);
		const fileDir = path.dirname(filePath);
		for (const link of extractMarkdownLinks(content)) {
			if (isExternalLink(link)) {
				continue;
			}
			const withoutAnchor = stripAnchorAndQuery(link);
			if (!withoutAnchor) {
				continue;
			}
			const resolved = path.resolve(fileDir, withoutAnchor);
			if (!pathExists(resolved)) {
				errors.push(`${relativePath} links to missing ${link}.`);
			}
		}

		if (
			WIKI_CONTEXT_STARTER_FILES.has(relativePath) &&
			!hasSectionWithBody(content, "Unknowns / Needs Confirmation")
		) {
			warnings.push(
				`${relativePath} is missing an Unknowns / Needs Confirmation section.`,
			);
		}

		if (checkOkf) {
			const okf = validateOkfFrontmatter(content);
			for (const error of okf.errors) {
				errors.push(`${relativePath}: ${error}`);
			}
			for (const warning of okf.warnings) {
				warnings.push(`${relativePath}: ${warning}`);
			}
		}
	}

	return { target: targetRoot, errors, warnings };
}

module.exports = {
	loadFeatureList,
	findFeatureById,
	validateFeatureListData,
	validateFeatureListFile,
	validateContinuousImprovementStateFile,
	validateWiki,
};
