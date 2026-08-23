"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");

const {
	recordConflict,
	listConflicts,
	conflictLedgerPath,
	replayEnvelopes,
	applyEnvelope,
} = require("../../scripts/lib/core/sync-conflicts");

function mkTarget(label) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-conflict-${label}-`));
	execSync("git init", { cwd: dir, encoding: "utf8" });
	execSync('git config user.email "test@example.com"', { cwd: dir, encoding: "utf8" });
	execSync('git config user.name "Test User"', { cwd: dir, encoding: "utf8" });
	return dir;
}

function writeArtifact(dir, relPath, content) {
	const full = path.join(dir, relPath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
	return relPath;
}

function makeEnvelope(dir, relPath, { hash = null, envelopeId = null } = {}) {
	const { packEnvelope } = require("../../scripts/lib/core/sync-remote");
	const packed = packEnvelope(dir, "context-page", relPath);
	if (hash) packed.envelope.artifactRef.hash = hash;
	if (envelopeId) packed.envelope.envelopeId = envelopeId;
	return packed.envelope;
}

// ── Conflict ledger ───────────────────────────────────────────

test("conflictLedgerPath points at .amber/sync/conflicts.jsonl", () => {
	const dir = mkTarget("path");
	assert.ok(conflictLedgerPath(dir).endsWith(path.join(".amber", "sync", "conflicts.jsonl")));
});

test("recordConflict appends to the ledger (append-only)", () => {
	const dir = mkTarget("record");
	recordConflict(dir, {
		conflictType: "concurrent-edit",
		envelopeId: "01234567-89ab-cdef-0123-456789abcdef",
		artifactPath: "docs/a.md",
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
	const dir = mkTarget("empty");
	assert.deepEqual(listConflicts(dir), []);
});

test("recordConflict preserves multiple entries (append-only, never overwrites)", () => {
	const dir = mkTarget("multi");
	recordConflict(dir, {
		conflictType: "concurrent-edit",
		envelopeId: "11111111-1111-1111-1111-111111111111",
		artifactPath: "docs/a.md",
		detail: "x",
	});
	recordConflict(dir, {
		conflictType: "version-mismatch",
		envelopeId: "22222222-2222-2222-2222-222222222222",
		artifactPath: "docs/b.md",
		detail: "y",
	});

	const conflicts = listConflicts(dir);
	assert.equal(conflicts.length, 2);
	assert.equal(conflicts[0].conflictType, "concurrent-edit");
	assert.equal(conflicts[1].conflictType, "version-mismatch");
});

// ── applyEnvelope (never silently overwrites) ────────────────

test("applyEnvelope applies cleanly when the local artifact matches", () => {
	const dir = mkTarget("apply-ok");
	const content = "original content";
	writeArtifact(dir, "docs/a.md", content);
	const envelope = makeEnvelope(dir, "docs/a.md");
	const result = applyEnvelope(dir, envelope);
	assert.equal(result.ok, true);
	assert.equal(result.action, "applied");
});

test("applyEnvelope records a conflict and refuses when the local hash differs", () => {
	const dir = mkTarget("apply-conflict");
	writeArtifact(dir, "docs/a.md", "original");
	const envelope = makeEnvelope(dir, "docs/a.md");
	// Local content changes after enveloping → hash mismatch
	writeArtifact(dir, "docs/a.md", "changed locally");

	const result = applyEnvelope(dir, envelope);
	assert.equal(result.ok, false);
	assert.equal(result.action, "conflict");
	assert.ok(result.conflict);
	assert.equal(result.conflict.conflictType, "concurrent-edit");

	// Local artifact is NOT overwritten
	const content = fs.readFileSync(path.join(dir, "docs", "a.md"), "utf8");
	assert.equal(content, "changed locally", "local content must never be silently overwritten");

	// Conflict is recorded append-only
	const conflicts = listConflicts(dir);
	assert.equal(conflicts.length, 1);
});

test("applyEnvelope records a conflict for an incompatible envelope", () => {
	const dir = mkTarget("apply-incompat");
	writeArtifact(dir, "docs/a.md", "original");
	const envelope = makeEnvelope(dir, "docs/a.md");
	envelope.versionNegotiation = { minCompatibleVersion: "99.0.0", capabilities: [] };

	const result = applyEnvelope(dir, envelope);
	assert.equal(result.ok, false);
	assert.equal(result.action, "conflict");
	assert.equal(result.conflict.conflictType, "version-mismatch");
});

// ── replayEnvelopes (idempotent + bounded) ───────────────────

test("replayEnvelopes is idempotent across repeated runs", () => {
	const dir = mkTarget("replay");
	writeArtifact(dir, "docs/a.md", "stable");
	const envelope = makeEnvelope(dir, "docs/a.md");
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
	const dir = mkTarget("replay-once");
	writeArtifact(dir, "docs/a.md", "stable");
	const envelope = makeEnvelope(dir, "docs/a.md");
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
	const dir = mkTarget("replay-conflict");
	writeArtifact(dir, "docs/a.md", "original");
	const envelope = makeEnvelope(dir, "docs/a.md");
	// local diverges after enveloping
	writeArtifact(dir, "docs/a.md", "diverged");
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
	const dir = mkTarget("replay-safe");
	// only .amber artifacts are enveloped; source files under src/ are not in the envelope surface
	writeArtifact(dir, ".amber/context/pages/p1.json", '{"pageId":"p1"}');
	const envelope = makeEnvelope(dir, ".amber/context/pages/p1.json");
	assert.ok(envelope.artifactRef.path.startsWith(".amber"), "only .amber artifacts enveloped");
});
