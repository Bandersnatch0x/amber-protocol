"use strict";

const fs = require("fs");
const path = require("path");
const { getSessionsDir } = require("./session-commands");
const { SCHEMA_VERSION } = require("./schema-version-checker");

function migrateManifests(projectRoot, options = {}) {
	const { dryRun = false } = options;
	const sessionsDir = getSessionsDir(projectRoot);

	if (!fs.existsSync(sessionsDir)) {
		return {
			success: true,
			migrated: 0,
			skipped: 0,
			wouldMigrate: 0,
			logs: [],
			message: "No sessions found",
		};
	}

	const sessionDirs = fs.readdirSync(sessionsDir).filter((name) => {
		const manifestPath = path.join(sessionsDir, name, "manifest.json");
		return fs.existsSync(manifestPath);
	});

	let migrated = 0;
	let skipped = 0;
	const logs = [];

	for (const sessionDirName of sessionDirs) {
		const manifestPath = path.join(
			sessionsDir,
			sessionDirName,
			"manifest.json",
		);
		let manifest;
		try {
			manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
		} catch {
			// A corrupt manifest cannot be migrated; skip and log it rather than
			// aborting migration for the healthy sessions beside it.
			skipped++;
			logs.push(`Skipped ${sessionDirName}: manifest is corrupt`);
			continue;
		}

		if (manifest.schemaVersion === SCHEMA_VERSION) {
			skipped++;
			logs.push(`Skipped ${sessionDirName}: already at ${SCHEMA_VERSION}`);
			continue;
		}

		const originalVersion = manifest.schemaVersion || null;

		if (!dryRun) {
			const backupPath = manifestPath + ".backup";
			fs.copyFileSync(manifestPath, backupPath);

			manifest.schemaVersion = SCHEMA_VERSION;
			fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
			logs.push(
				`Migrated ${sessionDirName}: ${originalVersion || "missing"} → ${SCHEMA_VERSION}`,
			);
		} else {
			logs.push(
				`Would migrate ${sessionDirName}: ${manifest.schemaVersion || "missing"} → ${SCHEMA_VERSION}`,
			);
		}

		migrated++;
	}

	return {
		success: true,
		migrated: dryRun ? 0 : migrated,
		skipped,
		wouldMigrate: dryRun ? migrated : 0,
		logs,
		message: dryRun
			? `Would migrate ${migrated} sessions`
			: `Migrated ${migrated} sessions, skipped ${skipped}`,
	};
}

module.exports = { migrateManifests, CURRENT_SCHEMA_VERSION: SCHEMA_VERSION };
