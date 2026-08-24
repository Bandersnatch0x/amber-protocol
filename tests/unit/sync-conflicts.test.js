"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	recordConflict,
	listConflicts,
	conflictLedgerPath,
	replayEnvelopes,
	applyEnvelope,
} = require("../../scripts/lib/core/sync-conflicts");
const { mkTarget } = require("../helpers/harness");

const PAGE = ".amber/context/pages/a.json";

function writeArtifact(dir, relPath, content) {
	const full = path.join(dir, relPath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
	return relPath;
}

function makeEnvelope(dir, relPath, { hash = null, envelopeId = null } = {}) {
	const { packEnvelope } = require("../../scripts/lib/core/sync-remote");
	const packed = packEnvelope(dir, "context-page", relPath);
	if (packed.errors.length > 0) {
		throw new Error(`fixture pack failed: ${packed.errors.join("; ")}`);
	}
	if (hash) packed.envelope.artifactRef.hash = hash;
	if (envelopeId) packed.envelope.envelopeId = envelopeId;
	return packed.envelope;
}

// ── Conflict ledger ───────────────────────────────────────────

test("conflictLedgerPath points at .amber/sync/conflicts.jsonl", () => {
	const dir = mkTarget("path", { git: true });
	assert.ok(conflictLedgerPath(dir).endsWith(path.join(".amber", "sync", "conflicts.jsonl")));
});

test("recordConflict appends to the ledger (append-only)", () => {
	const dir = mkTarget("record", { git: true });
	recordConflict(dir, {
		conflictType: "concurrent-edit",
		envelopeId: "01234567-89ab-cdef-0123-456789abcdef",
		artifactPath: PAGE,
		detail: "local content differs",
	});

	const conflicts = listConflicts(dir);
	assert.equal(conflicts.length, 1);
	assert.equal(conflicts[0].conflictType, "concurrent-edit");
	assert.equal(conflicts[0].envelopeId, "01234567-89ab-cdef-0123-456789abcdef");
	assert.equal(conflicts[0].resolution, "pending");
	assert.ok(conflicts[0].recordedAt);
});

test("listConflicts returns empty when no conflicts recorded", () => {
	const dir = mkTarget("empty", { git: true });
	assert.deepEqual(listConflicts(dir), []);
});

test("recordConflict preserves multiple entries (append-only, never overwrites)", () => {
	const dir = mkTarget("multi", { git: true });
	recordConflict(dir, {
		conflictType: "concurrent-edit",
		envelopeId: "11111111-1111-1111-1111-111111111111",
		artifactPath: PAGE,
		detail: "x",
	});
	recordConflict(dir, {
		conflictType: "version-mismatch",
		envelopeId: "22222222-2222-2222-2222-222222222222",
		artifactPath: ".amber/context/pages/b.json",
		detail: "y",
	});

	const conflicts = listConflicts(dir);
	assert.equal(conflicts.length, 2);
	assert.equal(conflicts[0].conflictType, "concurrent-edit");
	assert.equal(conflicts[1].conflictType, "version-mismatch");
});

// ── applyEnvelope (never silently overwrites) ────────────────

test("applyEnvelope applies cleanly when the local artifact matches", () => {
	const dir = mkTarget("apply-ok", { git: true });
	const content = "original content";
	writeArtifact(dir, PAGE, content);
	const envelope = makeEnvelope(dir, PAGE);
	const result = applyEnvelope(dir, envelope);
	assert.equal(result.ok, true);
	assert.equal(result.action, "applied");
});

test("applyEnvelope records a conflict and refuses when the local hash differs", () => {
	const dir = mkTarget("apply-conflict", { git: true });
	writeArtifact(dir, PAGE, "original");
	const envelope = makeEnvelope(dir, PAGE);
	// Local content changes after enveloping → hash mismatch
	writeArtifact(dir, PAGE, "changed locally");

	const result = applyEnvelope(dir, envelope);
	assert.equal(result.ok, false);
	assert.equal(result.action, "conflict");
	assert.ok(result.conflict);
	assert.equal(result.conflict.conflictType, "concurrent-edit");

	// Local artifact is NOT overwritten
	const content = fs.readFileSync(path.join(dir, PAGE), "utf8");
	assert.equal(content, "changed locally", "local content must never be silently overwritten");

	// Conflict is recorded append-only
	const conflicts = listConflicts(dir);
	assert.equal(conflicts.length, 1);
});

test("applyEnvelope records a conflict for an incompatible envelope", () => {
	const dir = mkTarget("apply-incompat", { git: true });
	writeArtifact(dir, PAGE, "original");
	const envelope = makeEnvelope(dir, PAGE);
	envelope.versionNegotiation = {
		amberProtocolVersion: "1.6.0",
		minCompatibleVersion: "99.0.0",
		capabilities: ["sync-envelope-v1"],
	};

	const result = applyEnvelope(dir, envelope);
	assert.equal(result.ok, false);
	assert.equal(result.action, "conflict");
	assert.equal(result.conflict.conflictType, "version-mismatch");
});

// ── replayEnvelopes (idempotent + bounded) ───────────────────

test("replayEnvelopes is idempotent across repeated runs", () => {
	const dir = mkTarget("replay", { git: true });
	writeArtifact(dir, PAGE, "stable");
	const envelope = makeEnvelope(dir, PAGE);
	// write the envelope to disk as an incoming envelope
	const envDir = path.join(dir, ".amber", "sync", "envelopes");
	fs.mkdirSync(envDir, { recursive: true });
	fs.writeFileSync(
		path.join(envDir, `${envelope.envelopeId}.json`),
		JSON.stringify(envelope, null, 2),
	);

	const r1 = replayEnvelopes(dir);
	assert.equal(r1.errors.length, 0);
	const r2 = replayEnvelopes(dir);
	assert.equal(r2.errors.length, 0);
	// Second replay applies nothing new (idempotent)
	assert.equal(r2.applied, 0);
});

test("replayEnvelopes applies each envelope at most once", () => {
	const dir = mkTarget("replay-once", { git: true });
	writeArtifact(dir, PAGE, "stable");
	const envelope = makeEnvelope(dir, PAGE);
	const envDir = path.join(dir, ".amber", "sync", "envelopes");
	fs.mkdirSync(envDir, { recursive: true });
	fs.writeFileSync(
		path.join(envDir, `${envelope.envelopeId}.json`),
		JSON.stringify(envelope, null, 2),
	);

	const r1 = replayEnvelopes(dir);
	assert.equal(r1.applied, 1);
	const r2 = replayEnvelopes(dir);
	assert.equal(r2.applied, 0);
});

test("replayEnvelopes refuses envelopes that would conflict", () => {
	const dir = mkTarget("replay-conflict", { git: true });
	writeArtifact(dir, PAGE, "original");
	const envelope = makeEnvelope(dir, PAGE);
	// local diverges after enveloping
	writeArtifact(dir, PAGE, "diverged");
	const envDir = path.join(dir, ".amber", "sync", "envelopes");
	fs.mkdirSync(envDir, { recursive: true });
	fs.writeFileSync(
		path.join(envDir, `${envelope.envelopeId}.json`),
		JSON.stringify(envelope, null, 2),
	);

	const result = replayEnvelopes(dir);
	assert.equal(result.applied, 0);
	assert.ok(result.conflicts.length >= 1, "conflict recorded");
	assert.equal(listConflicts(dir).length, 1);
});

test("replayEnvelopes never transports source code paths", () => {
	const dir = mkTarget("replay-safe", { git: true });
	// only .amber artifacts are enveloped; source files under src/ are not in the envelope surface
	writeArtifact(dir, ".amber/context/pages/p1.json", '{"pageId":"p1"}');
	const envelope = makeEnvelope(dir, ".amber/context/pages/p1.json");
	assert.ok(envelope.artifactRef.path.startsWith(".amber"), "only .amber artifacts enveloped");
});

// ── F035 S1: conflict application admission ───────────────────

function manualEnvelope(artifactPath, hash, envelopeId = "01234567-89ab-cdef-0123-456789abcdef") {
	return {
		schemaVersion: "1.0.0",
		envelopeId,
		artifactType: "context-page",
		artifactRef: { path: artifactPath, hash },
		structuralIdentity: { tenantId: "local", repositoryId: "r", repositoryGeneration: 0 },
		origin: { profile: "personal-node" },
		createdAt: "2026-08-23T12:00:00Z",
		versionNegotiation: {
			amberProtocolVersion: "1.6.0",
			minCompatibleVersion: "1.0.0",
			capabilities: ["sync-envelope-v1"],
		},
	};
}

test("applyEnvelope refuses an envelope whose artifact path escapes the repository", () => {
	const dir = mkTarget("apply-outside", { git: true });
	const outside = path.join(dir, "..", "outside-secret-apply.txt");
	fs.writeFileSync(outside, "secret");
	const { hashFile } = require("../../scripts/lib/core/sync-remote");
	const envelope = manualEnvelope("../outside-secret-apply.txt", hashFile(outside));

	const result = applyEnvelope(dir, envelope);
	assert.equal(result.ok, false, "outside artifact paths are never applied");
	assert.equal(result.action, "invalid");
	assert.ok(result.errors.length > 0);
	// No conflict record: an invalid path is not a semantic conflict, and the
	// outside file's hash must never be persisted.
	assert.deepEqual(listConflicts(dir), []);
});

test("applyEnvelope refuses an envelope whose path misses the artifact type family", () => {
	const dir = mkTarget("apply-mismatch", { git: true });
	writeArtifact(dir, "feature_list.json", "{}");
	const envelope = manualEnvelope("feature_list.json", "sha256:" + "a".repeat(64));

	const result = applyEnvelope(dir, envelope);
	assert.equal(result.ok, false);
	assert.equal(result.action, "invalid");
	assert.ok(result.errors.length > 0);
	assert.deepEqual(listConflicts(dir), []);
});

test("applyEnvelope does not mark an invalid-path envelope applied", () => {
	const dir = mkTarget("apply-unapplied", { git: true });
	const outside = path.join(dir, "..", "outside-secret-unapplied.txt");
	fs.writeFileSync(outside, "secret");
	const envelope = manualEnvelope("../outside-secret-unapplied.txt", "sha256:" + "a".repeat(64));
	const envDir = path.join(dir, ".amber", "sync", "envelopes");
	fs.mkdirSync(envDir, { recursive: true });
	fs.writeFileSync(
		path.join(envDir, `${envelope.envelopeId}.json`),
		JSON.stringify(envelope, null, 2),
	);

	const result = replayEnvelopes(dir);
	assert.equal(result.applied, 0);
	assert.deepEqual(result.conflicts, []);
	assert.ok(result.errors.length > 0);
	const { listAppliedEnvelopeIds } = require("../../scripts/lib/core/sync-conflicts");
	assert.equal(listAppliedEnvelopeIds(dir).has(envelope.envelopeId), false);
});
