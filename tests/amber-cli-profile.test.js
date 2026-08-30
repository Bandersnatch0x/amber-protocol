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

function cliPayload(r) {
	const outer = JSON.parse(r.stdout);
	// profile deployment subcommands nest their payload in outer.text
	return outer.text ? JSON.parse(outer.text) : outer;
}

function mkTarget(label) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-profile-${label}-`));
	execSync("git init", { cwd: dir, encoding: "utf8" });
	execSync('git config user.email "test@example.com"', { cwd: dir, encoding: "utf8" });
	execSync('git config user.name "Test User"', { cwd: dir, encoding: "utf8" });
	return dir;
}

test("profile deployment show defaults to personal-node on a fresh target", () => {
	const dir = mkTarget("show");
	const r = runCli(["profile", "deployment", "show", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = cliPayload(r);
	assert.equal(out.deploymentProfile, "personal-node");
	assert.equal(out.identity.tenantId, "local");
	assert.equal(out.identity.personId, "Test User <test@example.com>");
	assert.equal(out.source, "default");
	assert.equal(out.identitySource, "git-inference");
});

test("profile deployment set writes the profile file", () => {
	const dir = mkTarget("set");
	const r = runCli(
		["profile", "deployment", "set", "--profile", "team-hub", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 0, r.stderr);
	const raw = JSON.parse(fs.readFileSync(path.join(dir, ".amber", "profile.json"), "utf8"));
	assert.equal(raw.deploymentProfile, "team-hub");
});

test("profile deployment show reflects a set profile", () => {
	const dir = mkTarget("reflect");
	runCli(
		["profile", "deployment", "set", "--profile", "organization", "--target", dir, "--json"],
		dir,
	);
	const r = runCli(["profile", "deployment", "show", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = cliPayload(r);
	assert.equal(out.deploymentProfile, "organization");
	assert.equal(out.profileSource, "profile-file");
});

test("profile deployment set rejects an unknown profile", () => {
	const dir = mkTarget("badset");
	const r = runCli(
		["profile", "deployment", "set", "--profile", "bogus", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 1);
	const out = JSON.parse(r.stdout);
	assert.ok(out.errors.length > 0);
	assert.equal(fs.existsSync(path.join(dir, ".amber", "profile.json")), false);
});

test("profile deployment validate fails on an invalid profile file", () => {
	const dir = mkTarget("badval");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "profile.json"),
		JSON.stringify({ deploymentProfile: "nope" }),
	);
	const r = runCli(["profile", "deployment", "validate", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
	const out = cliPayload(r);
	assert.equal(out.valid, false);
});

test("profile deployment resolve returns the effective profile", () => {
	const dir = mkTarget("resolve");
	runCli(["profile", "deployment", "set", "--profile", "team-hub", "--target", dir, "--json"], dir);
	const r = runCli(["profile", "deployment", "resolve", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = cliPayload(r);
	assert.equal(out.deploymentProfile, "team-hub");
	assert.equal(out.source, "profile-file");
});

test("legacy profile inspect still works", () => {
	const dir = mkTarget("legacy");
	const r = runCli(["profile", "inspect", "--target", dir], dir);
	// inspect without --file errors → exit 1; deprecated but functional
	assert.equal(r.status, 1, r.stderr);
	assert.match(r.stdout + r.stderr, /No project profile file specified/);
});

// ── UNDOC-9 (#273): deprecation is scoped to the legacy actions ──

test("profile deployment carries no deprecation warning (supported surface)", () => {
	const dir = mkTarget("nodeprecation");
	const r = runCli(["profile", "deployment", "show", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const outer = JSON.parse(r.stdout);
	assert.ok(
		!(outer.warnings || []).some((w) => w.includes("DEPRECATED")),
		`deployment subcommand must not warn as deprecated: ${JSON.stringify(outer.warnings)}`,
	);
});

test("legacy profile inspect still warns as deprecated", () => {
	const dir = mkTarget("stilldeprecated");
	const r = runCli(["profile", "inspect", "--target", dir, "--json"], dir);
	const outer = JSON.parse(r.stdout);
	assert.ok(
		(outer.warnings || []).some((w) => w.includes("DEPRECATED")),
		`legacy action keeps the deprecation warning: ${JSON.stringify(outer.warnings)}`,
	);
});

test("profile deployment with unknown subcommand errors", () => {
	const dir = mkTarget("unknownsub");
	const r = runCli(["profile", "deployment", "bogus", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
});
