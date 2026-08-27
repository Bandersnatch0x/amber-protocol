"use strict";

// F059 T1 (#247): deterministic knowledge-graph parser + `knowledge graph`.
//
// The highest CLI seam is `amber knowledge graph --json` (spec § Testing
// Decisions): schema validity, byte-stable recompute, the full node/edge
// population against the REAL repository tree, and the standing F001/F007
// dead-anchor findings. Population is asserted through invariants (every
// source document has its node), never exact counts.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	SCHEMA_VERSION,
	EDGE_VERBS,
	ERROR_CODES,
	buildKnowledgeGraph,
	serializeKnowledgeGraph,
} = require("../../scripts/lib/core/knowledge-graph");
const { validate } = require("../../scripts/lib/core/schema-contract");
const { knowledgeDispatch } = require("../../scripts/lib/knowledge-commands");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { mkTarget, addPage, writeJson } = require("../helpers/harness");

const REPO_ROOT = path.join(__dirname, "..", "..");

// One build over the real tree, shared by the invariant tests (read-only).
const graph = buildKnowledgeGraph(REPO_ROOT);

// ── schema validity ───────────────────────────────────────────────────

test("real-tree graph validates against knowledge-graph.schema.json", () => {
	const verdict = validate("knowledge-graph", graph);
	assert.deepEqual(verdict.errors, []);
	assert.equal(verdict.valid, true);
	assert.equal(graph.schemaVersion, SCHEMA_VERSION);
});

test("provenance is present and deterministic on every node and edge", () => {
	for (const node of graph.nodes) assert.equal(node.provenance, "deterministic");
	for (const edge of graph.edges) assert.equal(edge.provenance, "deterministic");
});

test("three layers only; four verbs only", () => {
	const layers = new Set(graph.nodes.map((n) => n.layer));
	assert.deepEqual([...layers].sort(), ["decision", "implementation", "knowledge"]);
	for (const edge of graph.edges) assert.ok(EDGE_VERBS.includes(edge.verb), edge.verb);
});

// ── byte-stability ────────────────────────────────────────────────────

test("recompute over an unchanged tree is byte-identical", () => {
	const first = serializeKnowledgeGraph(buildKnowledgeGraph(REPO_ROOT));
	const second = serializeKnowledgeGraph(buildKnowledgeGraph(REPO_ROOT));
	assert.equal(first, second);
});

test("stable order: nodes by id, edges by (src, verb, dst), drift by (nodeId, path)", () => {
	const ids = graph.nodes.map((n) => n.id);
	assert.deepEqual(ids, [...ids].sort());
	assert.equal(new Set(ids).size, ids.length, "node ids are unique");
	const edgeKeys = graph.edges.map((e) => `${e.src}\u0000${e.verb}\u0000${e.dst}`);
	assert.deepEqual(edgeKeys, [...edgeKeys].sort());
	assert.equal(new Set(edgeKeys).size, edgeKeys.length, "edges are unique");
	const driftKeys = graph.drift.map((d) => `${d.nodeId}\u0000${d.path}`);
	assert.deepEqual(driftKeys, [...driftKeys].sort());
});

// ── population invariants against the real tree ──────────────────────

test("every docs/adr file has a decision-layer adr node", () => {
	const adrFiles = fs
		.readdirSync(path.join(REPO_ROOT, "docs", "adr"))
		.filter((name) => /^\d{4}-.+\.md$/.test(name));
	assert.ok(adrFiles.length >= 24, `expected the ADR corpus, found ${adrFiles.length}`);
	const byId = new Map(graph.nodes.map((n) => [n.id, n]));
	for (const name of adrFiles) {
		const id = `adr:${name.slice(0, 4)}`;
		const node = byId.get(id);
		assert.ok(node, `missing node for ${name}`);
		assert.equal(node.kind, "adr");
		assert.equal(node.layer, "decision");
		assert.equal(node.sourcePath, `docs/adr/${name}`);
	}
});

test("every feature_list.json entry has an implementation-layer feature node", () => {
	const { features } = JSON.parse(
		fs.readFileSync(path.join(REPO_ROOT, "feature_list.json"), "utf8"),
	);
	assert.ok(features.length > 0);
	const byId = new Map(graph.nodes.map((n) => [n.id, n]));
	for (const feature of features) {
		const node = byId.get(`feature:${feature.id}`);
		assert.ok(node, `missing node for feature ${feature.id}`);
		assert.equal(node.kind, "feature");
		assert.equal(node.layer, "implementation");
		assert.equal(node.sourcePath, "feature_list.json");
	}
});

test("every architecture page, wiki knowledge page, and MEMORY.md section has a knowledge node", () => {
	const byId = new Map(graph.nodes.map((n) => [n.id, n]));
	const archFiles = fs
		.readdirSync(path.join(REPO_ROOT, "docs", "architecture"))
		.filter((name) => name.endsWith(".md"));
	assert.ok(archFiles.length > 0);
	for (const name of archFiles) {
		const node = byId.get(`architecture:${name.slice(0, -3)}`);
		assert.ok(node, `missing node for docs/architecture/${name}`);
		assert.equal(node.layer, "knowledge");
	}
	const wikiDirs = fs
		.readdirSync(path.join(REPO_ROOT, "docs", "wiki", "knowledge"), { withFileTypes: true })
		.filter(
			(e) =>
				e.isDirectory() &&
				fs.existsSync(path.join(REPO_ROOT, "docs", "wiki", "knowledge", e.name, `${e.name}.md`)),
		);
	assert.ok(wikiDirs.length > 0);
	for (const dir of wikiDirs) {
		const node = byId.get(`wiki:${dir.name}`);
		assert.ok(node, `missing node for wiki page ${dir.name}`);
		assert.equal(node.layer, "knowledge");
	}
	const memorySections = fs
		.readFileSync(path.join(REPO_ROOT, "MEMORY.md"), "utf8")
		.split("\n")
		.filter((line) => /^##\s+/.test(line));
	assert.ok(memorySections.length > 0);
	assert.equal(graph.nodes.filter((n) => n.kind === "memory").length, memorySections.length);
});

test("code files are not nodes; every edge endpoint resolves to a node", () => {
	const ids = new Set(graph.nodes.map((n) => n.id));
	for (const node of graph.nodes) {
		assert.match(node.id, /^(adr|artifact|wiki|memory|architecture|feature):/);
	}
	for (const edge of graph.edges) {
		assert.ok(ids.has(edge.src), `dangling src ${edge.src}`);
		assert.ok(ids.has(edge.dst), `dangling dst ${edge.dst}`);
		assert.notEqual(edge.src, edge.dst);
	}
});

test("anchors are node properties, never edges", () => {
	const f001 = graph.nodes.find((n) => n.id === "feature:F001");
	assert.ok(f001.paths.includes("scripts/lib/core/scaffolding.js"));
	// No edge points at a bare path — every endpoint is a kind-prefixed id
	// (asserted above), so a declared path can only surface as a property.
	const f058 = graph.nodes.find((n) => n.id === "feature:F058");
	assert.ok(Array.isArray(f058.paths) && f058.paths.length > 0);
});

test("known real edges are discovered with evidence", () => {
	const find = (src, verb, dst) =>
		graph.edges.find((e) => e.src === src && e.verb === verb && e.dst === dst);
	// ADR-0007 header: Builds on ADR-0003 / ADR-0006; Supersedes the
	// architecture web-viewer statement.
	assert.ok(find("adr:0007", "builds-on", "adr:0003"));
	assert.ok(find("adr:0007", "builds-on", "adr:0006"));
	assert.ok(find("adr:0007", "supersedes", "architecture:web-viewer"));
	// ADR-0005 supersedes ADR-0002 (header block).
	const supersedes = find("adr:0005", "supersedes", "adr:0002");
	assert.ok(supersedes);
	assert.equal(supersedes.evidence[0].path, "docs/adr/0005-experimental-execution-removal.md");
	assert.ok(Number.isInteger(supersedes.evidence[0].line));
	// feature_list.json's F007 entry names ADR-0003 (declarer -> declared).
	assert.ok(find("feature:F007", "references", "adr:0003"));
});

// ── drift: the standing F001/F007 dead anchors ────────────────────────

test("F001 dead anchor: scaffolding.js renamed to scaffold.js, attached to the declaring node", () => {
	const finding = graph.drift.find(
		(d) => d.nodeId === "feature:F001" && d.path === "scripts/lib/core/scaffolding.js",
	);
	assert.ok(finding, "F001 finding missing");
	assert.equal(finding.kind, "dead-anchor");
	assert.equal(finding.actualPath, "scripts/lib/core/scaffold.js");
});

test("F007 dead anchor: loops/ collapsed to loops.js, attached to the declaring node", () => {
	const finding = graph.drift.find(
		(d) => d.nodeId === "feature:F007" && d.path === "scripts/lib/core/loops/",
	);
	assert.ok(finding, "F007 finding missing");
	assert.equal(finding.kind, "dead-anchor");
	assert.equal(finding.actualPath, "scripts/lib/core/loops.js");
});

test("live anchors (including glob anchors) produce no findings", () => {
	for (const finding of graph.drift) {
		assert.ok(
			!fs.existsSync(path.join(REPO_ROOT, finding.path)),
			`live path reported dead: ${finding.path}`,
		);
	}
	// F058's anchors exist; F016/F017's glob anchors match real files.
	const flagged = new Set(graph.drift.map((d) => d.nodeId));
	assert.ok(!flagged.has("feature:F058"));
	assert.ok(!flagged.has("feature:F016"));
	assert.ok(!flagged.has("feature:F017"));
});

// ── CLI seam: the `knowledge graph` action ────────────────────────────

test("knowledge graph dispatch emits the canonical bytes and exit 0", () => {
	const { result, exitCode, bypassPrint } = knowledgeDispatch({
		_: ["graph"],
		target: REPO_ROOT,
	});
	assert.equal(exitCode, 0);
	assert.equal(bypassPrint, true, "always prints the raw graph bytes");
	assert.equal(result.text, serializeKnowledgeGraph(buildKnowledgeGraph(REPO_ROOT)));
	assert.deepEqual(result.errors, []);
});

test("knowledge graph fails closed with a typed error on a corrupt source", () => {
	const dir = mkTarget("kg-corrupt");
	fs.writeFileSync(path.join(dir, "feature_list.json"), "{ not json");
	const { result, exitCode } = knowledgeDispatch({ _: ["graph"], target: dir });
	assert.equal(exitCode, 1);
	assert.equal(result.code, ERROR_CODES.source);
	assert.ok(result.errors.length > 0);
});

// ── fixture behavior ──────────────────────────────────────────────────

test("an empty target yields an empty, still schema-valid graph", () => {
	const dir = mkTarget("kg-empty");
	const empty = buildKnowledgeGraph(dir);
	assert.deepEqual(empty, { schemaVersion: SCHEMA_VERSION, nodes: [], edges: [], drift: [] });
});

test("artifacts enter at identity granularity with trace edges on the four verbs", () => {
	const dir = mkTarget("kg-artifacts");
	const intent = admitArtifact(dir, {
		type: "intent",
		identity: "intent/login-bug",
		body: "# Intent: login bug\n",
	});
	assert.equal(intent.ok, true);
	const second = admitArtifact(dir, {
		type: "intent",
		identity: "intent/login-bug",
		body: "# Intent: login bug\n\nAccepted.\n",
		expectedHead: 1,
		transition: "accept",
	});
	assert.equal(second.ok, true);
	const spec = admitArtifact(dir, {
		type: "spec",
		identity: "spec/login-spec",
		body: "# Spec: login\n",
		traces: [{ type: "refines", to: { type: "intent", identity: "intent/login-bug" } }],
	});
	assert.equal(spec.ok, true, JSON.stringify(spec.errors));

	const fixture = buildKnowledgeGraph(dir);
	const intentNode = fixture.nodes.find((n) => n.id === "artifact:intent/intent/login-bug");
	assert.ok(intentNode, "intent artifact node missing");
	assert.equal(intentNode.layer, "decision");
	assert.equal(intentNode.revisions, 2, "identity granularity: one node, two revisions");
	const specNode = fixture.nodes.find((n) => n.id === "artifact:spec/spec/login-spec");
	assert.ok(specNode, "spec artifact node missing");
	const edge = fixture.edges.find(
		(e) => e.src === specNode.id && e.dst === intentNode.id && e.verb === "builds-on",
	);
	assert.ok(edge, "refines trace maps to builds-on");
});

test("a context page merges into its source node as a property", () => {
	const dir = mkTarget("kg-context", { subdirs: ["docs/adr"] });
	fs.writeFileSync(
		path.join(dir, "docs", "adr", "0001-test-decision.md"),
		"# ADR-0001: Test decision\n\n**Status:** Accepted\n**Date:** 2026-01-01\n",
	);
	addPage(dir, "test-decision-page", {
		title: "Test decision page",
		sources: {
			s1: {
				kind: "file",
				ref: "docs/adr/0001-test-decision.md",
				rawHash: "sha256:0",
				mutable: true,
			},
		},
		blocks: [{ type: "prose", sources: ["s1"], text: "distilled" }],
	});
	const fixture = buildKnowledgeGraph(dir);
	const adr = fixture.nodes.find((n) => n.id === "adr:0001");
	assert.ok(adr);
	assert.equal(adr.contextPage, "test-decision-page");
});

test("rename detection requires prefix-related stems in the same directory", () => {
	const dir = mkTarget("kg-rename", { subdirs: ["lib"] });
	fs.writeFileSync(path.join(dir, "lib", "scaffold.js"), "x");
	fs.writeFileSync(path.join(dir, "lib", "scaffold-version-drift.js"), "x");
	writeJson(dir, "feature_list.json", {
		features: [
			{ id: "F001", title: "t", status: "passing", paths: ["lib/scaffolding.js"] },
			{ id: "F002", title: "t", status: "passing", paths: ["lib/unrelated-thing.js"] },
		],
	});
	const fixture = buildKnowledgeGraph(dir);
	const renamed = fixture.drift.find((d) => d.nodeId === "feature:F001");
	assert.equal(renamed.actualPath, "lib/scaffold.js");
	const unmatched = fixture.drift.find((d) => d.nodeId === "feature:F002");
	assert.ok(unmatched);
	assert.equal(unmatched.actualPath, undefined);
});
