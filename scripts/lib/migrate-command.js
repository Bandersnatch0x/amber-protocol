"use strict";

const fs = require("fs");
const path = require("path");
const { getSessionsDir } = require("./session-commands");
const { SCHEMA_VERSION } = require("./schema-version-checker");
const { CLI_VERSION } = require("./core/constants");

function writeJsonWithBackup(filePath, value) {
	const backupPath = `${filePath}.backup`;
	if (!fs.existsSync(backupPath)) fs.copyFileSync(filePath, backupPath);
	fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function migrateSessionManifest(sessionsDir, sessionDirName, dryRun) {
	const manifestPath = path.join(sessionsDir, sessionDirName, "manifest.json");
	let manifest;
	try {
		manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	} catch {
		return { skipped: true, log: `Skipped ${sessionDirName}: manifest is corrupt` };
	}
	if (manifest.schemaVersion === SCHEMA_VERSION) {
		return { skipped: true, log: `Skipped ${sessionDirName}: already at ${SCHEMA_VERSION}` };
	}
	const originalVersion = manifest.schemaVersion || null;
	if (dryRun) {
		return { migrated: true, log: `Would migrate ${sessionDirName}: ${originalVersion || "missing"} → ${SCHEMA_VERSION}` };
	}
	manifest.schemaVersion = SCHEMA_VERSION;
	writeJsonWithBackup(manifestPath, manifest);
	return { migrated: true, log: `Migrated ${sessionDirName}: ${originalVersion || "missing"} → ${SCHEMA_VERSION}` };
}

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
		const result = migrateSessionManifest(sessionsDir, sessionDirName, dryRun);
		if (result.skipped) skipped++;
		if (result.migrated) migrated++;
		logs.push(result.log);
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

function collectJsonArtifacts(projectRoot) {
	const files = [];
	const queue = [
		path.join(projectRoot, ".amber"),
		path.join(projectRoot, "routes"),
		path.join(projectRoot, "workflow-packs"),
	].filter((root) => fs.existsSync(root));
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
				files.push(full);
			}
		}
	}
	return files;
}

function addMissingVersionFields(content, filePath, artifactType) {
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
			content.created_at = new Date(fs.statSync(filePath).mtimeMs).toISOString();
			missing.push("created_at");
		} catch {
			// Leave created_at absent when the source timestamp is unreadable.
		}
	}
	if (content.artifact_type === undefined) {
		content.artifact_type = artifactType;
		missing.push("artifact_type");
	}
	return missing;
}

function versioningTargets(content) {
	const candidates = Array.isArray(content.loopContracts)
		? content.loopContracts
		: [content];
	return candidates.flatMap((candidate) => {
		if (!candidate || typeof candidate !== "object") return [];
		const declaredType = typeof candidate.artifact_type === "string"
			? candidate.artifact_type.trim()
			: "";
		const artifactType = declaredType || inferArtifactType(candidate);
		return artifactType ? [{ content: candidate, artifactType }] : [];
	});
}

function backfillJsonArtifact(projectRoot, filePath, dryRun) {
	let content;
	try {
		content = JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return null;
	}
	if (!content || typeof content !== "object") return null;
	const targets = versioningTargets(content);
	if (targets.length === 0) return null;
	const changes = targets
		.map((target) => addMissingVersionFields(target.content, filePath, target.artifactType))
		.filter((missing) => missing.length > 0);
	if (changes.length === 0) return { skipped: targets.length };
	const relative = path.relative(projectRoot, filePath);
	const fields = [...new Set(changes.flat())].join(", ");
	if (dryRun) {
		return { backfilled: changes.length, log: `Would backfill ${relative}: add ${fields}` };
	}
	writeJsonWithBackup(filePath, content);
	return { backfilled: changes.length, log: `Backfilled ${relative}: added ${fields}` };
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
	const artifactPaths = collectJsonArtifacts(projectRoot);

	if (artifactPaths.length === 0) {
		return {
			success: true,
			backfilled: 0,
			skipped: 0,
			wouldBackfill: 0,
			logs: [],
			message: "No Amber artifacts found",
		};
	}

	let backfilled = 0;
	let skipped = 0;
	const logs = [];
	for (const filePath of artifactPaths) {
		const result = backfillJsonArtifact(projectRoot, filePath, dryRun);
		if (!result) continue;
		if (result.skipped) skipped += result.skipped;
		if (result.backfilled) backfilled += result.backfilled;
		if (result.log) logs.push(result.log);
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
