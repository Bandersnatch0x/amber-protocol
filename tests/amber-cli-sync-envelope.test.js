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
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".amber", "context", "pages", "page.json"), "# Page\n");
	const r = runCli(
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
	assert.equal(r.status, 0, r.stderr);
	const out = JSON.parse(r.stdout);
	const env = JSON.parse(out.text);
	assert.equal(env.artifactType, "context-page");
	assert.equal(env.artifactRef.path, ".amber/context/pages/page.json");
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
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".amber", "context", "pages", "page.json"), "# Page\n");
	const r = runCli(
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
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".amber", "context", "pages", "page.json"), "# Page\n");
	const r = runCli(
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

test("sync envelope compat refuses a future producer version with a low minimum", () => {
	const dir = mkTarget("compfuture");
	const { envelopeFixture } = require("./helpers/sync-envelope-fixtures");
	const env = envelopeFixture({
		versionNegotiation: {
			amberProtocolVersion: "99.0.0",
			minCompatibleVersion: "1.0.0",
			capabilities: ["sync-envelope-v1"],
		},
	});
	const r = runCli(
		["sync", "envelope", "compat", "--envelope", JSON.stringify(env), "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 1, r.stdout);
	const out = JSON.parse(r.stdout);
	const payload = JSON.parse(out.text);
	assert.equal(payload.compatible, false);
	assert.ok(
		out.errors.some((e) => e.includes("amberProtocolVersion")),
		`expected a producer-version reason, got: ${out.errors.join("; ")}`,
	);
});

test("sync envelope validate refuses an envelope missing versionNegotiation", () => {
	const dir = mkTarget("validatemiss");
	const { envelopeFixture } = require("./helpers/sync-envelope-fixtures");
	const env = envelopeFixture();
	delete env.versionNegotiation;
	const r = runCli(
		["sync", "envelope", "validate", "--envelope", JSON.stringify(env), "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 1, r.stdout);
	const out = JSON.parse(r.stdout);
	const payload = JSON.parse(out.text);
	assert.equal(payload.valid, false);
	assert.ok(
		out.errors.some((e) => e.includes("versionNegotiation")),
		`expected a versionNegotiation error, got: ${out.errors.join("; ")}`,
	);
});

test("sync envelope unpack validates a matching local artifact", () => {
	const dir = mkTarget("unpack");
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".amber", "context", "pages", "page.json"), "# Page\n");
	const r = runCli(
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
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".amber", "context", "pages", "page.json"), "# Page\n");
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
			".amber/context/pages/page.json",
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

// ── F035 S1: canonical artifact path and allowlist ────────────

test("sync envelope pack refuses a traversal path outside the repository", () => {
	const dir = mkTarget("pack-traversal");
	const outside = path.join(dir, "..", "outside-secret-cli.txt");
	fs.writeFileSync(outside, "secret");
	const r = runCli(
		[
			"sync",
			"envelope",
			"pack",
			"--type",
			"context-page",
			"--artifact",
			"../outside-secret-cli.txt",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 1, "must refuse to pack outside the repository");
});

test("sync envelope pack refuses a source file with a valid artifact type", () => {
	const dir = mkTarget("pack-source");
	fs.mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
	fs.writeFileSync(path.join(dir, "scripts", "lib", "x.js"), "module.exports = {};\n");
	const r = runCli(
		[
			"sync",
			"envelope",
			"pack",
			"--type",
			"context-page",
			"--artifact",
			"scripts/lib/x.js",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 1, "source files are never enveloped");
});

test("sync envelope unpack refuses an envelope whose path escapes the repository", () => {
	const dir = mkTarget("unpack-outside");
	const outside = path.join(dir, "..", "outside-secret-unpack-cli.txt");
	fs.writeFileSync(outside, "secret");
	const { hashText } = require("../scripts/lib/core/context-hash");
	const realHash = hashText(fs.readFileSync(outside, "utf8"));
	const envelope = {
		schemaVersion: "1.0.0",
		envelopeId: "01234567-89ab-cdef-0123-456789abcdef",
		artifactType: "context-page",
		artifactRef: { path: "../outside-secret-unpack-cli.txt", hash: realHash },
		structuralIdentity: { tenantId: "local", repositoryId: "r", repositoryGeneration: 0 },
		origin: { profile: "personal-node" },
		createdAt: "2026-08-23T12:00:00Z",
		versionNegotiation: {
			amberProtocolVersion: "1.6.0",
			minCompatibleVersion: "1.0.0",
			capabilities: ["sync-envelope-v1"],
		},
	};
	const u = runCli(
		[
			"sync",
			"envelope",
			"unpack",
			"--envelope",
			JSON.stringify(envelope),
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(u.status, 1, "must refuse an outside artifact path");
	const out = JSON.parse(u.stdout);
	assert.ok(out.errors.length > 0);
	assert.ok(
		!out.errors.join("; ").includes(realHash),
		"rejection must not leak the outside file's hash",
	);
});

test("sync envelope with unknown subcommand errors", () => {
	const dir = mkTarget("unknownsub");
	const r = runCli(["sync", "envelope", "bogus", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
});
