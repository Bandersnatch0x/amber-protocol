"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
	EXPECTED_COUNTS,
	buildHumanReviewSample,
	buildKnowledgeContextManifest,
	readKnowledgeBaseProjection,
	syncKnowledgeContextPages,
} = require("../../scripts/lib/core/knowledge-projection");
const {
	buildKnowledgeGraph,
	buildKnowledgeGraphFromTree,
	serializeKnowledgeGraph,
} = require("../../scripts/lib/core/knowledge-graph");
const { verifyPages } = require("../../scripts/lib/core/context-verify");
const { mkTarget, readJson, writeJson } = require("../helpers/harness");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "scripts", "amber.js");

function writeFile(root, relPath, text) {
	const file = path.join(root, relPath);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text, "utf8");
}

function createCorpus(label) {
	const root = mkTarget(label, {
		subdirs: ["docs/adr", "docs/wiki/knowledge", "docs/architecture"],
	});
	for (let index = 1; index <= 24; index += 1) {
		const number = String(index).padStart(4, "0");
		writeFile(
			root,
			`docs/adr/${number}-decision-${number}.md`,
			`# ADR-${number}: Decision ${number}\n\n**Status:** Accepted\n**Date:** 2026-01-${String(Math.min(index, 28)).padStart(2, "0")}\n\nDecision ${number} describes F001.\n`,
		);
	}
	for (let index = 1; index <= 10; index += 1) {
		const name = `topic-${String(index).padStart(2, "0")}`;
		writeFile(
			root,
			`docs/wiki/knowledge/${name}/${name}.md`,
			`---\ntitle: "Topic ${index}"\nupdated_at: "2026-02-${String(index).padStart(2, "0")}"\n---\n\n# Topic ${index}\n\nThis page references ADR-0001 and F001.\n`,
		);
	}
	writeFile(root, "docs/wiki/knowledge/index.md", "# Knowledge index\n");
	writeFile(root, "docs/wiki/knowledge/knowledge-cards.md", "# Knowledge cards\n");
	for (let index = 1; index <= 9; index += 1) {
		const name = `area-${String(index).padStart(2, "0")}`;
		writeFile(
			root,
			`docs/architecture/${name}.md`,
			`# Area ${index}\n\nArchitecture page ${index} references ADR-0001 and F001.\n`,
		);
	}
	writeJson(root, "feature_list.json", {
		features: [
			{
				id: "F001",
				title: "Fixture feature",
				status: "passing",
				paths: ["docs/adr/0001-decision-0001.md"],
				user_visible_behavior: "References ADR-0001.",
			},
		],
	});
	return root;
}

function commandJson(args, cwd) {
	const run = spawnSync(process.execPath, [CLI, ...args, "--json"], { cwd, encoding: "utf8" });
	assert.equal(run.status, 0, run.stderr || run.stdout);
	const outer = JSON.parse(run.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

test("F059 manifest derives the exact 43-row corpus from the real tree", () => {
	const result = buildKnowledgeContextManifest(REPO_ROOT);
	assert.equal(result.ok, true, result.errors.join("; "));
	assert.deepEqual(result.manifest.counts, EXPECTED_COUNTS);
	assert.equal(result.manifest.rows.length, 43);
	for (const field of ["id", "sourceNodeId", "pageId", "sourcePath"]) {
		const values = result.manifest.rows.map((row) => row[field]);
		assert.equal(new Set(values).size, values.length, `${field} must be unique`);
	}
	assert.equal(result.manifest.rows.filter((row) => row.category === "wiki").length, 10);
	assert.ok(
		result.manifest.rows.every((row) => fs.existsSync(path.join(REPO_ROOT, row.sourcePath))),
	);
});

test("F059 context sync drives request, ingest, verify, and projection idempotently", () => {
	const root = createCorpus("kg-context-sync");
	const first = syncKnowledgeContextPages(root);
	assert.equal(first.ok, true, JSON.stringify(first.errors));
	assert.deepEqual(first.manifest.counts, EXPECTED_COUNTS);
	assert.equal(first.actions.length, 43);
	assert.equal(first.actions.filter((action) => action.outcome === "accepted").length, 43);
	assert.equal(first.verification.summary.total, 43);
	assert.equal(first.verification.summary.ok, 43);
	assert.ok(first.projection.outputHash);
	const rows = readKnowledgeBaseProjection(root);
	assert.equal(rows.length, 43);

	const second = syncKnowledgeContextPages(root);
	assert.equal(second.ok, true, JSON.stringify(second.errors));
	assert.equal(second.actions.length, 43);
	assert.equal(second.actions.filter((action) => action.outcome === "unchanged").length, 43);
	assert.equal(second.verification.summary.ok, 43);
});

test("F059 context verification reports stale, obsolete, and tampered pages", () => {
	const staleRoot = createCorpus("kg-stale");
	syncKnowledgeContextPages(staleRoot);
	writeFile(
		staleRoot,
		"docs/wiki/knowledge/topic-01/topic-01.md",
		'---\ntitle: "Topic 1"\nupdated_at: "2026-02-01"\n---\n\nChanged source.\n',
	);
	let stale = verifyPages(staleRoot).pages.find(
		(page) => page.pageId === "knowledge-wiki-topic-01",
	);
	assert.equal(stale.status, "stale");
	assert.ok(stale.findings.some((finding) => finding.code === "AMBER_E_CONTEXT_SOURCE_STALE"));

	const missingRoot = createCorpus("kg-missing");
	syncKnowledgeContextPages(missingRoot);
	fs.rmSync(path.join(missingRoot, "docs/wiki/knowledge/topic-02/topic-02.md"));
	let missing = verifyPages(missingRoot).pages.find(
		(page) => page.pageId === "knowledge-wiki-topic-02",
	);
	assert.equal(missing.status, "obsolete");
	assert.ok(missing.findings.some((finding) => finding.code === "AMBER_E_CONTEXT_PAGE_OBSOLETE"));

	const tamperedRoot = createCorpus("kg-tampered");
	syncKnowledgeContextPages(tamperedRoot);
	const pagePath = path.join(tamperedRoot, ".amber", "context", "pages", "knowledge-adr-0001.json");
	const page = readJson(pagePath);
	page.sources.source.excerpt = `${page.sources.source.excerpt}\ncorrupt`;
	fs.writeFileSync(pagePath, `${JSON.stringify(page, null, 2)}\n`, "utf8");
	let tampered = verifyPages(tamperedRoot).pages.find(
		(item) => item.pageId === "knowledge-adr-0001",
	);
	assert.equal(tampered.status, "tampered");
	assert.ok(
		tampered.findings.some((finding) => finding.code === "AMBER_E_CONTEXT_SOURCE_TAMPERED"),
	);
});

test("F059 graph production path reads projection and matches tree-reader bytes", () => {
	const root = createCorpus("kg-parity");
	const synced = syncKnowledgeContextPages(root);
	assert.equal(synced.ok, true, JSON.stringify(synced.errors));
	const treeBytes = serializeKnowledgeGraph(buildKnowledgeGraphFromTree(root));
	const projectionBytes = serializeKnowledgeGraph(buildKnowledgeGraph(root));
	assert.equal(projectionBytes, treeBytes);
	const graph = JSON.parse(projectionBytes);
	assert.ok(graph.nodes.length > 0);
	assert.equal(new Set(graph.nodes.map((node) => node.id)).size, graph.nodes.length);
});

test("F059 graph production path fails closed when projection is absent", () => {
	const root = createCorpus("kg-no-projection");
	assert.throws(() => buildKnowledgeGraph(root), /knowledge-base projection unavailable/);
});

test("F059 review sample spans ADR, wiki, and architecture pages", () => {
	const root = createCorpus("kg-sample");
	syncKnowledgeContextPages(root);
	const result = buildHumanReviewSample(root);
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	assert.equal(result.sample.rows.length, 6);
	assert.deepEqual(
		new Set(result.sample.rows.map((row) => row.category)),
		new Set(["adr", "wiki", "architecture"]),
	);
	assert.ok(result.sample.rows.every((row) => row.sourceHash.startsWith("sha256:")));
	assert.ok(result.sample.rows.every((row) => row.verificationStatus === "ok"));
	assert.ok(result.sample.rows.every((row) => row.excerpt.length > 0));
});

test("F059 CLI context-sync and knowledge graph use the projection path", () => {
	const root = createCorpus("kg-cli-sync");
	const sync = commandJson(["knowledge", "context-sync", "--target", root], root);
	assert.equal(sync.ok, true);
	assert.deepEqual(sync.counts, EXPECTED_COUNTS);
	assert.equal(sync.verification.summary.total, 43);
	const graphRun = spawnSync(
		process.execPath,
		[CLI, "knowledge", "graph", "--target", root, "--json"],
		{ cwd: root, encoding: "utf8" },
	);
	assert.equal(graphRun.status, 0, graphRun.stderr || graphRun.stdout);
	assert.equal(graphRun.stdout.trim(), serializeKnowledgeGraph(buildKnowledgeGraphFromTree(root)));
});
