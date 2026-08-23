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

function mkTarget(label) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-sync-${label}-`));
	execSync("git init", { cwd: dir, encoding: "utf8" });
	execSync('git config user.email "test@example.com"', { cwd: dir, encoding: "utf8" });
	execSync('git config user.name "Test User"', { cwd: dir, encoding: "utf8" });
	return dir;
}

test("sync envelope pack creates an envelope file", () => {
	const dir = mkTarget("pack");
	fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
	fs.writeFileSync(path.join(dir, "docs", "page.md"), "# Page\n");
	const r = runCli(
		[
			"sync",
			"envelope",
			"pack",
			"--type",
			"context-page",
			"--artifact",
			"docs/page.md",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 0, r.stderr);
	const out = JSON.parse(r.stdout);
	const env = JSON.parse(out.text);
	assert.equal(env.artifactType, "context-page");
	assert.equal(env.artifactRef.path, "docs/page.md");
	const envPath = path.join(dir, ".amber", "sync", "envelopes", `${env.envelopeId}.json`);
	assert.ok(fs.existsSync(envPath), "envelope file written");
});

test("sync envelope pack rejects a missing artifact", () => {
	const dir = mkTarget("pack-missing");
	const r = runCli(
		[
			"sync",
			"envelope",
			"pack",
			"--type",
			"context-page",
			"--artifact",
			"nope.md",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 1);
});

test("sync envelope validate accepts a packed envelope", () => {
	const dir = mkTarget("validate");
	fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
	fs.writeFileSync(path.join(dir, "docs", "page.md"), "# Page\n");
	const r = runCli(
		[
			"sync",
			"envelope",
			"pack",
			"--type",
			"context-page",
			"--artifact",
			"docs/page.md",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	const out = JSON.parse(r.stdout);
	const env = JSON.parse(out.text);
	const v = runCli(
		["sync", "envelope", "validate", "--envelope", JSON.stringify(env), "--target", dir, "--json"],
		dir,
	);
	assert.equal(v.status, 0, v.stderr);
	const vout = JSON.parse(v.stdout);
	const vpayload = JSON.parse(vout.text);
	assert.equal(vpayload.valid, true);
});

test("sync envelope compat refuses an incompatible envelope", () => {
	const dir = mkTarget("compat");
	fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
	fs.writeFileSync(path.join(dir, "docs", "page.md"), "# Page\n");
	const r = runCli(
		[
			"sync",
			"envelope",
			"pack",
			"--type",
			"context-page",
			"--artifact",
			"docs/page.md",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	const out = JSON.parse(r.stdout);
	const env = JSON.parse(out.text);
	env.versionNegotiation.minCompatibleVersion = "99.0.0";
	const c = runCli(
		["sync", "envelope", "compat", "--envelope", JSON.stringify(env), "--target", dir, "--json"],
		dir,
	);
	assert.equal(c.status, 1);
	const cout = JSON.parse(c.stdout);
	const cpayload = JSON.parse(cout.text);
	assert.equal(cpayload.compatible, false);
});

test("sync envelope unpack validates a matching local artifact", () => {
	const dir = mkTarget("unpack");
	fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
	fs.writeFileSync(path.join(dir, "docs", "page.md"), "# Page\n");
	const r = runCli(
		[
			"sync",
			"envelope",
			"pack",
			"--type",
			"context-page",
			"--artifact",
			"docs/page.md",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	const out = JSON.parse(r.stdout);
	const env = JSON.parse(out.text);
	const u = runCli(
		["sync", "envelope", "unpack", "--envelope", JSON.stringify(env), "--target", dir, "--json"],
		dir,
	);
	assert.equal(u.status, 0, u.stderr);
});

test("sync envelope pack uses team-hub profile when declared", () => {
	const dir = mkTarget("profile");
	fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(path.join(dir, "docs", "page.md"), "# Page\n");
	fs.writeFileSync(
		path.join(dir, ".amber", "profile.json"),
		JSON.stringify({ deploymentProfile: "team-hub" }),
	);
	const r = runCli(
		[
			"sync",
			"envelope",
			"pack",
			"--type",
			"context-page",
			"--artifact",
			"docs/page.md",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 0, r.stderr);
	const out = JSON.parse(r.stdout);
	const env = JSON.parse(out.text);
	assert.equal(env.origin.profile, "team-hub");
});

test("legacy sync (drift) still works", () => {
	const dir = mkTarget("legacy");
	const r = runCli(["sync", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = JSON.parse(r.stdout);
	assert.ok(out.text.includes("Target:"));
});

test("sync envelope with unknown subcommand errors", () => {
	const dir = mkTarget("unknownsub");
	const r = runCli(["sync", "envelope", "bogus", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
});
