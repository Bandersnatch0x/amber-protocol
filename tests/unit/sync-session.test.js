"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
	runSyncSession,
	createSyncSession,
	listEnvelopes,
	pushEnvelopes,
	pullEnvelopes,
} = require("../../scripts/lib/core/sync-session");
const { packEnvelope } = require("../../scripts/lib/core/sync-remote");
const { mkTarget } = require("../helpers/harness");

function writeArtifact(dir, relPath, content) {
	const full = path.join(dir, relPath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
	return relPath;
}

function initTarget(dir) {
	// A target that has run amber init has .amber/ structure
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	return dir;
}

function gitOut(dir, args) {
	const res = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
	return { status: res.status, stdout: (res.stdout || "").trim() };
}

// Staged entries are every porcelain line that is not untracked ("??").
function stagedPorcelainLines(dir) {
	return gitOut(dir, ["status", "--porcelain", "-uall"])
		.stdout.split(/\r?\n/)
		.filter(Boolean)
		.filter((line) => !line.startsWith("??"));
}

function baselineCommit(dir, label) {
	const res = spawnSync("git", ["commit", "--allow-empty", "-m", `baseline-${label}`], {
		cwd: dir,
		encoding: "utf8",
	});
	assert.equal(res.status, 0, (res.stderr || "").toString());
}

function packOne(dir) {
	writeArtifact(dir, ".amber/context/pages/page.json", "# Page\n");
	const { envelope, errors } = packEnvelope(dir, "context-page", ".amber/context/pages/page.json");
	assert.deepEqual(errors, []);
	return envelope;
}

// ── createSyncSession ─────────────────────────────────────────

test("createSyncSession returns a session record with a UUID and timestamps", () => {
	const dir = mkTarget("create", { git: true });
	const session = createSyncSession(dir, "push");
	assert.match(session.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	assert.equal(session.operation, "push");
	assert.ok(session.startedAt);
	assert.equal(session.status, "in-progress");
});

// ── listEnvelopes ─────────────────────────────────────────────

test("listEnvelopes returns empty for a target with no envelopes", () => {
	const dir = mkTarget("empty", { git: true });
	initTarget(dir);
	const envelopes = listEnvelopes(dir);
	assert.deepEqual(envelopes, []);
});

test("listEnvelopes returns packed envelopes", () => {
	const dir = mkTarget("list", { git: true });
	initTarget(dir);
	packOne(dir);
	const envelopes = listEnvelopes(dir);
	assert.equal(envelopes.length, 1);
	assert.equal(envelopes[0].artifactType, "context-page");
});

// ── pushEnvelopes (preparation/report-only, F035 D1) ──────────

test("pushEnvelopes prepares transport and performs zero git mutations", () => {
	const dir = mkTarget("push", { git: true });
	initTarget(dir);
	const envelope = packOne(dir);
	baselineCommit(dir, "push");
	const headBefore = gitOut(dir, ["rev-parse", "HEAD"]).stdout;
	const statusBefore = gitOut(dir, ["status", "--porcelain", "-uall"]).stdout;

	const result = pushEnvelopes(dir);

	assert.deepEqual(result.errors, []);
	assert.equal(result.mode, "prepare");
	assert.equal(result.envelopeCount, 1);
	assert.deepEqual(result.envelopeIds, [envelope.envelopeId]);
	assert.deepEqual(result.envelopePaths, [`.amber/sync/envelopes/${envelope.envelopeId}.json`]);
	assert.deepEqual(
		result.affectedPaths,
		[`.amber/sync/envelopes/${envelope.envelopeId}.json`],
		"affected paths list the .amber/sync/** files a transport commit would include",
	);
	assert.ok(
		result.proposedOps.some((op) => op.verb === "add" && op.paths.includes(".amber/sync")),
		"the add op carries its confined staging paths",
	);
	assert.ok(
		result.proposedOps.some((op) => op.verb === "commit" && op.message.startsWith("amber sync:")),
		`expected a proposed commit op, got ${JSON.stringify(result.proposedOps)}`,
	);
	assert.ok(
		result.proposedOps.every((op) => typeof op === "object" && typeof op.verb === "string"),
		"proposed operations are structured objects (F040 contract), never executed",
	);
	assert.equal(result.schemaVersion, "1.0.0");
	assert.equal(result.remoteConfigured, false, "no remote is configured in this fixture");
	assert.equal(result.conflictCount, 0);
	assert.equal(result.refusedCount, 0);

	// zero git mutations: HEAD, index, and working tree stay exactly as they were
	assert.equal(gitOut(dir, ["rev-parse", "HEAD"]).stdout, headBefore, "HEAD must not move");
	assert.equal(
		gitOut(dir, ["status", "--porcelain", "-uall"]).stdout,
		statusBefore,
		"index and working tree must be untouched",
	);
	assert.match(statusBefore, /\?\? \.amber\/sync\/envelopes\//, "envelope file stays untracked");
});

test("pushEnvelopes proposes git push only when a remote is configured", () => {
	const dir = mkTarget("push-remote", { git: true });
	initTarget(dir);
	packOne(dir);
	const remote = spawnSync("git", ["remote", "add", "origin", "https://example.com/hub.git"], {
		cwd: dir,
		encoding: "utf8",
	});
	assert.equal(remote.status, 0, (remote.stderr || "").toString());

	const result = pushEnvelopes(dir);

	assert.equal(result.remoteConfigured, true);
	assert.ok(
		result.proposedOps.some((op) => op.verb === "push"),
		"git push is proposed as a structured push op",
	);
	assert.deepEqual(result.errors, []);
});

test("pushEnvelopes with no envelopes proposes nothing", () => {
	const dir = mkTarget("noop", { git: true });
	initTarget(dir);
	const result = pushEnvelopes(dir);
	assert.equal(result.mode, "prepare");
	assert.equal(result.envelopeCount, 0);
	assert.deepEqual(result.envelopeIds, []);
	assert.deepEqual(result.envelopePaths, []);
	assert.deepEqual(result.affectedPaths, []);
	assert.deepEqual(result.proposedOps, []);
	assert.equal(result.errors.length, 0);
});

// ── pullEnvelopes (admission + persisted refusals) ────────────

test("pullEnvelopes validates on-disk envelopes without errors", () => {
	const dir = mkTarget("pull", { git: true });
	initTarget(dir);
	packOne(dir);

	const result = pullEnvelopes(dir);
	assert.equal(result.errors.length, 0);
	assert.ok(result.validated >= 1, `expected >= 1 validated envelope, got ${result.validated}`);
	assert.equal(result.refused, 0);
});

test("pullEnvelopes reports invalid envelopes as errors", () => {
	const dir = mkTarget("pull-bad", { git: true });
	initTarget(dir);
	const envDir = path.join(dir, ".amber", "sync", "envelopes");
	fs.mkdirSync(envDir, { recursive: true });
	fs.writeFileSync(path.join(envDir, "bad.json"), JSON.stringify({ artifactType: "bogus" }));

	const result = pullEnvelopes(dir);
	assert.ok(result.errors.length > 0);
	assert.ok(result.errors.some((e) => e.includes("bad.json") || e.includes("artifactType")));
});

test("pullEnvelopes records a foreign-tenant refusal in the conflict ledger", () => {
	const dir = mkTarget("pull-foreign", { git: true });
	initTarget(dir);
	const envelope = packOne(dir);
	// Shift the local tenant after packing: the envelope is now foreign
	fs.writeFileSync(
		path.join(dir, ".amber", "identity.json"),
		JSON.stringify({ tenantId: "another-tenant" }),
	);

	const result = pullEnvelopes(dir);

	assert.equal(result.validated, 0, "a refused envelope is never applied");
	assert.equal(result.refused, 1);
	assert.equal(result.conflicts.length, 1);
	assert.equal(result.conflicts[0].conflictType, "identity-mismatch");
	assert.equal(result.conflicts[0].resolution, "pending");
	assert.equal(result.conflicts[0].envelopeId, envelope.envelopeId);
	assert.deepEqual(result.errors, [], "a semantic refusal is a conflict, not an error");

	const ledger = fs.readFileSync(path.join(dir, ".amber", "sync", "conflicts.jsonl"), "utf8");
	assert.ok(ledger.includes(envelope.envelopeId), "conflict persisted in the ledger");
	assert.equal(
		fs.existsSync(path.join(dir, ".amber", "sync", "applied.jsonl")),
		false,
		"refused envelope must not be marked applied",
	);
});

test("pullEnvelopes records a foreign-generation refusal in the conflict ledger", () => {
	const dir = mkTarget("pull-generation", { git: true });
	initTarget(dir);
	const envelope = packOne(dir);
	fs.writeFileSync(
		path.join(dir, ".amber", "identity.json"),
		JSON.stringify({ repositoryGeneration: 7 }),
	);

	const result = pullEnvelopes(dir);

	assert.equal(result.refused, 1);
	assert.equal(result.conflicts[0].conflictType, "generation-mismatch");
	const ledger = fs.readFileSync(path.join(dir, ".amber", "sync", "conflicts.jsonl"), "utf8");
	assert.ok(ledger.includes(envelope.envelopeId), "conflict persisted in the ledger");
});

test("pullEnvelopes keeps invalid envelopes out of the conflict ledger", () => {
	const dir = mkTarget("pull-invalid", { git: true });
	initTarget(dir);
	const envDir = path.join(dir, ".amber", "sync", "envelopes");
	fs.mkdirSync(envDir, { recursive: true });
	fs.writeFileSync(path.join(envDir, "bad.json"), JSON.stringify({ artifactType: "bogus" }));

	const result = pullEnvelopes(dir);

	assert.ok(result.errors.length > 0, "invalid input fails explicitly");
	assert.equal(result.validated, 0);
	assert.equal(result.refused, 0, "invalid input is not a semantic conflict");
	assert.deepEqual(result.conflicts, []);
	assert.equal(
		fs.existsSync(path.join(dir, ".amber", "sync", "conflicts.jsonl")),
		false,
		"invalid envelopes must not touch the conflict ledger",
	);
	assert.equal(
		fs.existsSync(path.join(dir, ".amber", "sync", "applied.jsonl")),
		false,
		"invalid envelopes must not be marked applied",
	);
});

test("pullEnvelopes is idempotent: a refused envelope records one conflict across passes", () => {
	const dir = mkTarget("pull-idempotent", { git: true });
	initTarget(dir);
	packOne(dir);
	fs.writeFileSync(
		path.join(dir, ".amber", "identity.json"),
		JSON.stringify({ tenantId: "another-tenant" }),
	);

	pullEnvelopes(dir);
	const second = pullEnvelopes(dir);

	assert.equal(second.refused, 0, "second pass must not re-record the refusal");
	assert.equal(second.validated, 0);
	const lines = fs
		.readFileSync(path.join(dir, ".amber", "sync", "conflicts.jsonl"), "utf8")
		.split(/\r?\n/)
		.filter(Boolean);
	assert.equal(lines.length, 1, "conflict recorded exactly once");
});

// ── runSyncSession ────────────────────────────────────────────

test("runSyncSession prepares transport with zero git mutations", () => {
	const dir = mkTarget("session", { git: true });
	initTarget(dir);
	const envelope = packOne(dir);
	baselineCommit(dir, "session");
	const headBefore = gitOut(dir, ["rev-parse", "HEAD"]).stdout;

	const result = runSyncSession(dir);

	assert.ok(result.session, "session record present");
	assert.equal(result.session.operation, "sync");
	assert.equal(result.session.status, "completed");
	assert.deepEqual(result.errors, []);
	assert.ok(result.summary.pulled >= 1, "packed envelope applied during pull");
	assert.equal(result.summary.refused, 0);
	const prep = result.summary.preparation;
	assert.ok(prep, "run carries the transport preparation report");
	assert.equal(prep.mode, "prepare");
	assert.equal(prep.envelopeCount, 1);
	assert.deepEqual(prep.envelopeIds, [envelope.envelopeId]);
	assert.ok(prep.proposedOps.some((op) => op.verb === "add" && op.paths.includes(".amber/sync")));
	assert.ok(
		prep.affectedPaths.some((p) => p === `.amber/sync/envelopes/${envelope.envelopeId}.json`),
		"affected paths list the envelope files",
	);
	assert.ok(
		prep.affectedPaths.includes(".amber/sync/applied.jsonl"),
		"affected paths include the applied ledger written during pull",
	);

	assert.equal(gitOut(dir, ["rev-parse", "HEAD"]).stdout, headBefore, "HEAD must not move");
	assert.deepEqual(stagedPorcelainLines(dir), [], "nothing may be staged");
});

test("runSyncSession completes with recorded conflicts when an envelope is refused", () => {
	const dir = mkTarget("session-refused", { git: true });
	initTarget(dir);
	packOne(dir);
	fs.writeFileSync(
		path.join(dir, ".amber", "identity.json"),
		JSON.stringify({ tenantId: "another-tenant" }),
	);

	const result = runSyncSession(dir);

	assert.equal(
		result.session.status,
		"completed",
		"a semantic refusal is a recorded conflict, not a session failure",
	);
	assert.deepEqual(result.errors, []);
	assert.equal(result.summary.refused, 1);
	assert.equal(result.summary.conflicts.length, 1);
	assert.equal(result.summary.conflicts[0].conflictType, "identity-mismatch");
	assert.equal(
		result.summary.preparation.conflictCount,
		1,
		"the preparation report summarizes the recorded refusal",
	);
});
