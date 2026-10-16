"use strict";
const { trackTempDir } = require("./helpers/harness");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildOkfGraph, exportOkfBundle } = require("../scripts/lib/core/okf-export");
const { OKF_VERSION } = require("../scripts/lib/core/okf-frontmatter");

function tempDir(name) {
	return trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), `amber-okfx-${name}-`)));
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
	const outputDir = path.join(target, "out", "bundle");

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

for (const { rel, directory, missing } of [
	{ rel: "a.md" },
	{ rel: "okf.json" },
	{ rel: "graph.html" },
	{ rel: "okf.json", missing: true },
	{ rel: "nested", directory: true },
]) {
	test(`exportOkfBundle preflights the ${rel} output link${missing ? " to a missing file" : ""}`, () => {
		const target = tempDir("child-link");
		const outside = tempDir("child-link-out");
		smallWiki(target);
		writeFile(target, "docs/wiki/nested/deep/page.md", "# Nested page\n");
		const outputDir = path.join(target, "out");
		fs.mkdirSync(outputDir, { recursive: true });
		fs.writeFileSync(path.join(outputDir, "index.md"), "user index\n");
		const outsideFile = path.join(outside, "victim");
		if (!missing) fs.writeFileSync(outsideFile, "user outside\n");
		fs.symlinkSync(
			directory ? outside : outsideFile,
			path.join(outputDir, rel),
			directory ? (process.platform === "win32" ? "junction" : "dir") : "file",
		);
		const before = fs.readdirSync(outputDir).sort();
		const outsideBefore = fs.readdirSync(outside).sort();

		assert.throws(() => exportOkfBundle(target, { outputDir }), /outside the target root/);
		assert.equal(fs.readFileSync(path.join(outputDir, "index.md"), "utf8"), "user index\n");
		assert.deepEqual(fs.readdirSync(outputDir).sort(), before);
		assert.deepEqual(fs.readdirSync(outside).sort(), outsideBefore);
		if (!missing) assert.equal(fs.readFileSync(outsideFile, "utf8"), "user outside\n");
	});
}

test("exportOkfBundle permits an output child link to a file inside the target", () => {
	const target = tempDir("in-target-link");
	smallWiki(target);
	const outputDir = path.join(target, "out");
	fs.mkdirSync(outputDir, { recursive: true });
	const manifestFile = path.join(target, "manifest-copy.json");
	fs.writeFileSync(manifestFile, "old\n");
	fs.symlinkSync(manifestFile, path.join(outputDir, "okf.json"), "file");
	const result = exportOkfBundle(target, { outputDir });
	assert.deepEqual(result.errors, []);
	assert.equal(JSON.parse(fs.readFileSync(manifestFile, "utf8")).okfVersion, OKF_VERSION);
});

// A hard link is an ordinary in-target file, so no path or symlink check sees it,
// yet writing it replaces the bytes of the name outside the target sharing the inode.
test("exportOkfBundle refuses a planned leaf hard-linked outside the target", (t) => {
	const target = tempDir("hardlink");
	const outside = tempDir("hardlink-out");
	smallWiki(target);
	const outputDir = path.join(target, "out");
	fs.mkdirSync(outputDir, { recursive: true });
	const victim = path.join(outside, "victim.json");
	fs.writeFileSync(victim, "user outside\n");
	try {
		fs.linkSync(victim, path.join(outputDir, "okf.json"));
	} catch (error) {
		return t.skip(`hard link creation unavailable: ${error.code}`);
	}
	assert.throws(() => exportOkfBundle(target, { outputDir }), /hard-linked/);
	assert.equal(fs.readFileSync(victim, "utf8"), "user outside\n");
	assert.deepEqual(fs.readdirSync(outputDir).sort(), ["okf.json"]);
});

// The write goes to the referent, so an in-target symlink whose file is hard-linked
// outside the target escapes exactly like a hard-linked leaf.
test("exportOkfBundle refuses an in-target link to a file hard-linked outside the target", (t) => {
	const target = tempDir("link-chain");
	const outside = tempDir("link-chain-out");
	smallWiki(target);
	const outputDir = path.join(target, "out");
	fs.mkdirSync(outputDir, { recursive: true });
	const referent = path.join(target, "shared.bin");
	const victim = path.join(outside, "victim.bin");
	fs.writeFileSync(victim, "user outside\n");
	try {
		fs.linkSync(victim, referent);
	} catch (error) {
		return t.skip(`hard link creation unavailable: ${error.code}`);
	}
	fs.symlinkSync(referent, path.join(outputDir, "okf.json"), "file");
	assert.throws(() => exportOkfBundle(target, { outputDir }), /hard-linked/);
	assert.equal(fs.readFileSync(victim, "utf8"), "user outside\n");
});

test("exportOkfBundle refuses an external copied-page parent even when its leaf links back inside", () => {
	const target = tempDir("outside-parent");
	const outside = tempDir("outside-parent-out");
	smallWiki(target);
	writeFile(target, "docs/wiki/nested/deep/page.md", "# Nested page\n");
	const outputDir = path.join(target, "out");
	fs.mkdirSync(outputDir);
	fs.writeFileSync(path.join(outputDir, "index.md"), "user index\n");
	const leaf = path.join(target, "page-copy.md");
	fs.writeFileSync(leaf, "user page\n");
	fs.mkdirSync(path.join(outside, "deep"));
	fs.symlinkSync(leaf, path.join(outside, "deep/page.md"), "file");
	fs.symlinkSync(
		outside,
		path.join(outputDir, "nested"),
		process.platform === "win32" ? "junction" : "dir",
	);
	const before = fs.readdirSync(outputDir).sort();
	assert.throws(() => exportOkfBundle(target, { outputDir }), /outside the target root/);
	assert.equal(fs.readFileSync(leaf, "utf8"), "user page\n");
	assert.equal(fs.readFileSync(path.join(outputDir, "index.md"), "utf8"), "user index\n");
	assert.deepEqual(fs.readdirSync(outputDir).sort(), before);
});

test("exportOkfBundle permits a copied-page directory link elsewhere inside the target", () => {
	const target = tempDir("in-target-dir-link");
	smallWiki(target);
	writeFile(target, "docs/wiki/nested/deep/page.md", "# Nested page\n");
	const outputDir = path.join(target, "out");
	const pagesDir = path.join(target, "page-copies");
	fs.mkdirSync(outputDir);
	fs.mkdirSync(pagesDir);
	fs.symlinkSync(
		pagesDir,
		path.join(outputDir, "nested"),
		process.platform === "win32" ? "junction" : "dir",
	);
	const result = exportOkfBundle(target, { outputDir });
	assert.equal(result.nodeCount, 3);
	assert.equal(fs.readFileSync(path.join(pagesDir, "deep/page.md"), "utf8"), "# Nested page\n");
});

test("exportOkfBundle keeps new and existing outputs working under an aliased target ancestor", () => {
	const root = tempDir("alias-real");
	const aliases = tempDir("alias-links");
	const target = path.join(root, "repo");
	smallWiki(target);
	const alias = path.join(aliases, "parent");
	fs.symlinkSync(root, alias, process.platform === "win32" ? "junction" : "dir");
	const logicalTarget = path.join(alias, "repo");
	fs.mkdirSync(path.join(target, "existing"));
	for (const outputDir of [undefined, "existing", "new/deep"]) {
		const result = exportOkfBundle(logicalTarget, { outputDir });
		assert.deepEqual(result.errors, []);
		assert.equal(result.target, logicalTarget);
		const physicalOutput = path.join(target, outputDir || "docs/okf-bundle");
		assert.equal(
			JSON.parse(fs.readFileSync(path.join(physicalOutput, "okf.json"), "utf8")).concepts.length,
			2,
		);
		assert.match(fs.readFileSync(path.join(physicalOutput, "graph.html"), "utf8"), /Alpha/);
	}
});
