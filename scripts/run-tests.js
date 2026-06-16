"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TESTS_DIR = path.join(ROOT, "tests");

function collectTestFiles(dir, files = []) {
	if (!fs.existsSync(dir)) {
		return files;
	}

	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			collectTestFiles(fullPath, files);
		} else if (entry.isFile() && entry.name.endsWith(".test.js")) {
			files.push(fullPath);
		}
	}

	return files;
}

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
			collectTestFiles(resolved, files);
		} else {
			files.push(resolved);
		}
	}

	return files;
}

const patterns = process.argv.slice(2);
const files = (
	patterns.length > 0 ? resolveRequestedFiles(patterns) : collectTestFiles(TESTS_DIR)
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