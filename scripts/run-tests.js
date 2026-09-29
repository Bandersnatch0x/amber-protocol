"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
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

// Temp sweep, scoped to a RUN-OWNED root. Suites that build fixtures with raw
// fs.mkdtempSync instead of harness.js trackTempDir leave amber-* trees in
// Temp forever (2026-09: ~150k leaked dirs/week ate the whole system drive),
// but a runner that deletes every amber-* directory that merely APPEARED
// during the run also deletes a concurrent session's in-flight fixtures:
// appearing is not ownership. TMPDIR/TEMP/TMP are re-pointed at this directory
// for the child, so every os.tmpdir() fixture the run creates lands inside it
// and the post-run sweep can only ever remove directories this run created.
// Prefer new fixtures via harness.js trackTempDir, which needs no sweep at all.
const RUN_TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "amber-test-run-"));
function removeRunTempRoot() {
	try {
		fs.rmSync(RUN_TEMP_ROOT, { recursive: true, force: true, maxRetries: 3 });
		return true;
	} catch (error) {
		console.error(`[amber] test-run cleanup failed: ${RUN_TEMP_ROOT}: ${error.message}`);
		return false;
	}
}

// Relative paths keep the command line inside the Windows 32K limit even
// from a deep worktree root (325 absolute paths overflow it: ENAMETOOLONG).
const result = spawnSync(
	process.execPath,
	// ponytail: cap parallel test files so nested `node --test` (CLI-spawning
	// suites, validator self-test dispatch) can't fork-bomb the box — saw ~3370
	// node procs at peak. Raise the number if the run gets too slow.
	["--test", "--test-concurrency=4", ...files.map((file) => path.relative(ROOT, file))],
	{
		stdio: "inherit",
		cwd: ROOT,
		// One run-owned Temp root: every os.tmpdir() fixture the suites create
		// lands inside it, which is what makes the sweep below ownership-safe.
		env: {
			...process.env,
			TMPDIR: RUN_TEMP_ROOT,
			TEMP: RUN_TEMP_ROOT,
			TMP: RUN_TEMP_ROOT,
		},
	},
);
if (result.error) {
	console.error(`[amber] test runner failed to launch: ${result.error.message}`);
	// Tear down whatever the crashed launch already left behind before bailing.
	removeRunTempRoot();
	process.exit(1);
}

// The run-owned root is removed WHOLE: it holds every fixture this run created
// (amber-* and any other prefix), so no prefix scanning is needed and nothing
// outside the root is ever touched. A cleanup failure stays visible and fails an
// otherwise-successful run, without replacing an existing failure code — a
// failing test run keeps its own status.
const tempCleaned = removeRunTempRoot();
if (!tempCleaned && (result.status ?? 1) === 0) {
	console.error("[amber] temp cleanup failed; failing an otherwise successful run.");
	process.exit(1);
}

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
