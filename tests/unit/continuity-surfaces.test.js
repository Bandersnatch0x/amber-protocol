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

test("ensureContinuitySurfaces installs MEMORY.md with the capability creed (F027)", () => {
	const root = tempRoot();
	ensureContinuitySurfaces(root);
	const content = fs.readFileSync(path.join(root, "MEMORY.md"), "utf8");
	// The template (preferred over the inline legacy fallback) carries the
	// creed heading plus the write / do-not-write contract and closing line.
	assert.match(content, /## Memory creed — capability, not ceremony/);
	assert.match(content, /durable operator preference or correction/);
	assert.match(content, /decision that reverses an earlier one/);
	assert.match(content, /get wrong twice/);
	assert.match(content, /notes\.md/);
	assert.match(content, /git history/);
	assert.match(content, /transient task state/);
	assert.match(content, /Every entry must change a future decision or be deleted\./);
	// The original starter text survives below the creed.
	assert.match(content, /Durable project knowledge selected by humans\./);
});

test("ensureContinuitySurfaces never overwrites an authored MEMORY.md (writeIfMissing)", () => {
	const root = tempRoot();
	ensureContinuitySurfaces(root);
	const authored =
		"# Memory\n\nHand-written operator knowledge; the creed must not clobber this.\n";
	const memoryPath = path.join(root, "MEMORY.md");
	fs.writeFileSync(memoryPath, authored);
	ensureContinuitySurfaces(root);
	assert.equal(fs.readFileSync(memoryPath, "utf8"), authored);
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
