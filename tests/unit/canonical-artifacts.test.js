"use strict";

// F049 tickets 01–02 — Intent admission tracer bullet + compare-and-swap and
// idempotent admission (unit seam).
//
// Tests assert externally visible behavior of the canonical artifact store:
// deterministic serialization + hashes, atomic Body/Envelope admission with a
// receipt, durable prepared/committed settlement, committed-only visibility,
// stable error codes for orphaned/mismatched pairs, compare-and-swap
// supersession over an immutable monotonic history, and idempotent retries
// bound to the full canonical envelope content (same Body + different
// provenance is a conflict, never a silent duplicate).

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

function homeOf(dir, identity = "intent/login-bug") {
	const slug = `${identity}`.replace(/[^a-zA-Z0-9._-]+/g, "_");
	return path.join(dir, ".amber", "artifacts", "intents", slug);
}

function journalOf(dir, identity = "intent/login-bug") {
	return fs
		.readFileSync(path.join(homeOf(dir, identity), "journal.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
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

// ---------------------------------------------------------------------------
// F049 ticket 02 — compare-and-swap and idempotent admission (#219).
// Integrity fixtures exercise the PUBLIC admission seam (admitArtifact) only;
// journal files are read as durable state, never private helpers.
// ---------------------------------------------------------------------------

test("same Body with different provenance fails closed as idempotency conflict (F3 fix)", () => {
	const dir = mkTarget("f3-provenance");
	const first = admitIntent(dir);
	assert.equal(first.ok, true, first.errors.join("; "));

	// Same Body, different envelope content: NOT a duplicate — the old
	// bodyHash-only dedupe silently discarded the new provenance.
	const clash = admitIntent(dir, {
		provenance: { author: "other-owner", source: "ticket#99" },
	});
	assert.equal(clash.ok, false);
	assert.equal(clash.code, "AMBER_E_ARTIFACT_IDEMPOTENCY_CONFLICT");

	// The verbatim retry still returns the ORIGINAL receipt, provenance intact.
	const retry = admitIntent(dir);
	assert.equal(retry.ok, true, retry.errors.join("; "));
	assert.equal(retry.duplicate, true);
	assert.deepEqual(retry.receipt, first.receipt);

	// Exactly one committed revision was ever created.
	assert.equal(journalOf(dir).filter((r) => r.kind === "committed").length, 1);
	assert.equal(showArtifact(dir, "intent/login-bug").revision, 1);
});

test("declared expected head admits the same Body with new provenance as a new revision", () => {
	const dir = mkTarget("declared-supersede");
	admitIntent(dir);
	const v2 = admitIntent(dir, {
		provenance: { author: "other-owner", source: "ticket#99" },
		supersedes: 1,
	});
	assert.equal(v2.ok, true, v2.errors.join("; "));
	assert.equal(v2.receipt.revision, 2);
	assert.deepEqual(v2.receipt.provenance, { author: "other-owner", source: "ticket#99" });

	// Retrying that declared admission verbatim duplicates it, never forks.
	const retry = admitIntent(dir, {
		provenance: { author: "other-owner", source: "ticket#99" },
		supersedes: 1,
	});
	assert.equal(retry.ok, true);
	assert.equal(retry.duplicate, true);
	assert.equal(retry.receipt.revision, 2);
	assert.equal(journalOf(dir).filter((r) => r.kind === "committed").length, 2);
});

test("retry of a superseded revision returns that revision's original receipt (no duplicate revisions)", () => {
	const dir = mkTarget("retry-superseded");
	const v1 = admitIntent(dir);
	const v2 = admitIntent(dir, { body: BODY_V1 + "\nNon-goal: no SSO.\n", supersedes: 1 });
	assert.equal(v2.ok, true, v2.errors.join("; "));

	// A late retry of the v1 admission (e.g. after a timeout) must return
	// v1's original receipt, not create a third revision.
	const lateRetry = admitIntent(dir);
	assert.equal(lateRetry.ok, true, lateRetry.errors.join("; "));
	assert.equal(lateRetry.duplicate, true);
	assert.deepEqual(lateRetry.receipt, v1.receipt);

	assert.equal(showArtifact(dir, "intent/login-bug").revision, 2, "head stays at 2");
	assert.equal(journalOf(dir).filter((r) => r.kind === "committed").length, 2);
});

test("two admissions with the same expected head commit exactly one revision; loser conflicts", () => {
	const dir = mkTarget("cas-race");
	const v1 = admitIntent(dir);
	assert.equal(v1.ok, true, v1.errors.join("; "));

	// Both racing editors declare the same expected head (1) with different
	// content: the serialization point settles exactly one winner.
	const winner = admitIntent(dir, { body: BODY_V1 + "\nleft editor\n", supersedes: 1 });
	const loser = admitIntent(dir, { body: BODY_V1 + "\nright editor\n", supersedes: 1 });
	assert.equal(winner.ok, true, winner.errors.join("; "));
	assert.equal(loser.ok, false);
	assert.equal(loser.code, "AMBER_E_ARTIFACT_CONFLICT");
	assert.match(loser.errors[0], /stale|revision 2/);

	// Exactly one new revision: v1 plus the winner's v2.
	const commits = journalOf(dir).filter((r) => r.kind === "committed");
	assert.equal(commits.length, 2);
	assert.equal(showArtifact(dir, "intent/login-bug").revision, 2);
	const entries = listArtifacts(dir);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].revision, 2);
});

test("two first admissions racing on the empty head: the second fails closed", () => {
	const dir = mkTarget("first-race");
	const winner = admitArtifact(dir, {
		type: "intent",
		identity: "intent/first",
		body: "# left\n",
		provenance: null,
	});
	const loser = admitArtifact(dir, {
		type: "intent",
		identity: "intent/first",
		body: "# right\n",
		provenance: null,
	});
	assert.equal(winner.ok, true, winner.errors.join("; "));
	assert.equal(loser.ok, false);
	assert.equal(loser.code, "AMBER_E_ARTIFACT_CONFLICT");
	assert.equal(showArtifact(dir, "intent/first").revision, 1);
	assert.equal(journalOf(dir, "intent/first").filter((r) => r.kind === "committed").length, 1);
});

test("expectedHead declares the same CAS precondition as supersedes", () => {
	const dir = mkTarget("expected-head-param");
	admitIntent(dir);
	const viaExpectedHead = admitIntent(dir, { body: BODY_V1 + "v2\n", expectedHead: 1 });
	assert.equal(viaExpectedHead.ok, true, viaExpectedHead.errors.join("; "));
	assert.equal(viaExpectedHead.receipt.revision, 2);
	assert.equal(viaExpectedHead.receipt.supersedes, 1);

	// Stale expectedHead loses the CAS just like a stale supersedes.
	const stale = admitIntent(dir, { body: BODY_V1 + "v3\n", expectedHead: 1 });
	assert.equal(stale.ok, false);
	assert.equal(stale.code, "AMBER_E_ARTIFACT_CONFLICT");

	// Contradictory declarations never reach the store.
	const contradiction = admitIntent(dir, {
		body: BODY_V1 + "v4\n",
		expectedHead: 1,
		supersedes: 2,
	});
	assert.equal(contradiction.ok, false);
	assert.equal(contradiction.code, "AMBER_E_ARTIFACT_CONFLICT");
	assert.equal(showArtifact(dir, "intent/login-bug").revision, 2);
});

test("garbage expected-head values are rejected with the stable arg code (never NaN)", () => {
	const dir = mkTarget("bad-args");
	for (const bad of [NaN, 0, 1.5, "1", -1]) {
		const r = admitIntent(dir, { supersedes: bad, body: BODY_V1 + "x\n" });
		assert.equal(r.ok, false, `supersedes ${bad} must be rejected`);
		assert.equal(r.code, "AMBER_E_INVALID_ARG");
	}
	// Nothing was admitted by any garbage attempt.
	assert.ok(!fs.existsSync(path.join(dir, ".amber", "artifacts")));
});

test("idempotency key replays identical content and refuses different content", () => {
	const dir = mkTarget("idem-key");
	const first = admitIntent(dir, { idempotencyKey: "retry-42" });
	assert.equal(first.ok, true, first.errors.join("; "));

	// Same key, identical canonical content: original receipt, no new revision.
	const retry = admitIntent(dir, { idempotencyKey: "retry-42" });
	assert.equal(retry.ok, true, retry.errors.join("; "));
	assert.equal(retry.duplicate, true);
	assert.deepEqual(retry.receipt, first.receipt);

	// Same key, different content: fails closed as conflict.
	const clash = admitIntent(dir, {
		idempotencyKey: "retry-42",
		body: BODY_V1 + "\nNon-goal: none.\n",
	});
	assert.equal(clash.ok, false);
	assert.equal(clash.code, "AMBER_E_ARTIFACT_IDEMPOTENCY_CONFLICT");

	// Same key, same Body but different provenance: also different content.
	const clashProvenance = admitIntent(dir, {
		idempotencyKey: "retry-42",
		provenance: { author: "other-owner", source: "ticket#99" },
	});
	assert.equal(clashProvenance.ok, false);
	assert.equal(clashProvenance.code, "AMBER_E_ARTIFACT_IDEMPOTENCY_CONFLICT");

	// A fresh key admits new content normally (keys never gate admission).
	const v2 = admitIntent(dir, {
		idempotencyKey: "retry-43",
		body: BODY_V1 + "\nNon-goal: none.\n",
		supersedes: 1,
	});
	assert.equal(v2.ok, true, v2.errors.join("; "));
	assert.equal(v2.receipt.revision, 2);

	assert.equal(journalOf(dir).filter((r) => r.kind === "committed").length, 2);
	assert.equal(showArtifact(dir, "intent/login-bug").revision, 2);
});

test("a key recorded on a prepared-but-uncommitted attempt does not block later admissions", () => {
	const dir = mkTarget("key-dangling");
	admitIntent(dir);
	// Simulate a crashed keyed admission: prepared with a key, never committed.
	const home = homeOf(dir);
	fs.writeFileSync(
		path.join(home, "journal.jsonl"),
		fs.readFileSync(path.join(home, "journal.jsonl"), "utf8") +
			JSON.stringify({ kind: "prepared", revision: 2, idempotencyKey: "crashed" }) +
			"\n",
	);
	const after = admitIntent(dir, {
		body: BODY_V1 + "v2\n",
		supersedes: 1,
		idempotencyKey: "fresh",
	});
	assert.equal(after.ok, true, after.errors.join("; "));
	assert.equal(after.receipt.revision, 3, "dangling prepared slot 2 is consumed, not reused");
});

test("dangling prepared record consumes its slot; crashed files are never overwritten", () => {
	const dir = mkTarget("dangling-prepared");
	// Simulate a crashed first admission: prepared claimed slot 1 and wrote
	// half the pair, but never committed.
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_ghost");
	fs.mkdirSync(home, { recursive: true });
	fs.writeFileSync(path.join(home, "rev-1.md"), "# crashed body\n");
	fs.writeFileSync(
		path.join(home, "journal.jsonl"),
		JSON.stringify({ kind: "prepared", revision: 1, expectedHead: 0 }) + "\n",
	);

	const next = admitArtifact(dir, {
		type: "intent",
		identity: "intent/ghost",
		body: "# live body\n",
		provenance: null,
	});
	assert.equal(next.ok, true, next.errors.join("; "));
	assert.equal(next.receipt.revision, 2, "slot 1 was claimed; the live admission takes 2");

	// The crashed half-written files survive untouched and stay invisible.
	assert.equal(fs.readFileSync(path.join(home, "rev-1.md"), "utf8"), "# crashed body\n");
	assert.equal(showArtifact(dir, "intent/ghost", { revision: 1 }), null);
	const shown = showArtifact(dir, "intent/ghost");
	assert.equal(shown.revision, 2);
	assert.equal(shown.body, "# live body\n");
});

test("committed record without a matching prepared record fails admission as corruption", () => {
	const dir = mkTarget("settle-no-prepare");
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_tampered");
	fs.mkdirSync(home, { recursive: true });
	fs.writeFileSync(
		path.join(home, "journal.jsonl"),
		JSON.stringify({ kind: "committed", revision: 1, at: "2026-01-01T00:00:00.000Z" }) + "\n",
	);
	const r = admitArtifact(dir, {
		type: "intent",
		identity: "intent/tampered",
		body: "# anything\n",
		provenance: null,
	});
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
});

test("revision committed twice fails admission as corruption", () => {
	const dir = mkTarget("settle-double-commit");
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_tampered");
	fs.mkdirSync(home, { recursive: true });
	fs.writeFileSync(
		path.join(home, "journal.jsonl"),
		[
			JSON.stringify({ kind: "prepared", revision: 1, expectedHead: 0 }),
			JSON.stringify({ kind: "committed", revision: 1, expectedHead: 0 }),
			JSON.stringify({ kind: "committed", revision: 1, expectedHead: 0 }),
		].join("\n") + "\n",
	);
	const r = admitArtifact(dir, {
		type: "intent",
		identity: "intent/tampered",
		body: "# anything\n",
		provenance: null,
	});
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
});

test("commit whose admissionHash was never prepared fails admission as corruption", () => {
	const dir = mkTarget("settle-hash-swap");
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_tampered");
	fs.mkdirSync(home, { recursive: true });
	fs.writeFileSync(
		path.join(home, "journal.jsonl"),
		[
			JSON.stringify({ kind: "prepared", revision: 1, expectedHead: 0, admissionHash: "aaa" }),
			JSON.stringify({ kind: "committed", revision: 1, expectedHead: 0, admissionHash: "bbb" }),
		].join("\n") + "\n",
	);
	const r = admitArtifact(dir, {
		type: "intent",
		identity: "intent/tampered",
		body: "# anything\n",
		provenance: null,
	});
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
});

test("forked settlement (second commit against a stale expected head) fails admission as corruption", () => {
	const dir = mkTarget("settle-fork");
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_tampered");
	fs.mkdirSync(home, { recursive: true });
	const lines = [
		{ kind: "prepared", revision: 1, expectedHead: 0, admissionHash: "h1" },
		{ kind: "committed", revision: 1, expectedHead: 0, admissionHash: "h1" },
		{ kind: "prepared", revision: 2, expectedHead: 1, admissionHash: "h2" },
		{ kind: "committed", revision: 2, expectedHead: 1, admissionHash: "h2" },
		// A third revision "committing" against head 1 while head is 2.
		{ kind: "prepared", revision: 3, expectedHead: 1, admissionHash: "h3" },
		{ kind: "committed", revision: 3, expectedHead: 1, admissionHash: "h3" },
	];
	fs.writeFileSync(
		path.join(home, "journal.jsonl"),
		lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
	);
	const r = admitArtifact(dir, {
		type: "intent",
		identity: "intent/tampered",
		body: "# anything\n",
		provenance: null,
	});
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
	assert.match(r.errors[0], /expected head 1|forked|replayed head is 2/);
});

test("skipped revision slot fails admission as corruption", () => {
	const dir = mkTarget("settle-skip");
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_tampered");
	fs.mkdirSync(home, { recursive: true });
	fs.writeFileSync(
		path.join(home, "journal.jsonl"),
		[
			JSON.stringify({ kind: "prepared", revision: 1, expectedHead: 0 }),
			JSON.stringify({ kind: "committed", revision: 1, expectedHead: 0 }),
			JSON.stringify({ kind: "prepared", revision: 3, expectedHead: 1 }),
			JSON.stringify({ kind: "committed", revision: 3, expectedHead: 1 }),
		].join("\n") + "\n",
	);
	const r = admitArtifact(dir, {
		type: "intent",
		identity: "intent/tampered",
		body: "# anything\n",
		provenance: null,
	});
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
});

test("admission on top of an orphaned committed head fails closed as corruption", () => {
	const dir = mkTarget("orphan-head");
	admitIntent(dir);
	// Remove the committed head's Envelope: the settlement is inconsistent.
	fs.rmSync(path.join(homeOf(dir), "rev-1.envelope.json"));
	const r = admitIntent(dir, { body: BODY_V1 + "v2\n", supersedes: 1 });
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
});

test("admission on top of a tampered committed head fails closed with the binding code", () => {
	const dir = mkTarget("tampered-head");
	admitIntent(dir);
	fs.writeFileSync(path.join(homeOf(dir), "rev-1.md"), "# tampered body\n");
	const r = admitIntent(dir, { body: BODY_V1 + "v2\n", supersedes: 1 });
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_HASH_MISMATCH");
});

test("duplicate retry against a tampered revision fails closed instead of returning a receipt", () => {
	const dir = mkTarget("dup-tampered");
	admitIntent(dir);
	fs.writeFileSync(path.join(homeOf(dir), "rev-1.md"), "# tampered body\n");
	const retry = admitIntent(dir);
	assert.equal(retry.ok, false);
	assert.equal(retry.code, "AMBER_E_ARTIFACT_HASH_MISMATCH");
});

test("winner retry after a lost race never duplicates the committed revision", () => {
	const dir = mkTarget("post-race-retry");
	const v1 = admitIntent(dir);
	const winner = admitIntent(dir, { body: BODY_V1 + "\nleft editor\n", supersedes: 1 });
	const loser = admitIntent(dir, { body: BODY_V1 + "\nright editor\n", supersedes: 1 });
	assert.equal(winner.ok && loser.ok === false, true);

	// The winner's own retry is idempotent; the loser must supersede head 2.
	const winnerRetry = admitIntent(dir, { body: BODY_V1 + "\nleft editor\n", supersedes: 1 });
	assert.equal(winnerRetry.ok, true);
	assert.equal(winnerRetry.duplicate, true);
	assert.equal(winnerRetry.receipt.revision, 2);

	const loserRecovers = admitIntent(dir, { body: BODY_V1 + "\nright editor\n", supersedes: 2 });
	assert.equal(loserRecovers.ok, true, loserRecovers.errors.join("; "));
	assert.equal(loserRecovers.receipt.revision, 3);
	assert.equal(loserRecovers.receipt.supersedes, 2);

	assert.equal(journalOf(dir).filter((r) => r.kind === "committed").length, 3);
	assert.equal(showArtifact(dir, "intent/login-bug").revision, 3);
	assert.equal(v1.receipt.revision, 1);
});
