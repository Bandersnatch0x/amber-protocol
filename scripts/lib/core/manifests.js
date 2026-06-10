"use strict";

const path = require("node:path");

const {
	MINIMUM_HARNESS_FILES,
	SEMVER_PATTERN,
} = require("./constants");

const {
	pathExists,
	readJson,
	resolveTarget,
} = require("./fs-utils");

function loadManifest(pluginRoot, relativePath, errors) {
	const manifestPath = path.join(pluginRoot, relativePath);
	if (!pathExists(manifestPath)) {
		errors.push(`Missing required manifest: ${relativePath}`);
		return null;
	}

	try {
		const payload = readJson(manifestPath);
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
			errors.push(`${relativePath} must contain a JSON object.`);
			return null;
		}
		return payload;
	} catch (error) {
		errors.push(`${relativePath} must contain valid JSON: ${error.message}`);
		return null;
	}
}

function requireManifestString(manifest, relativePath, field, errors) {
	const value = field
		.split(".")
		.reduce(
			(current, key) =>
				current && current[key] !== undefined ? current[key] : undefined,
			manifest,
		);
	if (typeof value !== "string" || value.trim() === "") {
		errors.push(`${relativePath} field ${field} must be a non-empty string.`);
		return null;
	}
	return value;
}

function validateSkillsPath(
	pluginRoot,
	manifestDir,
	relativePath,
	rawSkillsPath,
	errors,
) {
	if (typeof rawSkillsPath !== "string" || rawSkillsPath.trim() === "") {
		errors.push(`${relativePath} field skills must be a non-empty string.`);
		return;
	}

	const candidates = [
		path.resolve(pluginRoot, rawSkillsPath),
		path.resolve(manifestDir, rawSkillsPath),
	];
	if (!candidates.some(pathExists)) {
		errors.push(`${relativePath} skills path does not exist: ${rawSkillsPath}`);
	}
}

function validateCommonManifest(pluginRoot, relativePath, manifest, errors) {
	const manifestDir = path.dirname(path.join(pluginRoot, relativePath));
	requireManifestString(manifest, relativePath, "name", errors);
	const version = requireManifestString(
		manifest,
		relativePath,
		"version",
		errors,
	);
	if (version && !SEMVER_PATTERN.test(version)) {
		errors.push(`${relativePath} field version must be semver.`);
	}
	requireManifestString(manifest, relativePath, "description", errors);
	requireManifestString(manifest, relativePath, "author.name", errors);
	validateSkillsPath(
		pluginRoot,
		manifestDir,
		relativePath,
		manifest.skills,
		errors,
	);
}

function validateCodexManifest(pluginRoot, manifest, errors) {
	const relativePath = ".codex-plugin/plugin.json";
	validateCommonManifest(pluginRoot, relativePath, manifest, errors);

	if (
		!manifest.interface ||
		typeof manifest.interface !== "object" ||
		Array.isArray(manifest.interface)
	) {
		errors.push(`${relativePath} field interface must be an object.`);
		return;
	}

	for (const field of [
		"displayName",
		"shortDescription",
		"longDescription",
		"developerName",
		"category",
	]) {
		requireManifestString(manifest, relativePath, `interface.${field}`, errors);
	}

	if (
		!Array.isArray(manifest.interface.capabilities) ||
		manifest.interface.capabilities.some((value) => typeof value !== "string")
	) {
		errors.push(
			`${relativePath} field interface.capabilities must be an array of strings.`,
		);
	}

	if (
		typeof manifest.interface.defaultPrompt !== "string" &&
		typeof manifest.interface.default_prompt !== "string"
	) {
		errors.push(
			`${relativePath} field interface.defaultPrompt or interface.default_prompt must be a non-empty string.`,
		);
	}
}

function validateManifests(target) {
	const pluginRoot = resolveTarget(target);
	const errors = [];
	const warnings = [];

	const codexManifest = loadManifest(
		pluginRoot,
		".codex-plugin/plugin.json",
		errors,
	);
	const claudeManifest = loadManifest(
		pluginRoot,
		".claude-plugin/plugin.json",
		errors,
	);

	if (codexManifest) {
		validateCodexManifest(pluginRoot, codexManifest, errors);
	}
	if (claudeManifest) {
		validateCommonManifest(
			pluginRoot,
			".claude-plugin/plugin.json",
			claudeManifest,
			errors,
		);
	}

	return { target: pluginRoot, errors, warnings };
}

function classifyTarget(target) {
	const targetRoot = resolveTarget(target);
	const evidence = [];

	if (
		pathExists(path.join(targetRoot, "SPEC.md")) &&
		pathExists(path.join(targetRoot, "ROADMAP.md")) &&
		pathExists(path.join(targetRoot, "scripts", "harness.js")) &&
		pathExists(path.join(targetRoot, "templates"))
	) {
		evidence.push("SPEC.md", "ROADMAP.md", "scripts/harness.js", "templates/");
		return { type: "product-repo", evidence };
	}

	for (const relativePath of MINIMUM_HARNESS_FILES) {
		if (pathExists(path.join(targetRoot, relativePath))) {
			evidence.push(relativePath);
		}
	}

	if (evidence.length > 0) {
		return { type: "harnessed-target-repo", evidence };
	}

	return { type: "unharnessed-target-repo", evidence };
}

module.exports = {
	loadManifest,
	requireManifestString,
	validateSkillsPath,
	validateCommonManifest,
	validateCodexManifest,
	validateManifests,
	classifyTarget,
};
