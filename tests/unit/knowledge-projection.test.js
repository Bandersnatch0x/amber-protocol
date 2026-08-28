"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
	COMMITTED_CORPUS_DIR,
	buildHumanReviewSample,
	buildKnowledgeContextManifest,
	committedManifestPath,
	committedProjectionOutputPath,
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

// The synthetic corpus built by createCorpus owns its own census (25/10/9);
// the production census's single source of truth is the committed manifest.
const FIXTURE_COUNTS = Object.freeze({ adr: 25, wiki: 10, architecture: 9, total: 44 });
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
	for (let index = 1; index <= 25; index += 1) {
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

test("F059 manifest derived from the real tree matches the committed census", () => {
	const result = buildKnowledgeContextManifest(REPO_ROOT);
	assert.equal(result.ok, true, result.errors.join("; "));
	const committed = readJson(
		path.join(REPO_ROOT, COMMITTED_CORPUS_DIR, "knowledge-context-manifest.json"),
	);
	assert.deepEqual(result.manifest.counts, committed.counts);
	assert.deepEqual(
		result.manifest.rows.map((row) => row.sourcePath),
		committed.rows.map((row) => row.sourcePath),
	);
	for (const field of ["id", "sourceNodeId", "pageId", "sourcePath"]) {
		const values = result.manifest.rows.map((row) => row[field]);
		assert.equal(new Set(values).size, values.length, `${field} must be unique`);
	}
	assert.ok(
		result.manifest.rows.every((row) => fs.existsSync(path.join(REPO_ROOT, row.sourcePath))),
	);
});

test("F059 context sync drives request, ingest, verify, and projection idempotently", () => {
	const root = createCorpus("kg-context-sync");
	const first = syncKnowledgeContextPages(root);
	assert.equal(first.ok, true, JSON.stringify(first.errors));
	assert.deepEqual(first.manifest.counts, FIXTURE_COUNTS);
	assert.equal(first.actions.length, 44);
	assert.equal(first.actions.filter((action) => action.outcome === "accepted").length, 44);
	assert.equal(first.verification.summary.total, 44);
	assert.equal(first.verification.summary.ok, 44);
	assert.ok(first.projection.outputHash);
	const rows = readKnowledgeBaseProjection(root);
	assert.equal(rows.length, 44);

	const second = syncKnowledgeContextPages(root);
	assert.equal(second.ok, true, JSON.stringify(second.errors));
	assert.equal(second.actions.length, 44);
	assert.equal(second.actions.filter((action) => action.outcome === "unchanged").length, 44);
	assert.equal(second.verification.summary.ok, 44);
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
	assert.throws(() => buildKnowledgeGraph(root), /committed manifest unavailable/);
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
	assert.deepEqual(sync.counts, FIXTURE_COUNTS);
	assert.equal(sync.verification.summary.total, 44);
	const graphRun = spawnSync(
		process.execPath,
		[CLI, "knowledge", "graph", "--target", root, "--json"],
		{ cwd: root, encoding: "utf8" },
	);
	assert.equal(graphRun.status, 0, graphRun.stderr || graphRun.stdout);
	assert.equal(graphRun.stdout.trim(), serializeKnowledgeGraph(buildKnowledgeGraphFromTree(root)));
});

// ── Additional tests covering two-axis review findings ────────────────

test("F059 clean git-ls-files corpus produces graph with no prior .amber/ state", () => {
	// Simulate what git archive delivers: only tracked files from docs/knowledge-corpus/.
	// Uses REPO_ROOT's committed corpus directly (the production path).
	// No context-sync or .amber/ writes are needed.
	const { result, exitCode } = require("../../scripts/lib/knowledge-commands").knowledgeDispatch({
		_: ["graph"],
		target: REPO_ROOT,
	});
	assert.equal(exitCode, 0, JSON.stringify(result.errors));
	assert.equal(result.errors.length, 0);
	const graph = JSON.parse(result.text);
	assert.ok(graph.nodes.length >= 44, "must include at least the 44 committed corpus nodes");
	// All 44 committed corpus nodes must have contextPage set via the committed manifest
	const withContextPage = graph.nodes.filter((n) => n.contextPage);
	assert.equal(
		withContextPage.length,
		44,
		"exactly 44 nodes must have contextPage (the committed corpus)",
	);
	// Byte-identical to tree-reader (parity seam)
	assert.equal(result.text, serializeKnowledgeGraph(buildKnowledgeGraphFromTree(REPO_ROOT)));
});

test("F059 git-archive clean clone: projection and tree-reader produce exact byte-identical output with contextPage", () => {
	// Build a real git archive from HEAD, extract to a temp dir, run both paths,
	// and assert exact serialized byte equality — the production acceptance test.
	const os = require("node:os");
	const { execFileSync } = require("node:child_process");
	const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-kg-archive-"));
	try {
		// Use a large maxBuffer to accommodate the full repo tar output.
		const tarBytes = execFileSync("git", ["archive", "HEAD", "--format=tar"], {
			cwd: REPO_ROOT,
			maxBuffer: 100 * 1024 * 1024,
		});
		// Extract via spawnSync with cwd instead of -C to avoid Windows drive-letter issue.
		const extracted = spawnSync("tar", ["-x"], {
			cwd: archiveDir,
			input: tarBytes,
			encoding: "buffer",
			maxBuffer: 100 * 1024 * 1024,
		});
		assert.equal(extracted.status, 0, `tar extraction failed: ${extracted.stderr.toString()}`);
		// Verify committed corpus is present
		assert.ok(
			fs.existsSync(path.join(archiveDir, "docs/knowledge-corpus/knowledge-context-manifest.json")),
			"committed manifest must be present in archive",
		);
		assert.ok(
			fs.existsSync(path.join(archiveDir, "docs/knowledge-corpus/knowledge-base.output.json")),
			"committed projection must be present in archive",
		);
		// Both paths must produce byte-identical output
		const projGraph = buildKnowledgeGraph(archiveDir);
		const treeGraph = buildKnowledgeGraphFromTree(archiveDir);
		const projBytes = serializeKnowledgeGraph(projGraph);
		const treeBytes = serializeKnowledgeGraph(treeGraph);
		assert.equal(
			projBytes,
			treeBytes,
			"projection and tree-reader must produce byte-identical output on clean archive",
		);
		// Exactly 44 nodes must have contextPage
		const withContextPage = projGraph.nodes.filter((n) => n.contextPage);
		assert.equal(
			withContextPage.length,
			44,
			"exactly 44 nodes must have contextPage on clean archive",
		);
	} finally {
		fs.rmSync(archiveDir, { recursive: true, force: true });
	}
});

test("F059 context-sync pages carry explicit ownership fields and provisional maturity", () => {
	const root = createCorpus("kg-ownership");
	syncKnowledgeContextPages(root);
	const pagePath = path.join(root, ".amber", "context", "pages", "knowledge-adr-0001.json");
	const page = readJson(pagePath);
	assert.equal(page.generatedBy, "context-sync");
	assert.equal(page.artifact_type, "knowledge-context-page");
	assert.equal(page.manifestId, "f059-knowledge-context-pages");
	assert.equal(
		page.assurance.maturity,
		"provisional",
		"HITL checkpoint pending — must not be reviewed",
	);
});

test("F059 reader excludes unrelated categorized page not in committed manifest", () => {
	const root = createCorpus("kg-unrelated-page");
	syncKnowledgeContextPages(root);
	// Inject an unrelated wiki page directly into the projection output
	const outputPath = committedProjectionOutputPath(root);
	const output = readJson(outputPath);
	output.pages.push({
		pageId: "knowledge-wiki-unrelated-extra",
		title: "Unrelated",
		knowledgeKind: "pattern",
		sourceNodeId: "wiki:unrelated-extra",
		sourceCategory: "wiki",
		sources: { source: { kind: "wiki", ref: "docs/wiki/knowledge/unrelated/unrelated.md" } },
		blocks: [{ type: "prose", sources: ["source"], text: "Unrelated content." }],
	});
	writeJson(root, path.relative(root, outputPath), output);
	// Reader must filter this out — only manifest members pass
	const rows = readKnowledgeBaseProjection(root);
	assert.equal(rows.length, 44, "must return exactly 44 manifest members, not 45");
	assert.ok(!rows.find((r) => r.pageId === "knowledge-wiki-unrelated-extra"));
});

test("F059 reader fails closed with AMBER_E_KNOWLEDGE_SOURCE_STALE when source is modified", () => {
	const root = createCorpus("kg-stale-source-reader");
	syncKnowledgeContextPages(root);
	// Modify a source file after sync
	writeFile(
		root,
		"docs/wiki/knowledge/topic-01/topic-01.md",
		'---\ntitle: "Topic 1 MODIFIED"\nupdated_at: "2026-02-01"\n---\n\nChanged source text.\n',
	);
	assert.throws(
		() => readKnowledgeBaseProjection(root),
		(err) => {
			assert.ok(
				err.amberCode === "AMBER_E_KNOWLEDGE_SOURCE_STALE",
				`unexpected code: ${err.amberCode}`,
			);
			return true;
		},
	);
});

test("F059 reader fails with AMBER_E_PROJECTION_MISSING when committed corpus is absent", () => {
	const root = createCorpus("kg-missing-corpus");
	// Do NOT run sync — no committed corpus files exist
	assert.throws(
		() => readKnowledgeBaseProjection(root),
		(err) => {
			assert.ok(
				err.amberCode === "AMBER_E_PROJECTION_MISSING",
				`unexpected code: ${err.amberCode}`,
			);
			return true;
		},
	);
});

test("F059 context-sync blocks collision when an unmanaged page occupies the target pageId", () => {
	const root = createCorpus("kg-collision");
	// Write a hand-authored page that structurally matches a managed row but has wrong ownership
	const pageDir = path.join(root, ".amber", "context", "pages");
	fs.mkdirSync(pageDir, { recursive: true });
	const collision = {
		schemaVersion: "1.2.0",
		pageId: "knowledge-adr-0001",
		title: "Hand-authored override",
		knowledgeKind: "decision",
		sourceNodeId: "adr:0001",
		sourceCategory: "adr",
		generatedBy: "human-author",
		artifact_type: "knowledge-context-page",
		sources: { source: { ref: "docs/adr/0001-governance-first-artifact-first.md" } },
		blocks: [{ type: "prose", sources: ["source"], text: "Human content." }],
	};
	fs.writeFileSync(
		path.join(pageDir, "knowledge-adr-0001.json"),
		JSON.stringify(collision, null, 2) + "\n",
		"utf8",
	);
	const result = syncKnowledgeContextPages(root);
	const action = result.actions.find((a) => a.pageId === "knowledge-adr-0001");
	assert.equal(
		action.outcome,
		"blocked",
		"must not overwrite a page with foreign ownership markers",
	);
});

test("F059 exact 44-row manifest replacement detection rejects 43-member manifest", () => {
	const root = createCorpus("kg-replacement-detect");
	syncKnowledgeContextPages(root);
	// Tamper the committed manifest to remove one ADR row
	const manifestPath = committedManifestPath(root);
	const manifest = readJson(manifestPath);
	manifest.rows = manifest.rows.filter((r) => r.pageId !== "knowledge-adr-0025");
	manifest.counts.adr = 24;
	manifest.counts.total = 43;
	writeJson(root, path.relative(root, manifestPath), manifest);
	// Reader must fail closed and NAME the path the tampered census dropped —
	// fixing the counts alongside the rows must not help.
	assert.throws(
		() => readKnowledgeBaseProjection(root),
		(err) => {
			assert.ok(err.amberCode === "AMBER_E_PROJECTION_DRIFT", `unexpected code: ${err.amberCode}`);
			assert.match(err.message, /not in the committed census/);
			assert.match(err.message, /docs\/adr\/0025-decision-0025\.md/);
			return true;
		},
	);
});

test("0007 drill: admitting a new ADR is exactly write, sync, commit corpus", () => {
	const root = createCorpus("kg-admission-drill");
	syncKnowledgeContextPages(root);
	assert.equal(readKnowledgeBaseProjection(root).length, FIXTURE_COUNTS.total);

	// Step 1 — write the document. The read gate now fails closed and NAMES it.
	writeFile(
		root,
		"docs/adr/0026-new-decision.md",
		"# ADR-0026: New decision\n\n**Status:** Accepted\n**Date:** 2026-02-01\n\nDecision 0026 describes F001.\n",
	);
	assert.throws(
		() => readKnowledgeBaseProjection(root),
		(err) => {
			assert.ok(err.amberCode === "AMBER_E_PROJECTION_DRIFT", `unexpected code: ${err.amberCode}`);
			assert.match(err.message, /docs\/adr\/0026-new-decision\.md/);
			return true;
		},
	);

	// Step 2 — sync regenerates the committed census; no constant to bump anywhere.
	const sync = syncKnowledgeContextPages(root);
	assert.equal(sync.ok, true, JSON.stringify(sync.errors));

	// Step 3 — committing the regenerated corpus is the admission; reads are green
	// and the new member is present by name.
	const rows = readKnowledgeBaseProjection(root);
	assert.equal(rows.length, FIXTURE_COUNTS.total + 1);
	assert.ok(rows.some((row) => row.pageId === "knowledge-adr-0026"));
	const committed = readJson(committedManifestPath(root));
	assert.ok(committed.rows.some((row) => row.sourcePath === "docs/adr/0026-new-decision.md"));
});

test("F059 tracked package state: docs/knowledge-corpus/ contains manifest and projection output", () => {
	// Verify the committed corpus files are present in the real repository tree.
	// This is the package/tracked-state check: a clean clone must have these files.
	const manifestFile = path.join(
		REPO_ROOT,
		COMMITTED_CORPUS_DIR,
		"knowledge-context-manifest.json",
	);
	const projectionFile = path.join(REPO_ROOT, COMMITTED_CORPUS_DIR, "knowledge-base.output.json");
	assert.ok(
		fs.existsSync(manifestFile),
		`committed manifest must exist at ${COMMITTED_CORPUS_DIR}`,
	);
	assert.ok(
		fs.existsSync(projectionFile),
		`committed projection must exist at ${COMMITTED_CORPUS_DIR}`,
	);
	const manifest = readJson(manifestFile);
	assert.equal(manifest.manifestId, "f059-knowledge-context-pages");
	assert.deepEqual(manifest.counts, FIXTURE_COUNTS);
	assert.equal(manifest.rows.length, 44);
	const projection = readJson(projectionFile);
	assert.equal(projection.pages.length, 44);
});
