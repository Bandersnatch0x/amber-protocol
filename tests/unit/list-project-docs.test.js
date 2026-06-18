"use strict";

// Integration coverage for listProjectDocs — composes a filesystem walk with
// the ignore-list and documentation heuristics, then sorts. isLikelyDocumentation
// is unit tested alone; this pins the composition (what a real tree yields,
// what the ignore-list drops).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { listProjectDocs } = require("../../scripts/lib/core/audit");

function tempTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "list-docs-"));
}

function write(root, relativePath, content = "x\n") {
	const full = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
}

test("lists documentation files relative to the target, sorted", () => {
	const root = tempTarget();
	write(root, "README.md");
	write(root, "AGENTS.md");
	write(root, "docs/guide.md");
	write(root, "docs/notes.txt"); // under docs/ counts regardless of extension

	assert.deepEqual(listProjectDocs(root), [
		"AGENTS.md",
		"README.md",
		"docs/guide.md",
		"docs/notes.txt",
	]);
});

test("excludes non-documentation source files", () => {
	const root = tempTarget();
	write(root, "README.md");
	write(root, "src/app.js"); // not a doc
	write(root, "config.yaml"); // not a doc

	assert.deepEqual(listProjectDocs(root), ["README.md"]);
});

test("excludes docs that live under ignored directories like node_modules", () => {
	const root = tempTarget();
	write(root, "README.md");
	write(root, "node_modules/pkg/README.md"); // ignored directory
	write(root, "node_modules/pkg/docs/api.md"); // ignored even under docs/

	assert.deepEqual(listProjectDocs(root), ["README.md"]);
});

test("returns an empty array for a project with no documentation", () => {
	const root = tempTarget();
	write(root, "src/index.js");
	assert.deepEqual(listProjectDocs(root), []);
});
