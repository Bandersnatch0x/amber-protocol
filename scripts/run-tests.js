"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { collectFilesBySuffix } = require("./lib/core/fs-utils");

const ROOT = path.resolve(__dirname, "..");
const TESTS_DIR = path.join(ROOT, "tests");
const TEST_IGNORED_DIRS = new Set(["node_modules", "fixtures"]);

function resolveRequestedFiles(patterns) {
	const files = [];

	for (const pattern of patterns) {
		const resolved = path.resolve(ROOT, pattern);
		if (!fs.existsSync(resolved)) {
			console.error(`Test path not found: ${pattern}`);
			process.exit(1);
		}

		const stats = fs.statSync(resolved);
		if (stats.isDirectory()) {
			collectFilesBySuffix(resolved, ".test.js", TEST_IGNORED_DIRS).forEach(
				(filePath) => {
					files.push(filePath);
				},
			);
		} else {
			files.push(resolved);
		}
	}

	return files;
}

const patterns = process.argv.slice(2);
const files = (
	patterns.length > 0
		? resolveRequestedFiles(patterns)
		: collectFilesBySuffix(TESTS_DIR, ".test.js", TEST_IGNORED_DIRS)
).sort();

if (files.length === 0) {
	console.error("No test files found.");
	process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], {
	stdio: "inherit",
	cwd: ROOT,
});

process.exit(result.status ?? 1);