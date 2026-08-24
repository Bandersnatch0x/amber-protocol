"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	PROJECTION_KINDS,
	buildWorkbenchProjection,
	renderTemporal,
	renderTimeline,
	renderCausal,
	renderRelationship,
	renderMindMap,
	renderContext,
	applyBounds,
	compareProjections,
} = require("../../scripts/lib/core/visualization-workbench");
const { mkTarget, addPage } = require("../helpers/harness");

// ── Constants ─────────────────────────────────────────────────

test("PROJECTION_KINDS enumerates the workbench projections (baseline #164)", () => {
	assert.deepEqual([...PROJECTION_KINDS].sort(), [
		"causal",
		"context",
		"mind-map",
		"relationship",
		"temporal",
		"timeline",
	]);
});

// ── Builders ──────────────────────────────────────────────────

test("renderTemporal produces a time-ordered projection", () => {
	const dir = mkTarget("temporal");
	addPage(dir, "p1", { title: "Old", createdAt: "2026-08-01T00:00:00Z" });
	addPage(dir, "p2", { title: "New", createdAt: "2026-08-03T00:00:00Z" });
	const result = renderTemporal(dir);
	assert.ok(result.entries.length >= 2);
	// newest first by default
	assert.ok(result.entries.length >= 2);
});

test("renderTimeline produces an ordered event sequence", () => {
	const dir = mkTarget("timeline");
	addPage(dir, "p1", { title: "Page 1", createdAt: "2026-08-01T00:00:00Z" });
	addPage(dir, "p2", { title: "Page 2", createdAt: "2026-08-02T00:00:00Z" });
	const result = renderTimeline(dir);
	assert.ok(result.events.length >= 2);
	assert.ok(
		result.events.every((e) => e.timestamp),
		"events carry timestamps",
	);
});

test("renderCausal produces directional derivation edges (older → newer)", () => {
	const dir = mkTarget("causal");
	const shared = { kind: "repo", ref: "docs/spec.md" };
	addPage(dir, "p1", { title: "Old", sources: { s1: shared }, createdAt: "2026-08-01T00:00:00Z" });
	addPage(dir, "p2", { title: "New", sources: { s1: shared }, createdAt: "2026-08-03T00:00:00Z" });
	const result = renderCausal(dir);
	assert.equal(result.kind, "causal");
	assert.ok(result.nodes.length >= 2);
	assert.ok(result.edges.length >= 1, "causal edge from shared provenance");
	const edge = result.edges[0];
	assert.equal(edge.type, "causal-derivation");
	assert.equal(edge.source, "p1");
	assert.equal(edge.target, "p2");
	assert.equal(edge.ref, "docs/spec.md");
});

test("renderContext produces a page→source-context view", () => {
	const dir = mkTarget("context");
	addPage(dir, "p1", {
		title: "Page 1",
		sources: { s1: { kind: "repo", ref: "a.md", rawHash: "sha256:" + "a".repeat(64) } },
	});
	const result = renderContext(dir);
	assert.equal(result.kind, "context");
	assert.ok(result.contexts.length >= 1);
	const page = result.contexts[0];
	assert.equal(page.id, "p1");
	assert.equal(page.sources.length, 1);
	assert.equal(page.sources[0].ref, "a.md");
	assert.ok(page.sources[0].hash, "context carries source hash");
});

test("renderRelationship produces edges from shared sources", () => {
	const dir = mkTarget("relationship");
	const shared = { kind: "repo", ref: "docs/spec.md" };
	addPage(dir, "p1", { title: "Page 1", sources: { s1: shared } });
	addPage(dir, "p2", { title: "Page 2", sources: { s1: shared } });
	const result = renderRelationship(dir);
	assert.ok(result.nodes.length >= 2);
	assert.ok(result.links.length >= 1, "shared-source link");
});

test("renderMindMap produces a page→source hierarchy", () => {
	const dir = mkTarget("mindmap");
	addPage(dir, "p1", {
		title: "Page 1",
		sources: { s1: { kind: "repo", ref: "a.md" }, s2: { kind: "repo", ref: "b.md" } },
	});
	const result = renderMindMap(dir);
	assert.ok(result.pages.length >= 1);
	const page = result.pages[0];
	assert.ok(page.sources.length >= 2, "page lists its sources");
});

test("buildWorkbenchProjection delegates to the requested kind", () => {
	const dir = mkTarget("build");
	addPage(dir, "p1", { title: "Page 1" });
	const result = buildWorkbenchProjection(dir, "temporal");
	assert.ok(result);
	assert.ok(result.sourceHash, "projection has sourceHash");
	assert.match(result.sourceHash, /^sha256:[0-9a-f]{64}$/);
});

test("buildWorkbenchProjection rejects an unknown kind", () => {
	const dir = mkTarget("badkind");
	assert.throws(() => buildWorkbenchProjection(dir, "bogus"), /unknown/i);
});

// ── Bounds ────────────────────────────────────────────────────

test("applyBounds enforces limit (bounded reads)", () => {
	const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
	const result = applyBounds(items, { limit: 2 });
	assert.equal(result.items.length, 2);
	assert.equal(result.truncated, true);
});

test("applyBounds supports sort keys deterministically", () => {
	const items = [
		{ id: "b", ts: 2 },
		{ id: "a", ts: 1 },
		{ id: "c", ts: 3 },
	];
	const result = applyBounds(items, { sortKey: "ts", limit: 10 });
	assert.deepEqual(
		result.items.map((i) => i.id),
		["a", "b", "c"],
	);
});

test("applyBounds supports filters", () => {
	const items = [
		{ id: "a", kind: "x" },
		{ id: "b", kind: "y" },
	];
	const result = applyBounds(items, { filter: { kind: "x" } });
	assert.equal(result.items.length, 1);
	assert.equal(result.items[0].id, "a");
});

// ── Compare ───────────────────────────────────────────────────

test("compareProjections reports differences between two projection states", () => {
	const before = { nodes: [{ id: "p1" }, { id: "p2" }] };
	const after = { nodes: [{ id: "p1" }, { id: "p2" }, { id: "p3" }] };
	const result = compareProjections(before, after);
	assert.equal(result.added.length, 1);
	assert.equal(result.added[0].id, "p3");
	assert.equal(result.removed.length, 0);
	assert.equal(result.changed, true);
});

test("compareProjections reports identical states as unchanged", () => {
	const before = { nodes: [{ id: "p1" }] };
	const result = compareProjections(before, before);
	assert.equal(result.changed, false);
	assert.equal(result.added.length, 0);
	assert.equal(result.removed.length, 0);
});

// ── Privacy / determinism ─────────────────────────────────────

test("projections are deterministic — same input, same shape", () => {
	const dir = mkTarget("det");
	addPage(dir, "p1", { title: "Page 1" });
	addPage(dir, "p2", { title: "Page 2" });
	const a = buildWorkbenchProjection(dir, "relationship");
	const b = buildWorkbenchProjection(dir, "relationship");
	assert.equal(a.sourceHash, b.sourceHash);
});
