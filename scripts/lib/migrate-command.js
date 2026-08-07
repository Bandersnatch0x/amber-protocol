"use strict";

const fs = require("fs");
const path = require("path");
const { getSessionsDir } = require("./session-commands");
const { SCHEMA_VERSION } = require("./schema-version-checker");
const { CLI_VERSION } = require("./core/constants");

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

function inferArtifactType(obj) {
	if (!obj || typeof obj !== "object") return null;
	if (obj.routeId && Array.isArray(obj.stages)) return "route";
	if (obj.trigger && obj.hardStops) return "loop-contract";
	if (obj.sessionId && obj.route && typeof obj.route === "object") return "session-manifest";
	if (obj.knowledgePlan && typeof obj.knowledgePlan === "object") return "knowledge-plan";
	if (obj.dimensions && Array.isArray(obj.findings)) return "workflow-assessment";
	if (obj.blocks && obj.sources && obj.pageId) return "context-page";
	if (obj.contract && Array.isArray(obj.acceptance)) return "context-request";
	if (obj.timestamp && typeof obj.type === "string") {
		const eventTypes = [
			"session_created", "route_selected", "stage_started", "stage_completed",
			"stage_failed", "verification_failed", "gate_triggered", "gate_passed",
			"gate_failed", "checkpoint_created", "session_paused", "session_resumed",
			"session_completed", "session_failed", "session_aborted", "budget_warning",
			"budget_exceeded", "error",
		];
		if (eventTypes.includes(obj.type)) return "timeline-event";
	}
	return null;
}

/**
 * Backfill the four optional versioning fields (ADR-0012) into Amber artifacts.
 * Only sets fields that are absent — idempotent, never overwrites existing values.
 *
 * @param {string} projectRoot
 * @param {object} [options]
 * @param {boolean} [options.dryRun]
 * @returns {{ success: boolean, backfilled: number, skipped: number, logs: string[], message: string }}
 */
function backfillVersioning(projectRoot, options = {}) {
	const { dryRun = false } = options;
	const amberDir = path.join(projectRoot, ".amber");

	if (!fs.existsSync(amberDir)) {
		return {
			success: true,
			backfilled: 0,
			skipped: 0,
			wouldBackfill: 0,
			logs: [],
			message: "No .amber directory found",
		};
	}

	let backfilled = 0;
	let skipped = 0;
	const logs = [];
	const queue = [amberDir];

	while (queue.length > 0) {
		const dir = queue.shift();
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
				queue.push(full);
			} else if (entry.isFile() && entry.name.endsWith(".json")) {
				let content;
				try {
					content = JSON.parse(fs.readFileSync(full, "utf8"));
				} catch {
					continue;
				}
				if (!content || typeof content !== "object") continue;

				const missing = [];
				if (content.amber_protocol_version === undefined) {
					content.amber_protocol_version = CLI_VERSION;
					missing.push("amber_protocol_version");
				}
				if (content.artifact_sequence === undefined) {
					content.artifact_sequence = 0;
					missing.push("artifact_sequence");
				}
				if (content.created_at === undefined) {
					try {
						const stat = fs.statSync(full);
						content.created_at = new Date(stat.mtimeMs).toISOString();
						missing.push("created_at");
					} catch {
						// stat failed — leave it absent
					}
				}
				if (content.artifact_type === undefined) {
					const inferred = inferArtifactType(content);
					if (inferred) {
						content.artifact_type = inferred;
						missing.push("artifact_type");
					}
				}

				if (missing.length === 0) {
					skipped++;
					continue;
				}

				if (!dryRun) {
					const backupPath = full + ".backup";
					fs.copyFileSync(full, backupPath);
					fs.writeFileSync(full, JSON.stringify(content, null, 2));
					const rel = path.relative(projectRoot, full);
					logs.push(`Backfilled ${rel}: added ${missing.join(", ")}`);
				} else {
					const rel = path.relative(projectRoot, full);
					logs.push(`Would backfill ${rel}: add ${missing.join(", ")}`);
				}

				backfilled++;
			}
		}
	}

	return {
		success: true,
		backfilled: dryRun ? 0 : backfilled,
		skipped,
		wouldBackfill: dryRun ? backfilled : 0,
		logs,
		message: dryRun
			? `Would backfill ${backfilled} artifacts, skipped ${skipped}`
			: `Backfilled ${backfilled} artifacts, skipped ${skipped}`,
	};
}

module.exports = { migrateManifests, backfillVersioning, CURRENT_SCHEMA_VERSION: SCHEMA_VERSION };
