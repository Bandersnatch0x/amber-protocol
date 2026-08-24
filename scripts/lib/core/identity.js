"use strict";

/**
 * Hybrid identity bootstrap for Personal Node (ADR-0019 decision D4).
 *
 * Person/Agent are inferred from git config (zero-config default).
 * Tenant/Organization default to deterministic local scope ("local" / "personal").
 * `.amber/identity.json` overrides any field when present.
 *
 * Resolution order:
 *   1. Load `.amber/identity.json` if it exists (explicit override).
 *   2. Infer Person from `git config user.name` + `user.email`.
 *   3. Fill remaining fields with deterministic defaults.
 *   4. Identity file wins over git inference for any field it declares.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_TENANT_ID = "local";
const DEFAULT_ORGANIZATION_ID = "personal";
const DEFAULT_REPOSITORY_GENERATION = 0;

/**
 * Return the deterministic default identity (no git, no identity file).
 * @returns {object} Identity with source="default".
 */
function defaultIdentity() {
	return {
		tenantId: DEFAULT_TENANT_ID,
		organizationId: DEFAULT_ORGANIZATION_ID,
		repositoryGeneration: DEFAULT_REPOSITORY_GENERATION,
		personId: null,
		agentId: null,
		source: "default",
	};
}

/**
 * Read a single effective git config key (local > global > system).
 * @param {string} cwd - Repository root.
 * @param {string} key - Config key, e.g. "user.name".
 * @returns {string} Trimmed value, or "" when unset.
 */
function gitConfig(cwd, key) {
	const res = spawnSync("git", ["config", key], {
		cwd,
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	if (res.status !== 0) return "";
	return (res.stdout || "").trim();
}

/**
 * Infer Person identity from git config.
 * @param {string} cwd - Repository root.
 * @returns {{personId: string|null, agentId: null}} Git-inferred person, or nulls.
 */
function inferFromGit(cwd) {
	// Only infer from an actual git repository. Reads the effective config
	// (local > global > system, per ADR-0019 D4: "git config user.name" /
	// "user.email") so a zero-config machine with machine-level identity is
	// still inferred. Repository-local values win when both exist. The
	// identity file (.amber/identity.json) overrides everything.
	if (!fs.existsSync(path.join(cwd, ".git"))) {
		return { personId: null, agentId: null };
	}
	const name = gitConfig(cwd, "user.name");
	const email = gitConfig(cwd, "user.email");
	const personId = name && email ? `${name} <${email}>` : null;
	return { personId, agentId: null };
}

/**
 * Load `.amber/identity.json` if it exists and is valid JSON.
 * @param {string} cwd - Repository root.
 * @returns {object|null} Parsed identity fields, or null if absent/malformed.
 */
function loadIdentityFile(cwd) {
	const filePath = path.join(cwd, ".amber", "identity.json");
	if (!fs.existsSync(filePath)) {
		return null;
	}
	try {
		const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
			return null;
		}
		return raw;
	} catch {
		return null;
	}
}

/**
 * Resolve identity using the hybrid strategy (ADR-0019 D4).
 *
 * @param {string} cwd - Repository root.
 * @returns {object} Resolved identity with all fields + source.
 */
function resolveIdentity(cwd) {
	const base = defaultIdentity();
	const file = loadIdentityFile(cwd);
	const git = inferFromGit(cwd);

	const hasFile = file !== null;
	const hasGitPerson = git.personId !== null;

	// Start from defaults
	const result = { ...base };

	// Apply git inference for personId/agentId
	if (hasGitPerson) {
		result.personId = git.personId;
	}
	result.agentId = git.agentId;

	// Apply identity file overrides
	if (hasFile) {
		if (typeof file.tenantId === "string" && file.tenantId) {
			result.tenantId = file.tenantId;
		}
		if (typeof file.organizationId === "string" && file.organizationId) {
			result.organizationId = file.organizationId;
		}
		if (typeof file.repositoryGeneration === "number" && file.repositoryGeneration >= 0) {
			result.repositoryGeneration = file.repositoryGeneration;
		}
		if (typeof file.personId === "string") {
			result.personId = file.personId;
		}
		if (typeof file.agentId === "string") {
			result.agentId = file.agentId;
		}
	}

	// Determine source
	if (hasFile && hasGitPerson && typeof file.personId !== "string") {
		result.source = "identity-file+git";
	} else if (hasFile) {
		result.source = "identity-file";
	} else if (hasGitPerson) {
		result.source = "git-inference";
	} else {
		result.source = "default";
	}

	return result;
}

module.exports = {
	DEFAULT_TENANT_ID,
	DEFAULT_ORGANIZATION_ID,
	DEFAULT_REPOSITORY_GENERATION,
	defaultIdentity,
	gitConfig,
	inferFromGit,
	loadIdentityFile,
	resolveIdentity,
};
