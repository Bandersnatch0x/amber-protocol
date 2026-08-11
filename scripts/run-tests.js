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
			collectFilesBySuffix(resolved, ".test.js", TEST_IGNORED_DIRS).forEach((filePath) => {
				files.push(filePath);
			});
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

// Leak guard: tests must isolate session state via --target / mkdtemp /
// fixtures, never write into the repo-root .amber/sessions/. Snapshot before
// the run, diff after; any new session dir is a leak we clean up and fail on.
// (The prior 6082-session accumulation — and the 9s governance scan it caused
// — came from exactly this kind of leak piling up across runs.)
const SESSIONS_DIR = path.join(ROOT, ".amber", "sessions");
function listRootSessions() {
	if (!fs.existsSync(SESSIONS_DIR)) return [];
	return fs
		.readdirSync(SESSIONS_DIR)
		.filter((name) => fs.statSync(path.join(SESSIONS_DIR, name)).isDirectory());
}
const sessionsBefore = new Set(listRootSessions());

const result = spawnSync(process.execPath, ["--test", ...files], {
	stdio: "inherit",
	cwd: ROOT,
});

const leaked = listRootSessions().filter((id) => !sessionsBefore.has(id));
if (leaked.length > 0) {
	console.error("");
	console.error(
		`[amber] test-suite leak guard: ${leaked.length} session(s) written to repo-root .amber/sessions/ during this run.`,
	);
	console.error(
		"Tests must isolate session state via --target / mkdtemp / fixtures, never the repo root.",
	);
	for (const id of leaked) {
		console.error(`  ${id}`);
		fs.rmSync(path.join(SESSIONS_DIR, id), { recursive: true, force: true });
	}
	console.error("[amber] cleaned up leaked sessions; failing the run.");
	process.exit(1);
}

process.exit(result.status ?? 1);
