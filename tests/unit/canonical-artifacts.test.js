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
	bodyHash,
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
		type: "epic",
		identity: "epic/x",
		body: BODY_V1,
	});
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_UNKNOWN_TYPE");
	assert.deepEqual(
		ARTIFACT_TYPES,
		["intent", "spec", "plan"],
		"closed registry covers the three registered planning types",
	);
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

// ---------------------------------------------------------------------------
// F049 ticket 03 (#220) — Spec/Plan types, lifecycle transitions, typed Trace
// lineage, and the routed ticket-02 review fixes F3/F6/F7/F8/F9. All
// assertions go through the public admission seam (admitArtifact / show /
// list); journals and pairs are read as durable state only.
// ---------------------------------------------------------------------------

test("admission without a transition carries the type's initial lifecycle state", () => {
	const dir = mkTarget("lifecycle-initial");
	const r = admitIntent(dir);
	assert.equal(r.ok, true, r.errors.join("; "));
	assert.equal(r.receipt.lifecycle, "draft");
	assert.equal(r.receipt.transition, null);
	assert.equal(r.receipt.scope, null);
	assert.deepEqual(r.receipt.traces, []);
	const shown = showArtifact(dir, "intent/login-bug");
	assert.equal(shown.lifecycle, "draft");
	assert.equal(shown.envelope.lifecycle, "draft");
});

test("a named transition admits a NEW revision with the target state; the old revision is untouched", () => {
	const dir = mkTarget("lifecycle-accept");
	admitIntent(dir);
	const accepted = admitIntent(dir, { expectedHead: 1, transition: "accept" });
	assert.equal(accepted.ok, true, accepted.errors.join("; "));
	assert.equal(accepted.receipt.revision, 2);
	assert.equal(accepted.receipt.lifecycle, "accepted");
	assert.equal(accepted.receipt.transition, "accept");
	assert.equal(accepted.receipt.supersedes, 1);

	// Immutable history: revision 1 keeps its draft state; only the new
	// revision carries the accepted state — no in-place status mutation.
	const rev1 = showArtifact(dir, "intent/login-bug", { revision: 1 });
	assert.equal(rev1.lifecycle, "draft");
	assert.equal(rev1.transition, null);
	const head = showArtifact(dir, "intent/login-bug");
	assert.equal(head.revision, 2);
	assert.equal(head.lifecycle, "accepted");
	assert.equal(journalOf(dir).filter((r) => r.kind === "committed").length, 2);
});

test("retry of a transition admission is idempotent against the settled revision", () => {
	const dir = mkTarget("lifecycle-retry");
	admitIntent(dir);
	const first = admitIntent(dir, { expectedHead: 1, transition: "accept" });
	const retry = admitIntent(dir, { expectedHead: 1, transition: "accept" });
	assert.equal(retry.ok, true, retry.errors.join("; "));
	assert.equal(retry.duplicate, true);
	assert.equal(retry.receipt.revision, first.receipt.revision);
	assert.equal(retry.receipt.lifecycle, "accepted");
	assert.equal(journalOf(dir).filter((r) => r.kind === "committed").length, 2);
});

test("unregistered transitions fail closed with the stable unknown-transition code", () => {
	const dir = mkTarget("transition-unknown");
	admitIntent(dir);
	for (const bogus of ["ship", "approve"]) {
		const r = admitIntent(dir, { expectedHead: 1, transition: bogus });
		assert.equal(r.ok, false);
		assert.equal(
			r.code,
			"AMBER_E_ARTIFACT_TRANSITION_UNKNOWN",
			`${bogus} is not an intent transition`,
		);
		assert.match(r.errors[0], new RegExp(`transition "${bogus}" is not registered for intent`));
	}
});

test("a transition that does not apply fails closed with the stable invalid-transition code", () => {
	const dir = mkTarget("transition-invalid");
	admitIntent(dir);
	admitIntent(dir, { expectedHead: 1, transition: "accept" });
	const again = admitIntent(dir, { expectedHead: 2, transition: "accept" });
	assert.equal(again.ok, false);
	assert.equal(again.code, "AMBER_E_ARTIFACT_TRANSITION_INVALID");
	assert.match(again.errors[0], /applies from lifecycle state "draft"/);
	assert.match(again.errors[0], /is in lifecycle state "accepted"/);
	// Nothing was admitted on top of the accepted head.
	assert.equal(showArtifact(dir, "intent/login-bug").revision, 2);
});

test("full planning lineage: accepted Intent <- Spec <- approved Spec <- Plan", () => {
	const dir = mkTarget("lineage-full");
	admitIntent(dir);
	const accepted = admitIntent(dir, { expectedHead: 1, transition: "accept" });
	assert.equal(accepted.ok, true, accepted.errors.join("; "));

	// The Spec refines the accepted Intent revision (lineage is re-declared
	// per admission: every revision's Envelope is self-contained).
	const refines = [{ type: "refines", to: { type: "intent", identity: "intent/login-bug" } }];
	const spec = admitArtifact(dir, {
		type: "spec",
		identity: "spec/login-spec",
		body: "# Spec: login\n\nBehavior: SSO login works.\n",
		traces: refines,
	});
	assert.equal(spec.ok, true, spec.errors.join("; "));
	assert.equal(spec.receipt.lifecycle, "draft");
	assert.deepEqual(spec.receipt.traces, [
		{ type: "refines", to: { type: "intent", identity: "intent/login-bug", revision: 2 } },
	]);

	const approved = admitArtifact(dir, {
		type: "spec",
		identity: "spec/login-spec",
		body: "# Spec: login\n\nBehavior: SSO login works.\n",
		expectedHead: 1,
		transition: "approve",
		traces: refines,
	});
	assert.equal(approved.ok, true, approved.errors.join("; "));
	assert.equal(approved.receipt.lifecycle, "approved");

	const plan = admitArtifact(dir, {
		type: "plan",
		identity: "plan/login-plan",
		body: "# Plan: login\n\nSlices: session, form, verification.\n",
		traces: [{ type: "realizes", to: { type: "spec", identity: "spec/login-spec" } }],
	});
	assert.equal(plan.ok, true, plan.errors.join("; "));
	assert.equal(plan.receipt.lifecycle, "draft");
	assert.deepEqual(plan.receipt.traces, [
		{ type: "realizes", to: { type: "spec", identity: "spec/login-spec", revision: 2 } },
	]);

	// The stored Envelopes carry the resolved traces and the contract version.
	const specShown = showArtifact(dir, "spec/login-spec", { type: "spec" });
	assert.deepEqual(specShown.traces, [
		{ type: "refines", to: { type: "intent", identity: "intent/login-bug", revision: 2 } },
	]);
	assert.equal(specShown.envelope.traceContractVersion, 1);
	const planShown = showArtifact(dir, "plan/login-plan", { type: "plan" });
	assert.equal(planShown.envelope.traceContractVersion, 1);

	// The type registry partitions storage by type directory.
	assert.ok(fs.existsSync(path.join(dir, ".amber", "artifacts", "specs", "spec_login-spec")));
	assert.ok(fs.existsSync(path.join(dir, ".amber", "artifacts", "plans", "plan_login-plan")));

	// list sees all three types at their current revisions and states.
	const entries = listArtifacts(dir);
	assert.deepEqual(
		entries.map((e) => `${e.type}/${e.identity}:${e.revision}:${e.lifecycle}`).sort(),
		[
			"intent/intent/login-bug:2:accepted",
			"plan/plan/login-plan:1:draft",
			"spec/spec/login-spec:2:approved",
		],
	);
});

test("omitted-Spec policy: a Plan cannot realize an Intent directly", () => {
	const dir = mkTarget("omitted-spec");
	admitIntent(dir);
	admitIntent(dir, { expectedHead: 1, transition: "accept" });
	const r = admitArtifact(dir, {
		type: "plan",
		identity: "plan/short-circuit",
		body: "# Plan\n",
		traces: [{ type: "realizes", to: { type: "intent", identity: "intent/login-bug" } }],
	});
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_TRACE_DIRECTION");
	assert.match(r.errors[0], /omitted-Spec policy/);
	assert.match(r.errors[0], /realize that Spec/);
	// Nothing was written for the rejected Plan.
	assert.equal(fs.existsSync(path.join(dir, ".amber", "artifacts", "plans")), false);
});

test("omitted-Spec policy also fires when the target identity resolves under the wrong type", () => {
	const dir = mkTarget("omitted-spec-derived");
	admitArtifact(dir, {
		type: "intent",
		identity: "shared-id",
		body: BODY_V1,
		transition: "accept",
	});
	const r = admitArtifact(dir, {
		type: "plan",
		identity: "plan/short-circuit",
		body: "# Plan\n",
		traces: [{ type: "realizes", to: { identity: "shared-id" } }],
	});
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_TRACE_DIRECTION");
	assert.match(r.errors[0], /"shared-id" resolves to a intent artifact/);
	assert.match(r.errors[0], /omitted-Spec policy/);
});

test("required lineage: a Spec without a refines trace fails the cardinality contract", () => {
	const dir = mkTarget("lineage-missing");
	admitArtifact(dir, {
		type: "intent",
		identity: "intent/login-bug",
		body: BODY_V1,
		transition: "accept",
	});
	const r = admitArtifact(dir, {
		type: "spec",
		identity: "spec/orphan",
		body: "# Spec\n",
	});
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_TRACE_CARDINALITY");
	assert.match(r.errors[0], /exactly one accepted Intent revision/);
	assert.match(r.errors[0], /carries 0 "refines" Traces/);
});

test("a generic relation cannot satisfy required planning lineage", () => {
	const dir = mkTarget("generic-relation");
	admitArtifact(dir, {
		type: "intent",
		identity: "intent/login-bug",
		body: BODY_V1,
		transition: "accept",
	});
	// An unregistered relation is rejected outright.
	const unregistered = admitArtifact(dir, {
		type: "spec",
		identity: "spec/generic",
		body: "# Spec\n",
		traces: [{ type: "relates-to", to: { type: "intent", identity: "intent/login-bug" } }],
	});
	assert.equal(unregistered.ok, false);
	assert.equal(unregistered.code, "AMBER_E_ARTIFACT_TRACE_UNKNOWN");
	assert.match(unregistered.errors[0], /generic or unregistered relation cannot satisfy/);

	// A registered but non-lineage relation (supersedes) still leaves the
	// required refines trace unmet: cardinality fires before resolution.
	const supersedesOnly = admitArtifact(dir, {
		type: "spec",
		identity: "spec/generic",
		body: "# Spec\n",
		traces: [{ type: "supersedes", to: { identity: "spec/another" } }],
	});
	assert.equal(supersedesOnly.ok, false);
	assert.equal(supersedesOnly.code, "AMBER_E_ARTIFACT_TRACE_CARDINALITY");
	assert.match(supersedesOnly.errors[0], /exactly one accepted Intent revision/);
});

test("required lineage: the target Intent revision must be accepted", () => {
	const dir = mkTarget("lineage-gate");
	admitArtifact(dir, { type: "intent", identity: "intent/login-bug", body: BODY_V1 });
	const r = admitArtifact(dir, {
		type: "spec",
		identity: "spec/early",
		body: "# Spec\n",
		traces: [{ type: "refines", to: { type: "intent", identity: "intent/login-bug" } }],
	});
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_TRACE_TARGET_LIFECYCLE");
	assert.match(r.errors[0], /lifecycle state "draft"/);
	assert.match(r.errors[0], /requires "accepted"/);
	assert.match(r.errors[0], /"accept" transition first/);

	// After the Intent is accepted, the same trace admits.
	admitArtifact(dir, {
		type: "intent",
		identity: "intent/login-bug",
		body: BODY_V1,
		expectedHead: 1,
		transition: "accept",
	});
	const ok = admitArtifact(dir, {
		type: "spec",
		identity: "spec/early",
		body: "# Spec\n",
		traces: [{ type: "refines", to: { type: "intent", identity: "intent/login-bug" } }],
	});
	assert.equal(ok.ok, true, ok.errors.join("; "));
});

test("required lineage: a Plan's Spec target must be approved", () => {
	const dir = mkTarget("lineage-plan-gate");
	// A Spec exists only through its own lineage: refine an accepted Intent,
	// then stay in draft so the Plan's realizes gate has something to hit.
	admitArtifact(dir, {
		type: "intent",
		identity: "intent/login-bug",
		body: BODY_V1,
		transition: "accept",
	});
	const spec = admitArtifact(dir, {
		type: "spec",
		identity: "spec/login-spec",
		body: "# Spec\n",
		traces: [{ type: "refines", to: { type: "intent", identity: "intent/login-bug" } }],
	});
	assert.equal(spec.ok, true, spec.errors.join("; "));
	assert.equal(spec.receipt.lifecycle, "draft");
	const r = admitArtifact(dir, {
		type: "plan",
		identity: "plan/early",
		body: "# Plan\n",
		traces: [{ type: "realizes", to: { type: "spec", identity: "spec/login-spec" } }],
	});
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_TRACE_TARGET_LIFECYCLE");
	assert.match(r.errors[0], /requires "approved"/);
});

test("trace targets must exist as committed revisions", () => {
	const dir = mkTarget("lineage-not-found");
	const r = admitArtifact(dir, {
		type: "spec",
		identity: "spec/ghost",
		body: "# Spec\n",
		traces: [{ type: "refines", to: { type: "intent", identity: "intent/ghost" } }],
	});
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_TRACE_TARGET_NOT_FOUND");
	assert.match(r.errors[0], /matches no committed intent artifact revision/);

	// A named revision that is not committed (prepared and aborted revisions
	// stay invisible) is equally absent.
	admitArtifact(dir, { type: "intent", identity: "intent/real", body: BODY_V1 });
	const pinned = admitArtifact(dir, {
		type: "spec",
		identity: "spec/pinned",
		body: "# Spec\n",
		traces: [{ type: "refines", to: { type: "intent", identity: "intent/real", revision: 7 } }],
	});
	assert.equal(pinned.ok, false);
	assert.equal(pinned.code, "AMBER_E_ARTIFACT_TRACE_TARGET_NOT_FOUND");
	assert.match(pinned.errors[0], /revision 7/);
	assert.match(pinned.errors[0], /not a committed revision/);
});

test("traces bind revisions, not heads: an explicit draft revision fails the lifecycle gate", () => {
	const dir = mkTarget("trace-pinning");
	admitArtifact(dir, { type: "intent", identity: "intent/a", body: BODY_V1 });
	admitArtifact(dir, {
		type: "intent",
		identity: "intent/a",
		body: BODY_V1,
		expectedHead: 1,
		transition: "accept",
	});
	const r = admitArtifact(dir, {
		type: "spec",
		identity: "spec/pinned",
		body: "# Spec\n",
		traces: [{ type: "refines", to: { type: "intent", identity: "intent/a", revision: 1 } }],
	});
	// Revision 1 is a draft; the head's accepted state cannot bleed in.
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_TRACE_TARGET_LIFECYCLE");
});

test("traces crossing scope boundaries are rejected with the stable scope code", () => {
	const dir = mkTarget("trace-scope");
	admitArtifact(dir, {
		type: "intent",
		identity: "intent/scoped",
		body: BODY_V1,
		scope: "team-a",
		transition: "accept",
	});
	const cross = admitArtifact(dir, {
		type: "spec",
		identity: "spec/cross",
		body: "# Spec\n",
		traces: [{ type: "refines", to: { type: "intent", identity: "intent/scoped" } }],
	});
	assert.equal(cross.ok, false);
	assert.equal(cross.code, "AMBER_E_ARTIFACT_TRACE_SCOPE");
	assert.match(cross.errors[0], /crosses a scope boundary/);
	assert.match(cross.errors[0], /"team-a"/);

	// Same scope on both endpoints admits; the scope rides the receipt.
	const same = admitArtifact(dir, {
		type: "spec",
		identity: "spec/same",
		body: "# Spec\n",
		scope: "team-a",
		traces: [{ type: "refines", to: { type: "intent", identity: "intent/scoped" } }],
	});
	assert.equal(same.ok, true, same.errors.join("; "));
	assert.equal(same.receipt.scope, "team-a");
	assert.deepEqual(same.receipt.traces, [
		{ type: "refines", to: { type: "intent", identity: "intent/scoped", revision: 1 } },
	]);
});

test("a supersedes trace binds a different artifact of the same type", () => {
	const dir = mkTarget("trace-supersedes");
	admitArtifact(dir, { type: "intent", identity: "intent/old", body: BODY_V1 });
	const r = admitArtifact(dir, {
		type: "intent",
		identity: "intent/new",
		body: "# Intent: replacement\n",
		traces: [{ type: "supersedes", to: { identity: "intent/old" } }],
	});
	assert.equal(r.ok, true, r.errors.join("; "));
	assert.deepEqual(r.receipt.traces, [
		{ type: "supersedes", to: { type: "intent", identity: "intent/old", revision: 1 } },
	]);
});

test("malformed trace input is rejected as an argument error before any registry check", () => {
	const dir = mkTarget("trace-shape");
	const cases = [
		{ type: "refines" }, // missing target
		{ type: "", to: { identity: "intent/a" } }, // empty type
		{ type: "refines", to: { identity: "." } }, // pure-dot identity
		{ type: "refines", to: { identity: "intent/a", revision: "2" } }, // non-integer
		{ type: "refines", to: { identity: "intent/a", revision: 0 } },
	];
	for (const trace of cases) {
		const r = admitArtifact(dir, {
			type: "spec",
			identity: "spec/x",
			body: "# Spec\n",
			traces: [trace],
		});
		assert.equal(r.ok, false);
		assert.equal(r.code, "AMBER_E_INVALID_ARG", JSON.stringify(trace));
	}
	const nonArray = admitArtifact(dir, {
		type: "spec",
		identity: "spec/x",
		body: "# Spec\n",
		traces: "refines:intent/a",
	});
	assert.equal(nonArray.ok, false);
	assert.equal(nonArray.code, "AMBER_E_INVALID_ARG");
});

test("scope and idempotency-key garbage fail closed as argument errors (F5)", () => {
	const dir = mkTarget("arg-garbage");
	for (const scope of ["", "   "]) {
		const r = admitArtifact(dir, {
			type: "intent",
			identity: "intent/x",
			body: BODY_V1,
			scope,
		});
		assert.equal(r.ok, false);
		assert.equal(r.code, "AMBER_E_INVALID_ARG");
		assert.match(r.errors[0], /scope must be a non-empty string/);
	}
	const emptyKey = admitArtifact(dir, {
		type: "intent",
		identity: "intent/x",
		body: BODY_V1,
		idempotencyKey: "",
	});
	assert.equal(emptyKey.ok, false);
	assert.equal(emptyKey.code, "AMBER_E_INVALID_ARG");
	assert.match(emptyKey.errors[0], /idempotencyKey must be a non-empty string/);
});

test("immutable history: a changed envelope (scope) on the same Body needs a new expected head", () => {
	const dir = mkTarget("immutable-envelope");
	admitIntent(dir);
	// Same Body, new scope: different canonical envelope content — not a
	// duplicate retry, and never an in-place edit of revision 1.
	const silentlyEdited = admitIntent(dir, { scope: "team-a" });
	assert.equal(silentlyEdited.ok, false);
	assert.equal(silentlyEdited.code, "AMBER_E_ARTIFACT_IDEMPOTENCY_CONFLICT");

	const asRevision = admitIntent(dir, { scope: "team-a", expectedHead: 1 });
	assert.equal(asRevision.ok, true, asRevision.errors.join("; "));
	assert.equal(asRevision.receipt.revision, 2);
	assert.equal(asRevision.receipt.scope, "team-a");

	// Revision 1 keeps its original (null) scope; nothing was mutated.
	const rev1 = showArtifact(dir, "intent/login-bug", { revision: 1 });
	assert.equal(rev1.scope, null);
	assert.equal(rev1.envelope.scope, null);
	assert.equal(showArtifact(dir, "intent/login-bug").scope, "team-a");
});

test("immutable history: a manual Body change is new admission input, producing a new revision", () => {
	const dir = mkTarget("immutable-body");
	admitIntent(dir);
	const before = fs.readFileSync(path.join(homeOf(dir), "rev-1.md"), "utf8");
	const beforeEnvelope = fs.readFileSync(path.join(homeOf(dir), "rev-1.envelope.json"), "utf8");

	const v2 = admitIntent(dir, { body: BODY_V1 + "\nAdded slice.\n", expectedHead: 1 });
	assert.equal(v2.ok, true, v2.errors.join("; "));
	assert.equal(v2.receipt.revision, 2);

	// The committed revision 1 pair is byte-identical after the admission.
	assert.equal(fs.readFileSync(path.join(homeOf(dir), "rev-1.md"), "utf8"), before);
	assert.equal(
		fs.readFileSync(path.join(homeOf(dir), "rev-1.envelope.json"), "utf8"),
		beforeEnvelope,
	);

	// A hand-edited stored Body never becomes an in-place content mutation:
	// reads fail closed on the broken binding instead.
	fs.writeFileSync(path.join(homeOf(dir), "rev-2.md"), "# hand-edited\n");
	assert.throws(
		() => showArtifact(dir, "intent/login-bug"),
		/HASH_MISMATCH/,
		"a tampered Body fails the read binding",
	);
});

test("F3: a fresh in-flight admission lock fails the next admission as a conflict", () => {
	const dir = mkTarget("lock-in-flight");
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_login-bug");
	fs.mkdirSync(home, { recursive: true });
	fs.writeFileSync(path.join(home, "admit.lock"), String(Date.now()), "utf8");
	const r = admitIntent(dir);
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_CONFLICT");
	assert.match(r.errors[0], /another admission for this artifact is in flight/);
	// The foreign lock is neither stolen nor removed by the loser.
	assert.ok(fs.existsSync(path.join(home, "admit.lock")));
});

test("F3: a stale admission lock is stolen and admission proceeds", () => {
	const dir = mkTarget("lock-stale");
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_login-bug");
	fs.mkdirSync(home, { recursive: true });
	fs.writeFileSync(path.join(home, "admit.lock"), String(Date.now()), "utf8");
	const stale = new Date(Date.now() - 31_000);
	fs.utimesSync(path.join(home, "admit.lock"), stale, stale);
	const r = admitIntent(dir);
	assert.equal(r.ok, true, r.errors.join("; "));
	assert.equal(r.receipt.revision, 1);
	// The stolen lock is released by the winner.
	assert.equal(fs.existsSync(path.join(home, "admit.lock")), false);
});

test("F6: a failed first admission leaves no empty artifact directory behind", () => {
	const dir = mkTarget("empty-dir-cleanup");
	// expectedHead on an artifact with no committed revisions fails under the
	// lock, after the lock created the artifact home but before any durable
	// write — the empty home must not survive the failure.
	const r = admitArtifact(dir, {
		type: "intent",
		identity: "intent/x",
		body: BODY_V1,
		expectedHead: 3,
	});
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_CONFLICT");
	assert.equal(
		fs.existsSync(path.join(dir, ".amber", "artifacts", "intents", "intent_x")),
		false,
		"no empty artifact home is left behind",
	);

	// A failed admission over EXISTING settlement state never removes the
	// home (journals and revision pairs are durable state).
	admitIntent(dir);
	const conflict = admitIntent(dir, { body: BODY_V1 + "v2\n" });
	assert.equal(conflict.ok, false);
	assert.ok(fs.existsSync(path.join(homeOf(dir), "journal.jsonl")));
});

test("F7: I/O failures on the durable writes surface as the typed artifact-IO code", () => {
	const dir = mkTarget("io-pair");
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_x");
	// rev-1.md as a directory makes the pair write fail after the prepared
	// record has claimed the slot — the failure is a typed result, never a
	// raw fs exception escaping admitArtifact.
	fs.mkdirSync(path.join(home, "rev-1.md"), { recursive: true });
	const r = admitArtifact(dir, { type: "intent", identity: "intent/x", body: BODY_V1 });
	assert.equal(r.ok, false);
	assert.equal(r.code, "AMBER_E_ARTIFACT_IO");
	assert.match(r.errors[0], /failed to write the Body\/Envelope pair/);

	// The envelope-side write fails the same way.
	const dir2 = mkTarget("io-envelope");
	const home2 = path.join(dir2, ".amber", "artifacts", "intents", "intent_x");
	fs.mkdirSync(path.join(home2, "rev-1.envelope.json"), { recursive: true });
	const r2 = admitArtifact(dir2, { type: "intent", identity: "intent/x", body: BODY_V1 });
	assert.equal(r2.ok, false);
	assert.equal(r2.code, "AMBER_E_ARTIFACT_IO");
});

test("F8: a missing pair at a non-head revision fails the dedupe scan as corruption", () => {
	const dir = mkTarget("dedupe-non-head");
	admitIntent(dir);
	admitIntent(dir, { body: BODY_V1 + "v2\n", expectedHead: 1 });
	// Remove revision 1's Envelope: the head (revision 2) stays intact, but
	// the content-bound dedupe scan must fail closed instead of skipping the
	// holed revision.
	fs.rmSync(path.join(homeOf(dir), "rev-1.envelope.json"));
	const retry = admitIntent(dir);
	assert.equal(retry.ok, false);
	assert.equal(retry.code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
	assert.match(retry.errors[0], /revision 1.*missing its Envelope on disk/);
});

test("F-2: a committed revision missing its Body fails the next admission as corruption", () => {
	const dir = mkTarget("dedupe-body-half");
	admitIntent(dir);
	admitIntent(dir, { body: BODY_V1 + "v2\n", expectedHead: 1 });
	// Remove revision 1's Body while keeping its Envelope: the head
	// (revision 2) stays intact, but the pair-completeness sweep must fail
	// closed at ANY committed revision — the old scan only noticed a missing
	// Body when the incoming admission hash matched that revision, so
	// admitting revision 3 on the holed store silently succeeded.
	fs.rmSync(path.join(homeOf(dir), "rev-1.md"));
	const next = admitIntent(dir, { body: BODY_V1 + "v3\n", expectedHead: 2 });
	assert.equal(next.ok, false);
	assert.equal(next.code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
	assert.match(next.errors[0], /revision 1.*missing its Body on disk/);
	// Nothing was admitted on top of the holed history.
	assert.equal(journalOf(dir).filter((r) => r.kind === "committed").length, 2);
	// Ticket 04: the read side agrees — show fails closed on the orphaned
	// Body half instead of serving the intact head over a holed history.
	assert.throws(
		() => showArtifact(dir, "intent/login-bug"),
		(err) => err.amberCode === "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT",
	);
});

test("F-2: a keyed retry also refuses a holed committed history", () => {
	const dir = mkTarget("dedupe-body-half-keyed");
	admitIntent(dir, { idempotencyKey: "seed-1" });
	admitIntent(dir, { body: BODY_V1 + "v2\n", expectedHead: 1, idempotencyKey: "seed-2" });
	fs.rmSync(path.join(homeOf(dir), "rev-1.md"));
	// The key matches the intact head revision, but the history below it is
	// holed: the retry fails closed instead of confirming a receipt on a
	// store admission would refuse to build on.
	const retry = admitIntent(dir, {
		body: BODY_V1 + "v2\n",
		expectedHead: 1,
		idempotencyKey: "seed-2",
	});
	assert.equal(retry.ok, false);
	assert.equal(retry.code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
	assert.match(retry.errors[0], /revision 1.*missing its Body on disk/);
	assert.equal(journalOf(dir).filter((r) => r.kind === "committed").length, 2);
});

test("F9: a committed record whose contentHash disagrees with the Envelope fails closed", () => {
	const dir = mkTarget("content-hash-crosscheck");
	admitIntent(dir);
	// Tamper the committed record's contentHash (journal replay stays
	// structurally valid; only the settlement/body binding disagrees).
	const journalPath = path.join(homeOf(dir), "journal.jsonl");
	const lines = fs
		.readFileSync(journalPath, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	for (const record of lines) {
		if (record.kind === "committed") record.contentHash = `sha256:${"0".repeat(64)}`;
	}
	fs.writeFileSync(
		journalPath,
		`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
		"utf8",
	);

	// A verbatim retry (dedupe scan path) refuses to confirm the revision.
	const retry = admitIntent(dir);
	assert.equal(retry.ok, false);
	assert.equal(retry.code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
	assert.match(retry.errors[0], /records contentHash.*while the stored Envelope binds bodyHash/);

	// Building on the head (CAS path) fails the same cross-check.
	const dir2 = mkTarget("content-hash-crosscheck-head");
	admitIntent(dir2);
	const journalPath2 = path.join(homeOf(dir2), "journal.jsonl");
	const lines2 = fs
		.readFileSync(journalPath2, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	for (const record of lines2) {
		if (record.kind === "committed") record.contentHash = `sha256:${"0".repeat(64)}`;
	}
	fs.writeFileSync(
		journalPath2,
		`${lines2.map((line) => JSON.stringify(line)).join("\n")}\n`,
		"utf8",
	);
	const supersede = admitIntent(dir2, { body: BODY_V1 + "v2\n", expectedHead: 1 });
	assert.equal(supersede.ok, false);
	assert.equal(supersede.code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");

	// Trace target resolution refuses to bind across the disagreement too.
	const dir3 = mkTarget("content-hash-crosscheck-trace");
	admitArtifact(dir3, {
		type: "intent",
		identity: "intent/login-bug",
		body: BODY_V1,
		transition: "accept",
	});
	const journalPath3 = path.join(homeOf(dir3), "journal.jsonl");
	const lines3 = fs
		.readFileSync(journalPath3, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	for (const record of lines3) {
		if (record.kind === "committed") record.contentHash = `sha256:${"0".repeat(64)}`;
	}
	fs.writeFileSync(
		journalPath3,
		`${lines3.map((line) => JSON.stringify(line)).join("\n")}\n`,
		"utf8",
	);
	const spec = admitArtifact(dir3, {
		type: "spec",
		identity: "spec/login-spec",
		body: "# Spec\n",
		traces: [{ type: "refines", to: { type: "intent", identity: "intent/login-bug" } }],
	});
	assert.equal(spec.ok, false);
	assert.equal(spec.code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
});

test("legacy revisions without lifecycle fields can still be transitioned and refined", () => {
	const dir = mkTarget("legacy-migration");
	// A ticket-02-shaped store: the journal carries full settlement hashes
	// (expectedHead + admissionHash on every record), while the ENVELOPE is
	// legacy — no lifecycle/transition/scope/traces fields. (Ticket 04's
	// strict hashless policy reads hashless committed records as stripped
	// provenance once any record is hash-bearing, so a legacy ENVELOPE must
	// ride a hash-bearing journal; pure hashless ticket-01 journals are
	// covered separately below.)
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_login-bug");
	fs.mkdirSync(home, { recursive: true });
	fs.writeFileSync(path.join(home, "rev-1.md"), BODY_V1);
	const legacyEnvelope = {
		schemaVersion: 1,
		type: "intent",
		identity: "intent/login-bug",
		revision: 1,
		supersedes: null,
		bodyHash: bodyHash(BODY_V1),
		provenance: null,
		committedAt: new Date("2024-01-01T00:00:00.000Z").toISOString(),
	};
	legacyEnvelope.envelopeHash = envelopeHash(legacyEnvelope);
	const legacyAdmissionHash = "a".repeat(64);
	fs.writeFileSync(
		path.join(home, "rev-1.envelope.json"),
		`${JSON.stringify(legacyEnvelope, null, 2)}\n`,
	);
	fs.writeFileSync(
		path.join(home, "journal.jsonl"),
		`${[
			JSON.stringify({
				kind: "prepared",
				revision: 1,
				at: legacyEnvelope.committedAt,
				expectedHead: 0,
				admissionHash: legacyAdmissionHash,
				attemptId: "legacy-attempt",
			}),
			JSON.stringify({
				kind: "committed",
				revision: 1,
				at: legacyEnvelope.committedAt,
				expectedHead: 0,
				admissionHash: legacyAdmissionHash,
				contentHash: legacyEnvelope.bodyHash,
			}),
		].join("\n")}\n`,
	);

	// The legacy revision reads with lifecycle normalized to null.
	const shown = showArtifact(dir, "intent/login-bug");
	assert.equal(shown.revision, 1);
	assert.equal(shown.lifecycle, null);

	// A verbatim retry still dedupes against the legacy envelope (the
	// admission hash ignores derived lifecycle content).
	const retry = admitArtifact(dir, { type: "intent", identity: "intent/login-bug", body: BODY_V1 });
	assert.equal(retry.ok, true, retry.errors.join("; "));
	assert.equal(retry.duplicate, true);
	assert.equal(retry.receipt.revision, 1);

	// The legacy draft can be accepted: its missing lifecycle field reads as
	// the type's initial state.
	const accepted = admitArtifact(dir, {
		type: "intent",
		identity: "intent/login-bug",
		body: BODY_V1,
		expectedHead: 1,
		transition: "accept",
	});
	assert.equal(accepted.ok, true, accepted.errors.join("; "));
	assert.equal(accepted.receipt.revision, 2);
	assert.equal(accepted.receipt.lifecycle, "accepted");

	// And a Spec can now refine the accepted revision.
	const spec = admitArtifact(dir, {
		type: "spec",
		identity: "spec/login-spec",
		body: "# Spec\n",
		traces: [{ type: "refines", to: { type: "intent", identity: "intent/login-bug" } }],
	});
	assert.equal(spec.ok, true, spec.errors.join("; "));
	assert.deepEqual(spec.receipt.traces, [
		{ type: "refines", to: { type: "intent", identity: "intent/login-bug", revision: 2 } },
	]);
});

// ---------------------------------------------------------------------------
// F049 ticket 04 (#221) — fail-closed admission integrity hardening.
// Fixtures exercise the PUBLIC seams (admitArtifact / showArtifact /
// listArtifacts); journals, Bodies, and Envelopes are hand-crafted as durable
// state and read back as durable state — never through private helpers. The
// hand-crafted stores are exactly the corrupt states admission could never
// produce, which is why they must be forged by hand.
// ---------------------------------------------------------------------------

/**
 * Hand-edit a committed revision's Envelope traces with a freshly recomputed
 * envelopeHash — the canonical way to build corrupt-but-self-consistent
 * lineage state (a real hand-edit that forgot the hash would fail earlier on
 * the envelope binding, not on the lineage verdict under test).
 */
function rewriteEnvelopeTraces(dir, identity, revision, traces) {
	const file = path.join(homeOf(dir, identity), `rev-${revision}.envelope.json`);
	const stored = JSON.parse(fs.readFileSync(file, "utf8"));
	stored.traces = traces;
	const { envelopeHash: _self, ...rest } = stored;
	stored.envelopeHash = envelopeHash(rest);
	fs.writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
}

test("ticket-04: a mutual supersedes cycle fails show with the stable cycle code", () => {
	const dir = mkTarget("t04-cycle");
	admitArtifact(dir, { type: "intent", identity: "intent/a", body: "# a\n" });
	admitArtifact(dir, { type: "intent", identity: "intent/b", body: "# b\n" });
	rewriteEnvelopeTraces(dir, "intent/a", 1, [
		{ type: "supersedes", to: { type: "intent", identity: "intent/b", revision: 1 } },
	]);
	rewriteEnvelopeTraces(dir, "intent/b", 1, [
		{ type: "supersedes", to: { type: "intent", identity: "intent/a", revision: 1 } },
	]);
	for (const identity of ["intent/a", "intent/b"]) {
		assert.throws(
			() => showArtifact(dir, identity),
			(err) =>
				err.amberCode === "AMBER_E_ARTIFACT_TRACE_CYCLE" &&
				/cyclic/.test(err.message) &&
				err.message.includes("intent/intent/a@1") &&
				err.message.includes("intent/intent/b@1"),
			`show of ${identity} must fail closed on the cyclic lineage naming both nodes`,
		);
	}
});

test("ticket-04: a self-supersede (one-revision cycle) fails the read", () => {
	const dir = mkTarget("t04-self-cycle");
	admitArtifact(dir, { type: "intent", identity: "intent/a", body: "# a\n" });
	rewriteEnvelopeTraces(dir, "intent/a", 1, [
		{ type: "supersedes", to: { type: "intent", identity: "intent/a", revision: 1 } },
	]);
	assert.throws(
		() => showArtifact(dir, "intent/a"),
		(err) =>
			err.amberCode === "AMBER_E_ARTIFACT_TRACE_CYCLE" &&
			/intent\/intent\/a@1 -> intent\/intent\/a@1/.test(err.message),
	);
});

test("ticket-04: a trace cycle fails the store-wide list, including for clean artifacts", () => {
	const dir = mkTarget("t04-cycle-list");
	admitArtifact(dir, { type: "intent", identity: "intent/a", body: "# a\n" });
	admitArtifact(dir, { type: "intent", identity: "intent/b", body: "# b\n" });
	rewriteEnvelopeTraces(dir, "intent/a", 1, [
		{ type: "supersedes", to: { type: "intent", identity: "intent/b", revision: 1 } },
	]);
	rewriteEnvelopeTraces(dir, "intent/b", 1, [
		{ type: "supersedes", to: { type: "intent", identity: "intent/a", revision: 1 } },
	]);
	// A clean artifact in the same store does not dilute the verdict: the
	// listing is a verification read of the WHOLE store — never a partial
	// projection that skips the corrupt artifact.
	admitArtifact(dir, { type: "intent", identity: "intent/c", body: "# c\n" });
	assert.throws(
		() => listArtifacts(dir),
		(err) => err.amberCode === "AMBER_E_ARTIFACT_TRACE_CYCLE",
	);
});

test("ticket-04: a cycle through a superseded (non-head) revision still fails the read", () => {
	const dir = mkTarget("t04-cycle-superseded");
	const v1 = admitArtifact(dir, { type: "intent", identity: "intent/a", body: "# a\n" });
	admitArtifact(dir, { type: "intent", identity: "intent/b", body: "# b\n" });
	admitArtifact(dir, {
		type: "intent",
		identity: "intent/a",
		body: "# a v2\n",
		expectedHead: v1.receipt.revision,
	});
	// The cycle rides revision 1, which the head (revision 2) superseded: a
	// cycle through superseded lineage is as corrupt as one through a head.
	rewriteEnvelopeTraces(dir, "intent/a", 1, [
		{ type: "supersedes", to: { type: "intent", identity: "intent/b", revision: 1 } },
	]);
	rewriteEnvelopeTraces(dir, "intent/b", 1, [
		{ type: "supersedes", to: { type: "intent", identity: "intent/a", revision: 1 } },
	]);
	assert.throws(
		() => listArtifacts(dir),
		(err) => err.amberCode === "AMBER_E_ARTIFACT_TRACE_CYCLE",
	);
	assert.throws(
		() => showArtifact(dir, "intent/a"),
		(err) => err.amberCode === "AMBER_E_ARTIFACT_TRACE_CYCLE",
	);
});

test("ticket-04: acyclic shared-ancestor lineage (a diamond) reads clean — no false positives", () => {
	const dir = mkTarget("t04-diamond");
	admitArtifact(dir, {
		type: "intent",
		identity: "intent/root",
		body: BODY_V1,
		transition: "accept",
	});
	for (const identity of ["spec/left", "spec/right"]) {
		const refines = [{ type: "refines", to: { type: "intent", identity: "intent/root" } }];
		const draft = admitArtifact(dir, { type: "spec", identity, body: "# Spec\n", traces: refines });
		assert.equal(draft.ok, true, draft.errors.join("; "));
		const approved = admitArtifact(dir, {
			type: "spec",
			identity,
			body: "# Spec\n",
			expectedHead: 1,
			transition: "approve",
			traces: refines,
		});
		assert.equal(approved.ok, true, approved.errors.join("; "));
	}
	for (const [specId, planId] of [
		["spec/left", "plan/left"],
		["spec/right", "plan/right"],
	]) {
		const plan = admitArtifact(dir, {
			type: "plan",
			identity: planId,
			body: "# Plan\n",
			traces: [{ type: "realizes", to: { type: "spec", identity: specId } }],
		});
		assert.equal(plan.ok, true, plan.errors.join("; "));
	}
	// Two plans sharing one accepted ancestor is a DAG, not a cycle: the
	// walk must read the whole diamond without a verdict.
	const entries = listArtifacts(dir);
	assert.equal(entries.length, 5);
	assert.equal(showArtifact(dir, "plan/left", { type: "plan" }).revision, 1);
	assert.equal(showArtifact(dir, "intent/root").lifecycle, "accepted");
});

test("ticket-04: an orphaned Envelope half fails show AND list at any committed revision", () => {
	const dir = mkTarget("t04-orphan-envelope");
	admitIntent(dir);
	admitIntent(dir, { body: BODY_V1 + "v2\n", expectedHead: 1 });
	// Hole at the non-head revision 1 while the head (revision 2) is intact:
	// the old read side served the head (show) or skipped the artifact
	// (list) — the verification read now fails closed on the hole itself.
	fs.rmSync(path.join(homeOf(dir), "rev-1.envelope.json"));
	assert.throws(
		() => showArtifact(dir, "intent/login-bug"),
		(err) =>
			err.amberCode === "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT" &&
			/revision 1.*missing its Envelope/.test(err.message),
	);
	assert.throws(
		() => showArtifact(dir, "intent/login-bug", { revision: 2 }),
		(err) => err.amberCode === "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT",
		"the intact head is not served over a holed history either",
	);
	assert.throws(
		() => listArtifacts(dir),
		(err) => err.amberCode === "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT",
	);
});

test("ticket-04: an orphaned Body half at the head fails show AND list (asymmetry closed)", () => {
	const dir = mkTarget("t04-orphan-body-head");
	admitIntent(dir);
	admitIntent(dir, { body: BODY_V1 + "v2\n", expectedHead: 1 });
	fs.rmSync(path.join(homeOf(dir), "rev-2.md"));
	// `list` used to hide the artifact (head pair missing) while `show`
	// served revision 1 — reads disagreed. Both now fail closed.
	assert.throws(
		() => showArtifact(dir, "intent/login-bug"),
		(err) =>
			err.amberCode === "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT" &&
			/revision 2.*missing its Body/.test(err.message),
	);
	assert.throws(
		() => listArtifacts(dir),
		(err) => err.amberCode === "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT",
	);
});

test("ticket-04: a ghost committed record fails show AND list as corruption", () => {
	const dir = mkTarget("t04-ghost-read");
	admitIntent(dir);
	fs.appendFileSync(
		path.join(homeOf(dir), "journal.jsonl"),
		JSON.stringify({
			kind: "committed",
			revision: 99,
			at: new Date().toISOString(),
			expectedHead: 1,
			admissionHash: "f".repeat(64),
		}) + "\n",
		"utf8",
	);
	for (const read of [() => showArtifact(dir, "intent/login-bug"), () => listArtifacts(dir)]) {
		assert.throws(
			read,
			(err) =>
				err.amberCode === "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT" &&
				/revision 99 without a matching prepared record/.test(err.message),
		);
	}
});

test("ticket-04: a forked settlement with intact pairs fails show AND list as corruption", () => {
	const dir = mkTarget("t04-fork-read");
	admitIntent(dir);
	const home = homeOf(dir);
	// Two forged revisions both building on head 1, each with a fully valid
	// pair on disk: only the settlement replay can see the fork.
	for (const revision of [2, 3]) {
		const body = BODY_V1 + `v${revision}\n`;
		const content = {
			schemaVersion: 1,
			type: "intent",
			identity: "intent/login-bug",
			revision,
			supersedes: 1,
			bodyHash: bodyHash(body),
			lifecycle: "draft",
			transition: null,
			scope: null,
			traces: [],
			provenance: null,
			committedAt: new Date().toISOString(),
		};
		content.envelopeHash = envelopeHash(content);
		fs.writeFileSync(path.join(home, `rev-${revision}.md`), body, "utf8");
		fs.writeFileSync(
			path.join(home, `rev-${revision}.envelope.json`),
			`${JSON.stringify(content, null, 2)}\n`,
			"utf8",
		);
		fs.appendFileSync(
			path.join(home, "journal.jsonl"),
			JSON.stringify({
				kind: "prepared",
				revision,
				at: new Date().toISOString(),
				expectedHead: 1,
				admissionHash: `h${revision}`,
				attemptId: `forged-${revision}`,
			}) +
				"\n" +
				JSON.stringify({
					kind: "committed",
					revision,
					at: new Date().toISOString(),
					expectedHead: 1,
					admissionHash: `h${revision}`,
					contentHash: content.bodyHash,
				}) +
				"\n",
			"utf8",
		);
	}
	for (const read of [() => showArtifact(dir, "intent/login-bug"), () => listArtifacts(dir)]) {
		assert.throws(
			read,
			(err) =>
				err.amberCode === "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT" &&
				/forked or forged settlement/.test(err.message),
		);
	}
});

test("ticket-04: a skipped revision slot fails show AND list as corruption", () => {
	const dir = mkTarget("t04-skip-read");
	admitIntent(dir);
	const home = homeOf(dir);
	// A fully valid revision 3 pair whose slot numbering jumps over 2: only
	// the replay sees the hole in the numbering.
	const body = BODY_V1 + "v3\n";
	const content = {
		schemaVersion: 1,
		type: "intent",
		identity: "intent/login-bug",
		revision: 3,
		supersedes: 1,
		bodyHash: bodyHash(body),
		lifecycle: "draft",
		transition: null,
		scope: null,
		traces: [],
		provenance: null,
		committedAt: new Date().toISOString(),
	};
	content.envelopeHash = envelopeHash(content);
	fs.writeFileSync(path.join(home, "rev-3.md"), body, "utf8");
	fs.writeFileSync(
		path.join(home, "rev-3.envelope.json"),
		`${JSON.stringify(content, null, 2)}\n`,
		"utf8",
	);
	fs.appendFileSync(
		path.join(home, "journal.jsonl"),
		JSON.stringify({
			kind: "prepared",
			revision: 3,
			at: new Date().toISOString(),
			expectedHead: 1,
			admissionHash: "h3",
			attemptId: "forged-3",
		}) +
			"\n" +
			JSON.stringify({
				kind: "committed",
				revision: 3,
				at: new Date().toISOString(),
				expectedHead: 1,
				admissionHash: "h3",
				contentHash: content.bodyHash,
			}) +
			"\n",
		"utf8",
	);
	for (const read of [() => showArtifact(dir, "intent/login-bug"), () => listArtifacts(dir)]) {
		assert.throws(
			read,
			(err) =>
				err.amberCode === "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT" &&
				/skips revision slot 2/.test(err.message),
		);
	}
});

test("ticket-04: a hashless committed record in a hash-bearing journal fails reads and admission (F2)", () => {
	const dir = mkTarget("t04-stripped");
	admitIntent(dir);
	const journalFile = path.join(homeOf(dir), "journal.jsonl");
	// Strip the settlement hashes from the committed record only: the old
	// legacy fallback matched it by revision and let a forged fork through.
	const lines = journalOf(dir).map((record) => ({ ...record }));
	for (const record of lines) {
		if (record.kind === "committed") {
			delete record.admissionHash;
			delete record.expectedHead;
		}
	}
	fs.writeFileSync(journalFile, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`, "utf8");
	for (const read of [() => showArtifact(dir, "intent/login-bug"), () => listArtifacts(dir)]) {
		assert.throws(
			read,
			(err) =>
				err.amberCode === "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT" &&
				/without its settlement hashes/.test(err.message),
		);
	}
	// Admission refuses to build on the stripped journal — and fails before
	// appending anything (the journal is unchanged by the refusal).
	const build = admitIntent(dir, { body: BODY_V1 + "v2\n", expectedHead: 1 });
	assert.equal(build.ok, false);
	assert.equal(build.code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
	assert.match(build.errors[0], /settlement hashes/);
	assert.equal(journalOf(dir).length, lines.length, "no record was appended by the refusal");
});

test("ticket-04: a pure ticket-01 journal (zero hash-bearing records) stays readable", () => {
	const dir = mkTarget("t04-legacy-pure");
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_login-bug");
	fs.mkdirSync(home, { recursive: true });
	fs.writeFileSync(path.join(home, "rev-1.md"), BODY_V1);
	const legacy = {
		schemaVersion: 1,
		type: "intent",
		identity: "intent/login-bug",
		revision: 1,
		supersedes: null,
		bodyHash: bodyHash(BODY_V1),
		provenance: null,
		committedAt: "2024-01-01T00:00:00.000Z",
	};
	legacy.envelopeHash = envelopeHash(legacy);
	fs.writeFileSync(path.join(home, "rev-1.envelope.json"), `${JSON.stringify(legacy, null, 2)}\n`);
	fs.writeFileSync(
		path.join(home, "journal.jsonl"),
		`${[
			JSON.stringify({ kind: "prepared", revision: 1, at: legacy.committedAt }),
			JSON.stringify({ kind: "committed", revision: 1, at: legacy.committedAt }),
		].join("\n")}\n`,
	);
	const shown = showArtifact(dir, "intent/login-bug");
	assert.equal(shown.revision, 1);
	assert.equal(shown.lifecycle, null, "legacy envelope reads with lifecycle normalized");
	assert.deepEqual(
		listArtifacts(dir).map((e) => e.revision),
		[1],
	);

	// A verbatim retry still dedupes against the legacy envelope (the
	// admission hash ignores derived lifecycle content).
	const retry = admitArtifact(dir, { type: "intent", identity: "intent/login-bug", body: BODY_V1 });
	assert.equal(retry.ok, true, retry.errors.join("; "));
	assert.equal(retry.duplicate, true);
	assert.equal(retry.receipt.revision, 1);

	// Extending the hashless journal fails closed BEFORE any write: the
	// strict policy never leaves a mixed journal behind (which it would then
	// have to read as stripped provenance).
	const extend = admitIntent(dir, { body: BODY_V1 + "v2\n", expectedHead: 1 });
	assert.equal(extend.ok, false);
	assert.equal(extend.code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
	assert.match(extend.errors[0], /pure ticket-01 legacy journal/);
	assert.equal(journalOf(dir).length, 2, "the refusal appended nothing");
	assert.equal(
		showArtifact(dir, "intent/login-bug").revision,
		1,
		"still readable after the refusal",
	);
});

test("ticket-04: a dangling prepared record is settled as aborted by the verification read (journal-only)", () => {
	const dir = mkTarget("t04-recover-read");
	admitIntent(dir);
	const home = homeOf(dir);
	fs.appendFileSync(
		path.join(home, "journal.jsonl"),
		JSON.stringify({
			kind: "prepared",
			revision: 2,
			at: new Date().toISOString(),
			expectedHead: 1,
			admissionHash: "e".repeat(64),
			attemptId: "crashed-attempt",
			idempotencyKey: "crashed-key",
		}) + "\n",
		"utf8",
	);
	// Snapshot the durable artifact state: recovery may append to the
	// JOURNAL only — every Body and Envelope byte must survive untouched,
	// and no new pair file may appear.
	const bodyBefore = fs.readFileSync(path.join(home, "rev-1.md"), "utf8");
	const envelopeBefore = fs.readFileSync(path.join(home, "rev-1.envelope.json"), "utf8");
	const filesBefore = fs.readdirSync(home).sort();

	const shown = showArtifact(dir, "intent/login-bug");
	assert.equal(shown.revision, 1, "the read serves the committed head");

	const journal = journalOf(dir);
	const aborted = journal.filter((r) => r.kind === "aborted");
	assert.equal(aborted.length, 1, "exactly one aborted record settles the crashed attempt");
	assert.equal(aborted[0].revision, 2);
	assert.equal(aborted[0].recovered, true, "the record is marked as recovery-settled");
	assert.equal(aborted[0].expectedHead, 1, "the crashed attempt's anchors are copied");
	assert.equal(aborted[0].admissionHash, "e".repeat(64));
	assert.equal(aborted[0].attemptId, "crashed-attempt");
	assert.equal(aborted[0].idempotencyKey, "crashed-key");

	// No repair path reached the artifacts: only journal.jsonl changed.
	assert.equal(fs.readFileSync(path.join(home, "rev-1.md"), "utf8"), bodyBefore);
	assert.equal(fs.readFileSync(path.join(home, "rev-1.envelope.json"), "utf8"), envelopeBefore);
	assert.deepEqual(fs.readdirSync(home).sort(), filesBefore, "no pair file was created or removed");

	// The aborted revision stays invisible, and the listing agrees.
	assert.equal(showArtifact(dir, "intent/login-bug", { revision: 2 }), null);
	assert.deepEqual(
		listArtifacts(dir).map((e) => e.revision),
		[1],
	);

	// The consumed slot is never reused: the next admission takes 3.
	const next = admitIntent(dir, { body: BODY_V1 + "v2\n", expectedHead: 1 });
	assert.equal(next.ok, true, next.errors.join("; "));
	assert.equal(next.receipt.revision, 3);
});

test("ticket-04: recovery leaves a live admission's prepared record alone", () => {
	const dir = mkTarget("t04-recover-live");
	admitIntent(dir);
	const home = homeOf(dir);
	fs.appendFileSync(
		path.join(home, "journal.jsonl"),
		JSON.stringify({
			kind: "prepared",
			revision: 2,
			at: new Date().toISOString(),
			expectedHead: 1,
			admissionHash: "d".repeat(64),
			attemptId: "live-attempt",
		}) + "\n",
		"utf8",
	);
	// A fresh admit.lock means a live admission owns that prepared record
	// right now: the read serves the head but must NOT abort it.
	fs.writeFileSync(path.join(home, "admit.lock"), String(Date.now()), "utf8");
	assert.equal(showArtifact(dir, "intent/login-bug").revision, 1);
	assert.equal(
		journalOf(dir).filter((r) => r.kind === "aborted").length,
		0,
		"a live attempt's prepared record is not aborted",
	);
	// Once the lock is gone (the admission finished or crashed for real),
	// the same read settles the dangling record deterministically.
	fs.rmSync(path.join(home, "admit.lock"));
	assert.equal(showArtifact(dir, "intent/login-bug").revision, 1);
	assert.equal(journalOf(dir).filter((r) => r.kind === "aborted").length, 1);
});

test("ticket-04: admission settles a crashed prior attempt before claiming its own slot", () => {
	const dir = mkTarget("t04-recover-admit");
	admitIntent(dir);
	fs.appendFileSync(
		path.join(homeOf(dir), "journal.jsonl"),
		JSON.stringify({ kind: "prepared", revision: 2, idempotencyKey: "crashed" }) + "\n",
		"utf8",
	);
	const next = admitIntent(dir, { body: BODY_V1 + "v2\n", supersedes: 1 });
	assert.equal(next.ok, true, next.errors.join("; "));
	assert.equal(next.receipt.revision, 3, "the crashed attempt's slot is consumed, not reused");
	const aborted = journalOf(dir).filter((r) => r.kind === "aborted");
	assert.equal(aborted.length, 1, "the admission settled the crashed attempt as aborted");
	assert.equal(aborted[0].revision, 2);
	assert.equal(aborted[0].recovered, true);
	assert.equal(aborted[0].idempotencyKey, "crashed");
});

test("ticket-04: the integrity analysis module holds no I/O or write capability (no repair path)", () => {
	// Structural guard in the T1 "no mutation path" style: detection lives in
	// a deliberately pure module, so no code path from a verdict can reach a
	// Body/Envelope write. The module must stay import-free and must expose
	// only pure verdict functions.
	const modulePath = path.join(
		__dirname,
		"..",
		"..",
		"scripts",
		"lib",
		"core",
		"canonical-artifact-verify.js",
	);
	const source = fs.readFileSync(modulePath, "utf8");
	assert.doesNotMatch(source, /require\s*\(/, "the pure module must import nothing");
	assert.doesNotMatch(
		source,
		/writeFileSync|appendFileSync|readFileSync|rmSync|unlinkSync|mkdirSync|openSync|renameSync|copyFileSync|truncateSync|\bprocess\./,
		"the pure module must hold no filesystem or process capability",
	);
	const verify = require("../../scripts/lib/core/canonical-artifact-verify");
	assert.deepEqual(Object.keys(verify).sort(), ["danglingPreparedRevisions", "findTraceCycle"]);
	for (const name of Object.keys(verify)) {
		assert.doesNotMatch(
			name,
			/set|update|mutate|rewrite|edit|write|repair|recover|append/i,
			`${name} must stay a pure verdict`,
		);
	}
});
