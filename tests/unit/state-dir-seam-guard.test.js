"use strict";

/**
 * Guard for the state-dir seam (F036 slice 2).
 *
 * Production code under scripts/lib/** and scripts/amber.js must not build
 * state-dir paths by joining a literal ".amber" segment: every such path goes
 * through statePath()/statePathForCreate() from scripts/lib/state-dir-resolver.js
 * (read policy falls back to legacy .harness; create policy always targets
 * .amber). A hardcoded join would silently strand state on the wrong side of
 * the rename, which is exactly the class of bug this seam exists to prevent.
 *
 * Exempt files:
 *   - scripts/lib/state-dir-resolver.js — owns the seam and its constants.
 *   - scripts/lib/state-migration.js — owns the .harness → .amber migration
 *     policy and must address both dirs literally.
 *
 * Display strings, artifact-path registries, and prefix classifications that
 * merely mention ".amber" (without joining it into a path) are out of scope.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCAN_TARGETS = [
	path.join(REPO_ROOT, "scripts", "lib"),
	path.join(REPO_ROOT, "scripts", "amber.js"),
];
const EXEMPT_FILES = new Set([
	"scripts/lib/state-dir-resolver.js",
	"scripts/lib/state-migration.js",
]);

// Single-line offense: path.join(..., ".amber", ...) with the literal segment
// anywhere in the argument list before the statement ends.
const INLINE_JOIN_WITH_AMBER = /path\.join\([^;]*["']\.amber["']/;

// Multi-line offense: a standalone ".amber" segment line inside a call whose
// arguments continue onto the next line (e.g. a path.join( split across lines).
const STANDALONE_AMBER_SEGMENT = /^\s*["']\.amber["']\s*(?:,|\)|$)/;

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
	const files = SCAN_TARGETS.flatMap((target) => collectJsFiles(target)).sort();
	const relativeFiles = files.map((file) => toPosix(path.relative(REPO_ROOT, file)));

	// The guard is only meaningful if it actually walks the production tree:
	// fail loudly if the layout moved out from under it.
	assert.ok(
		relativeFiles.length > 40,
		`expected to scan 40+ production files, found ${relativeFiles.length}`,
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
		const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
		lines.forEach((line, i) => {
			if (INLINE_JOIN_WITH_AMBER.test(line) || STANDALONE_AMBER_SEGMENT.test(line)) {
				offenders.push(`${relativePath}:${i + 1}: ${line.trim()}`);
			}
		});
	}
	return offenders;
}

test("production code joins state-dir paths only through the state-dir seam", () => {
	const offenders = findOffenders();
	assert.deepEqual(
		offenders,
		[],
		[
			"Hardcoded .amber path.join site(s) found in production code.",
			"Use statePath() (read, legacy .harness fallback) or statePathForCreate()",
			"(create, always .amber) from scripts/lib/state-dir-resolver.js instead:",
			"",
			...offenders,
		].join("\n"),
	);
});
