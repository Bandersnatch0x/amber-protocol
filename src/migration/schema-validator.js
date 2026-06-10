"use strict";

/**
 * Schema validator — detects version and validates upgrade compatibility.
 */

const V55_KNOWN_FIELDS = new Set([
	"version", "agents", "routes", "skills",
]);

const PHASE_B_KNOWN_FIELDS = new Set([
	"version", "framework", "agents", "skills", "routes",
	"profiles", "migratedAt", "migrationId",
]);

const DEPRECATED_FIELDS = new Set([
	"deprecated_field", "legacy_api", "old_config",
	"legacyMode", "compat",
]);

const REMOVED_FIELDS = new Set([
	"deprecated_field",
]);

/**
 * @param {object} settings
 * @returns {"5.5" | "phase-b" | null}
 */
function detectVersion(settings) {
	if (!settings || typeof settings !== "object") return null;

	if (settings.framework === "phase-b" && settings.version) {
		return "phase-b";
	}

	if (settings.version === "5.5") {
		return "5.5";
	}

	return null;
}

/**
 * @param {object} settings - V5.5 settings
 * @param {string} targetVersion - target framework version
 * @returns {{ compatible: boolean, breakingChanges: Array, deprecatedFields: Array, warnings: Array }}
 */
function validateUpgrade(settings, targetVersion) {
	const breakingChanges = [];
	const deprecatedFields = [];
	const warnings = [];

	if (!settings || typeof settings !== "object") {
		return {
			compatible: false,
			breakingChanges: [{ field: "root", message: "Settings is not a valid object" }],
			deprecatedFields: [],
			warnings: [],
		};
	}

	// Check for removed fields
	for (const field of REMOVED_FIELDS) {
		if (Object.hasOwn(settings, field)) {
			breakingChanges.push({
				field,
				message: `Field "${field}" has been removed in Phase B`,
				severity: "breaking",
			});
		}
	}

	// Check for deprecated fields
	for (const field of DEPRECATED_FIELDS) {
		if (Object.hasOwn(settings, field)) {
			deprecatedFields.push({
				field,
				message: `Field "${field}" is deprecated and will be removed`,
				severity: "warning",
			});
		}
	}

	// Additional compatibility checks
	if (!settings.agents) {
		warnings.push({
			field: "agents",
			message: "No agents configured. Default agent will be created.",
		});
	}

	return {
		compatible: breakingChanges.length === 0,
		breakingChanges,
		deprecatedFields,
		warnings,
	};
}

module.exports = { detectVersion, validateUpgrade };
