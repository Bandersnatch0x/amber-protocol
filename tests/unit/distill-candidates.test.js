"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
	findDistillCandidates,
	writeDistillProposal,
} = require("../../scripts/lib/distill-candidates");

function tempRoot() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-distill-"));
}

function writeFile(root, relativePath, content) {
	const filePath = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);
}

test("findDistillCandidates returns only repeated findings", () => {
	const root = tempRoot();
	writeFile(
		root,
		path.join("docs", "superpowers", "plans", "a.md"),
		"# Fix auth\n\n## Add tests\n",
	);
	writeFile(
		root,
		path.join("docs", "superpowers", "plans", "b.md"),
		"# Fix auth\n\n## Add tests\n",
	);
	writeFile(
		root,
		path.join("docs", "superpowers", "plans", "c.md"),
		"# Unique plan\n",
	);

	const candidates = findDistillCandidates(root);
	const texts = candidates.map((c) => c.text);
	assert.ok(texts.includes("Fix auth"));
	assert.ok(texts.includes("Add tests"));
	assert.ok(!texts.includes("Unique plan"));
});

test("writeDistillProposal writes a markdown report", () => {
	const root = tempRoot();
	writeFile(
		root,
		path.join("docs", "superpowers", "plans", "a.md"),
		"# Fix auth\n",
	);
	writeFile(
		root,
		path.join("docs", "superpowers", "plans", "b.md"),
		"# Fix auth\n",
	);
	const output = path.join(root, "docs", "maintenance", "distill-proposals.md");

	const result = writeDistillProposal(root, output);
	assert.equal(result.outputPath, output);
	assert.ok(fs.existsSync(output));
	const report = fs.readFileSync(output, "utf8");
	assert.match(report, /# Distill Proposals/);
	assert.match(report, /Fix auth/);
});
