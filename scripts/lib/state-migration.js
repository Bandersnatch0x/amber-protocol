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

// Copy-validate semantics: copy .harness -> .amber, never delete the source,
// refuse when .amber already exists, validate manifests/timelines post-copy.
function migrateState(projectRoot) {
	const source = path.join(projectRoot, LEGACY_STATE_DIR);
	const dest = path.join(projectRoot, CANONICAL_STATE_DIR);
	const result = {
		copied: [],
		skipped: [],
		failed: [],
		errors: [],
		warnings: [],
		validated: { manifests: 0, timelines: 0 },
	};
	if (!fs.existsSync(source)) {
		result.errors.push(`${LEGACY_STATE_DIR} not found at ${source}; nothing to migrate.`);
		return result;
	}
	if (fs.existsSync(dest)) {
		result.errors.push(
			`${CANONICAL_STATE_DIR} already exists at ${dest}; refusing to overwrite. ` +
				"Remove or merge it manually, then re-run.",
		);
		return result;
	}
	for (const file of walk(source)) {
		const rel = path.relative(source, file);
		const target = path.join(dest, rel);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.copyFileSync(file, target);
		result.copied.push(rel.split(path.sep).join("/"));
	}
	// Post-copy validation
	for (const rel of result.copied) {
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
			result.linkUpdates.push(
				path.relative(targetRoot, file).split(path.sep).join("/"),
			);
		}
	}
	return result;
}

module.exports = { migrateState, migrateWiki };
