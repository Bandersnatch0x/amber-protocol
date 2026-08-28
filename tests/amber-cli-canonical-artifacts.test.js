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
// Fixture-setup-only import: the CLI tests build corrupt-but-self-consistent
// durable state with the store's own hash primitives; every assertion goes
// through the CLI seam.
const { envelopeHash, bodyHash } = require(
	path.join(ROOT, "scripts", "lib", "core", "canonical-artifacts"),
);

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

	// Ticket 04: reads fail closed too — the verification read replays the
	// journal instead of serving the untampered prefix silently (T2-review
	// finding F1: list used to drop the artifact while show served rev 1).
	const list = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	assert.equal(list.status, 1);
	assert.equal(payload(list).code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
	const shown = runCli(["artifact", "show", "--id", "intent/st", "--target", dir, "--json"], dir);
	assert.equal(shown.status, 1);
	assert.equal(payload(shown).code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
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

// ---------------------------------------------------------------------------
// F049 ticket 03 (#220) — Spec/Plan types, lifecycle transitions, typed Trace
// lineage, and the routed ticket-02 review fixes F4/F5, all through the
// public CLI seam (`amber artifact admit|show|list`).
// ---------------------------------------------------------------------------

test("CLI: full Intent -> Spec -> Plan lineage with lifecycle transitions and traces", () => {
	const dir = mkTarget("t03-lineage");
	const admitIntent = runCli(
		["artifact", "admit", "--id", "intent/login-bug", "--body", BODY_V1, "--target", dir, "--json"],
		dir,
	);
	assert.equal(admitIntent.status, 0, admitIntent.stderr);
	assert.equal(payload(admitIntent).lifecycle, "draft");

	const accept = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/login-bug",
			"--body",
			BODY_V1,
			"--expected-head",
			"1",
			"--transition",
			"accept",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(accept.status, 0, accept.stderr);
	const accepted = payload(accept);
	assert.equal(accepted.revision, 2);
	assert.equal(accepted.lifecycle, "accepted");
	assert.equal(accepted.transition, "accept");

	const admitSpec = runCli(
		[
			"artifact",
			"admit",
			"--type",
			"spec",
			"--id",
			"spec/login-spec",
			"--body",
			"# Spec: login\n",
			"--trace",
			"refines:intent/login-bug",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(admitSpec.status, 0, admitSpec.stderr);
	const spec = payload(admitSpec);
	assert.equal(spec.type, "spec");
	assert.equal(spec.lifecycle, "draft");
	assert.deepEqual(spec.traces, [
		{ type: "refines", to: { type: "intent", identity: "intent/login-bug", revision: 2 } },
	]);

	const approveSpec = runCli(
		[
			"artifact",
			"admit",
			"--type",
			"spec",
			"--id",
			"spec/login-spec",
			"--body",
			"# Spec: login\n",
			"--expected-head",
			"1",
			"--transition",
			"approve",
			"--trace",
			"refines:intent/login-bug",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(approveSpec.status, 0, approveSpec.stderr);
	assert.equal(payload(approveSpec).lifecycle, "approved");

	const admitPlan = runCli(
		[
			"artifact",
			"admit",
			"--type",
			"plan",
			"--id",
			"plan/login-plan",
			"--body",
			"# Plan: login\n",
			"--trace",
			"realizes:spec/login-spec",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(admitPlan.status, 0, admitPlan.stderr);
	const plan = payload(admitPlan);
	assert.equal(plan.type, "plan");
	assert.deepEqual(plan.traces, [
		{ type: "realizes", to: { type: "spec", identity: "spec/login-spec", revision: 2 } },
	]);

	// show reads per-type; list sees the whole lineage.
	const shown = runCli(
		["artifact", "show", "--type", "plan", "--id", "plan/login-plan", "--target", dir, "--json"],
		dir,
	);
	assert.equal(shown.status, 0, shown.stderr);
	const shownPlan = payload(shown);
	assert.equal(shownPlan.lifecycle, "draft");
	assert.deepEqual(shownPlan.traces, [
		{ type: "realizes", to: { type: "spec", identity: "spec/login-spec", revision: 2 } },
	]);

	const list = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	const entries = payload(list);
	assert.deepEqual(
		entries.map((e) => `${e.type}/${e.identity}:${e.revision}:${e.lifecycle}`).sort(),
		[
			"intent/intent/login-bug:2:accepted",
			"plan/plan/login-plan:1:draft",
			"spec/spec/login-spec:2:approved",
		],
	);
});

test("CLI: omitted-Spec policy rejects a Plan realizing its Intent directly", () => {
	const dir = mkTarget("t03-omitted");
	runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/login-bug",
			"--body",
			BODY_V1,
			"--transition",
			"accept",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	const r = runCli(
		[
			"artifact",
			"admit",
			"--type",
			"plan",
			"--id",
			"plan/short-circuit",
			"--body",
			"# Plan\n",
			"--trace",
			"realizes:intent/login-bug",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 1);
	const outer = payload(r);
	assert.equal(outer.code, "AMBER_E_ARTIFACT_TRACE_DIRECTION");
	assert.match(outer.errors.join(" "), /omitted-Spec policy/);
});

test("CLI: a generic relation cannot satisfy required planning lineage", () => {
	const dir = mkTarget("t03-generic");
	runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/login-bug",
			"--body",
			BODY_V1,
			"--transition",
			"accept",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	const r = runCli(
		[
			"artifact",
			"admit",
			"--type",
			"spec",
			"--id",
			"spec/generic",
			"--body",
			"# Spec\n",
			"--trace",
			"relates-to:intent/login-bug",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 1);
	const outer = payload(r);
	assert.equal(outer.code, "AMBER_E_ARTIFACT_TRACE_UNKNOWN");
	assert.match(outer.errors.join(" "), /not registered/);

	// A Spec with no trace at all misses required lineage.
	const missing = runCli(
		[
			"artifact",
			"admit",
			"--type",
			"spec",
			"--id",
			"spec/bare",
			"--body",
			"# Spec\n",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(missing.status, 1);
	assert.equal(payload(missing).code, "AMBER_E_ARTIFACT_TRACE_CARDINALITY");
});

test("CLI: cross-scope traces are rejected; same-scope traces admit", () => {
	const dir = mkTarget("t03-scope");
	runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/scoped",
			"--body",
			BODY_V1,
			"--scope",
			"team-a",
			"--transition",
			"accept",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	const cross = runCli(
		[
			"artifact",
			"admit",
			"--type",
			"spec",
			"--id",
			"spec/cross",
			"--body",
			"# Spec\n",
			"--trace",
			"refines:intent/scoped",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(cross.status, 1);
	const outer = payload(cross);
	assert.equal(outer.code, "AMBER_E_ARTIFACT_TRACE_SCOPE");
	assert.match(outer.errors.join(" "), /crosses a scope boundary/);

	const same = runCli(
		[
			"artifact",
			"admit",
			"--type",
			"spec",
			"--id",
			"spec/same",
			"--body",
			"# Spec\n",
			"--scope",
			"team-a",
			"--trace",
			"refines:intent/scoped",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(same.status, 0, same.stderr);
	assert.equal(payload(same).scope, "team-a");
});

test("CLI: unknown and inapplicable transitions fail with stable codes", () => {
	const dir = mkTarget("t03-transitions");
	runCli(
		["artifact", "admit", "--id", "intent/login-bug", "--body", BODY_V1, "--target", dir, "--json"],
		dir,
	);
	const unknown = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/login-bug",
			"--body",
			BODY_V1,
			"--expected-head",
			"1",
			"--transition",
			"ship",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(unknown.status, 1);
	assert.equal(payload(unknown).code, "AMBER_E_ARTIFACT_TRANSITION_UNKNOWN");

	runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/login-bug",
			"--body",
			BODY_V1,
			"--expected-head",
			"1",
			"--transition",
			"accept",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	const invalid = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/login-bug",
			"--body",
			BODY_V1,
			"--expected-head",
			"2",
			"--transition",
			"accept",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(invalid.status, 1);
	assert.equal(payload(invalid).code, "AMBER_E_ARTIFACT_TRANSITION_INVALID");
});

test("CLI: show rejects unregistered types with the stable unknown-type code", () => {
	const dir = mkTarget("t03-bad-show-type");
	const r = runCli(
		["artifact", "show", "--type", "epic", "--id", "epic/x", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 1);
	assert.equal(payload(r).code, "AMBER_E_ARTIFACT_UNKNOWN_TYPE");
});

test("F4: a trailing value flag never silently drops its precondition", () => {
	const dir = mkTarget("t03-f4");
	for (const [flag, label] of [
		["--expected-head", "expected head"],
		["--body", "body"],
		["--idempotency-key", "idempotency key"],
		["--transition", "transition"],
		["--trace", "trace"],
	]) {
		// The flag under test is the LAST token: parseArgs yields undefined,
		// which must fail closed instead of meaning "not declared".
		const r = runCli(
			["artifact", "admit", "--target", dir, "--json", "--id", "intent/x", "--body", BODY_V1, flag],
			dir,
		);
		assert.equal(r.status, 1, `${flag} as the last token must fail`);
		const outer = payload(r);
		assert.equal(outer.code, "AMBER_E_INVALID_ARG", label);
		assert.match(outer.errors.join(" "), /requires a value/);
	}
	// Nothing was admitted by any of the truncated invocations.
	const list = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	assert.equal(payload(list).length, 0);
});

test("F5: an explicitly empty --idempotency-key fails closed", () => {
	const dir = mkTarget("t03-f5");
	const r = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/x",
			"--body",
			BODY_V1,
			"--idempotency-key",
			"",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 1);
	const outer = payload(r);
	assert.equal(outer.code, "AMBER_E_INVALID_ARG");
	assert.match(outer.errors.join(" "), /non-empty string/);
	const list = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	assert.equal(payload(list).length, 0);
});

test("F-3: an explicitly empty --type fails closed instead of defaulting to intent", () => {
	const dir = mkTarget("t03r-empty-type");
	for (const action of ["admit", "show"]) {
		const args = [
			"artifact",
			action,
			"--id",
			"intent/x",
			...(action === "admit" ? ["--body", BODY_V1] : []),
			"--type",
			"",
			"--target",
			dir,
			"--json",
		];
		const r = runCli(args, dir);
		assert.equal(r.status, 1, `--type "" on ${action} must fail`);
		const outer = payload(r);
		assert.equal(outer.code, "AMBER_E_INVALID_ARG", action);
		assert.match(outer.errors.join(" "), /--type/);
	}
	// A whitespace-only value is equally an explicitly empty type.
	const blank = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/x",
			"--body",
			BODY_V1,
			"--type",
			"   ",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(blank.status, 1);
	assert.equal(payload(blank).code, "AMBER_E_INVALID_ARG");

	// The legitimate default (flag absent entirely) still resolves to intent.
	const admit = runCli(
		["artifact", "admit", "--id", "intent/x", "--body", BODY_V1, "--target", dir, "--json"],
		dir,
	);
	assert.equal(admit.status, 0, admit.stderr);
	assert.equal(payload(admit).type, "intent");
	const list = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	assert.equal(payload(list).length, 1);
});

test("F-4: a trailing --target fails closed instead of falling back to the CWD", () => {
	const dir = mkTarget("t03r-trailing-target");
	// The CLI process runs with `dir` as its CWD and --target is the LAST
	// token, so the invocation names no target at all: the old behavior
	// silently resolved the missing value to process.cwd() and admitted there.
	const r = runCli(
		["artifact", "admit", "--id", "intent/x", "--body", BODY_V1, "--json", "--target"],
		dir,
	);
	assert.equal(r.status, 1, "a trailing --target must fail");
	const outer = payload(r);
	assert.equal(outer.code, "AMBER_E_INVALID_ARG");
	assert.match(outer.errors.join(" "), /--target requires a value/);
	// Nothing was written to the CWD the truncated invocation fell back to.
	assert.ok(!fs.existsSync(path.join(dir, ".amber")), "nothing was written to the CWD");
});

test("CLI: malformed --trace values are rejected with the stable arg code (never NaN)", () => {
	const dir = mkTarget("t03-trace-garbage");
	// Full-review follow-up finding 8: `refines:intent/a@abc` left this list —
	// a non-digit suffix after the last '@' now belongs to the IDENTITY
	// ("intent/a@abc"), so it fails later with TRACE_TARGET_NOT_FOUND instead
	// of INVALID_ARG (covered by its own test below).
	for (const garbage of ["bogus", "refines:", ":intent/a", "refines:intent/a@0"]) {
		const r = runCli(
			[
				"artifact",
				"admit",
				"--type",
				"spec",
				"--id",
				"spec/x",
				"--body",
				"# Spec\n",
				"--trace",
				garbage,
				"--target",
				dir,
				"--json",
			],
			dir,
		);
		assert.equal(r.status, 1, `--trace ${garbage} must fail`);
		const outer = payload(r);
		assert.equal(outer.code, "AMBER_E_INVALID_ARG", garbage);
	}
});

test("CLI: an explicit trace revision binds that revision exactly", () => {
	const dir = mkTarget("t03-trace-revision");
	runCli(
		["artifact", "admit", "--id", "intent/login-bug", "--body", BODY_V1, "--target", dir, "--json"],
		dir,
	);
	runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/login-bug",
			"--body",
			BODY_V1,
			"--expected-head",
			"1",
			"--transition",
			"accept",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	const r = runCli(
		[
			"artifact",
			"admit",
			"--type",
			"spec",
			"--id",
			"spec/pinned",
			"--body",
			"# Spec\n",
			"--trace",
			"refines:intent/login-bug@2",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 0, r.stderr);
	assert.deepEqual(payload(r).traces, [
		{ type: "refines", to: { type: "intent", identity: "intent/login-bug", revision: 2 } },
	]);
});

// ---------------------------------------------------------------------------
// F049 ticket 04 (#221) — fail-closed integrity hardening at the public CLI
// seam: verification reads (show/list) fail closed on tampered settlement,
// orphaned pair halves, and cyclic trace lineage; crashed admissions settle
// deterministically as aborted (journal-only recovery); plus the routed
// strictness fixes for explicitly-empty --target / list --type.
// ---------------------------------------------------------------------------

function homeOfCli(dir, identity) {
	const slug = identity.replace(/[^a-zA-Z0-9._-]+/g, "_");
	return path.join(dir, ".amber", "artifacts", "intents", slug);
}

function journalOfCli(dir, identity) {
	return fs
		.readFileSync(path.join(homeOfCli(dir, identity), "journal.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
}

test("CLI: ticket-04 — an explicitly empty --target fails as INVALID_ARG on admit, show, and list", () => {
	const dir = mkTarget("t04-empty-target");
	// The CLI process runs with `dir` as its CWD: the old behavior silently
	// resolved the empty value to process.cwd() and operated there.
	const invocations = [
		["artifact", "admit", "--id", "intent/x", "--body", BODY_V1, "--target", "", "--json"],
		["artifact", "show", "--id", "intent/x", "--target", "", "--json"],
		["artifact", "list", "--target", "", "--json"],
	];
	for (const args of invocations) {
		const r = runCli(args, dir);
		assert.equal(r.status, 1, `${args[1]} --target "" must fail`);
		const outer = payload(r);
		assert.equal(outer.code, "AMBER_E_INVALID_ARG", args[1]);
		assert.match(outer.errors.join(" "), /--target must be a non-empty repository path/);
	}
	// Nothing was written to the CWD the empty target would have resolved to.
	assert.ok(!fs.existsSync(path.join(dir, ".amber")), "the CWD stays clean");
});

test('CLI: ticket-04 — list --type "" fails as INVALID_ARG, not UNKNOWN_TYPE', () => {
	const dir = mkTarget("t04-empty-type");
	const empty = runCli(["artifact", "list", "--type", "", "--target", dir, "--json"], dir);
	assert.equal(empty.status, 1);
	const outer = payload(empty);
	assert.equal(
		outer.code,
		"AMBER_E_INVALID_ARG",
		"an explicitly empty --type is an argument error",
	);
	assert.match(outer.errors.join(" "), /--type must be one of the registered artifact types/);
	// An unregistered NON-empty value still reports the unknown-type verdict.
	const unknown = runCli(["artifact", "list", "--type", "epic", "--target", dir, "--json"], dir);
	assert.equal(unknown.status, 1);
	assert.equal(payload(unknown).code, "AMBER_E_ARTIFACT_UNKNOWN_TYPE");
	// The legitimate filter value still lists.
	const ok = runCli(["artifact", "list", "--type", "intent", "--target", dir, "--json"], dir);
	assert.equal(ok.status, 0, ok.stderr);
});

test("CLI: ticket-04 — an orphaned pair half fails show and list with the corruption code", () => {
	const dir = mkTarget("t04-orphan-cli");
	const seed = runCli(
		["artifact", "admit", "--id", "intent/orphan", "--body", BODY_V1, "--target", dir, "--json"],
		dir,
	);
	assert.equal(seed.status, 0, seed.stderr);
	fs.rmSync(path.join(homeOfCli(dir, "intent/orphan"), "rev-1.md"));

	const shown = runCli(
		["artifact", "show", "--id", "intent/orphan", "--target", dir, "--json"],
		dir,
	);
	assert.equal(shown.status, 1);
	const outer = payload(shown);
	assert.equal(outer.code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
	assert.match(outer.errors.join(" "), /missing its Body on disk/);

	const list = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	assert.equal(list.status, 1);
	assert.equal(payload(list).code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
});

test("CLI: ticket-04 — a ghost committed record fails show and list with the corruption code", () => {
	const dir = mkTarget("t04-ghost-cli");
	const seed = runCli(
		["artifact", "admit", "--id", "intent/ghost", "--body", BODY_V1, "--target", dir, "--json"],
		dir,
	);
	assert.equal(seed.status, 0, seed.stderr);
	fs.appendFileSync(
		path.join(homeOfCli(dir, "intent/ghost"), "journal.jsonl"),
		JSON.stringify({
			kind: "committed",
			revision: 99,
			at: new Date().toISOString(),
			expectedHead: 1,
			admissionHash: "f".repeat(64),
		}) + "\n",
		"utf8",
	);
	for (const args of [
		["artifact", "show", "--id", "intent/ghost", "--target", dir, "--json"],
		["artifact", "list", "--target", dir, "--json"],
	]) {
		const r = runCli(args, dir);
		assert.equal(r.status, 1, args.join(" "));
		const outer = payload(r);
		assert.equal(outer.code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
		assert.match(outer.errors.join(" "), /revision 99 without a matching prepared record/);
	}
});

test("CLI: ticket-04 — cyclic trace lineage fails show and list with the stable cycle code", () => {
	const dir = mkTarget("t04-cycle-cli");
	for (const identity of ["intent/a", "intent/b"]) {
		const seed = runCli(
			["artifact", "admit", "--id", identity, "--body", "# cycle\n", "--target", dir, "--json"],
			dir,
		);
		assert.equal(seed.status, 0, seed.stderr);
	}
	// Hand-edit both Envelopes into a mutual supersedes cycle, recomputing
	// the envelope hash so the corruption is exactly the cyclic lineage.
	for (const [self, other] of [
		["intent/a", "intent/b"],
		["intent/b", "intent/a"],
	]) {
		const file = path.join(homeOfCli(dir, self), "rev-1.envelope.json");
		const stored = JSON.parse(fs.readFileSync(file, "utf8"));
		stored.traces = [{ type: "supersedes", to: { type: "intent", identity: other, revision: 1 } }];
		const { envelopeHash: _self, ...rest } = stored;
		stored.envelopeHash = envelopeHash(rest);
		fs.writeFileSync(file, JSON.stringify(stored, null, 2) + "\n", "utf8");
	}
	for (const args of [
		["artifact", "show", "--id", "intent/a", "--target", dir, "--json"],
		["artifact", "list", "--target", dir, "--json"],
	]) {
		const r = runCli(args, dir);
		assert.equal(r.status, 1, args.join(" "));
		const outer = payload(r);
		assert.equal(outer.code, "AMBER_E_ARTIFACT_TRACE_CYCLE");
		assert.match(outer.errors.join(" "), /cyclic/);
		assert.match(outer.errors.join(" "), /intent\/intent\/a@1/);
	}
});

test("CLI: ticket-04 — a stripped hashless committed record fails reads (strict hashless policy)", () => {
	const dir = mkTarget("t04-stripped-cli");
	const seed = runCli(
		["artifact", "admit", "--id", "intent/st", "--body", BODY_V1, "--target", dir, "--json"],
		dir,
	);
	assert.equal(seed.status, 0, seed.stderr);
	const journalFile = path.join(homeOfCli(dir, "intent/st"), "journal.jsonl");
	const lines = journalOfCli(dir, "intent/st").map((record) => ({ ...record }));
	for (const record of lines) {
		if (record.kind === "committed") {
			delete record.admissionHash;
			delete record.expectedHead;
		}
	}
	fs.writeFileSync(journalFile, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`, "utf8");
	for (const args of [
		["artifact", "show", "--id", "intent/st", "--target", dir, "--json"],
		["artifact", "list", "--target", dir, "--json"],
	]) {
		const r = runCli(args, dir);
		assert.equal(r.status, 1, args.join(" "));
		const outer = payload(r);
		assert.equal(outer.code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
		assert.match(outer.errors.join(" "), /settlement hashes/);
	}
});

test("CLI: ticket-04 — a dangling prepared record is settled as aborted by the verification read", () => {
	const dir = mkTarget("t04-recover-cli");
	const seed = runCli(
		["artifact", "admit", "--id", "intent/crash", "--body", BODY_V1, "--target", dir, "--json"],
		dir,
	);
	assert.equal(seed.status, 0, seed.stderr);
	const home = homeOfCli(dir, "intent/crash");
	const bodyBefore = fs.readFileSync(path.join(home, "rev-1.md"), "utf8");
	const envelopeBefore = fs.readFileSync(path.join(home, "rev-1.envelope.json"), "utf8");
	// A crashed admission attempt: prepared claimed slot 2, nothing settled it.
	fs.appendFileSync(
		path.join(home, "journal.jsonl"),
		JSON.stringify({
			kind: "prepared",
			revision: 2,
			at: new Date().toISOString(),
			expectedHead: 1,
			admissionHash: "e".repeat(64),
			attemptId: "crashed-attempt",
		}) + "\n",
		"utf8",
	);

	const shown = runCli(
		["artifact", "show", "--id", "intent/crash", "--target", dir, "--json"],
		dir,
	);
	assert.equal(shown.status, 0, shown.stderr);
	assert.equal(payload(shown).revision, 1);

	const journal = journalOfCli(dir, "intent/crash");
	const aborted = journal.filter((r) => r.kind === "aborted");
	assert.equal(aborted.length, 1, "the read settled the crashed attempt as aborted");
	assert.equal(aborted[0].revision, 2);
	assert.equal(aborted[0].recovered, true);
	assert.equal(aborted[0].attemptId, "crashed-attempt");

	// Journal-only recovery: the committed pair survived byte-identical.
	assert.equal(fs.readFileSync(path.join(home, "rev-1.md"), "utf8"), bodyBefore);
	assert.equal(fs.readFileSync(path.join(home, "rev-1.envelope.json"), "utf8"), envelopeBefore);

	// The aborted revision stays invisible to reads.
	const gone = runCli(
		["artifact", "show", "--id", "intent/crash", "--revision", "2", "--target", dir, "--json"],
		dir,
	);
	assert.equal(gone.status, 1);
	assert.equal(payload(gone).code, "AMBER_E_ARTIFACT_NOT_FOUND");
	const list = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	assert.equal(list.status, 0, list.stderr);
	assert.deepEqual(
		payload(list).map((e) => e.revision),
		[1],
	);
});

test("CLI: ticket-04 — a pure ticket-01 legacy journal still reads", () => {
	const dir = mkTarget("t04-legacy-cli");
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_legacy");
	fs.mkdirSync(home, { recursive: true });
	fs.writeFileSync(path.join(home, "rev-1.md"), BODY_V1);
	const legacy = {
		schemaVersion: 1,
		type: "intent",
		identity: "intent/legacy",
		revision: 1,
		supersedes: null,
		bodyHash: bodyHash(BODY_V1),
		provenance: null,
		committedAt: "2024-01-01T00:00:00.000Z",
	};
	legacy.envelopeHash = envelopeHash(legacy);
	fs.writeFileSync(path.join(home, "rev-1.envelope.json"), JSON.stringify(legacy, null, 2) + "\n");
	fs.writeFileSync(
		path.join(home, "journal.jsonl"),
		[
			JSON.stringify({ kind: "prepared", revision: 1, at: legacy.committedAt }),
			JSON.stringify({ kind: "committed", revision: 1, at: legacy.committedAt }),
		].join("\n") + "\n",
		"utf8",
	);
	const shown = runCli(
		["artifact", "show", "--id", "intent/legacy", "--target", dir, "--json"],
		dir,
	);
	assert.equal(shown.status, 0, shown.stderr);
	assert.equal(payload(shown).revision, 1);
	assert.equal(payload(shown).body, BODY_V1);
	const list = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	assert.equal(list.status, 0, list.stderr);
	assert.deepEqual(
		payload(list).map((e) => e.identity),
		["intent/legacy"],
	);
});

// ---------------------------------------------------------------------------
// Full-review follow-up (F049 `ae42c09..3d8e4da`): identity case policy
// (finding 1), lock I/O classification (finding 6), `@`-bearing identities
// in the --trace grammar (finding 8).
// ---------------------------------------------------------------------------

test("CLI: a case-variant identity is a stable admission error and a hinted not-found read", () => {
	const dir = mkTarget("fr1-cli");
	const admit = runCli(
		["artifact", "admit", "--id", "intent/Login-Bug", "--body", BODY_V1, "--target", dir, "--json"],
		dir,
	);
	assert.equal(admit.status, 0, admit.stderr);
	assert.equal(payload(admit).identity, "intent/Login-Bug");

	// Admission of the case variant fails with the dedicated collision code
	// and names the exact spelling — never a CAS conflict or corruption.
	const variant = runCli(
		["artifact", "admit", "--id", "intent/login-bug", "--body", BODY_V1, "--target", dir, "--json"],
		dir,
	);
	assert.equal(variant.status, 1);
	const variantOuter = JSON.parse(variant.stdout);
	assert.equal(variantOuter.code, "AMBER_E_ARTIFACT_IDENTITY_CASE_COLLISION");
	assert.match(variantOuter.errors.join("; "), /intent\/Login-Bug/);

	// Reading the case variant is not-found with the stored spelling in the
	// message — not settlement corruption with a restore-from-VCS remedy.
	const shown = runCli(
		["artifact", "show", "--id", "intent/login-bug", "--target", dir, "--json"],
		dir,
	);
	assert.equal(shown.status, 1);
	const shownOuter = JSON.parse(shown.stdout);
	assert.equal(shownOuter.code, "AMBER_E_ARTIFACT_NOT_FOUND");
	assert.match(shownOuter.errors.join("; "), /intent\/Login-Bug/);
	assert.doesNotMatch(shownOuter.errors.join("; "), /SETTLEMENT_CORRUPT/);

	// The exact spelling still reads, and list serves the stored spelling.
	const exact = runCli(
		["artifact", "show", "--id", "intent/Login-Bug", "--target", dir, "--json"],
		dir,
	);
	assert.equal(exact.status, 0, exact.stderr);
	assert.equal(payload(exact).identity, "intent/Login-Bug");
	const list = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	assert.equal(list.status, 0, list.stderr);
	assert.deepEqual(
		payload(list).map((e) => e.identity),
		["intent/Login-Bug"],
	);
});

test("CLI: an artifact home blocked by a file fails admission as artifact I/O", () => {
	const dir = mkTarget("fr6-cli");
	const home = path.join(dir, ".amber", "artifacts", "intents", "intent_login-bug");
	fs.mkdirSync(path.dirname(home), { recursive: true });
	fs.writeFileSync(home, "not a directory");
	const r = runCli(
		["artifact", "admit", "--id", "intent/login-bug", "--body", BODY_V1, "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 1);
	const outer = JSON.parse(r.stdout);
	// Finding 6: an I/O condition is never reported as a compare-and-swap
	// conflict, and the raw mkdir error becomes the typed artifact-IO code.
	assert.equal(outer.code, "AMBER_E_ARTIFACT_IO");
	assert.match(outer.errors.join("; "), /cannot create the artifact home/);
});

test("CLI: --trace identities may contain '@' (revision parsed from the last '@' only)", () => {
	const dir = mkTarget("fr8-cli");
	const admit = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/user@tenant",
			"--body",
			BODY_V1,
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(admit.status, 0, admit.stderr);
	assert.equal(payload(admit).identity, "intent/user@tenant");
	const accept = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/user@tenant",
			"--body",
			BODY_V1,
			"--expected-head",
			"1",
			"--transition",
			"accept",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(accept.status, 0, accept.stderr);

	// Unpinned: the whole token is the identity (the '@' is not a revision
	// separator because what follows it is not all digits).
	const spec = runCli(
		[
			"artifact",
			"admit",
			"--type",
			"spec",
			"--id",
			"spec/pinned",
			"--body",
			"# Spec\n",
			"--trace",
			"refines:intent/user@tenant",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(spec.status, 0, spec.stderr);
	assert.deepEqual(payload(spec).traces, [
		{ type: "refines", to: { type: "intent", identity: "intent/user@tenant", revision: 2 } },
	]);

	// Pinned: the revision parses from the LAST '@' only.
	const specPinned = runCli(
		[
			"artifact",
			"admit",
			"--type",
			"spec",
			"--id",
			"spec/pinned-2",
			"--body",
			"# Spec 2\n",
			"--trace",
			"refines:intent/user@tenant@2",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(specPinned.status, 0, specPinned.stderr);
	assert.deepEqual(payload(specPinned).traces, [
		{ type: "refines", to: { type: "intent", identity: "intent/user@tenant", revision: 2 } },
	]);

	// A non-digit suffix that names no stored identity is a target miss, not
	// an argument error (the grammar accepts it; the store rejects it).
	const miss = runCli(
		[
			"artifact",
			"admit",
			"--type",
			"spec",
			"--id",
			"spec/miss",
			"--body",
			"# Spec\n",
			"--trace",
			"refines:intent/a@abc",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(miss.status, 1);
	assert.equal(JSON.parse(miss.stdout).code, "AMBER_E_ARTIFACT_TRACE_TARGET_NOT_FOUND");
});
