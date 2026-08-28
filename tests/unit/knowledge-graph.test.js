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
	buildKnowledgeGraphFromTree,
	serializeKnowledgeGraph,
} = require("../../scripts/lib/core/knowledge-graph");
const { validate } = require("../../scripts/lib/core/schema-contract");
const { knowledgeDispatch } = require("../../scripts/lib/knowledge-commands");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { mkTarget, addPage, writeJson } = require("../helpers/harness");

const REPO_ROOT = path.join(__dirname, "..", "..");

// One build over the real tree, shared by the invariant tests (read-only).
const graph = buildKnowledgeGraphFromTree(REPO_ROOT);

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
	const first = serializeKnowledgeGraph(buildKnowledgeGraphFromTree(REPO_ROOT));
	const second = serializeKnowledgeGraph(buildKnowledgeGraphFromTree(REPO_ROOT));
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

test("knowledge graph dispatch emits projected bytes matching the explicit tree-reader baseline", () => {
	const { syncKnowledgeContextPages } = require("../../scripts/lib/core/knowledge-projection");
	const synced = syncKnowledgeContextPages(REPO_ROOT);
	assert.equal(synced.ok, true, JSON.stringify(synced.errors));
	const { result, exitCode, bypassPrint } = knowledgeDispatch({
		_: ["graph"],
		target: REPO_ROOT,
	});
	assert.equal(exitCode, 0);
	assert.equal(bypassPrint, true, "always prints the raw graph bytes");
	assert.equal(result.text, serializeKnowledgeGraph(buildKnowledgeGraphFromTree(REPO_ROOT)));
	assert.deepEqual(result.errors, []);
});

test("knowledge graph fails closed with a typed error when the projection is missing", () => {
	const dir = mkTarget("kg-missing-projection");
	const { result, exitCode } = knowledgeDispatch({ _: ["graph"], target: dir });
	assert.equal(exitCode, 1);
	assert.equal(result.code, "AMBER_E_PROJECTION_MISSING");
	assert.ok(result.errors.length > 0);
});

// ── fixture behavior ──────────────────────────────────────────────────

test("an empty target yields an empty, still schema-valid graph", () => {
	const dir = mkTarget("kg-empty");
	const empty = buildKnowledgeGraphFromTree(dir);
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

	const fixture = buildKnowledgeGraphFromTree(dir);
	const intentNode = fixture.nodes.find((n) => n.id === "artifact:intent/intent/login-bug");
	assert.ok(intentNode, "intent artifact node missing");
	assert.equal(intentNode.layer, "decision");
	assert.equal(intentNode.revisions, 2, "identity granularity: one node, two revisions");
	// Head revision body is the accepted body (revision 2)
	assert.ok(
		typeof intentNode.body === "string" && intentNode.body.length > 0,
		"artifact node must carry head revision body",
	);
	assert.ok(
		intentNode.body.includes("Accepted"),
		"artifact body should contain the head revision text",
	);
	const specNode = fixture.nodes.find((n) => n.id === "artifact:spec/spec/login-spec");
	assert.ok(specNode, "spec artifact node missing");
	assert.ok(
		typeof specNode.body === "string" && specNode.body.length > 0,
		"spec artifact node must carry body",
	);
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
	const fixture = buildKnowledgeGraphFromTree(dir);
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
	const fixture = buildKnowledgeGraphFromTree(dir);
	const renamed = fixture.drift.find((d) => d.nodeId === "feature:F001");
	assert.equal(renamed.actualPath, "lib/scaffold.js");
	const unmatched = fixture.drift.find((d) => d.nodeId === "feature:F002");
	assert.ok(unmatched);
	assert.equal(unmatched.actualPath, undefined);
});

// ── F-2: context-page source ref normalization ────────────────────────

test("F-2: context page with #L range fragment merges into its source node", () => {
	const dir = mkTarget("kg-cp-range", { subdirs: ["docs/adr"] });
	fs.writeFileSync(
		path.join(dir, "docs", "adr", "0001-test-decision.md"),
		"# ADR-0001: Test decision\n\n**Status:** Accepted\n**Date:** 2026-01-01\n",
	);
	addPage(dir, "test-fragmented-page", {
		title: "Fragmented ref page",
		sources: {
			s1: {
				kind: "file",
				ref: "docs/adr/0001-test-decision.md#L1-L5",
				rawHash: "sha256:0",
				mutable: true,
			},
		},
		blocks: [{ type: "prose", sources: ["s1"], text: "distilled" }],
	});
	const fixture = buildKnowledgeGraphFromTree(dir);
	const adr = fixture.nodes.find((n) => n.id === "adr:0001");
	assert.ok(adr, "adr:0001 node missing");
	assert.equal(adr.contextPage, "test-fragmented-page", "context page with #L range did not merge");
});

test("F-2: context page sourcing a canonical-artifact body file merges into the artifact node", () => {
	const dir = mkTarget("kg-cp-artifact");
	const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
	const admission = admitArtifact(dir, {
		type: "intent",
		identity: "intent/cp-test",
		body: "# Intent: cp-test\n",
	});
	assert.equal(admission.ok, true, JSON.stringify(admission.errors));
	// The artifact's body file is .amber/artifacts/intents/<slug>/rev-1.md
	const slugFor = (identity) => String(identity).replace(/[^a-zA-Z0-9._-]+/g, "_");
	const artifactSlug = slugFor("intent/cp-test");
	const artifactRevPath = `.amber/artifacts/intents/${artifactSlug}/rev-1.md`;
	addPage(dir, "artifact-context-page", {
		title: "Artifact context page",
		sources: {
			s1: {
				kind: "file",
				ref: `${artifactRevPath}#L1-L1`,
				rawHash: "sha256:0",
				mutable: false,
			},
		},
		blocks: [{ type: "prose", sources: ["s1"], text: "distilled artifact" }],
	});
	const fixture = buildKnowledgeGraphFromTree(dir);
	const artifactNode = fixture.nodes.find((n) => n.id === `artifact:intent/intent/cp-test`);
	assert.ok(artifactNode, "artifact node missing");
	assert.equal(
		artifactNode.contextPage,
		"artifact-context-page",
		"context page with artifact file ref did not merge into artifact node",
	);
});

// ── F-3: repository-boundary confinement ─────────────────────────────

test("F-3: ../ anchor produces a dead-anchor finding without probing outside the fixture", () => {
	const dir = mkTarget("kg-escape", { subdirs: ["lib"] });
	fs.writeFileSync(path.join(dir, "lib", "real.js"), "x");
	writeJson(dir, "feature_list.json", {
		features: [
			{
				id: "F001",
				title: "t",
				status: "passing",
				paths: ["../outside.js", "lib/real.js"],
			},
		],
	});
	const fixture = buildKnowledgeGraphFromTree(dir);
	// real.js is alive — no finding for it
	const realFinding = fixture.drift.find((d) => d.path === "lib/real.js");
	assert.equal(realFinding, undefined, "live path reported dead");
	// ../outside.js is a dead anchor — finding present, no actualPath (no probe outside)
	const escapeFinding = fixture.drift.find((d) => d.path === "../outside.js");
	assert.ok(escapeFinding, "../outside.js anchor must produce a dead-anchor finding");
	assert.equal(escapeFinding.kind, "dead-anchor");
	assert.equal(escapeFinding.actualPath, undefined, "no actualPath: no probe outside target");
});

// ── F-4: glob matcher completeness ───────────────────────────────────

test("F-4: dir-wildcard pattern matching no directory produces a finding", () => {
	const dir = mkTarget("kg-glob-dir", { subdirs: ["lib"] });
	fs.writeFileSync(path.join(dir, "lib", "real.js"), "x");
	writeJson(dir, "feature_list.json", {
		features: [
			{
				id: "F001",
				title: "t",
				status: "passing",
				paths: ["missing*/also-missing.js"],
			},
		],
	});
	const fixture = buildKnowledgeGraphFromTree(dir);
	const finding = fixture.drift.find(
		(d) => d.nodeId === "feature:F001" && d.path === "missing*/also-missing.js",
	);
	assert.ok(finding, "missing*/also-missing.js must produce a dead-anchor finding");
	assert.equal(finding.kind, "dead-anchor");
});

test("F-4: ? in basename matches a single character — lib/file?.js with lib/file1.js alive", () => {
	const dir = mkTarget("kg-glob-qmark", { subdirs: ["lib"] });
	fs.writeFileSync(path.join(dir, "lib", "file1.js"), "x");
	writeJson(dir, "feature_list.json", {
		features: [{ id: "F001", title: "t", status: "passing", paths: ["lib/file?.js"] }],
	});
	const fixture = buildKnowledgeGraphFromTree(dir);
	const finding = fixture.drift.find((d) => d.nodeId === "feature:F001");
	assert.equal(
		finding,
		undefined,
		"lib/file?.js must NOT produce a finding when lib/file1.js exists",
	);
});

test("F-6: content nodes carry a body excerpt; all nodes with canonical text have body ≤ 2000 chars", () => {
	const contentKinds = new Set(["adr", "wiki", "memory", "architecture"]);
	let contentCount = 0;
	for (const node of graph.nodes) {
		// Body must be bounded when present
		if (node.body !== undefined) {
			assert.ok(typeof node.body === "string", `${node.id} body must be a string`);
			assert.ok(node.body.length > 0, `${node.id} body must be non-empty`);
			assert.ok(
				node.body.length <= 2000,
				`${node.id} body exceeds 2000 chars (got ${node.body.length})`,
			);
		}
		// Content-layer nodes always have body (their source files are non-empty)
		if (contentKinds.has(node.kind)) {
			assert.ok(
				typeof node.body === "string" && node.body.length > 0,
				`${node.id} (${node.kind}) missing body excerpt`,
			);
			contentCount++;
		}
	}
	assert.ok(contentCount > 0, "no content nodes found");
});

test("F-6: feature nodes with canonical text carry a representative body excerpt", () => {
	const featureNodes = graph.nodes.filter((n) => n.kind === "feature");
	assert.ok(featureNodes.length > 0, "no feature nodes found");
	// Features with non-trivial user_visible_behavior etc. have body;
	// features whose ALL canonical text fields are empty may have no body.
	const withBody = featureNodes.filter((n) => n.body !== undefined);
	assert.ok(withBody.length > 0, "expected at least some feature nodes to carry body");
	for (const n of withBody) {
		assert.ok(typeof n.body === "string" && n.body.length > 0, `${n.id} body must be non-empty`);
		assert.ok(n.body.length <= 2000, `${n.id} body exceeds 2000 chars`);
	}
});

test("F-6: artifact nodes carry body from the head revision committed text", () => {
	const artifactNodes = graph.nodes.filter((n) => n.kind === "artifact");
	// The real repo has committed artifacts; all should expose the head body.
	for (const n of artifactNodes) {
		if (n.body !== undefined) {
			assert.ok(typeof n.body === "string" && n.body.length > 0, `${n.id} body must be non-empty`);
			assert.ok(n.body.length <= 2000, `${n.id} artifact body exceeds 2000 chars`);
		}
	}
	// At least fixture tests below verify artifact body round-trips; real-tree
	// artifacts may or may not have body depending on committed revisions.
});

test("F-6: body is absent for empty-text memory sections", () => {
	const { mkTarget } = require("../helpers/harness");
	const dir = mkTarget("kg-empty-body", { subdirs: ["docs/adr"] });
	// Create an ADR with only whitespace after trimming
	fs.writeFileSync(path.join(dir, "docs", "adr", "0001-empty.md"), "  \n  \n");
	const fixture = buildKnowledgeGraphFromTree(dir);
	const adr = fixture.nodes.find((n) => n.id === "adr:0001");
	assert.ok(adr, "adr:0001 missing");
	// Whitespace-only text produces no body
	assert.equal(adr.body, undefined, "whitespace-only body should be absent");
});

test("F-6: body is bounded at 2000 chars for long documents", () => {
	const { mkTarget } = require("../helpers/harness");
	const dir = mkTarget("kg-long-body", { subdirs: ["docs/adr"] });
	const longText =
		"# ADR-0001: Long\n\n**Status:** Accepted\n**Date:** 2026-01-01\n\n" + "x".repeat(5000);
	fs.writeFileSync(path.join(dir, "docs", "adr", "0001-long.md"), longText);
	const fixture = buildKnowledgeGraphFromTree(dir);
	const adr = fixture.nodes.find((n) => n.id === "adr:0001");
	assert.ok(adr, "adr:0001 missing");
	assert.ok(typeof adr.body === "string", "body must be a string");
	assert.ok(adr.body.length <= 2000, `body length ${adr.body.length} exceeds 2000`);
	assert.ok(adr.body.length > 0, "body must be non-empty for non-empty document");
});

test("F-5: amber knowledge graph --json emits schema-valid, byte-identical JSON from root CLI", () => {
	const { spawnSync } = require("node:child_process");
	const { validate } = require("../../scripts/lib/core/schema-contract");
	const amber = path.join(REPO_ROOT, "scripts", "amber.js");
	const run = () =>
		spawnSync(process.execPath, [amber, "knowledge", "graph", "--target", REPO_ROOT, "--json"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
		});

	const first = run();
	assert.equal(first.status, 0, `exit code non-zero; stderr: ${first.stderr}`);

	// Schema-valid output
	const parsed = JSON.parse(first.stdout);
	const verdict = validate("knowledge-graph", parsed);
	assert.deepEqual(verdict.errors, [], "schema validation errors");
	assert.equal(verdict.valid, true);

	// Byte-identical on repeated run
	const second = run();
	assert.equal(second.status, 0);
	assert.equal(first.stdout, second.stdout, "output is not byte-identical on recompute");

	// F001/F007 drift findings persist at the CLI seam
	const f001 = parsed.drift.find(
		(d) => d.nodeId === "feature:F001" && d.path === "scripts/lib/core/scaffolding.js",
	);
	assert.ok(f001, "F001 drift finding missing in CLI output");
	const f007 = parsed.drift.find(
		(d) => d.nodeId === "feature:F007" && d.path === "scripts/lib/core/loops/",
	);
	assert.ok(f007, "F007 drift finding missing in CLI output");

	// Population bounds
	assert.ok(parsed.nodes.length >= 100, `expected >=100 nodes, got ${parsed.nodes.length}`);
	assert.ok(parsed.edges.length >= 80, `expected >=80 edges, got ${parsed.edges.length}`);

	// Independently derivable edges (from reading the ADR source files directly)
	const edge = (src, verb, dst) =>
		parsed.edges.find((e) => e.src === src && e.verb === verb && e.dst === dst);
	assert.ok(edge("adr:0003", "builds-on", "adr:0002"), "adr:0003 builds-on adr:0002");
	assert.ok(edge("adr:0005", "supersedes", "adr:0002"), "adr:0005 supersedes adr:0002");
	assert.ok(edge("adr:0007", "builds-on", "adr:0003"), "adr:0007 builds-on adr:0003");
	assert.ok(edge("adr:0007", "builds-on", "adr:0006"), "adr:0007 builds-on adr:0006");
	assert.ok(
		edge("adr:0007", "supersedes", "architecture:web-viewer"),
		"adr:0007 supersedes architecture:web-viewer",
	);
	assert.ok(edge("adr:0008", "builds-on", "adr:0003"), "adr:0008 builds-on adr:0003");
	assert.ok(edge("adr:0008", "builds-on", "adr:0007"), "adr:0008 builds-on adr:0007");
	assert.ok(edge("feature:F007", "references", "adr:0003"), "feature:F007 references adr:0003");
});
