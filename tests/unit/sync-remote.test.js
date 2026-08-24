"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	checkCompatibility,
	packEnvelope,
	unpackEnvelope,
	envelopeFromArtifact,
	validateEnvelope,
} = require("../../scripts/lib/core/sync-remote");
const { mkTarget } = require("../helpers/harness");

function writeArtifact(dir, relPath, content) {
	const full = path.join(dir, relPath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
	return relPath;
}

// ── checkCompatibility ─────────────────────────────────────────

test("checkCompatibility accepts an envelope with a matching protocol version", () => {
	const envelope = {
		versionNegotiation: {
			amberProtocolVersion: "1.6.0",
			minCompatibleVersion: "1.0.0",
			capabilities: ["sync-envelope-v1"],
		},
	};
	const result = checkCompatibility(envelope, { version: "1.6.0" });
	assert.equal(result.compatible, true);
	assert.deepEqual(result.reasons, []);
});

test("checkCompatibility refuses an envelope whose minCompatibleVersion exceeds current", () => {
	const envelope = {
		versionNegotiation: {
			amberProtocolVersion: "2.0.0",
			minCompatibleVersion: "2.0.0",
			capabilities: ["sync-envelope-v2"],
		},
	};
	const result = checkCompatibility(envelope, { version: "1.6.0" });
	assert.equal(result.compatible, false);
	assert.ok(result.reasons.some((r) => r.includes("minCompatibleVersion")));
});

test("checkCompatibility refuses when a required capability is missing", () => {
	const envelope = {
		versionNegotiation: {
			amberProtocolVersion: "1.6.0",
			minCompatibleVersion: "1.0.0",
			capabilities: ["sync-envelope-v1", "some-required-capability"],
		},
	};
	const result = checkCompatibility(envelope, {
		version: "1.6.0",
		capabilities: ["sync-envelope-v1"],
	});
	assert.equal(result.compatible, false);
	assert.ok(result.reasons.some((r) => r.includes("some-required-capability")));
});

test("checkCompatibility refuses an envelope with no versionNegotiation", () => {
	const result = checkCompatibility({}, { version: "1.6.0" });
	assert.equal(result.compatible, false);
	assert.ok(result.reasons.some((r) => r.includes("versionNegotiation")));
});

test("checkCompatibility accepts when capabilities are satisfied", () => {
	const envelope = {
		versionNegotiation: {
			amberProtocolVersion: "1.6.0",
			minCompatibleVersion: "1.0.0",
			capabilities: ["sync-envelope-v1"],
		},
	};
	const result = checkCompatibility(envelope, {
		version: "1.6.0",
		capabilities: ["sync-envelope-v1", "extra"],
	});
	assert.equal(result.compatible, true);
});

// ── validateEnvelope ───────────────────────────────────────────

test("validateEnvelope accepts a well-formed envelope", () => {
	const envelope = {
		schemaVersion: "1.0.0",
		envelopeId: "01234567-89ab-cdef-0123-456789abcdef",
		artifactType: "timeline-event",
		artifactRef: { path: "x", hash: "sha256:" + "a".repeat(64) },
		structuralIdentity: { tenantId: "local", repositoryId: "r", repositoryGeneration: 0 },
		origin: { profile: "personal-node" },
		createdAt: "2026-08-23T12:00:00Z",
	};
	const result = validateEnvelope(envelope);
	assert.equal(result.valid, true);
	assert.deepEqual(result.errors, []);
});

test("validateEnvelope rejects an envelope missing structuralIdentity", () => {
	const envelope = {
		schemaVersion: "1.0.0",
		envelopeId: "01234567-89ab-cdef-0123-456789abcdef",
		artifactType: "timeline-event",
		artifactRef: { path: "x", hash: "sha256:" + "a".repeat(64) },
		origin: { profile: "personal-node" },
		createdAt: "2026-08-23T12:00:00Z",
	};
	const result = validateEnvelope(envelope);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((e) => e.includes("structuralIdentity")));
});

test("validateEnvelope rejects an envelope with invalid hash format", () => {
	const envelope = {
		schemaVersion: "1.0.0",
		envelopeId: "01234567-89ab-cdef-0123-456789abcdef",
		artifactType: "timeline-event",
		artifactRef: { path: "x", hash: "not-a-hash" },
		structuralIdentity: { tenantId: "local", repositoryId: "r", repositoryGeneration: 0 },
		origin: { profile: "personal-node" },
		createdAt: "2026-08-23T12:00:00Z",
	};
	const result = validateEnvelope(envelope);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((e) => e.includes("hash")));
});

// ── envelopeFromArtifact ───────────────────────────────────────

test("envelopeFromArtifact creates an envelope with a content hash", () => {
	const dir = mkTarget("pack", { git: true });
	writeArtifact(dir, "docs/note.md", "hello envelope");
	const env = envelopeFromArtifact(dir, "context-page", "docs/note.md");
	assert.equal(env.artifactType, "context-page");
	assert.equal(env.artifactRef.path, "docs/note.md");
	assert.match(env.artifactRef.hash, /^sha256:[0-9a-f]{64}$/);
	assert.equal(env.structuralIdentity.tenantId, "local");
	assert.match(env.envelopeId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	assert.ok(env.createdAt);
});

test("envelopeFromArtifact throws for a missing artifact", () => {
	const dir = mkTarget("missing", { git: true });
	assert.throws(() => envelopeFromArtifact(dir, "context-page", "does-not-exist.md"), /not found/);
});

// ── packEnvelope / unpackEnvelope ─────────────────────────────

test("packEnvelope writes an envelope to .amber/sync/", () => {
	const dir = mkTarget("pack-write", { git: true });
	writeArtifact(dir, "docs/note.md", "pack me");
	const packed = packEnvelope(dir, "context-page", "docs/note.md");
	assert.equal(packed.errors.length, 0);
	const envPath = path.join(
		dir,
		".amber",
		"sync",
		"envelopes",
		`${packed.envelope.envelopeId}.json`,
	);
	assert.ok(fs.existsSync(envPath), "envelope file written");
	const raw = JSON.parse(fs.readFileSync(envPath, "utf8"));
	assert.equal(raw.artifactRef.path, "docs/note.md");
});

test("unpackEnvelope validates a locally-present artifact with matching hash", () => {
	const dir = mkTarget("unpack", { git: true });
	const content = "artifact content 123";
	writeArtifact(dir, "docs/source.md", content);
	const packed = packEnvelope(dir, "context-page", "docs/source.md");

	// Envelope validates; artifact is already present via git transport with a matching hash.
	const unpacked = unpackEnvelope(dir, packed.envelope);
	assert.equal(unpacked.errors.length, 0);
	assert.equal(unpacked.artifactPath, "docs/source.md");
	const written = fs.readFileSync(path.join(dir, "docs", "source.md"), "utf8");
	assert.equal(written, content);
});

test("unpackEnvelope fails closed for an incompatible envelope", () => {
	const dir = mkTarget("incompat", { git: true });
	writeArtifact(dir, "docs/source.md", "content");
	const packed = packEnvelope(dir, "context-page", "docs/source.md");
	// Corrupt the version negotiation to require a newer protocol
	packed.envelope.versionNegotiation.minCompatibleVersion = "99.0.0";

	const unpacked = unpackEnvelope(dir, packed.envelope);
	assert.ok(unpacked.errors.length > 0);
	assert.ok(
		unpacked.errors.some(
			(e) => e.includes("compatib") || e.includes("Compatible") || e.includes("refus"),
		),
	);
});

test("unpackEnvelope refuses when the artifact hash does not match", () => {
	const dir = mkTarget("hash-mismatch", { git: true });
	writeArtifact(dir, "docs/source.md", "original");
	const packed = packEnvelope(dir, "context-page", "docs/source.md");
	// Corrupt the envelope hash
	packed.envelope.artifactRef.hash = "sha256:" + "b".repeat(64);

	const unpacked = unpackEnvelope(dir, packed.envelope);
	assert.ok(unpacked.errors.length > 0);
});

test("packEnvelope uses the deployment profile identity", () => {
	const dir = mkTarget("profile", { git: true });
	writeArtifact(dir, "docs/note.md", "x");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "profile.json"),
		JSON.stringify({ deploymentProfile: "team-hub" }),
	);
	const packed = packEnvelope(dir, "context-page", "docs/note.md");
	assert.equal(packed.envelope.origin.profile, "team-hub");
});
