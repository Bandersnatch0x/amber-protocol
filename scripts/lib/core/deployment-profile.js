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

const DEPLOYMENT_PROFILES = Object.freeze(["personal-node", "team-hub", "organization"]);
const DEFAULT_PROFILE = "personal-node";
const PROFILE_FILE = ".amber/profile.json";

/**
 * Read and validate the deployment profile file.
 * @param {string} cwd - Repository root.
 * @returns {{deploymentProfile: string|null, source: string, errors: string[]}}
 *   deploymentProfile is null when the file declares an unknown profile.
 */
function readProfileFile(cwd) {
	const filePath = path.join(cwd, PROFILE_FILE);
	const base = { deploymentProfile: DEFAULT_PROFILE, source: "default", errors: [] };
	if (!fs.existsSync(filePath)) {
		return base;
	}
	let raw;
	try {
		raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return base;
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return base;
	}
	const profile = raw.deploymentProfile;
	if (typeof profile !== "string" || !DEPLOYMENT_PROFILES.includes(profile)) {
		return {
			deploymentProfile: null,
			source: "profile-file",
			errors: [
				`Unknown deployment profile "${profile}". Expected one of: ${DEPLOYMENT_PROFILES.join(", ")}`,
			],
		};
	}
	return { deploymentProfile: profile, source: "profile-file", errors: [] };
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
	const amberDir = path.join(cwd, ".amber");
	fs.mkdirSync(amberDir, { recursive: true });
	fs.writeFileSync(
		path.join(amberDir, "profile.json"),
		JSON.stringify({ deploymentProfile: profile }, null, 2) + "\n",
	);
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
	const { deploymentProfile, errors } = readProfileFile(cwd);
	return { valid: errors.length === 0, deploymentProfile, errors };
}

/**
 * Show the full deployment profile: declaration + resolved identity.
 * @param {string} cwd - Repository root.
 * @returns {object} Profile declaration, identity, and sources.
 */
function showDeploymentProfile(cwd) {
	const { deploymentProfile, source: profileSource, errors } = readProfileFile(cwd);
	const identity = resolveIdentity(cwd);
	return {
		deploymentProfile,
		identity,
		source: errors.length > 0 ? "invalid" : profileSource,
		profileSource,
		identitySource: identity.source,
		errors,
	};
}

module.exports = {
	DEPLOYMENT_PROFILES,
	DEFAULT_PROFILE,
	PROFILE_FILE,
	readProfileFile,
	writeProfileFile,
	resolveDeploymentProfile,
	validateDeploymentProfile,
	showDeploymentProfile,
};
