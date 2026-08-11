"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { validateWiki } = require("../scripts/lib/core/validators");
const { scaffoldHarness } = require("../scripts/lib/core/scaffold");
const { run } = require("../scripts/amber.js");

async function runQuiet(argv) {
	const originalLog = console.log;
	const originalError = console.error;
	console.log = () => {};
	console.error = () => {};
	try {
		return await run(argv);
	} finally {
		console.log = originalLog;
		console.error = originalError;
	}
}

function tempDir(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-okf-${name}-`));
}

function writeFile(root, relativePath, content) {
	const filePath = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);
}

const INDEX = [
	"---",
	"type: index",
	"title: Index",
	"description: Root page.",
	"---",
	"",
	"# Index",
].join("\n");

test("OKF mode errors on a wiki page missing the required type field", () => {
	const target = tempDir("missing-type");
	writeFile(target, "docs/wiki/index.md", INDEX);
	writeFile(target, "docs/wiki/notes.md", "# Notes\n\nNo frontmatter here.\n");

	const result = validateWiki(target, { okf: true });

	assert.ok(
		result.errors.some((error) => /notes\.md/.test(error) && /type|frontmatter/i.test(error)),
		`expected an OKF type/frontmatter error for notes.md, got: ${JSON.stringify(result.errors)}`,
	);
});

test("OKF mode warns when a page has type but lacks recommended fields", () => {
	const target = tempDir("missing-recommended");
	writeFile(target, "docs/wiki/index.md", INDEX);
	writeFile(
		target,
		"docs/wiki/sparse.md",
		["---", "type: concept", "---", "", "# Sparse"].join("\n"),
	);

	const result = validateWiki(target, { okf: true });

	assert.deepEqual(result.errors, []);
	assert.ok(
		result.warnings.some(
			(warning) => /sparse\.md/.test(warning) && /title|description/.test(warning),
		),
		`expected an OKF recommended-field warning for sparse.md, got: ${JSON.stringify(result.warnings)}`,
	);
});

test("scaffolded wiki is OKF-conformant under OKF mode", () => {
	const target = tempDir("scaffold");
	scaffoldHarness(target);

	const result = validateWiki(target, { okf: true });

	assert.deepEqual(result.errors, []);
	const okfWarnings = result.warnings.filter((warning) => /OKF/i.test(warning));
	assert.deepEqual(okfWarnings, []);
});

test("wiki --okf CLI exits 0 when conformant and 1 when a page is non-conformant", async () => {
	const target = tempDir("cli");
	scaffoldHarness(target);

	assert.equal(await runQuiet(["wiki", "--target", target, "--okf"]), 0);

	writeFile(target, "docs/wiki/orphan.md", "# Orphan\n\nno frontmatter\n");
	assert.equal(await runQuiet(["wiki", "--target", target, "--okf"]), 1);
});

test("default mode does not apply OKF checks (backward compatible)", () => {
	const target = tempDir("default-mode");
	writeFile(target, "docs/wiki/index.md", "# Index\n");
	writeFile(target, "docs/wiki/notes.md", "# Notes\n\nNo frontmatter.\n");

	const result = validateWiki(target);

	assert.ok(!result.errors.some((error) => /frontmatter|OKF/i.test(error)));
	assert.ok(!result.warnings.some((warning) => /OKF/i.test(warning)));
});
