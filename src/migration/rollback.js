"use strict";

/**
 * Rollback utilities — backup management and restoration.
 */

const fs = require("fs");
const path = require("path");

const BACKUP_PATTERN =
	/^\.backup-(\d{4}-\d{2}-\d{2}-\d{6}(?:-\d{3})*)\.json$/;

/**
 * Find all backup files in a directory, sorted newest first.
 * @param {string} dir - directory to scan
 * @returns {Array<{path: string, timestamp: string, filename: string}>}
 */
function findBackups(dir) {
	if (!fs.existsSync(dir)) return [];

	const entries = fs.readdirSync(dir);
	const backups = [];

	for (const entry of entries) {
		const match = entry.match(BACKUP_PATTERN);
		if (match) {
			backups.push({
				filename: entry,
				timestamp: match[1],
				path: path.join(dir, entry),
			});
		}
	}

	// Sort newest first
	backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

	return backups;
}

/**
 * Create a backup of a settings file.
 * @param {string} settingsPath - path to settings.json
 * @returns {string} path to created backup
 */
function createBackup(settingsPath) {
	const dir = path.dirname(settingsPath);
	const now = new Date();
	const stamp = [
		now.getFullYear(),
		"-",
		String(now.getMonth() + 1).padStart(2, "0"),
		"-",
		String(now.getDate()).padStart(2, "0"),
		"-",
		String(now.getHours()).padStart(2, "0"),
		String(now.getMinutes()).padStart(2, "0"),
		String(now.getSeconds()).padStart(2, "0"),
		"-",
		String(now.getMilliseconds()).padStart(3, "0"),
	].join("");

	const content = fs.readFileSync(settingsPath);
	let suffix = "";
	let backupPath;

	for (let attempt = 0; attempt < 1000; attempt++) {
		const backupName = `.backup-${stamp}${suffix}.json`;
		backupPath = path.join(dir, backupName);
		if (!fs.existsSync(backupPath)) {
			fs.writeFileSync(backupPath, content);
			return backupPath;
		}
		suffix = `-${String(attempt + 1).padStart(3, "0")}`;
	}

	throw new Error(`Unable to create unique backup in ${dir}`);
}

/**
 * Rollback settings to a backup.
 * @param {string} settingsPath - current settings.json path
 * @param {string} backupPath - path to the backup to restore
 * @returns {{ success: boolean, error?: string }}
 */
function rollback(settingsPath, backupPath) {
	try {
		// Validate backup exists
		if (!fs.existsSync(backupPath)) {
			return { success: false, error: `Backup not found: ${backupPath}` };
		}

		// Validate backup is valid JSON
		const backupContent = fs.readFileSync(backupPath, "utf8");
		let parsed;
		try {
			parsed = JSON.parse(backupContent);
		} catch (e) {
			return {
				success: false,
				error: `Backup file is not valid JSON: ${backupPath}`,
			};
		}

		// Validate backup has reasonable structure
		if (!parsed || typeof parsed !== "object") {
			return {
				success: false,
				error: "Backup content is not a valid settings object",
			};
		}

		// Create a pre-rollback backup of current settings
		if (fs.existsSync(settingsPath)) {
			createBackup(settingsPath);
		}

		// Restore
		fs.writeFileSync(settingsPath, backupContent);

		return { success: true };
	} catch (e) {
		return { success: false, error: e.message };
	}
}

module.exports = { findBackups, createBackup, rollback };
