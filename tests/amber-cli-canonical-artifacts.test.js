"use strict";

// F049 tickets 01–02 — Intent admission CLI integration (tests the public seam:
// `amber artifact admit|show|list` through the standard command registry).
// Ticket 02 covers compare-and-swap (`--expected-head`), idempotent admission
// (`--idempotency-key`, content-bound dedupe), and fail-closed settlement.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function runCli(args, cwd) {
	return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-ca-${label}-`));
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

const BODY_V1 = "# Intent: login bug\n\nOutcome: users can log in again.\n";

test("artifact unknown subcommand errors", () => {
	const dir = mkTarget("unknown");
	const r = runCli(["artifact", "bogus", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
});

test("admit returns a receipt and show/list read it back (committed only)", () => {
	const dir = mkTarget("e2e");
	const admit = runCli(
		["artifact", "admit", "--id", "intent/login-bug", "--body", BODY_V1, "--target", dir, "--json"],
		dir,
	);
	assert.equal(admit.status, 0, admit.stderr);
	const receipt = payload(admit);
	assert.equal(receipt.type, "intent");
	assert.equal(receipt.identity, "intent/login-bug");
	assert.equal(receipt.revision, 1);
	assert.match(receipt.contentHash, /^sha256:[0-9a-f]{64}$/);
	assert.ok(receipt.envelopeHash);
	assert.ok(receipt.committedAt);

	// Atomic pair on disk.
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_login-bug");
	assert.ok(fs.existsSync(path.join(home, "rev-1.md")));
	assert.ok(fs.existsSync(path.join(home, "rev-1.envelope.json")));

	const shown = runCli(
		["artifact", "show", "--id", "intent/login-bug", "--revision", "1", "--target", dir, "--json"],
		dir,
	);
	assert.equal(shown.status, 0, shown.stderr);
	assert.equal(payload(shown).status, "committed");
	assert.equal(payload(shown).body, BODY_V1);

	const list = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	assert.equal(list.status, 0, list.stderr);
	const entries = payload(list);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].identity, "intent/login-bug");
	assert.equal(entries[0].revision, 1);
});

test("exact duplicate retry returns the original revision flagged as duplicate", () => {
	const dir = mkTarget("dup");
	runCli(
		["artifact", "admit", "--id", "intent/x", "--body", BODY_V1, "--target", dir, "--json"],
		dir,
	);
	const retry = runCli(
		["artifact", "admit", "--id", "intent/x", "--body", BODY_V1, "--target", dir],
		dir,
	);
	assert.equal(retry.status, 0, retry.stderr);
	assert.match(retry.stdout + retry.stderr, /duplicate/i);
});

test("supersede creates revision 2; revision 1 stays readable; stale CAS conflicts", () => {
	const dir = mkTarget("supersede");
	runCli(
		["artifact", "admit", "--id", "intent/y", "--body", BODY_V1, "--target", dir, "--json"],
		dir,
	);
	const v2 = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/y",
			"--body",
			BODY_V1 + "\nNon-goal: no SSO.\n",
			"--supersedes-revision",
			"1",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(v2.status, 0, v2.stderr);
	assert.equal(payload(v2).revision, 2);
	assert.equal(payload(v2).supersedes, 1);

	// Earlier revision remains immutable and readable.
	const rev1 = runCli(
		["artifact", "show", "--id", "intent/y", "--revision", "1", "--target", dir, "--json"],
		dir,
	);
	assert.equal(rev1.status, 0, rev1.stderr);
	assert.equal(payload(rev1).body, BODY_V1);

	// Stale expected head fails closed with the stable code.
	const stale = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/y",
			"--body",
			BODY_V1 + "\nv3\n",
			"--supersedes-revision",
			"1",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(stale.status, 1);
	const outer = payload(stale);
	assert.equal(outer.code, "AMBER_E_ARTIFACT_CONFLICT");
});

test("show of an unknown identity reports the stable not-found code", () => {
	const dir = mkTarget("missing");
	const r = runCli(["artifact", "show", "--id", "intent/ghost", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
	const outer = payload(r);
	assert.equal(outer.code, "AMBER_E_ARTIFACT_NOT_FOUND");
	assert.ok(outer.errors.length > 0);
});

test("prepared-but-unsettled revisions are invisible to show/list via CLI", () => {
	const dir = mkTarget("prepared-cli");
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_ghost");
	fs.mkdirSync(home, { recursive: true });
	fs.writeFileSync(path.join(home, "rev-1.md"), "# ghost\n");
	fs.writeFileSync(
		path.join(home, "rev-1.envelope.json"),
		JSON.stringify({
			schemaVersion: 1,
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
	const shown = runCli(
		["artifact", "show", "--id", "intent/ghost", "--target", dir, "--json"],
		dir,
	);
	assert.equal(shown.status, 1, "prepared-only is invisible to show");
	const list = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	assert.equal(list.status, 0);
	assert.deepEqual(payload(list), []);
});

test("tampered Envelope metadata fails show/list with the stable envelope-mismatch code", () => {
	const dir = mkTarget("envelope-tamper-cli");
	runCli(
		["artifact", "admit", "--id", "intent/t", "--body", BODY_V1, "--target", dir, "--json"],
		dir,
	);
	const envFile = path.join(
		dir,
		".amber",
		"artifacts",
		"intents",
		"intent_t",
		"rev-1.envelope.json",
	);
	const stored = JSON.parse(fs.readFileSync(envFile, "utf8"));
	stored.provenance = { source: "TAMPERED" };
	fs.writeFileSync(envFile, JSON.stringify(stored, null, 2) + "\n", "utf8");

	const shown = runCli(["artifact", "show", "--id", "intent/t", "--target", dir, "--json"], dir);
	assert.equal(shown.status, 1);
	assert.equal(payload(shown).code, "AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH");

	const list = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	assert.equal(list.status, 1);
	assert.equal(payload(list).code, "AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH");
});

test("pure-dot identity is rejected via CLI with a stable code and no store writes", () => {
	for (const identity of [".", ".."]) {
		const dir = mkTarget(`dot-id-cli-${identity === "." ? "self" : "parent"}`);
		const r = runCli(
			["artifact", "admit", "--id", identity, "--body", BODY_V1, "--target", dir, "--json"],
			dir,
		);
		assert.equal(r.status, 1);
		assert.equal(payload(r).code, "AMBER_E_ARTIFACT_INVALID_IDENTITY");
		assert.ok(!fs.existsSync(path.join(dir, ".amber", "artifacts")), "store root stays clean");
	}
});

// F049 ticket 02 — compare-and-swap and idempotent admission (#219).
// Every fixture below drives the PUBLIC CLI seam only.

test("concurrent admissions with the same expected head commit exactly one revision (CAS)", () => {
	const dir = mkTarget("cas-race");
	const seed = runCli(
		["artifact", "admit", "--id", "intent/race", "--body", BODY_V1, "--target", dir, "--json"],
		dir,
	);
	assert.equal(seed.status, 0, seed.stderr);
	assert.equal(payload(seed).revision, 1);

	// Two callers both built their admission against head 1. Whichever
	// settles first wins; the loser must fail closed with the stable code.
	const winner = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/race",
			"--body",
			BODY_V1 + "\nWinner edit.\n",
			"--expected-head",
			"1",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(winner.status, 0, winner.stderr);
	assert.equal(payload(winner).revision, 2);

	const loser = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/race",
			"--body",
			BODY_V1 + "\nLoser edit.\n",
			"--expected-head",
			"1",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(loser.status, 1);
	assert.equal(payload(loser).code, "AMBER_E_ARTIFACT_CONFLICT");

	// Reads and queries see exactly one new revision: the winner's.
	const list = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	assert.equal(list.status, 0, list.stderr);
	const entries = payload(list);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].revision, 2);
	const shown = runCli(["artifact", "show", "--id", "intent/race", "--target", dir, "--json"], dir);
	assert.equal(payload(shown).revision, 2);
	assert.match(payload(shown).body, /Winner edit/);
});

test("exact duplicate with the same idempotency key returns the original receipt", () => {
	const dir = mkTarget("idem-key");
	const first = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/keyed",
			"--body",
			BODY_V1,
			"--idempotency-key",
			"op-123",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(first.status, 0, first.stderr);
	const receipt = payload(first);
	assert.equal(receipt.revision, 1);
	assert.equal(receipt.duplicate, undefined);

	const retry = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/keyed",
			"--body",
			BODY_V1,
			"--idempotency-key",
			"op-123",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(retry.status, 0, retry.stderr);
	const outer = JSON.parse(retry.stdout);
	assert.ok(
		(outer.warnings || []).some((w) => /duplicate/i.test(String(w))),
		"duplicate retry is flagged in warnings",
	);
	const replayed = payload(retry);
	assert.equal(replayed.revision, receipt.revision);
	assert.equal(replayed.contentHash, receipt.contentHash);
	assert.equal(replayed.envelopeHash, receipt.envelopeHash);

	// No duplicate revision is visible to reads or queries.
	const list = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	const entries = payload(list);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].revision, 1);
});

test("idempotency key reused with different content fails closed as conflict", () => {
	const dir = mkTarget("idem-clash");
	const first = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/clash",
			"--body",
			BODY_V1,
			"--idempotency-key",
			"op-9",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(first.status, 0, first.stderr);

	const clash = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/clash",
			"--body",
			BODY_V1 + "\nDifferent content.\n",
			"--idempotency-key",
			"op-9",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(clash.status, 1);
	const outer = payload(clash);
	assert.equal(outer.code, "AMBER_E_ARTIFACT_IDEMPOTENCY_CONFLICT");
	assert.ok(outer.errors.length > 0);

	// Fail-closed: no second revision was created.
	const list = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	assert.equal(payload(list).length, 1);
});

test("same Body with different provenance conflicts at the head; expected head admits it", () => {
	const dir = mkTarget("prov-clash");
	const first = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/prov",
			"--body",
			BODY_V1,
			"--provenance",
			"github#issue#100",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(first.status, 0, first.stderr);

	// F3 fix: the Body is identical, but the canonical envelope content
	// (provenance included) differs — this is a conflict, not a duplicate.
	const clash = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/prov",
			"--body",
			BODY_V1,
			"--provenance",
			"github#issue#200",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(clash.status, 1);
	assert.equal(payload(clash).code, "AMBER_E_ARTIFACT_IDEMPOTENCY_CONFLICT");

	// Declaring the CAS precondition turns the same admission into a
	// legitimate new revision.
	const v2 = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/prov",
			"--body",
			BODY_V1,
			"--provenance",
			"github#issue#200",
			"--expected-head",
			"1",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(v2.status, 0, v2.stderr);
	assert.equal(payload(v2).revision, 2);
});

test("expected head on an empty artifact fails closed with the conflict code", () => {
	const dir = mkTarget("cas-empty");
	const r = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/empty",
			"--body",
			BODY_V1,
			"--expected-head",
			"1",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 1);
	const outer = payload(r);
	assert.equal(outer.code, "AMBER_E_ARTIFACT_CONFLICT");
	assert.ok(outer.errors.length > 0);
});

test("garbage numeric flag values are rejected with the stable arg code (never NaN)", () => {
	const dir = mkTarget("flag-garbage");
	for (const flag of ["--expected-head", "--supersedes-revision"]) {
		for (const garbage of ["abc", "1.5", "-1", "0", ""]) {
			const args = [
				"artifact",
				"admit",
				"--id",
				"intent/garbage",
				"--body",
				BODY_V1,
				flag,
				garbage,
				"--target",
				dir,
				"--json",
			];
			const r = runCli(args, dir);
			assert.equal(r.status, 1, `${flag} ${JSON.stringify(garbage)} must fail`);
			const outer = payload(r);
			assert.equal(outer.code, "AMBER_E_INVALID_ARG", `${flag} ${garbage}`);
			assert.match(outer.errors.join(" "), new RegExp(flag));
		}
	}
	// Nothing was admitted by any rejected invocation.
	assert.ok(!fs.existsSync(path.join(dir, ".amber", "artifacts")), "store root stays clean");
});

test("tampered settlement fails the next CLI admission with the corruption code", () => {
	const dir = mkTarget("settlement-tamper-cli");
	const seed = runCli(
		["artifact", "admit", "--id", "intent/st", "--body", BODY_V1, "--target", dir, "--json"],
		dir,
	);
	assert.equal(seed.status, 0, seed.stderr);

	// Replay a committed record by hand: two commits claim revision 1.
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_st");
	const journalFile = path.join(home, "journal.jsonl");
	const lines = fs.readFileSync(journalFile, "utf8").trim().split("\n");
	fs.appendFileSync(journalFile, lines[lines.length - 1] + "\n", "utf8");

	const next = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/st",
			"--body",
			BODY_V1 + "\nNext.\n",
			"--expected-head",
			"1",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(next.status, 1);
	assert.equal(payload(next).code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");

	// Reads still see the untampered committed history.
	const list = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	assert.equal(list.status, 0);
	assert.equal(payload(list).length, 1);
});

test("retry after a lost race replays the committed receipt and never duplicates revisions", () => {
	const dir = mkTarget("race-retry");
	const seed = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/rr",
			"--body",
			BODY_V1,
			"--idempotency-key",
			"seed-1",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(seed.status, 0, seed.stderr);

	const winner = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/rr",
			"--body",
			BODY_V1 + "\nWinner.\n",
			"--expected-head",
			"1",
			"--idempotency-key",
			"op-77",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(winner.status, 0, winner.stderr);
	const won = payload(winner);
	assert.equal(won.revision, 2);

	// The losing retry of the SAME admission (same key, same content, same
	// expected head) must not create revision 3: it replays the receipt.
	const loserRetry = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/rr",
			"--body",
			BODY_V1 + "\nWinner.\n",
			"--expected-head",
			"1",
			"--idempotency-key",
			"op-77",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(loserRetry.status, 0, loserRetry.stderr);
	const outer = JSON.parse(loserRetry.stdout);
	assert.ok(
		(outer.warnings || []).some((w) => /duplicate/i.test(String(w))),
		"the replayed admission is flagged as a duplicate",
	);
	const replayed = payload(loserRetry);
	assert.equal(replayed.revision, 2);
	assert.equal(replayed.envelopeHash, won.envelopeHash);

	const list = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	const entries = payload(list);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].revision, 2);
});
