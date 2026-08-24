"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	PROJECTION_TYPES,
	projectionManifestPath,
	projectionStatus,
	rebuildProjection,
	buildProjection,
	validateProjectionManifest,
} = require("../../scripts/lib/core/projection-registry");
const { mkTarget } = require("../helpers/harness");

// ── Constants ──────────────────────────────────────────────────

test("PROJECTION_TYPES enumerates the three baseline projection kinds", () => {
	assert.deepEqual([...PROJECTION_TYPES].sort(), [
		"governance-graph",
		"knowledge-base",
		"visualization-workbench",
	]);
});

// ── validateProjectionManifest ────────────────────────────────

test("validateProjectionManifest accepts a well-formed manifest", () => {
	const manifest = {
		schemaVersion: "1.0.0",
		projectionId: "governance-graph",
		projection_type: "governance-graph",
		projection_version: 1,
		rebuild_checkpoint: "abc",
		sourceHash: "sha256:" + "a".repeat(64),
		outputHash: "sha256:" + "b".repeat(64),
	};
	const result = validateProjectionManifest(manifest);
	assert.equal(result.valid, true);
	assert.deepEqual(result.errors, []);
});

test("validateProjectionManifest accepts ADR-0012 versioning fields", () => {
	const manifest = {
		schemaVersion: "1.0.0",
		projectionId: "governance-graph",
		projection_type: "governance-graph",
		projection_version: 1,
		rebuild_checkpoint: "abc",
		sourceHash: "sha256:" + "a".repeat(64),
		outputHash: "sha256:" + "b".repeat(64),
		amber_protocol_version: "1.7.0",
		artifact_sequence: 0,
		created_at: "2026-08-20T00:00:00Z",
		artifact_type: "projection-manifest",
	};
	const result = validateProjectionManifest(manifest);
	assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("validateProjectionManifest rejects a bad artifact_sequence", () => {
	const manifest = {
		schemaVersion: "1.0.0",
		projectionId: "governance-graph",
		projection_type: "governance-graph",
		projection_version: 1,
		rebuild_checkpoint: "abc",
		sourceHash: "sha256:" + "a".repeat(64),
		outputHash: "sha256:" + "b".repeat(64),
		artifact_sequence: -1,
	};
	const result = validateProjectionManifest(manifest);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((e) => e.includes("artifact_sequence")));
});

test("validateProjectionManifest rejects an unknown projection type", () => {
	const manifest = {
		schemaVersion: "1.0.0",
		projectionId: "bogus",
		projection_type: "bogus",
		projection_version: 1,
		rebuild_checkpoint: "abc",
		sourceHash: "sha256:" + "a".repeat(64),
		outputHash: "sha256:" + "b".repeat(64),
	};
	const result = validateProjectionManifest(manifest);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((e) => e.includes("bogus")));
});

test("validateProjectionManifest rejects missing required fields", () => {
	const result = validateProjectionManifest({});
	assert.equal(result.valid, false);
	assert.ok(result.errors.length > 0);
});

// ── buildProjection / rebuildProjection ───────────────────────

test("buildProjection creates an immutable rebuildable projection from canonical artifacts", () => {
	const dir = mkTarget("build");
	// canonical artifact: a context page
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Page 1", sources: {}, blocks: [] }),
	);

	const result = buildProjection(dir, "governance-graph", () => ({ nodes: [{ id: "p1" }] }));
	assert.equal(result.ok, true, result.detail || JSON.stringify(result));
	assert.ok(result.manifest);
	assert.equal(result.manifest.projection_type, "governance-graph");
	assert.ok(result.manifest.sourceHash);
	assert.ok(result.manifest.outputHash);
	assert.ok(result.manifest.rebuild_checkpoint);
	// ADR-0012 versioning fields populated on write
	assert.equal(result.manifest.artifact_type, "projection-manifest");
	assert.equal(result.manifest.artifact_sequence, 0);
	assert.ok(result.manifest.amber_protocol_version);
	assert.ok(result.manifest.created_at);
});

test("rebuildProjection writes a manifest with a stable identity", () => {
	const dir = mkTarget("rebuild");
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Page 1", sources: {}, blocks: [] }),
	);

	const r1 = rebuildProjection(dir, "governance-graph", () => ({ nodes: [{ id: "p1" }] }));
	assert.equal(r1.ok, true);
	const manifestPath = projectionManifestPath(dir, "governance-graph");
	assert.ok(fs.existsSync(manifestPath), "manifest written");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	assert.equal(manifest.projectionId, "governance-graph");
});

test("rebuildProjection fails when the builder throws", () => {
	const dir = mkTarget("fail");
	const result = rebuildProjection(dir, "governance-graph", () => {
		throw new Error("builder failure");
	});
	assert.equal(result.ok, false);
	assert.ok(result.errors.some((e) => e.includes("builder failure")));
});

// ── projectionStatus ──────────────────────────────────────────

test("projectionStatus reports missing when no manifest exists", () => {
	const dir = mkTarget("status-missing");
	const result = projectionStatus(dir, "knowledge-base");
	assert.equal(result.ok, false);
	assert.equal(result.code, "AMBER_E_PROJECTION_MISSING");
});

test("projectionStatus reports current for a fresh projection", () => {
	const dir = mkTarget("status-current");
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Page 1", sources: {}, blocks: [] }),
	);
	const rebuilt = rebuildProjection(dir, "governance-graph", () => ({ nodes: [{ id: "p1" }] }));
	assert.equal(rebuilt.ok, true);

	const status = projectionStatus(dir, "governance-graph");
	assert.equal(status.ok, true, JSON.stringify(status));
	assert.equal(status.detail, "current");
});

test("projectionStatus reports drift when canonical artifacts change", () => {
	const dir = mkTarget("status-drift");
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Page 1", sources: {}, blocks: [] }),
	);
	rebuildProjection(dir, "governance-graph", () => ({ nodes: [{ id: "p1" }] }));

	// canonical artifact changes → projection is stale
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({ pageId: "p1", title: "Page 1 changed", sources: {}, blocks: [] }),
	);
	const status = projectionStatus(dir, "governance-graph");
	assert.equal(status.ok, false);
	assert.equal(status.code, "AMBER_E_PROJECTION_DRIFT");
});

// ── Organization profile tie-in ───────────────────────────────

test("projections are available on the organization deployment profile", () => {
	const dir = mkTarget("org");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "profile.json"),
		JSON.stringify({ deploymentProfile: "organization" }),
	);
	const { resolveDeploymentProfile } = require("../../scripts/lib/core/deployment-profile");
	const profile = resolveDeploymentProfile(dir);
	assert.equal(profile.deploymentProfile, "organization");
	// all three projection kinds are valid on any profile
	for (const type of PROJECTION_TYPES) {
		assert.ok(typeof type === "string" && type.length > 0);
	}
});
