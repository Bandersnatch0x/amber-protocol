"use strict";

const path = require("node:path");

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

function defaultBundleDir(targetRoot) {
	return path.join(targetRoot, ".amber", "handoff", "latest");
}

function resolveTargetRelativePath(targetRoot, candidate) {
	if (!candidate) return defaultBundleDir(targetRoot);
	return path.isAbsolute(candidate) ? candidate : path.resolve(targetRoot, candidate);
}

module.exports = {
	REQUIRED_BUNDLE_FILES,
	defaultBundleDir,
	resolveTargetRelativePath,
	slash,
};
