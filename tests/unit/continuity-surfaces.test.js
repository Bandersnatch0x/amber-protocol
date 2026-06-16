"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
	ensureContinuitySurfaces,
	appendTaskProgress,
} = require("../../scripts/lib/continuity-surfaces");

function tempRoot() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-continuity-"));
}

test("ensureContinuitySurfaces creates stable repo-local paths idempotently", () => {
	const root = tempRoot();
	const first = ensureContinuitySurfaces(root);
	const second = ensureContinuitySurfaces(root);
	assert.deepEqual(first, second);
	assert.ok(fs.existsSync(path.join(root, "MEMORY.md")));
	assert.ok(fs.existsSync(path.join(root, "notes.md")));
	assert.ok(fs.existsSync(path.join(root, "tasks", "README.md")));
});

test("appendTaskProgress rejects unsafe task ids", () => {
	const root = tempRoot();
	assert.throws(() => appendTaskProgress(root, "../escape", "bad"), /unsafe task id/);
});

test("appendTaskProgress writes a task progress entry", () => {
	const root = tempRoot();
	const relativePath = appendTaskProgress(root, "T001", "Started recovery review.");
	const filePath = path.join(root, relativePath);
	assert.ok(fs.existsSync(filePath));
	const content = fs.readFileSync(filePath, "utf8");
	assert.match(content, /Started recovery review\./);
});
