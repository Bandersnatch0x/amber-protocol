"use strict";

// F049 ticket 01 — Intent admission tracer bullet (unit seam).
//
// Tests assert externally visible behavior of the canonical artifact store:
// deterministic serialization + hashes, atomic Body/Envelope admission with a
// receipt, durable prepared/committed settlement, committed-only visibility,
// stable error codes for orphaned/mismatched pairs, compare-and-swap
// supersession over an immutable monotonic history, and idempotent retries.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	admitArtifact,
	showArtifact,
	listArtifacts,
	envelopeHash,
	ARTIFACT_TYPES,
	ARTIFACT_STATUSES,
} = require("../../scripts/lib/core/canonical-artifacts");

const BODY_V1 = "# Intent: login bug\n\nOutcome: users can log in again.\n";

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-ca-unit-${label}-`));
}

function admitIntent(dir, overrides = {}) {
	return admitArtifact(dir, {
		type: "intent",
		identity: "intent/login-bug",
		body: BODY_V1,
		provenance: { author: "product-owner", source: "ticket#42" },
		...overrides,
	});
}

test("envelope hash is reproducible from the stored file (self-field excluded)", () => {
	const dir = mkTarget("env-hash");
	const result = admitIntent(dir);
	assert.equal(result.ok, true, result.errors.join("; "));
	const stored = JSON.parse(
		fs.readFileSync(
			path.join(dir, ".amber", "artifacts", "intents", "intent_login-bug", "rev-1.envelope.json"),
			"utf8",
		),
	);
	assert.equal(envelopeHash(stored), stored.envelopeHash);
});

test("admit with different content and no expected head fails closed as conflict (default CAS)", () => {
	const dir = mkTarget("fork-guard");
	admitIntent(dir);
	const fork = admitIntent(dir, { body: BODY_V1 + "\nNon-goal: none.\n" });
	assert.equal(fork.ok, false);
	assert.equal(fork.code, "AMBER_E_ARTIFACT_CONFLICT");
});

test("admit stores Body + Envelope atomically and returns a full receipt", () => {
	const dir = mkTarget("receipt");
	const result = admitIntent(dir);
	assert.equal(result.ok, true, result.errors.join("; "));
	const r = result.receipt;
	assert.equal(r.type, "intent");
	assert.equal(r.identity, "intent/login-bug");
	assert.equal(r.revision, 1);
	assert.match(r.contentHash, /^sha256:[0-9a-f]{64}$/);
	assert.ok(r.envelopeHash, "receipt carries the Envelope canonical hash");
	assert.deepEqual(r.provenance, { author: "product-owner", source: "ticket#42" });
	assert.ok(r.committedAt, "receipt carries commit time");

	// Atomic pair on disk: both sides present under the artifact home.
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_login-bug");
	assert.ok(fs.existsSync(path.join(home, "rev-1.md")), "Body stored");
	assert.ok(fs.existsSync(path.join(home, "rev-1.envelope.json")), "Envelope stored");
});

test("exact duplicate retry returns the original committed revision (idempotent)", () => {
	const dir = mkTarget("idempotent");
	const first = admitIntent(dir);
	const retry = admitIntent(dir);
	assert.equal(retry.ok, true);
	assert.equal(retry.receipt.revision, first.receipt.revision);
	assert.equal(retry.receipt.contentHash, first.receipt.contentHash);
	assert.equal(retry.duplicate, true, "retry is flagged as duplicate");
	// No second revision was created.
	assert.equal(showArtifact(dir, "intent/login-bug").revision, 1);
});

test("same identity with different content creates revision 2 via supersedes flow", () => {
	const dir = mkTarget("supersede");
	const v1 = admitIntent(dir);
	const v2 = admitIntent(dir, {
		body: BODY_V1 + "\nNon-goal: no SSO work.\n",
		supersedes: v1.receipt.revision,
	});
	assert.equal(v2.ok, true, v2.errors.join("; "));
	assert.equal(v2.receipt.revision, 2);
	assert.equal(v2.receipt.supersedes, 1);
	// Earlier revision remains immutable and readable.
	const shown = showArtifact(dir, "intent/login-bug", { revision: 1 });
	assert.equal(shown.revision, 1);
	assert.equal(shown.body, BODY_V1);
	assert.equal(showArtifact(dir, "intent/login-bug").revision, 2, "head moved to rev 2");
});

test("superseding a non-current revision fails closed as conflict", () => {
	const dir = mkTarget("stale-cas");
	const v1 = admitIntent(dir);
	admitIntent(dir, { body: BODY_V1 + "v2\n", supersedes: v1.receipt.revision });
	const stale = admitIntent(dir, {
		body: BODY_V1 + "v3\n",
		supersedes: 1, // expected head is stale; current is 2
	});
	assert.equal(stale.ok, false);
	assert.equal(stale.code, "AMBER_E_ARTIFACT_CONFLICT");
});

test("orphaned Body or Envelope input is rejected with a stable error code", () => {
	const dir = mkTarget("orphan");
	const missingEnvelope = admitArtifact(dir, {
		type: "intent",
		identity: "intent/x",
		body: null,
	});
	assert.equal(missingEnvelope.ok, false);
	assert.equal(missingEnvelope.code, "AMBER_E_ARTIFACT_ORPHANED_HALF");
});

test("missing identity is rejected with the stable invalid-identity code", () => {
	const dir = mkTarget("no-identity");
	const r = admitArtifact(dir, { type: "intent", identity: undefined, body: BODY_V1 });
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_INVALID_IDENTITY");
});

test("unknown artifact type is rejected with a stable error code", () => {
	const dir = mkTarget("bad-type");
	const r = admitArtifact(dir, {
		type: "spec",
		identity: "spec/x",
		body: BODY_V1,
	});
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_UNKNOWN_TYPE");
	assert.deepEqual(ARTIFACT_TYPES, ["intent"], "closed registry starts with intent only");
});

test("show/list surface only committed revisions", () => {
	const dir = mkTarget("visible");
	admitIntent(dir);
	const current = showArtifact(dir, "intent/login-bug");
	assert.equal(current.status, "committed");
	assert.equal(current.revision, 1);
	const entries = listArtifacts(dir);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].identity, "intent/login-bug");
	assert.equal(entries[0].revision, 1);
	assert.equal(entries[0].status, "committed");
});

test("prepared-but-unsettled journal record is not visible to reads", () => {
	const dir = mkTarget("prepared-only");
	// Hand-craft a journal that stops at prepared (crashed before commit).
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_ghost");
	fs.mkdirSync(home, { recursive: true });
	fs.writeFileSync(path.join(home, "rev-1.md"), "# ghost body\n");
	fs.writeFileSync(
		path.join(home, "rev-1.envelope.json"),
		JSON.stringify({
			type: "intent",
			identity: "intent/ghost",
			revision: 1,
			status: "prepared",
		}),
	);
	fs.writeFileSync(
		path.join(home, "journal.jsonl"),
		JSON.stringify({ kind: "prepared", revision: 1 }) + "\n",
	);
	assert.equal(showArtifact(dir, "intent/ghost"), null, "prepared-only is invisible");
	assert.deepEqual(listArtifacts(dir), [], "prepared-only never lists");
});

test("corrupt journal fails closed with the typed corruption code", () => {
	const dir = mkTarget("journal-corrupt");
	admitIntent(dir);
	const journalFile = path.join(
		dir,
		".amber",
		"artifacts",
		"intents",
		"intent_login-bug",
		"journal.jsonl",
	);
	fs.writeFileSync(journalFile, fs.readFileSync(journalFile, "utf8") + "{ not json\n");
	assert.throws(
		() => showArtifact(dir, "intent/login-bug"),
		/artifact ledger corrupt|AMBER_E_ARTIFACT_JOURNAL_CORRUPT/i,
	);
});

test("tampered committed Body is rejected on read with the stable hash-mismatch code", () => {
	const dir = mkTarget("tamper");
	admitIntent(dir);
	const bodyFile = path.join(dir, ".amber", "artifacts", "intents", "intent_login-bug", "rev-1.md");
	fs.writeFileSync(bodyFile, "# tampered content\n");
	assert.throws(() => showArtifact(dir, "intent/login-bug"), /AMBER_E_ARTIFACT_HASH_MISMATCH/);
});

test("tampered Envelope metadata is rejected on read with the stable envelope-mismatch code", () => {
	const dir = mkTarget("envelope-tamper");
	admitIntent(dir);
	const envFile = path.join(
		dir,
		".amber",
		"artifacts",
		"intents",
		"intent_login-bug",
		"rev-1.envelope.json",
	);
	// Rewrite provenance without recomputing envelopeHash: the stored Envelope
	// no longer matches its own canonical hash.
	const stored = JSON.parse(fs.readFileSync(envFile, "utf8"));
	stored.provenance = { source: "TAMPERED" };
	stored.supersedes = 99;
	fs.writeFileSync(envFile, JSON.stringify(stored, null, 2) + "\n", "utf8");
	assert.throws(
		() => showArtifact(dir, "intent/login-bug"),
		/AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH/,
	);
	assert.throws(() => listArtifacts(dir), /AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH/);
});

test("garbage envelopeHash on a stored Envelope is rejected on read", () => {
	const dir = mkTarget("env-hash-garbage");
	admitIntent(dir);
	const envFile = path.join(
		dir,
		".amber",
		"artifacts",
		"intents",
		"intent_login-bug",
		"rev-1.envelope.json",
	);
	const stored = JSON.parse(fs.readFileSync(envFile, "utf8"));
	stored.envelopeHash = "deadbeef";
	fs.writeFileSync(envFile, JSON.stringify(stored, null, 2) + "\n", "utf8");
	assert.throws(
		() => showArtifact(dir, "intent/login-bug"),
		/AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH/,
	);
});

test("pure-dot identities are rejected and the store root stays clean", () => {
	for (const identity of [".", ".."]) {
		const dir = mkTarget(`dot-identity-${identity === "." ? "self" : "parent"}`);
		const r = admitArtifact(dir, { type: "intent", identity, body: BODY_V1 });
		assert.equal(r.ok, false, `identity "${identity}" must be rejected`);
		assert.equal(r.code, "AMBER_E_ARTIFACT_INVALID_IDENTITY");
		// No artifact home was created anywhere under the store.
		assert.ok(!fs.existsSync(path.join(dir, ".amber", "artifacts")), "store root stays clean");
	}
});

test("aborted revisions are not visible but stay in the durable journal", () => {
	const dir = mkTarget("aborted");
	const ok = admitIntent(dir);
	// Simulate an aborted attempt at revision 2.
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_login-bug");
	fs.writeFileSync(
		path.join(home, "journal.jsonl"),
		fs.readFileSync(path.join(home, "journal.jsonl"), "utf8") +
			JSON.stringify({ kind: "prepared", revision: 2 }) +
			"\n" +
			JSON.stringify({ kind: "aborted", revision: 2 }) +
			"\n",
	);
	const shown = showArtifact(dir, "intent/login-bug");
	assert.equal(shown.revision, 1, "aborted rev 2 invisible");
	const journal = fs
		.readFileSync(path.join(home, "journal.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l));
	assert.ok(journal.some((r) => r.kind === "aborted" && r.revision === 2));
	assert.equal(ok.ok, true);

	// After abort, revision slot 2 is consumed: the next admission takes 3
	// and supersedes the still-current head 1.
	const v3 = admitIntent(dir, { body: BODY_V1 + "v2\n", supersedes: 1 });
	assert.equal(v3.ok, true, v3.errors.join("; "));
	assert.equal(v3.receipt.revision, 3, "aborted slot is never reused");
});

test("no mutation path exists: module exposes no status/content setter", () => {
	const exported = require("../../scripts/lib/core/canonical-artifacts");
	for (const name of Object.keys(exported)) {
		assert.doesNotMatch(name, /set|update|mutate|rewrite|edit/i, `${name} must not mutate`);
	}
	assert.deepEqual(ARTIFACT_STATUSES, ["prepared", "committed", "aborted"]);
});
test("status names are exactly prepared/committed/aborted in journal records", () => {
	const dir = mkTarget("journal-names");
	admitIntent(dir);
	const journalPath = path.join(
		dir,
		".amber",
		"artifacts",
		"intents",
		"intent_login-bug",
		"journal.jsonl",
	);
	const records = fs
		.readFileSync(journalPath, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.deepEqual(
		records.map((r) => [r.kind, r.revision]),
		[
			["prepared", 1],
			["committed", 1],
		],
	);
});
