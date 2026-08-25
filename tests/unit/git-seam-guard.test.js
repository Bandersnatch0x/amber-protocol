"use strict";

/**
 * Guard for the git adapter seam (F037, survey Finding 4).
 *
 * Production code under scripts/lib/** must not spawn git directly: every git
 * invocation goes through scripts/lib/core/git-exec.js (gitExec / gitOutput /
 * gitRun / isRepository / configGet) so the "never throw, degrade gracefully"
 * policy and the {ok, status, stdout, stderr} failure shape live in exactly
 * one module. A direct spawnSync("git", ...) reintroduces a private failure
 * policy — the exact drift Finding 4 documented across sync-session.js,
 * identity.js, and worktree-manager.js.
 *
 * Exempt files:
 *   - scripts/lib/core/git-exec.js — owns the seam and is the only legal
 *     direct spawner.
 *
 * scripts/demo/**, scripts/validate-*.js, and tests live outside scripts/lib
 * and are out of scope by construction. Display strings that merely mention
 * git (e.g. sync-session's proposed-ops list) never follow a spawn call and do
 * not match.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCAN_TARGET = path.join(REPO_ROOT, "scripts", "lib");
const EXEMPT_FILES = new Set(["scripts/lib/core/git-exec.js"]);

// Direct git spawn: the sync child_process entry points with "git" as the
// command — exact-string form (spawnSync("git", [...])) or the head of a
// string command (execSync("git init ...")). \s* spans newlines so a call with
// the command on the following line is still caught.
const DIRECT_GIT_SPAWN = /\b(?:spawnSync|execFileSync|execSync)\(\s*["']git(?:["']|\s)/;

function toPosix(value) {
	return value.replace(/\\/g, "/");
}

function collectJsFiles(entry) {
	const stat = fs.statSync(entry);
	if (stat.isFile()) {
		return entry.endsWith(".js") ? [entry] : [];
	}
	const out = [];
	for (const name of fs.readdirSync(entry).sort()) {
		out.push(...collectJsFiles(path.join(entry, name)));
	}
	return out;
}

function findOffenders() {
	const offenders = [];
	const files = collectJsFiles(SCAN_TARGET).sort();
	const relativeFiles = files.map((file) => toPosix(path.relative(REPO_ROOT, file)));

	// The guard is only meaningful if it actually walks the production tree:
	// fail loudly if the layout moved out from under it.
	assert.ok(
		relativeFiles.length > 100,
		`expected to scan 100+ production files, found ${relativeFiles.length}`,
	);
	for (const exempt of EXEMPT_FILES) {
		assert.ok(
			relativeFiles.includes(exempt),
			`exempt file ${exempt} no longer exists — update the exemption list`,
		);
	}

	for (const [index, file] of files.entries()) {
		const relativePath = relativeFiles[index];
		if (EXEMPT_FILES.has(relativePath)) continue;
		const content = fs.readFileSync(file, "utf8");
		const match = DIRECT_GIT_SPAWN.exec(content);
		if (match) {
			const line = content.slice(0, match.index).split(/\r?\n/).length;
			offenders.push(`${relativePath}:${line}: ${match[0]}`);
		}
	}
	return offenders;
}

test("production code spawns git only through the git-exec seam", () => {
	const offenders = findOffenders();
	assert.deepEqual(
		offenders,
		[],
		[
			"Direct git spawn(s) found in production code.",
			"Use gitExec()/gitOutput()/gitRun()/isRepository()/configGet() from",
			"scripts/lib/core/git-exec.js instead:",
			"",
			...offenders,
		].join("\n"),
	);
});
