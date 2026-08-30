"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	DEPLOYMENT_PROFILES,
	DEFAULT_PROFILE,
	PROFILE_SOURCE_DEFAULT,
	PROFILE_SOURCE_FILE,
	isInvalidDeclaration,
	hasDeclaredValidProfile,
	readProfileFile,
	writeProfileFile,
	resolveDeploymentProfile,
	validateDeploymentProfile,
	showDeploymentProfile,
} = require("../../scripts/lib/core/deployment-profile");
const { mkTarget } = require("../helpers/harness");

const PROFILE_FILE = ".amber/profile.json";

// ── Constants ──────────────────────────────────────────────────

test("DEPLOYMENT_PROFILES enumerates the three profiles", () => {
	assert.deepEqual([...DEPLOYMENT_PROFILES].sort(), ["organization", "personal-node", "team-hub"]);
});

test("DEFAULT_PROFILE is personal-node (offline-first)", () => {
	assert.equal(DEFAULT_PROFILE, "personal-node");
});

// ── readProfileFile ────────────────────────────────────────────

test("readProfileFile returns default when .amber/profile.json absent", () => {
	const dir = mkTarget("absent");
	const profile = readProfileFile(dir);
	assert.equal(profile.deploymentProfile, DEFAULT_PROFILE);
	assert.equal(profile.source, "default");
});

test("readProfileFile returns parsed profile when present", () => {
	const dir = mkTarget("present", { profile: { deploymentProfile: "team-hub" } });
	const profile = readProfileFile(dir);
	assert.equal(profile.deploymentProfile, "team-hub");
	assert.equal(profile.source, "profile-file");
});

test("readProfileFile fails closed on malformed JSON", () => {
	const dir = mkTarget("malformed");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(path.join(dir, PROFILE_FILE), "{ bad json");
	const profile = readProfileFile(dir);
	assert.equal(profile.deploymentProfile, null);
	assert.equal(profile.source, "profile-file");
	assert.ok(profile.errors.some((e) => e.includes("not valid JSON")));
});

test("readProfileFile fails closed on non-object JSON", () => {
	const dir = mkTarget("non-object");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(path.join(dir, PROFILE_FILE), JSON.stringify(["personal-node"]));
	const profile = readProfileFile(dir);
	assert.equal(profile.deploymentProfile, null);
	assert.equal(profile.source, "profile-file");
	assert.ok(profile.errors.some((e) => e.includes("expected a JSON object")));
});

test("validateDeploymentProfile fails for malformed JSON", () => {
	const dir = mkTarget("validate-malformed");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(path.join(dir, PROFILE_FILE), "{ bad json");
	const result = validateDeploymentProfile(dir);
	assert.equal(result.valid, false);
	assert.equal(result.deploymentProfile, null);
});

test("validateDeploymentProfile fails for non-object JSON", () => {
	const dir = mkTarget("validate-non-object");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(path.join(dir, PROFILE_FILE), JSON.stringify(["personal-node"]));
	const result = validateDeploymentProfile(dir);
	assert.equal(result.valid, false);
	assert.equal(result.deploymentProfile, null);
});

test("validateDeploymentProfile passes for an absent declaration (default)", () => {
	const dir = mkTarget("validate-absent");
	const result = validateDeploymentProfile(dir);
	assert.equal(result.valid, true);
	assert.equal(result.deploymentProfile, DEFAULT_PROFILE);
});

test("readProfileFile rejects an unknown deployment profile", () => {
	const dir = mkTarget("unknown", { profile: { deploymentProfile: "bogus" } });
	const profile = readProfileFile(dir);
	assert.equal(profile.deploymentProfile, null);
	assert.ok(profile.errors.some((e) => e.includes("bogus")));
});

// ── writeProfileFile ───────────────────────────────────────────

test("writeProfileFile persists a valid profile", () => {
	const dir = mkTarget("write");
	const result = writeProfileFile(dir, "team-hub");
	assert.equal(result.errors.length, 0);
	const raw = JSON.parse(fs.readFileSync(path.join(dir, PROFILE_FILE), "utf8"));
	assert.equal(raw.deploymentProfile, "team-hub");
});

test("writeProfileFile rejects an invalid profile", () => {
	const dir = mkTarget("badwrite");
	const result = writeProfileFile(dir, "not-a-profile");
	assert.ok(result.errors.length > 0);
	assert.equal(fs.existsSync(path.join(dir, PROFILE_FILE)), false);
});

// ── resolveDeploymentProfile ───────────────────────────────────

test("resolveDeploymentProfile defaults to personal-node", () => {
	const dir = mkTarget("resolve-default");
	const resolved = resolveDeploymentProfile(dir);
	assert.equal(resolved.deploymentProfile, "personal-node");
});

test("resolveDeploymentProfile honors the profile file", () => {
	const dir = mkTarget("resolve-set", { profile: { deploymentProfile: "organization" } });
	const resolved = resolveDeploymentProfile(dir);
	assert.equal(resolved.deploymentProfile, "organization");
});

// ── validateDeploymentProfile ──────────────────────────────────

test("validateDeploymentProfile passes for a known profile", () => {
	const dir = mkTarget("validate-ok", { profile: { deploymentProfile: "team-hub" } });
	const result = validateDeploymentProfile(dir);
	assert.equal(result.valid, true);
	assert.equal(result.deploymentProfile, "team-hub");
});

test("validateDeploymentProfile fails for an unknown profile", () => {
	const dir = mkTarget("validate-bad", { profile: { deploymentProfile: "nope" } });
	const result = validateDeploymentProfile(dir);
	assert.equal(result.valid, false);
});

// ── showDeploymentProfile ──────────────────────────────────────

test("showDeploymentProfile returns profile + identity + source", () => {
	const dir = mkTarget("show");
	const shown = showDeploymentProfile(dir);
	assert.equal(shown.deploymentProfile, "personal-node");
	assert.ok(shown.identity, "identity must be present");
	assert.equal(shown.identity.tenantId, "local");
	assert.equal(shown.identity.organizationId, "personal");
	assert.equal(shown.source, "default");
	assert.equal(shown.profileSource, "default");
});

test("showDeploymentProfile reflects the profile file and git identity", () => {
	const dir = mkTarget("show-set", { git: true, profile: { deploymentProfile: "team-hub" } });
	const shown = showDeploymentProfile(dir);
	assert.equal(shown.deploymentProfile, "team-hub");
	assert.equal(shown.identity.personId, "Test User <test@example.com>");
	assert.equal(shown.profileSource, "profile-file");
	assert.equal(shown.identitySource, "git-inference");
});

test("showDeploymentProfile fails closed on invalid profile file", () => {
	const dir = mkTarget("show-invalid", { profile: { deploymentProfile: "bogus" } });
	const shown = showDeploymentProfile(dir);
	assert.equal(shown.deploymentProfile, null);
	assert.ok(shown.errors.length > 0);
});

// ── Shared predicates and source constants (#273 S1-S3) ───────

test("source constants match the strings readProfileFile emits", () => {
	assert.equal(PROFILE_SOURCE_DEFAULT, "default");
	assert.equal(PROFILE_SOURCE_FILE, "profile-file");
	const absent = readProfileFile(mkTarget("const-absent"));
	assert.equal(absent.source, PROFILE_SOURCE_DEFAULT);
	const declared = readProfileFile(
		mkTarget("const-declared", { profile: { deploymentProfile: "team-hub" } }),
	);
	assert.equal(declared.source, PROFILE_SOURCE_FILE);
});

test("isInvalidDeclaration is false for the absent default and any valid declaration", () => {
	assert.equal(isInvalidDeclaration(readProfileFile(mkTarget("pred-absent"))), false);
	for (const declared of DEPLOYMENT_PROFILES) {
		const dir = mkTarget(`pred-valid-${declared}`, { profile: { deploymentProfile: declared } });
		assert.equal(isInvalidDeclaration(readProfileFile(dir)), false);
	}
});

test("isInvalidDeclaration is true for malformed, non-object, and unknown-value declarations", () => {
	const malformed = mkTarget("pred-malformed");
	fs.mkdirSync(path.join(malformed, ".amber"), { recursive: true });
	fs.writeFileSync(path.join(malformed, PROFILE_FILE), "{ bad json");
	assert.equal(isInvalidDeclaration(readProfileFile(malformed)), true);

	const nonObject = mkTarget("pred-non-object");
	fs.mkdirSync(path.join(nonObject, ".amber"), { recursive: true });
	fs.writeFileSync(path.join(nonObject, PROFILE_FILE), JSON.stringify(["personal-node"]));
	assert.equal(isInvalidDeclaration(readProfileFile(nonObject)), true);

	const unknown = mkTarget("pred-unknown", { profile: { deploymentProfile: "bogus" } });
	assert.equal(isInvalidDeclaration(readProfileFile(unknown)), true);
});

test("hasDeclaredValidProfile requires a declaration — the absent default does not satisfy it", () => {
	assert.equal(hasDeclaredValidProfile(mkTarget("declared-absent")), false);
});

test("hasDeclaredValidProfile accepts every enum-valid declared profile", () => {
	for (const declared of DEPLOYMENT_PROFILES) {
		const dir = mkTarget(`declared-${declared}`, { profile: { deploymentProfile: declared } });
		assert.equal(hasDeclaredValidProfile(dir), true, `must accept ${declared}`);
	}
});

test("hasDeclaredValidProfile rejects malformed, non-object, and unknown declarations", () => {
	const malformed = mkTarget("declared-malformed");
	fs.mkdirSync(path.join(malformed, ".amber"), { recursive: true });
	fs.writeFileSync(path.join(malformed, PROFILE_FILE), "{ bad json");
	assert.equal(hasDeclaredValidProfile(malformed), false);

	const nonObject = mkTarget("declared-non-object");
	fs.mkdirSync(path.join(nonObject, ".amber"), { recursive: true });
	fs.writeFileSync(path.join(nonObject, PROFILE_FILE), JSON.stringify(["personal-node"]));
	assert.equal(hasDeclaredValidProfile(nonObject), false);

	const unknown = mkTarget("declared-unknown", { profile: { deploymentProfile: "bogus" } });
	assert.equal(hasDeclaredValidProfile(unknown), false);
});
