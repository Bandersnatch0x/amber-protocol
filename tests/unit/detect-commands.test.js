"use strict";

// Behavioral coverage for detectCommands — extracts verification commands from a
// project's package.json scripts and Makefile. Only the negative case (no
// commands -> no "Detected commands:" header) was exercised via the CLI; the
// extraction logic and the malformed-package.json path were untested.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { detectCommands } = require("../../scripts/lib/core/audit");

function tempTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "detect-commands-"));
}

test("extracts package.json scripts as package.json-sourced commands", () => {
	const root = tempTarget();
	fs.writeFileSync(
		path.join(root, "package.json"),
		JSON.stringify({ scripts: { test: "node --test", lint: "eslint ." } }),
	);
	const commands = detectCommands(root);
	assert.deepEqual(commands, [
		{ source: "package.json", name: "test", command: "node --test" },
		{ source: "package.json", name: "lint", command: "eslint ." },
	]);
});

test("detects a Makefile as a make command", () => {
	const root = tempTarget();
	fs.writeFileSync(path.join(root, "Makefile"), "test:\n\tnode --test\n");
	const commands = detectCommands(root);
	assert.deepEqual(commands, [
		{ source: "Makefile", name: "make", command: "make <target>" },
	]);
});

test("records a parse issue for a malformed package.json instead of throwing", () => {
	const root = tempTarget();
	fs.writeFileSync(path.join(root, "package.json"), "{ not valid json ");
	const parseIssues = [];
	const commands = detectCommands(root, parseIssues);
	assert.deepEqual(commands, []);
	assert.equal(parseIssues.length, 1);
	assert.equal(parseIssues[0].source, "package.json");
	assert.ok(parseIssues[0].message);
});

test("returns no commands for a project with neither package.json nor Makefile", () => {
	assert.deepEqual(detectCommands(tempTarget()), []);
});

test("a package.json without a scripts section yields no commands", () => {
	const root = tempTarget();
	fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "x" }));
	assert.deepEqual(detectCommands(root), []);
});
