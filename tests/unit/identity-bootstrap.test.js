"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");

const {
	resolveIdentity,
	inferFromGit,
	loadIdentityFile,
	defaultIdentity,
} = require("../../scripts/lib/core/identity");

function mkGitTarget(label) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-identity-${label}-`));
	execSync("git init", { cwd: dir, encoding: "utf8" });
	execSync('git config user.email "test@example.com"', { cwd: dir, encoding: "utf8" });
	execSync('git config user.name "Test User"', { cwd: dir, encoding: "utf8" });
	return dir;
}

function mkNoGitTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-identity-nogit-${label}-`));
}

// ── defaultIdentity ─────────────────────────────────────────────

test("defaultIdentity returns deterministic local defaults", () => {
	const id = defaultIdentity();
	assert.equal(id.tenantId, "local");
	assert.equal(id.organizationId, "personal");
	assert.equal(id.repositoryGeneration, 0);
	assert.equal(id.personId, null);
	assert.equal(id.agentId, null);
	assert.equal(id.source, "default");
});

test("defaultIdentity is stable across calls", () => {
	const a = defaultIdentity();
	const b = defaultIdentity();
	assert.deepEqual(a, b);
});

// ── inferFromGit ────────────────────────────────────────────────

test("inferFromGit returns null personId when git is unavailable", () => {
	const dir = mkNoGitTarget("nogit");
	const inferred = inferFromGit(dir);
	assert.equal(inferred.personId, null);
	assert.equal(inferred.agentId, null);
});

test("inferFromGit returns personId from git config in a git repo", () => {
	const dir = mkGitTarget("git");
	const inferred = inferFromGit(dir);
	assert.equal(inferred.personId, "Test User <test@example.com>");
	assert.equal(inferred.agentId, null);
});

test("inferFromGit returns null when git config is empty", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-identity-empty-"));
	execSync("git init", { cwd: dir, encoding: "utf8" });
	// Don't set user.name/email
	const inferred = inferFromGit(dir);
	assert.equal(inferred.personId, null);
});

// ── loadIdentityFile ────────────────────────────────────────────

test("loadIdentityFile returns null when .amber/identity.json does not exist", () => {
	const dir = mkNoGitTarget("nofile");
	const loaded = loadIdentityFile(dir);
	assert.equal(loaded, null);
});

test("loadIdentityFile returns parsed identity when .amber/identity.json exists", () => {
	const dir = mkNoGitTarget("hasfile");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "identity.json"),
		JSON.stringify({
			tenantId: "team-a",
			organizationId: "my-org",
			repositoryGeneration: 2,
			personId: "Explicit Person <explicit@example.com>",
		}),
	);
	const loaded = loadIdentityFile(dir);
	assert.equal(loaded.tenantId, "team-a");
	assert.equal(loaded.organizationId, "my-org");
	assert.equal(loaded.repositoryGeneration, 2);
	assert.equal(loaded.personId, "Explicit Person <explicit@example.com>");
});

test("loadIdentityFile returns null for malformed JSON", () => {
	const dir = mkNoGitTarget("badjson");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".amber", "identity.json"), "{ not valid json");
	const loaded = loadIdentityFile(dir);
	assert.equal(loaded, null);
});

// ── resolveIdentity (hybrid) ───────────────────────────────────

test("resolveIdentity uses git inference for personId when no identity file", () => {
	const dir = mkGitTarget("hybrid-git");
	const id = resolveIdentity(dir);
	assert.equal(id.personId, "Test User <test@example.com>");
	assert.equal(id.tenantId, "local");
	assert.equal(id.organizationId, "personal");
	assert.equal(id.repositoryGeneration, 0);
	assert.equal(id.source, "git-inference");
});

test("resolveIdentity uses defaults when no git and no identity file", () => {
	const dir = mkNoGitTarget("hybrid-default");
	const id = resolveIdentity(dir);
	assert.equal(id.personId, null);
	assert.equal(id.tenantId, "local");
	assert.equal(id.organizationId, "personal");
	assert.equal(id.source, "default");
});

test("resolveIdentity: identity file overrides git inference for personId", () => {
	const dir = mkGitTarget("hybrid-override");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "identity.json"),
		JSON.stringify({
			tenantId: "team-a",
			organizationId: "my-org",
			personId: "Override Person <override@example.com>",
		}),
	);
	const id = resolveIdentity(dir);
	assert.equal(id.personId, "Override Person <override@example.com>");
	assert.equal(id.tenantId, "team-a");
	assert.equal(id.organizationId, "my-org");
	assert.equal(id.repositoryGeneration, 0);
	assert.equal(id.source, "identity-file");
});

test("resolveIdentity: identity file overrides tenantId and organizationId but keeps git personId", () => {
	const dir = mkGitTarget("hybrid-partial");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "identity.json"),
		JSON.stringify({
			tenantId: "production",
			organizationId: "enterprise",
		}),
	);
	const id = resolveIdentity(dir);
	// personId from git (not in identity file)
	assert.equal(id.personId, "Test User <test@example.com>");
	// tenantId/org from identity file
	assert.equal(id.tenantId, "production");
	assert.equal(id.organizationId, "enterprise");
	assert.equal(id.source, "identity-file+git");
});

test("resolveIdentity: identity file with agentId is preserved", () => {
	const dir = mkNoGitTarget("hybrid-agent");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "identity.json"),
		JSON.stringify({
			agentId: "claude-code-instance-1",
		}),
	);
	const id = resolveIdentity(dir);
	assert.equal(id.agentId, "claude-code-instance-1");
	assert.equal(id.tenantId, "local");
	assert.equal(id.source, "identity-file");
});

test("resolveIdentity: identity file with repositoryGeneration is preserved", () => {
	const dir = mkNoGitTarget("hybrid-gen");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "identity.json"),
		JSON.stringify({
			repositoryGeneration: 5,
		}),
	);
	const id = resolveIdentity(dir);
	assert.equal(id.repositoryGeneration, 5);
});

test("resolveIdentity returns a serializable object with all fields", () => {
	const dir = mkGitTarget("hybrid-fields");
	const id = resolveIdentity(dir);
	const keys = Object.keys(id).sort();
	assert.deepEqual(keys, [
		"agentId",
		"organizationId",
		"personId",
		"repositoryGeneration",
		"source",
		"tenantId",
	]);
});

test("resolveIdentity source is one of: default, git-inference, identity-file, identity-file+git", () => {
	const dir = mkNoGitTarget("source-check");
	const id = resolveIdentity(dir);
	assert.ok(["default", "git-inference", "identity-file", "identity-file+git"].includes(id.source));
});
