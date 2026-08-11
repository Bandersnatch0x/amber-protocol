"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildOkfGraph, exportOkfBundle } = require("../scripts/lib/core/okf-export");
const { OKF_VERSION } = require("../scripts/lib/core/okf-frontmatter");

function tempDir(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-okfx-${name}-`));
}

function writeFile(root, relativePath, content) {
	const filePath = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);
}

function smallWiki(target) {
	writeFile(
		target,
		"docs/wiki/index.md",
		[
			"---",
			"type: index",
			"title: Index",
			"description: Root.",
			"---",
			"",
			"# Index",
			"",
			"[A](a.md)",
		].join("\n"),
	);
	writeFile(
		target,
		"docs/wiki/a.md",
		["---", "type: concept", "title: Alpha", "description: A page.", "---", "", "# Alpha"].join(
			"\n",
		),
	);
}

test("buildOkfGraph derives nodes from wiki pages and edges from internal links", () => {
	const target = tempDir("graph");
	smallWiki(target);

	const graph = buildOkfGraph(target);

	assert.equal(graph.nodes.length, 2);
	const index = graph.nodes.find((n) => n.id === "index.md");
	assert.equal(index.title, "Index");
	assert.equal(index.type, "index");
	assert.ok(
		graph.edges.some((e) => e.source === "index.md" && e.target === "a.md"),
		`expected an edge index.md -> a.md, got: ${JSON.stringify(graph.edges)}`,
	);
});

test("exportOkfBundle writes an okf.json manifest, copies pages, and emits a graph visualizer", () => {
	const target = tempDir("bundle");
	smallWiki(target);
	const outputDir = path.join(tempDir("out"), "bundle");

	const result = exportOkfBundle(target, { outputDir });

	assert.deepEqual(result.errors, []);
	assert.equal(result.nodeCount, 2);

	const manifestPath = path.join(outputDir, "okf.json");
	assert.ok(fs.existsSync(manifestPath), "okf.json should exist");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	assert.equal(manifest.okfVersion, OKF_VERSION);
	assert.equal(manifest.concepts.length, 2);

	assert.ok(fs.existsSync(path.join(outputDir, "index.md")), "pages should be copied");

	const graphHtmlPath = path.join(outputDir, "graph.html");
	assert.ok(fs.existsSync(graphHtmlPath), "graph.html visualizer should exist");
	const html = fs.readFileSync(graphHtmlPath, "utf8");
	assert.ok(html.includes("Alpha"), "visualizer should embed page titles");
	assert.ok(/<html/i.test(html), "visualizer should be a self-contained HTML document");
});
