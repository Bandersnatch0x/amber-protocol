"use strict";

/**
 * Migration engine — converts V5.5 settings to Phase B format.
 */

const crypto = require("crypto");

const FIELD_RENAMES = {
	deprecated_field: null, // remove
	legacy_api: null, // remove
	old_config: null, // remove
	legacyMode: null, // remove
	compat: null, // remove
};

/**
 * @param {object} settings - V5.5 settings object
 * @returns {object} Phase B settings object
 */
function migrateSettings(settings) {
	const v55 = JSON.parse(JSON.stringify(settings || {}));
	const phaseB = {};

	// Core fields
	phaseB.version = "1.0.0";
	phaseB.framework = "phase-b";
	phaseB.migrationId = crypto.randomUUID();
	phaseB.migratedAt = new Date().toISOString();
	phaseB.previousVersion = v55.version || "unknown";

	// Preserve and normalize agents
	phaseB.agents = migrateAgents(v55.agents || {});

	// Migrate routes
	phaseB.routes = migrateRoutes(v55.routes || []);

	// Add required Phase B fields
	phaseB.skills = v55.skills || [];
	phaseB.profiles = v55.profiles || {};

	// Copy over known user customizations (not in the deprecated/rename set)
	const knownPhaseBFields = new Set([
		"version",
		"framework",
		"migrationId",
		"migratedAt",
		"previousVersion",
		"agents",
		"routes",
		"skills",
		"profiles",
	]);

	for (const [key, value] of Object.entries(v55)) {
		if (knownPhaseBFields.has(key)) continue;
		if (Object.hasOwn(FIELD_RENAMES, key)) continue;

		// Preserve custom user settings
		phaseB[key] = value;
	}

	return phaseB;
}

function migrateAgents(v55Agents) {
	const agents = {};

	for (const [name, config] of Object.entries(v55Agents)) {
		agents[name] = { ...config };
	}

	// Ensure default agent exists
	if (!agents.default) {
		agents.default = {
			model: "claude-sonnet-4",
			tools: ["read", "write", "execute", "search"],
		};
	}

	return agents;
}

function migrateRoutes(v55Routes) {
	if (!Array.isArray(v55Routes)) return [];

	return v55Routes.map((route) => ({
		...route,
		framework: "phase-b",
		version: "1.0.0",
	}));
}

module.exports = { migrateSettings };
