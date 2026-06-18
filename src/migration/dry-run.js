"use strict";

/**
 * Dry-run migration — previews the migration without modifying any files.
 */

const { migrateSettings } = require("./v5-to-phase-b");

/**
 * @param {object} settings - original settings
 * @returns {{ before: object, after: object, diff: Array, summary: string }}
 */
function dryRun(settings) {
	// Match migrateSettings's null-safety (it does `settings || {}`) so the same
	// empty/missing input can't crash the preview while the apply path copes.
	const before = JSON.parse(JSON.stringify(settings || {}));
	const after = migrateSettings(before);

	const diff = computeDiff(before, after);

	return {
		before,
		after,
		diff,
		summary: generateSummary(diff),
	};
}

function computeDiff(before, after) {
	const changes = [];
	const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

	for (const key of allKeys) {
		const beforeVal = before[key];
		const afterVal = after[key];

		if (beforeVal === undefined && afterVal !== undefined) {
			changes.push({
				field: key,
				type: "added",
				before: undefined,
				after: afterVal,
			});
		} else if (beforeVal !== undefined && afterVal === undefined) {
			changes.push({
				field: key,
				type: "removed",
				before: beforeVal,
				after: undefined,
			});
		} else if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
			// Determine if it's a version change, modification, or rename
			const type = key === "version" ? "changed" : "modified";
			changes.push({
				field: key,
				type,
				before: beforeVal,
				after: afterVal,
			});
		}
	}

	return changes;
}

function generateSummary(diff) {
	const added = diff.filter((d) => d.type === "added");
	const removed = diff.filter((d) => d.type === "removed");
	const modified = diff.filter(
		(d) => d.type === "modified" || d.type === "changed",
	);

	const parts = [];
	if (added.length) parts.push(`${added.length} field(s) will be added`);
	if (removed.length) parts.push(`${removed.length} field(s) will be removed`);
	if (modified.length)
		parts.push(`${modified.length} field(s) will be modified`);
	if (parts.length === 0)
		parts.push("No changes needed — settings appear to already be Phase B");

	return parts.join(", ") + ".";
}

module.exports = { dryRun };
