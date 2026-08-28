"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
	checkCompatibility,
	packEnvelope,
	unpackEnvelope,
	envelopeFromArtifact,
	validateEnvelope,
	resolveSyncArtifact,
	admitEnvelope,
	ARTIFACT_PATH_REGISTRY,
} = require("../../scripts/lib/core/sync-remote");
const { mkTarget } = require("../helpers/harness");
const {
	envelopeFixture,
	structuralMatrix,
	compatibilityMatrix,
} = require("../helpers/sync-envelope-fixtures");

const PAGE = ".amber/context/pages/note.json";

function writeArtifact(dir, relPath, content) {
	const full = path.join(dir, relPath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
	return relPath;
}

function trySymlink(target, linkPath, type = "file") {
	try {
		fs.symlinkSync(target, linkPath, type);
		return true;
	} catch (err) {
		if (err && (err.code === "EPERM" || err.code === "EACCES" || err.code === "ENOSYS")) {
			return false;
		}
		throw err;
	}
}

const validEnvelope = envelopeFixture;

// ── checkCompatibility ─────────────────────────────────────────

test("checkCompatibility accepts an envelope with a matching protocol version", () => {
	const envelope = {
		versionNegotiation: {
			amberProtocolVersion: "1.6.0",
			minCompatibleVersion: "1.0.0",
			capabilities: ["sync-envelope-v1"],
		},
	};
	const result = checkCompatibility(envelope, { version: "1.6.0" });
	assert.equal(result.compatible, true);
	assert.deepEqual(result.reasons, []);
});

test("checkCompatibility refuses an envelope whose minCompatibleVersion exceeds current", () => {
	const envelope = {
		versionNegotiation: {
			amberProtocolVersion: "2.0.0",
			minCompatibleVersion: "2.0.0",
			capabilities: ["sync-envelope-v2"],
		},
	};
	const result = checkCompatibility(envelope, { version: "1.6.0" });
	assert.equal(result.compatible, false);
	assert.ok(result.reasons.some((r) => r.includes("minCompatibleVersion")));
});

test("checkCompatibility refuses when a required capability is missing", () => {
	const envelope = {
		versionNegotiation: {
			amberProtocolVersion: "1.6.0",
			minCompatibleVersion: "1.0.0",
			capabilities: ["sync-envelope-v1", "some-required-capability"],
		},
	};
	const result = checkCompatibility(envelope, {
		version: "1.6.0",
		capabilities: ["sync-envelope-v1"],
	});
	assert.equal(result.compatible, false);
	assert.ok(result.reasons.some((r) => r.includes("some-required-capability")));
});

test("checkCompatibility refuses an envelope with no versionNegotiation", () => {
	const result = checkCompatibility({}, { version: "1.6.0" });
	assert.equal(result.compatible, false);
	assert.ok(result.reasons.some((r) => r.includes("versionNegotiation")));
});

test("checkCompatibility accepts when capabilities are satisfied", () => {
	const envelope = {
		versionNegotiation: {
			amberProtocolVersion: "1.6.0",
			minCompatibleVersion: "1.0.0",
			capabilities: ["sync-envelope-v1"],
		},
	};
	const result = checkCompatibility(envelope, {
		version: "1.6.0",
		capabilities: ["sync-envelope-v1", "extra"],
	});
	assert.equal(result.compatible, true);
});

// ── validateEnvelope ───────────────────────────────────────────

test("validateEnvelope accepts a well-formed envelope", () => {
	const result = validateEnvelope(validEnvelope());
	assert.equal(result.valid, true);
	assert.deepEqual(result.errors, []);
});

test("validateEnvelope rejects an envelope missing structuralIdentity", () => {
	const envelope = validEnvelope();
	delete envelope.structuralIdentity;
	const result = validateEnvelope(envelope);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((e) => e.includes("structuralIdentity")));
});

test("validateEnvelope rejects an envelope with invalid hash format", () => {
	const envelope = validEnvelope({ artifactRef: { path: "x", hash: "not-a-hash" } });
	const result = validateEnvelope(envelope);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((e) => e.includes("hash")));
});

// ── F035 S2: schema SSOT fixture matrix ────────────────────────
// The runtime validator must accept/reject exactly what the compiled
// schemas/sync-envelope.schema.json accepts/rejects (tests/helpers/
// sync-envelope-fixtures.js is the single shared matrix).

for (const { name, envelope, expectValid, errorPattern } of structuralMatrix()) {
	test(`validateEnvelope structural matrix: ${name}`, () => {
		const result = validateEnvelope(envelope);
		assert.equal(result.valid, expectValid, JSON.stringify(result.errors));
		if (!expectValid && errorPattern) {
			assert.ok(
				result.errors.some((e) => errorPattern.test(e)),
				`expected an error matching ${errorPattern}, got: ${result.errors.join("; ")}`,
			);
		}
	});
}

// ── F035 S2: protocol compatibility matrix ─────────────────────
// Both the producer's amberProtocolVersion and the declared
// minCompatibleVersion must be checked; unknown future producer majors and
// malformed versions fail closed instead of being silently interpreted.

for (const {
	name,
	versionNegotiation,
	localVersion,
	localCapabilities,
	expectCompatible,
	reasonPattern,
} of compatibilityMatrix()) {
	test(`checkCompatibility matrix: ${name}`, () => {
		const local = { version: localVersion };
		if (localCapabilities) local.capabilities = localCapabilities;
		const result = checkCompatibility({ versionNegotiation }, local);
		assert.equal(result.compatible, expectCompatible, JSON.stringify(result.reasons));
		if (!expectCompatible && reasonPattern) {
			assert.ok(
				result.reasons.some((r) => reasonPattern.test(r)),
				`expected a reason matching ${reasonPattern}, got: ${result.reasons.join("; ")}`,
			);
		}
	});
}

// ── envelopeFromArtifact ───────────────────────────────────────

test("envelopeFromArtifact creates an envelope with a content hash", () => {
	const dir = mkTarget("pack", { git: true });
	writeArtifact(dir, PAGE, "hello envelope");
	const env = envelopeFromArtifact(dir, "context-page", PAGE);
	assert.equal(env.artifactType, "context-page");
	assert.equal(env.artifactRef.path, PAGE);
	assert.match(env.artifactRef.hash, /^sha256:[0-9a-f]{64}$/);
	assert.equal(env.structuralIdentity.tenantId, "local");
	assert.match(env.envelopeId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	assert.ok(env.createdAt);
});

test("envelopeFromArtifact throws for a missing artifact", () => {
	const dir = mkTarget("missing", { git: true });
	assert.throws(
		() => envelopeFromArtifact(dir, "context-page", ".amber/context/pages/gone.json"),
		/not found/,
	);
	// A missing file at a non-canonical path is refused by admission, which
	// runs before any existence check.
	assert.throws(
		() => envelopeFromArtifact(dir, "context-page", "does-not-exist.md"),
		/must live at/,
	);
});

// ── packEnvelope / unpackEnvelope ─────────────────────────────

test("packEnvelope writes an envelope to .amber/sync/", () => {
	const dir = mkTarget("pack-write", { git: true });
	writeArtifact(dir, PAGE, "pack me");
	const packed = packEnvelope(dir, "context-page", PAGE);
	assert.equal(packed.errors.length, 0);
	const envPath = path.join(
		dir,
		".amber",
		"sync",
		"envelopes",
		`${packed.envelope.envelopeId}.json`,
	);
	assert.ok(fs.existsSync(envPath), "envelope file written");
	const raw = JSON.parse(fs.readFileSync(envPath, "utf8"));
	assert.equal(raw.artifactRef.path, PAGE);
});

test("unpackEnvelope validates a locally-present artifact with matching hash", () => {
	const dir = mkTarget("unpack", { git: true });
	const content = "artifact content 123";
	writeArtifact(dir, PAGE, content);
	const packed = packEnvelope(dir, "context-page", PAGE);

	// Envelope validates; artifact is already present via git transport with a matching hash.
	const unpacked = unpackEnvelope(dir, packed.envelope);
	assert.equal(unpacked.errors.length, 0);
	assert.equal(unpacked.artifactPath, PAGE);
	const written = fs.readFileSync(path.join(dir, PAGE), "utf8");
	assert.equal(written, content);
});

test("unpackEnvelope fails closed for an incompatible envelope", () => {
	const dir = mkTarget("incompat", { git: true });
	writeArtifact(dir, PAGE, "content");
	const packed = packEnvelope(dir, "context-page", PAGE);
	// Corrupt the version negotiation to require a newer protocol
	packed.envelope.versionNegotiation.minCompatibleVersion = "99.0.0";

	const unpacked = unpackEnvelope(dir, packed.envelope);
	assert.ok(unpacked.errors.length > 0);
	assert.ok(
		unpacked.errors.some(
			(e) => e.includes("compatib") || e.includes("Compatible") || e.includes("refus"),
		),
	);
});

test("unpackEnvelope refuses when the artifact hash does not match", () => {
	const dir = mkTarget("hash-mismatch", { git: true });
	writeArtifact(dir, PAGE, "original");
	const packed = packEnvelope(dir, "context-page", PAGE);
	// Corrupt the envelope hash
	packed.envelope.artifactRef.hash = "sha256:" + "b".repeat(64);

	const unpacked = unpackEnvelope(dir, packed.envelope);
	assert.ok(unpacked.errors.length > 0);
});

test("packEnvelope uses the deployment profile identity", () => {
	const dir = mkTarget("profile", { git: true });
	writeArtifact(dir, PAGE, "x");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "profile.json"),
		JSON.stringify({ deploymentProfile: "team-hub" }),
	);
	const packed = packEnvelope(dir, "context-page", PAGE);
	assert.equal(packed.envelope.origin.profile, "team-hub");
});

test("packEnvelope refuses an invalid deployment profile declaration", () => {
	const dir = mkTarget("profile-invalid", { git: true });
	writeArtifact(dir, PAGE, "x");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "profile.json"),
		JSON.stringify({ deploymentProfile: "bogus" }),
	);
	const packed = packEnvelope(dir, "context-page", PAGE);
	assert.equal(packed.envelope, null);
	assert.ok(packed.errors.some((e) => e.includes("invalid deployment profile declaration")));
});

test("packEnvelope refuses a malformed deployment profile file", () => {
	const dir = mkTarget("profile-malformed", { git: true });
	writeArtifact(dir, PAGE, "x");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".amber", "profile.json"), "{ bad json");
	const packed = packEnvelope(dir, "context-page", PAGE);
	assert.equal(packed.envelope, null);
	assert.ok(packed.errors.some((e) => e.includes("invalid deployment profile declaration")));
});

test("packEnvelope refuses a non-object deployment profile file", () => {
	const dir = mkTarget("profile-non-object", { git: true });
	writeArtifact(dir, PAGE, "x");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".amber", "profile.json"), JSON.stringify(["team-hub"]));
	const packed = packEnvelope(dir, "context-page", PAGE);
	assert.equal(packed.envelope, null);
	assert.ok(packed.errors.some((e) => e.includes("invalid deployment profile declaration")));
});

test("packEnvelope defaults origin.profile when no declaration exists", () => {
	const dir = mkTarget("profile-absent", { git: true });
	writeArtifact(dir, PAGE, "x");
	const packed = packEnvelope(dir, "context-page", PAGE);
	assert.equal(packed.errors.length, 0);
	assert.equal(packed.envelope.origin.profile, "personal-node");
});

// ── F035 S1: canonical artifact path and allowlist ────────────

test("ARTIFACT_PATH_REGISTRY covers every ARTIFACT_TYPES entry", () => {
	const { ARTIFACT_TYPES } = require("../../scripts/lib/core/sync-remote");
	for (const type of ARTIFACT_TYPES) {
		assert.ok(ARTIFACT_PATH_REGISTRY[type], `registry pattern missing for ${type}`);
	}
	for (const type of Object.keys(ARTIFACT_PATH_REGISTRY)) {
		assert.ok(ARTIFACT_TYPES.includes(type), `registry has unknown type ${type}`);
	}
});

test("resolveSyncArtifact returns the canonical repository-relative POSIX path", () => {
	const dir = mkTarget("resolve-ok", { git: true });
	writeArtifact(dir, PAGE, "{}");
	const resolved = resolveSyncArtifact(dir, "context-page", PAGE);
	assert.equal(resolved, PAGE);
});

test("resolveSyncArtifact rejects an unknown artifact type", () => {
	const dir = mkTarget("resolve-type", { git: true });
	assert.throws(() => resolveSyncArtifact(dir, "bogus-type", PAGE), /unknown artifact type/);
});

test("resolveSyncArtifact rejects empty and whitespace-only paths", () => {
	const dir = mkTarget("resolve-empty", { git: true });
	assert.throws(() => resolveSyncArtifact(dir, "context-page", ""), /required/);
	assert.throws(() => resolveSyncArtifact(dir, "context-page", "   "), /required/);
	assert.throws(() => resolveSyncArtifact(dir, "context-page", undefined), /required/);
});

test("resolveSyncArtifact rejects absolute paths", () => {
	const dir = mkTarget("resolve-abs", { git: true });
	writeArtifact(dir, PAGE, "{}");
	const abs = path.join(dir, PAGE);
	assert.throws(() => resolveSyncArtifact(dir, "context-page", abs), /absolute/);
	assert.throws(() => resolveSyncArtifact(dir, "context-page", "/etc/passwd"), /absolute/);
});

test("resolveSyncArtifact rejects the repository root", () => {
	const dir = mkTarget("resolve-root", { git: true });
	assert.throws(() => resolveSyncArtifact(dir, "context-page", "."), /root|outside/i);
});

test("resolveSyncArtifact rejects dot segments and non-POSIX separators", () => {
	const dir = mkTarget("resolve-dots", { git: true });
	writeArtifact(dir, PAGE, "{}");
	assert.throws(() => resolveSyncArtifact(dir, "context-page", `./${PAGE}`), /dot|canonical/i);
	assert.throws(
		() => resolveSyncArtifact(dir, "context-page", `.amber/./context/pages/note.json`),
		/dot|canonical/i,
	);
	assert.throws(
		() => resolveSyncArtifact(dir, "context-page", `${PAGE}/`),
		/trailing|dot|canonical/i,
	);
	assert.throws(
		() => resolveSyncArtifact(dir, "context-page", `.amber//context/pages/note.json`),
		/canonical|empty/i,
	);
	assert.throws(
		() => resolveSyncArtifact(dir, "context-page", `.amber\\context\\pages\\note.json`),
		/canonical|separator/i,
	);
});

test("resolveSyncArtifact rejects traversal that escapes the repository", () => {
	const dir = mkTarget("resolve-traversal", { git: true });
	assert.throws(
		() => resolveSyncArtifact(dir, "context-page", "../outside-secret.txt"),
		/outside the target root|outside the repository/i,
	);
	assert.throws(
		() => resolveSyncArtifact(dir, "context-page", ".amber/context/../../outside.txt"),
		/outside the target root|outside the repository/i,
	);
});

test("resolveSyncArtifact rejects directories and non-regular files", () => {
	const dir = mkTarget("resolve-dir", { git: true });
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages", "d.json"), { recursive: true });
	assert.throws(
		() => resolveSyncArtifact(dir, "context-page", ".amber/context/pages/d.json"),
		/director|regular file/i,
	);
});

test("resolveSyncArtifact rejects a valid type paired with an unrelated path", () => {
	const dir = mkTarget("resolve-mismatch", { git: true });
	writeArtifact(dir, "feature_list.json", "{}");
	writeArtifact(dir, "scripts/lib/core/x.js", "module.exports = {};\n");
	writeArtifact(dir, "package.json", "{}");
	writeArtifact(dir, ".env", "SECRET=1\n");
	writeArtifact(dir, "CLAUDE.md", "agent instructions\n");
	assert.throws(
		() => resolveSyncArtifact(dir, "context-page", "feature_list.json"),
		/must|canonical|match/i,
	);
	assert.throws(
		() => resolveSyncArtifact(dir, "context-page", "scripts/lib/core/x.js"),
		/must|canonical|match/i,
	);
	assert.throws(() => resolveSyncArtifact(dir, "route", "package.json"), /must|canonical|match/i);
	assert.throws(() => resolveSyncArtifact(dir, "route", ".env"), /must|canonical|match/i);
	assert.throws(
		() => resolveSyncArtifact(dir, "feature-list", "CLAUDE.md"),
		/must|canonical|match/i,
	);
});

test("resolveSyncArtifact rejects a path that escapes through an outside symlink", (t) => {
	const dir = mkTarget("resolve-symlink", { git: true });
	const outside = path.join(dir, "..", "outside-secret-resolve.txt");
	fs.writeFileSync(outside, "secret");
	const link = path.join(dir, ".amber", "context", "pages", "link.json");
	fs.mkdirSync(path.dirname(link), { recursive: true });
	if (!trySymlink(outside, link)) return t.skip("symlink creation not permitted on this platform");
	assert.throws(
		() => resolveSyncArtifact(dir, "context-page", ".amber/context/pages/link.json"),
		/outside the target root|outside the repository/i,
	);
});

test("resolveSyncArtifact rejects missing descendants beneath an outside symlinked directory", (t) => {
	const dir = mkTarget("resolve-symlink-dir", { git: true });
	const outsideDir = fs.mkdtempSync(path.join(dir, "..", "outside-dir-"));
	fs.writeFileSync(path.join(outsideDir, "real.json"), "{}");
	const linkDir = path.join(dir, ".amber", "context", "pages");
	fs.mkdirSync(path.dirname(linkDir), { recursive: true });
	const type = process.platform === "win32" ? "junction" : "dir";
	if (!trySymlink(outsideDir, linkDir, type)) {
		return t.skip("symlink creation not permitted on this platform");
	}
	assert.throws(
		() => resolveSyncArtifact(dir, "context-page", ".amber/context/pages/real.json"),
		/outside the target root|outside the repository/i,
	);
	assert.throws(
		() => resolveSyncArtifact(dir, "context-page", ".amber/context/pages/missing.json"),
		/outside the target root|outside the repository/i,
	);
});

test("packEnvelope refuses traversal that escapes the repository", () => {
	const dir = mkTarget("pack-traversal", { git: true });
	const outside = path.join(dir, "..", "outside-secret-pack.txt");
	fs.writeFileSync(outside, "secret");
	const packed = packEnvelope(dir, "context-page", "../outside-secret-pack.txt");
	assert.ok(packed.errors.length > 0, "must refuse to pack outside the repository");
	assert.equal(packed.envelope, null);
});

test("packEnvelope refuses a source file paired with a valid artifact type", () => {
	const dir = mkTarget("pack-source", { git: true });
	writeArtifact(dir, "scripts/lib/core/sync-remote.js", "module.exports = {};\n");
	const packed = packEnvelope(dir, "context-page", "scripts/lib/core/sync-remote.js");
	assert.ok(packed.errors.length > 0, "source files are never enveloped");
});

test("packEnvelope refuses dot-segment paths even when the target is canonical", () => {
	const dir = mkTarget("pack-dots", { git: true });
	writeArtifact(dir, PAGE, "{}");
	const packed = packEnvelope(dir, "context-page", `./${PAGE}`);
	assert.ok(packed.errors.length > 0, "dot-segment paths are not canonical");
});

test("packEnvelope refuses a directory in the artifact path family", () => {
	const dir = mkTarget("pack-dir", { git: true });
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages", "d.json"), { recursive: true });
	const packed = packEnvelope(dir, "context-page", ".amber/context/pages/d.json");
	assert.ok(packed.errors.length > 0, "directories are not artifacts");
});

test("packEnvelope packs every registered artifact type at its canonical path", () => {
	const dir = mkTarget("pack-all-types", { git: true });
	const cases = [
		["session-manifest", ".amber/sessions/01234567-89ab-cdef-0123-456789abcdef/manifest.json"],
		["timeline-event", ".amber/sessions/01234567-89ab-cdef-0123-456789abcdef/timeline.jsonl"],
		["feature-list", "feature_list.json"],
		["route", "routes/demo.route.json"],
		["loop-contract", "workflow-packs/demo.pack.json"],
		["context-page", ".amber/context/pages/p.json"],
		["context-request", ".amber/context/requests/r.json"],
		["knowledge-plan", "docs/wiki/knowledge-plan.json"],
		["workflow-assessment", "docs/workflow-assessment.md"],
		["memory-entry", ".amber/memory/registry/e.json"],
		["memory-request", ".amber/memory/requests/rq.json"],
		["governance-report", "docs/governance-report.md"],
	];
	for (const [type, relPath] of cases) {
		writeArtifact(dir, relPath, "{}\n");
		const packed = packEnvelope(dir, type, relPath);
		assert.deepEqual(packed.errors, [], `${type} must pack at ${relPath}`);
		assert.equal(packed.envelope.artifactType, type);
		assert.equal(packed.envelope.artifactRef.path, relPath);
	}
});

test("unpackEnvelope refuses an envelope whose artifact path escapes the repository", () => {
	const dir = mkTarget("unpack-outside", { git: true });
	const outside = path.join(dir, "..", "outside-secret-unpack.txt");
	fs.writeFileSync(outside, "secret");
	const { hashFile } = require("../../scripts/lib/core/sync-remote");
	const envelope = validEnvelope({
		artifactRef: { path: "../outside-secret-unpack.txt", hash: hashFile(outside) },
	});
	const unpacked = unpackEnvelope(dir, envelope);
	assert.ok(unpacked.errors.length > 0, "must refuse an outside artifact path");
	assert.equal(unpacked.artifactPath, null);
});

test("unpackEnvelope rejection never exposes or persists the outside file's hash", () => {
	const dir = mkTarget("unpack-leak", { git: true });
	const outside = path.join(dir, "..", "outside-secret-leak.txt");
	fs.writeFileSync(outside, "secret content for leak test");
	const { hashFile } = require("../../scripts/lib/core/sync-remote");
	const realHash = hashFile(outside);
	const envelope = validEnvelope({
		artifactRef: { path: "../outside-secret-leak.txt", hash: "sha256:" + "c".repeat(64) },
	});
	const unpacked = unpackEnvelope(dir, envelope);
	assert.ok(unpacked.errors.length > 0);
	const message = unpacked.errors.join("; ");
	assert.ok(!message.includes(realHash), "rejection must not leak the outside file's hash");
	const ledger = path.join(dir, ".amber", "sync", "conflicts.jsonl");
	assert.ok(!fs.existsSync(ledger) || !fs.readFileSync(ledger, "utf8").includes(realHash));
});

test("unpackEnvelope refuses a valid type paired with an unrelated path", () => {
	const dir = mkTarget("unpack-mismatch", { git: true });
	writeArtifact(dir, "feature_list.json", "{}");
	const { hashFile } = require("../../scripts/lib/core/sync-remote");
	// Real hash so only the type/path admission can reject this envelope.
	const envelope = validEnvelope({
		artifactType: "context-page",
		artifactRef: { path: "feature_list.json", hash: hashFile(path.join(dir, "feature_list.json")) },
	});
	const unpacked = unpackEnvelope(dir, envelope);
	assert.ok(unpacked.errors.length > 0, "type and canonical path family must both match");
	assert.equal(unpacked.artifactPath, null);
});

// ── F035 S3: structural identity admission ─────────────────────

const LOCAL_IDENTITY = {
	tenantId: "local",
	repositoryId: "local-repository",
	repositoryGeneration: 0,
};

test("admitEnvelope admits an envelope matching the local structural identity", () => {
	const dir = mkTarget("admit-ok", { git: true });
	writeArtifact(dir, PAGE, "content");
	const packed = packEnvelope(dir, "context-page", PAGE);

	const admission = admitEnvelope(dir, packed.envelope);
	assert.equal(admission.status, "admitted");
	assert.equal(admission.conflictType, null);
	assert.equal(admission.artifactPath, PAGE);
	assert.deepEqual(admission.errors, []);
});

test("admitEnvelope refuses a tenant mismatch as identity-mismatch before reading content", () => {
	const dir = mkTarget("admit-tenant", { git: true });
	writeArtifact(dir, PAGE, "content");
	// Wrong hash AND wrong tenant: only the identity-before-hash ordering can
	// surface identity-mismatch here.
	const envelope = validEnvelope({
		structuralIdentity: { ...LOCAL_IDENTITY, tenantId: "team-a" },
		artifactRef: { path: PAGE, hash: "sha256:" + "b".repeat(64) },
	});
	const admission = admitEnvelope(dir, envelope);
	assert.equal(admission.status, "refused");
	assert.equal(admission.conflictType, "identity-mismatch");
	assert.ok(admission.errors.some((e) => e.includes("tenant")));
});

test("admitEnvelope refuses a repository mismatch as identity-mismatch", () => {
	const dir = mkTarget("admit-repo", { git: true });
	writeArtifact(dir, PAGE, "content");
	const envelope = validEnvelope({
		structuralIdentity: { ...LOCAL_IDENTITY, repositoryId: "someone-elses-repo" },
	});
	const admission = admitEnvelope(dir, envelope);
	assert.equal(admission.status, "refused");
	assert.equal(admission.conflictType, "identity-mismatch");
	assert.ok(admission.errors.some((e) => e.includes("repository")));
});

test("admitEnvelope refuses a generation mismatch as generation-mismatch", () => {
	const dir = mkTarget("admit-gen", { git: true });
	writeArtifact(dir, PAGE, "content");
	const envelope = validEnvelope({
		structuralIdentity: { ...LOCAL_IDENTITY, repositoryGeneration: 5 },
	});
	const admission = admitEnvelope(dir, envelope);
	assert.equal(admission.status, "refused");
	assert.equal(admission.conflictType, "generation-mismatch");
	assert.ok(admission.errors.some((e) => e.includes("generation")));
});

test("admitEnvelope refuses incompatible protocol as version-mismatch", () => {
	const dir = mkTarget("admit-version", { git: true });
	writeArtifact(dir, PAGE, "content");
	const envelope = validEnvelope({
		structuralIdentity: { ...LOCAL_IDENTITY },
		versionNegotiation: {
			amberProtocolVersion: "1.6.0",
			minCompatibleVersion: "99.0.0",
			capabilities: ["sync-envelope-v1"],
		},
	});
	const admission = admitEnvelope(dir, envelope);
	assert.equal(admission.status, "refused");
	assert.equal(admission.conflictType, "version-mismatch");
});

test("admitEnvelope classifies a non-canonical path as invalid input, not a conflict", () => {
	const dir = mkTarget("admit-path", { git: true });
	writeArtifact(dir, "feature_list.json", "{}");
	const envelope = validEnvelope({
		structuralIdentity: { ...LOCAL_IDENTITY },
		artifactType: "context-page",
		artifactRef: { path: "feature_list.json", hash: "sha256:" + "a".repeat(64) },
	});
	const admission = admitEnvelope(dir, envelope);
	assert.equal(admission.status, "invalid");
	assert.equal(admission.conflictType, null);
	assert.equal(admission.artifactPath, null);
});

test("envelopeFromArtifact stamps the governed repositoryId, never the directory name", () => {
	const dir = mkTarget("repo-id", { git: true });
	writeArtifact(dir, PAGE, "content");
	const packed = packEnvelope(dir, "context-page", PAGE);
	assert.equal(packed.envelope.structuralIdentity.repositoryId, "local-repository");
	assert.notEqual(packed.envelope.structuralIdentity.repositoryId, path.basename(dir));
});

test("envelopeFromArtifact repositoryId is stable across clones of one remote", () => {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), "amber-admit-clones-"));
	const bare = path.join(base, "hub.git");
	spawnSync("git", ["init", "--bare", bare]);
	const ids = [];
	for (const name of ["clone-alpha", "clone-beta"]) {
		const dir = path.join(base, name);
		spawnSync("git", ["clone", bare, dir]);
		spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
		spawnSync("git", ["config", "user.name", "Test User"], { cwd: dir });
		writeArtifact(dir, PAGE, "same content");
		const packed = packEnvelope(dir, "context-page", PAGE);
		ids.push(packed.envelope.structuralIdentity.repositoryId);
	}
	assert.equal(ids[0], ids[1], "clones of one remote must stamp one repositoryId");
	assert.ok(!["clone-alpha", "clone-beta"].includes(ids[0]));
});

test("unpackEnvelope refuses a cross-tenant envelope", () => {
	const dir = mkTarget("unpack-tenant", { git: true });
	writeArtifact(dir, PAGE, "content");
	const { hashFile } = require("../../scripts/lib/core/sync-remote");
	const envelope = validEnvelope({
		structuralIdentity: { ...LOCAL_IDENTITY, tenantId: "team-a" },
		artifactRef: { path: PAGE, hash: hashFile(path.join(dir, PAGE)) },
	});
	const unpacked = unpackEnvelope(dir, envelope);
	assert.ok(unpacked.errors.some((e) => e.includes("tenant")));
	assert.equal(unpacked.artifactPath, null);
});
