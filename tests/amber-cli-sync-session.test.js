"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function runCli(args, cwd) {
	return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

function git(dir, args) {
	const res = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
	assert.equal(res.status, 0, (res.stderr || "").toString());
	return (res.stdout || "").trim();
}

function mkTarget(label) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-sess-${label}-`));
	execSync("git init", { cwd: dir, encoding: "utf8" });
	execSync('git config user.email "test@example.com"', { cwd: dir, encoding: "utf8" });
	execSync('git config user.name "Test User"', { cwd: dir, encoding: "utf8" });
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	return dir;
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

function packPageEnvelope(dir) {
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".amber", "context", "pages", "page.json"), "# Page\n");
	return runCli(
		[
			"sync",
			"envelope",
			"pack",
			"--type",
			"context-page",
			"--artifact",
			".amber/context/pages/page.json",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
}

function head(dir) {
	return git(dir, ["rev-parse", "HEAD"]);
}

function porcelain(dir) {
	return git(dir, ["status", "--porcelain", "-uall"]);
}

test("sync session list shows zero envelopes on a fresh target", () => {
	const dir = mkTarget("list");
	const r = runCli(["sync", "session", "list", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.deepEqual(out, []);
});

test("sync session run prepares transport without git writes", () => {
	const dir = mkTarget("run");
	git(dir, ["commit", "--allow-empty", "-m", "baseline"]);
	const headBefore = head(dir);
	const p = packPageEnvelope(dir);
	assert.equal(p.status, 0, p.stderr);

	const r = runCli(["sync", "session", "run", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.ok(out.session, "session record present");
	assert.equal(out.session.operation, "sync");
	assert.ok(out.summary.pulled >= 1, `expected pulled >= 1, got ${out.summary.pulled}`);
	const prep = out.summary.preparation;
	assert.ok(prep, "transport preparation report present");
	assert.equal(prep.mode, "prepare");
	assert.ok(prep.proposedOps.some((op) => op.verb === "add" && op.paths.includes(".amber/sync")));
	assert.ok(
		prep.proposedOps.some((op) => op.verb === "commit" && op.message.startsWith("amber sync:")),
	);
	assert.ok(prep.envelopeIds.length >= 1, "envelope ids listed in the report");

	assert.equal(head(dir), headBefore, "sync session run must not commit");
	const status = porcelain(dir);
	assert.match(status, /\?\? \.amber\/sync\/envelopes\//, "envelope files stay untracked");
	const staged = status
		.split(/\r?\n/)
		.filter(Boolean)
		.filter((line) => !line.startsWith("??"));
	assert.deepEqual(staged, [], "nothing may be staged");
});

test("sync session push reports preparation and performs no git writes", () => {
	const dir = mkTarget("push");
	git(dir, ["commit", "--allow-empty", "-m", "baseline"]);
	const headBefore = head(dir);
	const logBefore = git(dir, ["log", "--oneline"]);
	const p = packPageEnvelope(dir);
	assert.equal(p.status, 0, p.stderr);

	const r = runCli(["sync", "session", "push", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const outer = JSON.parse(r.stdout);
	assert.match(outer.text, /preparation/i, "report names transport preparation");
	assert.ok(outer.text.includes("git add .amber/sync"), "report renders the add op's shell line");
	assert.ok(outer.text.includes("git commit"), "report renders the commit op's shell line");
	assert.ok(/not executed|never executed|no git commands were executed/i.test(outer.text));

	// F040: --json carries the schema-valid machine-readable report itself
	assert.ok(outer.report, "the schema-governed report rides in the JSON result");
	assert.equal(outer.report.schemaVersion, "1.0.0");
	assert.ok(
		outer.report.proposedOps.every((op) => typeof op === "object" && typeof op.verb === "string"),
		"CLI-reported ops are structured, never shell strings",
	);
	const {
		validateSyncTransportReport,
	} = require("../scripts/lib/core/sync-transport-report-contract");
	const v = validateSyncTransportReport(outer.report);
	assert.equal(v.valid, true, `CLI report must validate: ${JSON.stringify(v.errors)}`);

	assert.equal(head(dir), headBefore, "push must not create a commit");
	assert.equal(git(dir, ["log", "--oneline"]), logBefore, "commit count must be unchanged");
	const status = porcelain(dir);
	assert.match(status, /\?\? \.amber\/sync\/envelopes\//, "envelope files remain untracked");
});

test("sync session pull validates packed envelopes", () => {
	const dir = mkTarget("pull");
	const p = packPageEnvelope(dir);
	assert.equal(p.status, 0, p.stderr);

	const r = runCli(["sync", "session", "pull", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const outer = JSON.parse(r.stdout);
	assert.match(outer.text, /Validated 1 envelope/);
});

test("sync session pull records a refused envelope in the conflict ledger", () => {
	const dir = mkTarget("pull-refused");
	const p = packPageEnvelope(dir);
	assert.equal(p.status, 0, p.stderr);
	// Local identity moves to another tenant after the envelope was packed
	fs.writeFileSync(
		path.join(dir, ".amber", "identity.json"),
		JSON.stringify({ tenantId: "team-a" }),
	);

	const r = runCli(["sync", "session", "pull", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const outer = JSON.parse(r.stdout);
	assert.match(outer.text, /refused 1/, "the refusal surfaces in the report");
	assert.match(outer.text, /conflicts recorded/i);

	const c = runCli(["sync", "session", "conflicts", "--target", dir, "--json"], dir);
	assert.equal(c.status, 0, c.stderr);
	const conflicts = payload(c);
	assert.equal(conflicts.length, 1);
	assert.equal(conflicts[0].conflictType, "identity-mismatch");
	assert.equal(conflicts[0].resolution, "pending");
});

test("sync session with unknown subcommand errors", () => {
	const dir = mkTarget("unknown");
	const r = runCli(["sync", "session", "bogus", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
});
