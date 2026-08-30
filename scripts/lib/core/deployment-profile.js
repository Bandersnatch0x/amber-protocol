"use strict";

/**
 * Deployment profile for #158 Stage 2 (Personal Node profile).
 *
 * A repository declares its deployment profile in `.amber/profile.json`:
 *   { "deploymentProfile": "personal-node" | "team-hub" | "organization" }
 *
 * Default is "personal-node" (offline-first, zero distributed contexts).
 * The resolved profile combines the deployment profile declaration with
 * the hybrid identity bootstrap (scripts/lib/core/identity.js).
 */

const fs = require("node:fs");
const path = require("node:path");

const { resolveIdentity } = require("./identity");
const { statePath, statePathForCreate } = require("../state-dir-resolver");

const DEPLOYMENT_PROFILES = Object.freeze(["personal-node", "team-hub", "organization"]);
const DEFAULT_PROFILE = "personal-node";
// Canonical location of the profile declaration (documentation shape; reads
// go through the state-dir seam so a legacy .harness profile stays visible).
const PROFILE_FILE = ".amber/profile.json";
// Resolution sources (closed set): "default" when no declaration file exists,
// "profile-file" when the declaration file was read — valid or not.
const PROFILE_SOURCE_DEFAULT = "default";
const PROFILE_SOURCE_FILE = "profile-file";

// One error shape for every failed declaration read (#273 S1): fail closed
// with a null profile, the profile-file source, and one explanatory error.
function invalidDeclaration(message) {
	return { deploymentProfile: null, source: PROFILE_SOURCE_FILE, errors: [message] };
}

/**
 * The one "declaration invalid" reading (#273 S3), shared by the validator,
 * the phase gates, and the envelope producer: a resolution is invalid exactly
 * when the parser reported errors. Absence is not invalid — it defaults.
 * @param {{errors: string[]}} resolution - A readProfileFile(...) result.
 * @returns {boolean}
 */
function isInvalidDeclaration(resolution) {
	return resolution.errors.length > 0;
}

/**
 * Read and validate the deployment profile file.
 * @param {string} cwd - Repository root.
 * @returns {{deploymentProfile: string|null, source: string, errors: string[]}}
 *   deploymentProfile is null when the file declares an unknown profile.
 */
function readProfileFile(cwd) {
	const filePath = statePath(cwd, "profile.json");
	const base = { deploymentProfile: DEFAULT_PROFILE, source: PROFILE_SOURCE_DEFAULT, errors: [] };
	if (!fs.existsSync(filePath)) {
		return base;
	}
	let raw;
	try {
		raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return invalidDeclaration(
			`Malformed deployment profile file (not valid JSON): ${path.relative(cwd, filePath)}`,
		);
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return invalidDeclaration(
			`Malformed deployment profile file (expected a JSON object): ${path.relative(cwd, filePath)}`,
		);
	}
	const profile = raw.deploymentProfile;
	if (typeof profile !== "string" || !DEPLOYMENT_PROFILES.includes(profile)) {
		return invalidDeclaration(
			`Unknown deployment profile "${profile}". Expected one of: ${DEPLOYMENT_PROFILES.join(", ")}`,
		);
	}
	return { deploymentProfile: profile, source: PROFILE_SOURCE_FILE, errors: [] };
}

/**
 * Shared predicate (#273 S2): a deployment profile is DECLARED (the file
 * exists) and VALID (it parses to one of DEPLOYMENT_PROFILES). The absent-file
 * default does not satisfy it. Phase-2 gate evidence and inv-2 read this.
 * @param {string} cwd - Repository root.
 * @returns {boolean}
 */
function hasDeclaredValidProfile(cwd) {
	const resolution = readProfileFile(cwd);
	return (
		resolution.source === PROFILE_SOURCE_FILE &&
		!isInvalidDeclaration(resolution) &&
		resolution.deploymentProfile !== null
	);
}

/**
 * Write the deployment profile file.
 * @param {string} cwd - Repository root.
 * @param {string} profile - One of DEPLOYMENT_PROFILES.
 * @returns {{errors: string[]}} Empty errors on success.
 */
function writeProfileFile(cwd, profile) {
	if (!DEPLOYMENT_PROFILES.includes(profile)) {
		return {
			errors: [
				`Unknown deployment profile "${profile}". Expected one of: ${DEPLOYMENT_PROFILES.join(", ")}`,
			],
		};
	}
	const profilePath = statePathForCreate(cwd, "profile.json");
	fs.mkdirSync(path.dirname(profilePath), { recursive: true });
	fs.writeFileSync(profilePath, JSON.stringify({ deploymentProfile: profile }, null, 2) + "\n");
	return { errors: [] };
}

/**
 * Resolve the effective deployment profile (default when absent).
 * @param {string} cwd - Repository root.
 * @returns {{deploymentProfile: string|null, source: string, errors: string[]}}
 */
function resolveDeploymentProfile(cwd) {
	const { deploymentProfile, source, errors } = readProfileFile(cwd);
	return { deploymentProfile, source, errors };
}

/**
 * Validate the deployment profile.
 * @param {string} cwd - Repository root.
 * @returns {{valid: boolean, deploymentProfile: string|null, errors: string[]}}
 */
function validateDeploymentProfile(cwd) {
	const resolution = readProfileFile(cwd);
	return {
		valid: !isInvalidDeclaration(resolution),
		deploymentProfile: resolution.deploymentProfile,
		errors: resolution.errors,
	};
}

/**
 * Show the full deployment profile: declaration + resolved identity.
 * @param {string} cwd - Repository root.
 * @returns {object} Profile declaration, identity, and sources.
 */
function showDeploymentProfile(cwd) {
	const resolution = readProfileFile(cwd);
	const { deploymentProfile, source: profileSource, errors } = resolution;
	const identity = resolveIdentity(cwd);
	return {
		deploymentProfile,
		identity,
		source: isInvalidDeclaration(resolution) ? "invalid" : profileSource,
		profileSource,
		identitySource: identity.source,
		errors,
	};
}

module.exports = {
	DEPLOYMENT_PROFILES,
	DEFAULT_PROFILE,
	PROFILE_FILE,
	PROFILE_SOURCE_DEFAULT,
	PROFILE_SOURCE_FILE,
	isInvalidDeclaration,
	hasDeclaredValidProfile,
	readProfileFile,
	writeProfileFile,
	resolveDeploymentProfile,
	validateDeploymentProfile,
	showDeploymentProfile,
};
