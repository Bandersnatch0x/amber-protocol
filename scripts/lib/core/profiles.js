"use strict";

const path = require("node:path");

const {
	SEMVER_PATTERN,
} = require("./constants");

const {
	readJson,
	isMissingPath,
} = require("./fs-utils");

const {
	discoverStandards,
} = require("./planning");

function validateProjectProfileData(data) {
	const errors = [];
	const warnings = [];

	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return { errors: ["Project profile must contain an object."], warnings };
	}

	for (const field of ["id", "title", "version"]) {
		if (typeof data[field] !== "string" || data[field].trim() === "") {
			errors.push(`Project profile field ${field} must be a non-empty string.`);
		}
	}

	if (typeof data.version === "string" && !SEMVER_PATTERN.test(data.version)) {
		errors.push("Project profile version must be semver.");
	}

	if (!Array.isArray(data.packIds) || data.packIds.length === 0) {
		errors.push("Project profile packIds must contain at least one pack id.");
	} else if (
		data.packIds.some(
			(packId) => typeof packId !== "string" || packId.trim() === "",
		)
	) {
		errors.push("Project profile packIds must be non-empty strings.");
	}

	if (data.standards !== undefined && !Array.isArray(data.standards)) {
		errors.push("Project profile standards must be an array when present.");
	}

	if (
		data.environment !== undefined &&
		(!data.environment ||
			typeof data.environment !== "object" ||
			Array.isArray(data.environment))
	) {
		errors.push("Project profile environment must be an object when present.");
	}

	return { errors, warnings };
}

function inspectProjectProfile(filePath) {
	if (isMissingPath(filePath)) {
		return {
			file: "",
			errors: ["No project profile file specified. Pass --file <path>."],
			warnings: [],
		};
	}
	const profilePath = path.resolve(filePath);
	const errors = [];
	const warnings = [];
	let data;

	try {
		data = readJson(profilePath);
	} catch (error) {
		return {
			file: profilePath,
			errors: [`Cannot read project profile: ${error.message}`],
			warnings,
		};
	}

	const validation = validateProjectProfileData(data);
	errors.push(...validation.errors);
	warnings.push(...validation.warnings);

	// readJson returns whatever the file parses to, so a body of valid JSON
	// `null`/scalar/array parses cleanly but is not a profile object. Bail before
	// the data.standards / data.id reads below would throw on it, surfacing the
	// validation errors instead of crashing — same posture as the manifest/ledger
	// readers that survive a corrupt file.
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return { file: profilePath, errors, warnings };
	}

	const standards = new Set(discoverStandards().map((standard) => standard.id));
	for (const standard of data.standards || []) {
		if (!standards.has(standard)) {
			errors.push(`Project profile references missing standard: ${standard}.`);
		}
	}

	return {
		file: profilePath,
		errors,
		warnings,
		profile: {
			id: data.id,
			title: data.title,
			version: data.version,
			packIds: Array.isArray(data.packIds) ? data.packIds : [],
		},
	};
}

module.exports = {
	validateProjectProfileData,
	inspectProjectProfile,
};
