"use strict";

const path = require("node:path");

const { statePathForCreate } = require("../state-dir-resolver");
const { resolvePathWithin } = require("./fs-utils");

const REQUIRED_BUNDLE_FILES = [
	"README.md",
	"session-summary.md",
	"verification-evidence.md",
	"next-actions.md",
	"risks.md",
	"recovery-commands.md",
	"manifest.json",
];

function slash(value) {
	return value.split(path.sep).join("/");
}

// Handoff bundles (post-rename state kind, 2026-07-13): bundle state never
// existed under .harness, so reads (validate) and creates (produce) both
// target the canonical dir (see the note in organization-audit.js).
function defaultBundleDir(targetRoot) {
	return statePathForCreate(targetRoot, "handoff", "latest");
}

// The bundle is a target-scoped artifact, so its destination cannot land outside
// the target the command reports it wrote into.
function resolveTargetRelativePath(targetRoot, candidate) {
	if (!candidate) return defaultBundleDir(targetRoot);
	return resolvePathWithin(targetRoot, candidate, {
		label: "Handoff bundle directory",
		allowRoot: true,
		canonicalExisting: true,
	});
}

module.exports = {
	REQUIRED_BUNDLE_FILES,
	defaultBundleDir,
	resolveTargetRelativePath,
	slash,
};
