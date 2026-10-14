"use strict";

/**
 * Guard for the confined-write seam (issue/362).
 *
 * A destination that comes from a CLI flag is how a caller-supplied path reaches a
 * writer, and a leaf sharing its inode with another name is invisible to every path
 * and symlink check: writing it replaces the bytes of every other name, including
 * names outside the target. assertExclusiveLeaf is called per writer today, so this
 * guard turns "a new surface forgot the check" from an escape into a test failure.
 *
 * Exempt: scripts/lib/core/fs-utils.js owns the resolver and the guard itself.
 * shortcut: only destinations written by name are covered; a flag-derived output
 * directory (wiki export, handoff bundle) is guarded per file inside the writer.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EXEMPT_FILES = new Set(["scripts/lib/core/fs-utils.js"]);

// const/let declaration and bare reassignment both produce a resolved destination.
const RESOLVED_ASSIGN =
	/(?:const|let|var)\s+(\w+)\s*=\s*resolvePathWithin\(|(?:^|[;{}\n])[ \t]*(\w+)\s*=\s*resolvePathWithin\(/gm;
const FLAG_DERIVED = /\b(args|options|opts|input|cli)\b/;

const writtenAsDestination = (src, name) =>
	new RegExp(`\\b(?:fs\\.)?(?:writeFileSync|appendFileSync)\\(\\s*${name}\\s*,`).test(src) ||
	new RegExp(`\\b(?:writeJson|writeJsonPrettier)\\(\\s*${name}\\s*[,)]`).test(src) ||
	new RegExp(`\\bcopyFileSync\\([^,]+,\\s*${name}\\s*[,)]`).test(src);

const leafChecked = (src, name) =>
	new RegExp(`assertExclusiveLeaf\\([^)]*\\b${name}\\b\\s*[,)]`).test(src);

function productionSources() {
	const found = [];
	(function walk(dir) {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === "node_modules" || entry.name === ".git") continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".js")) found.push(full);
		}
	})(path.join(REPO_ROOT, "scripts"));
	return found.filter((full) => !full.includes(`${path.sep}tests${path.sep}`));
}

function offensesFor(source) {
	const src = fs.readFileSync(source, "utf8");
	if (!src.includes("resolvePathWithin(")) return [];
	const rel = path.relative(REPO_ROOT, source).split(path.sep).join("/");
	if (EXEMPT_FILES.has(rel)) return [];
	const offenses = [];
	let match;
	RESOLVED_ASSIGN.lastIndex = 0;
	while ((match = RESOLVED_ASSIGN.exec(src))) {
		const name = match[1] || match[2];
		const statement = src.slice(match.index, src.indexOf(";", match.index) + 1);
		if (!FLAG_DERIVED.test(statement)) continue;
		if (!writtenAsDestination(src, name)) continue;
		if (leafChecked(src, name)) continue;
		offenses.push(`${rel}:${src.slice(0, match.index).split(/\r?\n/).length} ${name}`);
	}
	return offenses;
}

test("every flag-derived confined write destination is leaf-checked", () => {
	const offenses = productionSources().flatMap(offensesFor);
	assert.deepEqual(
		offenses,
		[],
		"a destination taken from a CLI flag can be written through a shared inode",
	);
});
