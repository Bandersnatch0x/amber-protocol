"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathExists, resolveTarget } = require("./core/fs-utils");

// Files and directories created by `amber init` that are safe to remove.
// Each entry is { path: string, isDir: boolean }.
const AMBER_GENERATED = [
	{ path: "AGENTS.md", isDir: false },
	{ path: "CLAUDE.md", isDir: false },
	{ path: "CONTEXT.md", isDir: false },
	{ path: "PROGRESS.md", isDir: false },
	{ path: "feature_list.json", isDir: false },
	{ path: "session-handoff.md", isDir: false },
	{ path: "docs/wiki", isDir: true },
	{ path: "docs/adr", isDir: true },
	{ path: "docs/plans", isDir: true },
	{ path: "docs/agents", isDir: true },
	{ path: ".workflow", isDir: true },
	{ path: ".amber", isDir: true },
	{ path: "templates", isDir: true },
	{ path: "standards", isDir: true },
];

function cleanAmber(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const dryRun = Boolean(options.dryRun);
	const removed = [];
	const skipped = [];
	const errors = [];

	for (const entry of AMBER_GENERATED) {
		const fullPath = path.join(targetRoot, entry.path);
		if (!pathExists(fullPath)) {
			continue;
		}

		if (dryRun) {
			removed.push(entry.path);
			continue;
		}

		try {
			fs.rmSync(fullPath, { recursive: true, force: true });
			removed.push(entry.path);
		} catch (err) {
			errors.push(`Cannot remove ${entry.path}: ${err.message}`);
		}
	}

	const warnings = [];
	if (removed.length === 0) {
		warnings.push("No amber-generated files found to remove.");
	}

	return {
		target: targetRoot,
		removed,
		skipped,
		errors,
		warnings,
		dryRun,
	};
}

module.exports = { cleanAmber, AMBER_GENERATED };
