"use strict";

// F049 ticket 01 — Intent admission CLI integration (tests the public seam:
// `amber artifact admit|show|list` through the standard command registry).

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
