"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { CANONICAL_STATE_DIR, LEGACY_STATE_DIR } = require("./state-dir-resolver");

function walk(dir) {
	if (!fs.existsSync(dir)) return [];
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full));
		else out.push(full);
	}
	return out;
}

function normalizeRel(filePath) {
	return filePath.split(path.sep).join("/");
}

function filesMatch(a, b) {
	if (!fs.existsSync(a) || !fs.existsSync(b)) return false;
	const aStat = fs.statSync(a);
	const bStat = fs.statSync(b);
	if (aStat.size !== bStat.size) return false;
	return fs.readFileSync(a).equals(fs.readFileSync(b));
}

function timestampForPath(date = new Date()) {
	return date.toISOString().replace(/[:.]/g, "-");
}

function uniqueBackupPath(projectRoot, timestamp) {
	const base = path.join(projectRoot, `.amber-legacy-harness-backup-${timestamp}`);
	let candidate = base;
	let index = 2;
	while (fs.existsSync(candidate)) {
		candidate = `${base}-${index}`;
		index += 1;
	}
	return candidate;
}

function validateCopiedState(dest, rel, result) {
	const target = path.join(dest, rel);
	if (rel.endsWith("manifest.json")) {
		try {
			JSON.parse(fs.readFileSync(target, "utf8"));
			result.validated.manifests += 1;
		} catch {
			result.failed.push(`${rel}: manifest is not valid JSON`);
		}
	} else if (rel.endsWith("timeline.jsonl")) {
		const lines = fs.readFileSync(target, "utf8").split("\n").filter(Boolean);
		try {
			for (const line of lines) JSON.parse(line);
			result.validated.timelines += 1;
		} catch {
			result.failed.push(`${rel}: timeline contains a non-JSON line`);
		}
	}
}

// Copy-validate semantics: merge .harness -> .amber without overwriting existing
// files. By default the legacy source is preserved; --archive-legacy renames it
// after a clean copy/validation so .amber and .harness no longer coexist.
function migrateState(projectRoot, options = {}) {
	const source = path.join(projectRoot, LEGACY_STATE_DIR);
	const dest = path.join(projectRoot, CANONICAL_STATE_DIR);
	const result = {
		copied: [],
		skipped: [],
		conflicts: [],
		failed: [],
		errors: [],
		warnings: [],
		validated: { manifests: 0, timelines: 0 },
		archivedLegacy: false,
		legacyBackupPath: null,
	};
	if (!fs.existsSync(source)) {
		if (fs.existsSync(dest)) {
			result.skipped.push(`${LEGACY_STATE_DIR} not found; ${CANONICAL_STATE_DIR} already exists`);
			result.text = [
				`State migration: ${LEGACY_STATE_DIR} -> ${CANONICAL_STATE_DIR}`,
				"Already consolidated; no legacy state directory found.",
			].join("\n");
			return result;
		}
		result.errors.push(`${LEGACY_STATE_DIR} not found at ${source}; nothing to migrate.`);
		return result;
	}
	for (const file of walk(source)) {
		const rel = normalizeRel(path.relative(source, file));
		const target = path.join(dest, rel);
		if (fs.existsSync(target)) {
			if (filesMatch(file, target)) {
				result.skipped.push(`${rel} (already present)`);
			} else {
				result.conflicts.push(rel);
			}
			continue;
		}
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.copyFileSync(file, target);
		result.copied.push(rel);
	}
	// Post-copy validation for newly introduced manifests/timelines.
	for (const rel of result.copied) {
		validateCopiedState(dest, rel, result);
	}
	if (result.conflicts.length > 0) {
		result.warnings.push(
			`${result.conflicts.length} legacy file(s) differed from existing .amber files and were left in ${LEGACY_STATE_DIR}.`,
		);
	}
	if (options.archiveLegacy) {
		if (result.failed.length > 0 || result.conflicts.length > 0) {
			result.errors.push(
				`Refusing to archive ${LEGACY_STATE_DIR} until validation failures and file conflicts are resolved.`,
			);
		} else {
			const backupPath = uniqueBackupPath(projectRoot, timestampForPath(options.now));
			fs.renameSync(source, backupPath);
			result.archivedLegacy = true;
			result.legacyBackupPath = backupPath;
		}
	}
	result.text = [
		`State migration: ${LEGACY_STATE_DIR} -> ${CANONICAL_STATE_DIR}`,
		`Copied: ${result.copied.length}`,
		`Skipped: ${result.skipped.length}`,
		`Conflicts: ${result.conflicts.length}`,
		`Validated manifests: ${result.validated.manifests}`,
		`Validated timelines: ${result.validated.timelines}`,
		`Legacy archived: ${result.archivedLegacy ? normalizeRel(path.relative(projectRoot, result.legacyBackupPath)) : "no"}`,
	].join("\n");
	return result;
}

// Rename docs/wiki/agent/harness.md -> amber.md in a TARGET repo and rewrite
// links in every wiki markdown file. Required because doctor accepts only the
// new name (decision: new-name-only + forced migration).
function migrateWiki(targetRoot) {
	const agentDir = path.join(targetRoot, "docs", "wiki", "agent");
	const oldPage = path.join(agentDir, "harness.md");
	const newPage = path.join(agentDir, "amber.md");
	const result = { renamed: [], linkUpdates: [], skipped: [], errors: [], warnings: [] };
	if (fs.existsSync(newPage)) {
		result.skipped.push("docs/wiki/agent/amber.md already exists");
		return result;
	}
	if (!fs.existsSync(oldPage)) {
		result.errors.push("docs/wiki/agent/harness.md not found; nothing to migrate.");
		return result;
	}
	fs.renameSync(oldPage, newPage);
	result.renamed.push("docs/wiki/agent/harness.md -> docs/wiki/agent/amber.md");
	const wikiRoot = path.join(targetRoot, "docs", "wiki");
	for (const file of walk(wikiRoot).filter((f) => f.endsWith(".md"))) {
		const content = fs.readFileSync(file, "utf8");
		const updated = content
			.replace(/agent\/harness\.md/g, "agent/amber.md")
			.replace(/\.\/harness\.md/g, "./amber.md");
		if (updated !== content) {
			fs.writeFileSync(file, updated);
			result.linkUpdates.push(path.relative(targetRoot, file).split(path.sep).join("/"));
		}
	}
	return result;
}

module.exports = { migrateState, migrateWiki };
