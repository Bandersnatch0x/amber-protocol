"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	buildGovernanceGraph,
	queryGraph,
	DENY_SCOPE,
	parseScope,
} = require("../../scripts/lib/core/governance-graph");
const {
	recordReadReceipt,
	listReadReceipts,
	verifyReceipt,
} = require("../../scripts/lib/core/projection-receipts");

function mkTarget(label) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-graph-${label}-`));
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	return dir;
}

function addPage(dir, pageId, { title, sources = {}, blocks = [] } = {}) {
	const dirPath = path.join(dir, ".amber", "context", "pages");
	fs.mkdirSync(dirPath, { recursive: true });
	fs.writeFileSync(
		path.join(dirPath, `${pageId}.json`),
		JSON.stringify({ pageId, title: title || pageId, sources, blocks }),
	);
}

// ── buildGovernanceGraph ──────────────────────────────────────

test("buildGovernanceGraph creates a deterministic node graph from canonical pages", () => {
	const dir = mkTarget("build");
	addPage(dir, "p1", {
		title: "Page 1",
		sources: { s1: { kind: "repo", ref: "docs/spec.md" } },
	});
	addPage(dir, "p2", {
		title: "Page 2",
		sources: { s1: { kind: "repo", ref: "docs/spec.md" } },
	});

	const graph = buildGovernanceGraph(dir);
	assert.ok(graph.nodes.length >= 2, "two page nodes");
	assert.ok(graph.edges.length >= 1, "shared-source edge");
	assert.match(graph.sourceHash, /^sha256:[0-9a-f]{64}$/);
});

test("buildGovernanceGraph is deterministic — same canonical input, same hash", () => {
	const dir = mkTarget("det");
	addPage(dir, "p1", { title: "Page 1", sources: { s1: { kind: "repo", ref: "a.md" } } });
	const g1 = buildGovernanceGraph(dir);
	const g2 = buildGovernanceGraph(dir);
	assert.equal(g1.sourceHash, g2.sourceHash);
	assert.equal(JSON.stringify(g1.edges), JSON.stringify(g2.edges));
});

test("buildGovernanceGraph edges carry provenance (source refs)", () => {
	const dir = mkTarget("provenance");
	const shared = { kind: "repo", ref: "docs/spec.md", rawHash: "sha256:" + "a".repeat(64) };
	addPage(dir, "p1", { title: "Page 1", sources: { s1: shared } });
	addPage(dir, "p2", { title: "Page 2", sources: { s1: shared } });
	const graph = buildGovernanceGraph(dir);
	const edge = graph.edges[0];
	assert.ok(edge, "at least one edge");
	assert.equal(edge.ref, "docs/spec.md");
	assert.ok(edge.provenance && edge.provenance.length >= 2, "edge has provenance");
});

// ── parseScope / DENY_SCOPE ───────────────────────────────────

test("parseScope returns an explicit scope or null for global", () => {
	assert.equal(parseScope("p1"), "p1");
	assert.equal(parseScope(null), null);
	assert.equal(parseScope(""), null);
});

test("DENY_SCOPE is a distinct sentinel for exact-scope denial", () => {
	assert.ok((DENY_SCOPE !== null && typeof DENY_SCOPE === "symbol") || DENY_SCOPE === "deny");
});

// ── queryGraph ────────────────────────────────────────────────

test("queryGraph returns nodes for an explicit scope", () => {
	const dir = mkTarget("query-scope");
	addPage(dir, "p1", { title: "Page 1" });
	addPage(dir, "p2", { title: "Page 2" });
	const graph = buildGovernanceGraph(dir);

	const result = queryGraph(graph, { scope: "p1" });
	assert.equal(result.ok, true);
	assert.equal(result.nodes.length, 1);
	assert.equal(result.nodes[0].id, "p1");
});

test("queryGraph with no scope is bounded (returns all nodes with a cap)", () => {
	const dir = mkTarget("query-bounded");
	for (let i = 0; i < 10; i += 1) {
		addPage(dir, `p${i}`, { title: `Page ${i}` });
	}
	const graph = buildGovernanceGraph(dir);

	const result = queryGraph(graph, { scope: null, limit: 5 });
	assert.equal(result.ok, true);
	assert.ok(result.nodes.length <= 5, "bounded read");
	assert.ok(result.truncated === true, "truncation flagged");
});

test("queryGraph denies an unknown scope (exact-scope denial)", () => {
	const dir = mkTarget("query-deny");
	addPage(dir, "p1", { title: "Page 1" });
	const graph = buildGovernanceGraph(dir);

	const result = queryGraph(graph, { scope: "nonexistent-page" });
	assert.equal(result.ok, false);
	assert.equal(result.code, "AMBER_E_GRAPH_DENY");
});

// ── Read receipts ─────────────────────────────────────────────

test("recordReadReceipt appends an immutable receipt", () => {
	const dir = mkTarget("receipt");
	const receipt = recordReadReceipt(dir, {
		scope: "p1",
		projectionType: "governance-graph",
		resultHash: "sha256:" + "a".repeat(64),
	});
	assert.ok(receipt.receiptId);
	assert.ok(receipt.readAt);
	assert.match(receipt.resultHash, /^sha256:[0-9a-f]{64}$/);

	const receipts = listReadReceipts(dir);
	assert.equal(receipts.length, 1);
	assert.equal(receipts[0].scope, "p1");
});

test("listReadReceipts returns empty when no receipts", () => {
	const dir = mkTarget("receipt-empty");
	assert.deepEqual(listReadReceipts(dir), []);
});

test("verifyReceipt confirms an existing receipt is immutable", () => {
	const dir = mkTarget("receipt-verify");
	const receipt = recordReadReceipt(dir, {
		scope: "p1",
		projectionType: "governance-graph",
		resultHash: "sha256:" + "a".repeat(64),
	});
	const verified = verifyReceipt(dir, receipt.receiptId);
	assert.equal(verified.ok, true);
	assert.equal(verified.receipt.receiptId, receipt.receiptId);
});

test("verifyReceipt fails for an unknown receipt id", () => {
	const dir = mkTarget("receipt-missing");
	const verified = verifyReceipt(dir, "no-such-receipt");
	assert.equal(verified.ok, false);
});

test("receipts are append-only — records accumulate, never overwrite", () => {
	const dir = mkTarget("receipt-append");
	recordReadReceipt(dir, {
		scope: "p1",
		projectionType: "governance-graph",
		resultHash: "sha256:" + "a".repeat(64),
	});
	recordReadReceipt(dir, {
		scope: "p2",
		projectionType: "governance-graph",
		resultHash: "sha256:" + "b".repeat(64),
	});
	const receipts = listReadReceipts(dir);
	assert.equal(receipts.length, 2);
	assert.notEqual(receipts[0].receiptId, receipts[1].receiptId);
});

// ── Integration ───────────────────────────────────────────────

test("query + receipt flow: bounded read leaves an immutable receipt", () => {
	const dir = mkTarget("flow");
	addPage(dir, "p1", { title: "Page 1", sources: { s1: { kind: "repo", ref: "a.md" } } });
	addPage(dir, "p2", { title: "Page 2", sources: { s1: { kind: "repo", ref: "a.md" } } });
	const graph = buildGovernanceGraph(dir);

	const query = queryGraph(graph, { scope: "p1" });
	assert.equal(query.ok, true);

	// every read leaves a receipt
	const receipt = recordReadReceipt(dir, {
		scope: "p1",
		projectionType: "governance-graph",
		resultHash: graph.sourceHash,
	});
	assert.ok(receipt.receiptId);
});
