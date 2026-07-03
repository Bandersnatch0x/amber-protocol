"use strict";

// Install provenance: a record of every template-managed file's hash at install
// time, plus its ownership tier. The scaffold-version detector compares these
// against the currently-shipped template to classify each file as
// fresh / stale / customized / ambiguous. Lives in `.amber/provenance.json`
// (NOT init-report.json, which is only written when detection/wiki insights exist).
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
	TEMPLATE_ROOT,
	CLI_VERSION,
	AMBER_CONTROLLED_CONTENT_FILES,
	AMBER_STATE_FILES,
} = require("./constants");
const { pathExists, readText, writeJson, relativeSlash, walkFiles } = require("./fs-utils");

// Strip YAML-frontmatter `updated:` lines before hashing. A release that bumps
// only the date is metadata, not content; hashing raw bytes would flag every
// template as stale on each release and defeat the detector. Only the
// `updated:` line is removed; other frontmatter is content.
function normalizedContentForHash(text) {
	return text
		.split("\n")
		.filter((line) => !/^updated:\s/.test(line))
		.join("\n");
}

function computeTemplateHash(filePath) {
	if (!pathExists(filePath)) return null;
	try {
		return crypto
			.createHash("sha256")
			.update(normalizedContentForHash(readText(filePath)), "utf8")
			.digest("hex");
	} catch {
		return null;
	}
}

// The set of files Amber's init installs (everything under templates/), as
// repo-relative POSIX paths. The detector and provenance operate over THIS set
// only, so project-created files (F002, F003, …) are never flagged as drift.
function templateManagedFiles(templateRoot = TEMPLATE_ROOT) {
	return walkFiles(templateRoot).map((f) => relativeSlash(templateRoot, f));
}

function fileTier(relPath) {
	if (AMBER_STATE_FILES.has(relPath)) return "state";
	if (AMBER_CONTROLLED_CONTENT_FILES.has(relPath)) return "controlled";
	return "authored";
}

function provenancePath(targetRoot) {
	return path.join(targetRoot, ".amber", "provenance.json");
}

function loadProvenance(targetRoot) {
	const p = provenancePath(targetRoot);
	if (!pathExists(p)) return null;
	try {
		const data = JSON.parse(readText(p));
		if (data && typeof data === "object" && data.files) return data;
	} catch {
		// Corrupt provenance → treat as absent; the detector reports "no provenance".
	}
	return null;
}

// Build a provenance record from the files CURRENTLY ON DISK in targetRoot.
// `templateHash` is the hash of the installed bytes at stamp time (the baseline
// against which future "stale vs customized" is decided). `inferred: true` marks
// a migration baseline for a pre-existing install whose original version is
// unknowable — the detector then refuses to call differing files "stale".
function buildProvenance(targetRoot, { inferred = false, templateRoot = TEMPLATE_ROOT } = {}) {
	const files = {};
	for (const rel of templateManagedFiles(templateRoot)) {
		const installed = path.join(targetRoot, rel);
		if (!pathExists(installed)) continue;
		const installedHash = computeTemplateHash(installed);
		if (installedHash == null) continue;
		files[rel] = { templateHash: installedHash, tier: fileTier(rel) };
	}
	return {
		schemaVersion: 1,
		amberVersion: CLI_VERSION,
		provenanceInferred: inferred,
		recordedAt: new Date().toISOString(),
		files,
	};
}

function writeProvenance(targetRoot, provenance) {
	writeJson(provenancePath(targetRoot), provenance);
	return provenancePath(targetRoot);
}

module.exports = {
	normalizedContentForHash,
	computeTemplateHash,
	templateManagedFiles,
	fileTier,
	provenancePath,
	loadProvenance,
	buildProvenance,
	writeProvenance,
};
