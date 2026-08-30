"use strict";

/**
 * Sync Runtime envelope transport (#158 Stage 3, Team Hub).
 *
 * Implements the ADR-0019 D1 transport decision: file envelopes carried by
 * git. The Sync Runtime packs governed artifacts into immutable envelopes
 * (schemas/sync-envelope.schema.json), validates them on receipt, negotiates
 * version/capability compatibility, and refuses incompatible envelopes.
 *
 * Envelopes never carry source code, secrets, agents, tools, or arbitrary
 * files (baseline authority boundary 6; #158 user stories 19-20).
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { hashText } = require("./context-hash");
const { resolveIdentity } = require("./identity");
const { resolveDeploymentProfile, isInvalidDeclaration } = require("./deployment-profile");
const { resolvePathWithin, toPortablePath } = require("./fs-utils");
const { validateSyncEnvelope } = require("./sync-envelope-contract");
const { statePathForCreate } = require("../state-dir-resolver");

const ENVELOPE_SCHEMA_VERSION = "1.0.0";
const SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const LOCAL_CAPABILITIES = Object.freeze(["sync-envelope-v1", "structural-identity-v1"]);

const ARTIFACT_TYPES = Object.freeze([
	"session-manifest",
	"timeline-event",
	"feature-list",
	"route",
	"loop-contract",
	"context-page",
	"context-request",
	"knowledge-plan",
	"workflow-assessment",
	"memory-entry",
	"memory-request",
	"governance-report",
]);

// Canonical artifact home per type (F035 S1). Artifact type is not authority by
// itself: every type maps to one repository-owned path family, and a valid
// type paired with an unrelated path (source, package, credential, secret,
// agent, tool files) is refused. Patterns are matched against the canonical
// repository-relative POSIX form before any existence check, read, or hash.
const ARTIFACT_PATH_REGISTRY = Object.freeze({
	"session-manifest": {
		pattern: /^\.amber\/sessions\/[^/]+\/manifest\.json$/,
		family: ".amber/sessions/<sessionId>/manifest.json",
	},
	"timeline-event": {
		pattern: /^\.amber\/sessions\/[^/]+\/timeline\.jsonl$/,
		family: ".amber/sessions/<sessionId>/timeline.jsonl",
	},
	"feature-list": { pattern: /^feature_list\.json$/, family: "feature_list.json" },
	route: { pattern: /^routes\/[^/]+\.route\.json$/, family: "routes/<name>.route.json" },
	"loop-contract": {
		pattern: /^workflow-packs\/[^/]+\.pack\.json$/,
		family: "workflow-packs/<name>.pack.json",
	},
	"context-page": {
		pattern: /^\.amber\/context\/pages\/[^/]+\.json$/,
		family: ".amber/context/pages/<pageId>.json",
	},
	"context-request": {
		pattern: /^\.amber\/context\/requests\/[^/]+\.json$/,
		family: ".amber/context/requests/<requestId>.json",
	},
	"knowledge-plan": {
		pattern: /^docs\/wiki\/knowledge-plan\.(json|yaml)$/,
		family: "docs/wiki/knowledge-plan.json (or .yaml)",
	},
	"workflow-assessment": {
		pattern: /^docs\/workflow-assessment\.(md|json)$/,
		family: "docs/workflow-assessment.md (or .json)",
	},
	"memory-entry": {
		pattern: /^\.amber\/memory\/registry\/[^/]+\.json$/,
		family: ".amber/memory/registry/<entryId>.json",
	},
	"memory-request": {
		pattern: /^\.amber\/memory\/requests\/[^/]+\.json$/,
		family: ".amber/memory/requests/<requestId>.json",
	},
	"governance-report": {
		pattern: /^docs\/governance-report\.(md|json)$/,
		family: "docs/governance-report.md (or .json)",
	},
});

/**
 * Resolve an enveloped artifact path to its canonical repository-relative POSIX
 * form (F035 S1 admission primitive). Rejects, in order, before any content
 * read, hash, or ledger write: unknown types; empty paths; absolute paths;
 * dot/empty segments and non-POSIX separators; paths outside the artifact
 * type's canonical family; paths that escape the repository lexically or
 * through a symlink/realpath transition; directories and non-regular files.
 * @param {string} cwd - Repository root.
 * @param {string} artifactType - One of ARTIFACT_TYPES.
 * @param {string} artifactPath - Repository-relative artifact path.
 * @returns {string} Canonical repository-relative POSIX path.
 * @throws {Error} With a deterministic, user-facing message on rejection.
 */
function resolveSyncArtifact(cwd, artifactType, artifactPath) {
	const registryEntry = ARTIFACT_PATH_REGISTRY[artifactType];
	if (!registryEntry) {
		throw new Error(`unknown artifact type "${artifactType}"`);
	}
	if (typeof artifactPath !== "string" || artifactPath.trim() === "") {
		throw new Error("artifact path is required");
	}
	if (artifactPath === "." || artifactPath === "..") {
		throw new Error(
			`artifact path must name a file inside the repository, not the repository root: ${artifactPath}`,
		);
	}
	if (path.isAbsolute(artifactPath)) {
		throw new Error(`artifact path must be repository-relative, not absolute: ${artifactPath}`);
	}
	if (artifactPath.includes("\\")) {
		throw new Error(`artifact path must use POSIX separators, not backslashes: ${artifactPath}`);
	}
	const segments = artifactPath.split("/");
	const sawEmpty = segments.includes("");
	const sawDot = segments.includes(".");
	const sawParent = segments.includes("..");
	if (sawParent) {
		throw new Error(
			`artifact path must not contain ".." segments (outside the repository): ${artifactPath}`,
		);
	}
	if (sawEmpty) {
		throw new Error(
			`artifact path must not contain empty segments (double or trailing separators): ${artifactPath}`,
		);
	}
	if (sawDot) {
		throw new Error(`artifact path must not contain dot segments: ${artifactPath}`);
	}
	if (!registryEntry.pattern.test(artifactPath)) {
		throw new Error(
			`artifactType "${artifactType}" artifacts must live at ${registryEntry.family}: ${artifactPath}`,
		);
	}
	const resolved = resolvePathWithin(cwd, artifactPath, { label: "artifact path" });
	let stat = null;
	try {
		stat = fs.statSync(resolved);
	} catch (error) {
		if (error && error.code !== "ENOENT") throw error;
	}
	if (stat && !stat.isFile()) {
		throw new Error(`artifact path is not a regular file: ${artifactPath}`);
	}
	return toPortablePath(path.relative(path.resolve(cwd), resolved));
}

/**
 * Compute the sha256: content hash of a file.
 * @param {string} filePath - Absolute path.
 * @returns {string} "sha256:<64 hex>"
 */
function hashFile(filePath) {
	// content hashing lives in context-hash (single home); reading as utf8
	// yields the same bytes, so the digest is identical to the old raw read
	return hashText(fs.readFileSync(filePath, "utf8"));
}

/**
 * Check envelope version/capability compatibility against the local install.
 * Fails closed: a malformed version, an unknown future producer major, a
 * minimum above the local version, or a missing local capability all refuse
 * the envelope (ADR-0012 §C).
 * @param {object} envelope - The envelope to check.
 * @param {{version?: string, capabilities?: string[]}} [local] - Local install metadata.
 * @returns {{compatible: boolean, reasons: string[]}}
 */
function checkCompatibility(envelope, local = {}) {
	const neg = envelope && envelope.versionNegotiation;
	if (!neg || typeof neg !== "object") {
		return { compatible: false, reasons: ["envelope has no versionNegotiation block"] };
	}
	const reasons = [];
	const producer = neg.amberProtocolVersion;
	const minCompat = neg.minCompatibleVersion;
	const producerOk = typeof producer === "string" && SEMVER_PATTERN.test(producer);
	const minCompatOk = typeof minCompat === "string" && SEMVER_PATTERN.test(minCompat);
	if (!producerOk) {
		reasons.push(`envelope declares malformed amberProtocolVersion ${JSON.stringify(producer)}`);
	}
	if (!minCompatOk) {
		reasons.push(`envelope declares malformed minCompatibleVersion ${JSON.stringify(minCompat)}`);
	}
	if (producerOk && minCompatOk) {
		const localVersion =
			local.version || require(path.join(__dirname, "..", "..", "..", "package.json")).version;
		if (majorVersion(producer) > majorVersion(localVersion)) {
			reasons.push(
				`envelope producer amberProtocolVersion ${producer} is a newer major than local ${localVersion}; unknown future protocol semantics are refused`,
			);
		}
		if (compareVersions(localVersion, minCompat) < 0) {
			reasons.push(
				`envelope requires minCompatibleVersion ${minCompat}; local is ${localVersion} (silent downgrade refused)`,
			);
		}
	}
	const localCaps = new Set(local.capabilities || LOCAL_CAPABILITIES);
	if (Array.isArray(neg.capabilities)) {
		for (const cap of neg.capabilities) {
			if (!localCaps.has(cap)) {
				reasons.push(`envelope requires capability ${cap} which this install lacks`);
			}
		}
	}
	return { compatible: reasons.length === 0, reasons };
}

/**
 * Major component of a strict x.y.z version.
 * @param {string} v - Version string.
 * @returns {number}
 */
function majorVersion(v) {
	return parseInt(v.split(".")[0], 10);
}

/**
 * Simple semver-ish comparison. Returns <0, 0, >0. Both inputs must already
 * match SEMVER_PATTERN.
 * @param {string} a - Version a.
 * @param {string} b - Version b.
 * @returns {number}
 */
function compareVersions(a, b) {
	const pa = String(a)
		.split(".")
		.map((n) => parseInt(n, 10) || 0);
	const pb = String(b)
		.split(".")
		.map((n) => parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
		const va = pa[i] || 0;
		const vb = pb[i] || 0;
		if (va !== vb) return va - vb;
	}
	return 0;
}

/**
 * Validate an envelope against the sync-envelope contract.
 * Delegates to the compiled schemas/sync-envelope.schema.json via the cached
 * AJV adapter (scripts/lib/core/sync-envelope-contract.js) — the schema is
 * the single source of structural truth.
 * @param {object} envelope - The envelope to validate.
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateEnvelope(envelope) {
	return validateSyncEnvelope(envelope);
}

/**
 * Build an envelope from a local artifact.
 * @param {string} cwd - Repository root.
 * @param {string} artifactType - One of ARTIFACT_TYPES.
 * @param {string} relPath - Repository-relative path to the artifact.
 * @returns {object} The envelope.
 * @throws {Error} When the artifact is missing, the type is unknown, the
 *   path is not canonical for the type (see resolveSyncArtifact), or the
 *   deployment profile declaration is invalid.
 */
function envelopeFromArtifact(cwd, artifactType, relPath) {
	const canonicalPath = resolveSyncArtifact(cwd, artifactType, relPath);
	const absPath = path.join(cwd, canonicalPath);
	if (!fs.existsSync(absPath)) {
		throw new Error(`artifact not found: ${canonicalPath}`);
	}
	const identity = resolveIdentity(cwd);
	const profile = resolveDeploymentProfile(cwd);
	if (isInvalidDeclaration(profile)) {
		throw new Error(`invalid deployment profile declaration: ${profile.errors.join("; ")}`);
	}
	const hash = hashFile(absPath);
	return {
		schemaVersion: ENVELOPE_SCHEMA_VERSION,
		envelopeId: crypto.randomUUID(),
		artifactType,
		artifactRef: { path: canonicalPath, hash },
		structuralIdentity: {
			tenantId: identity.tenantId,
			repositoryId: identity.repositoryId,
			repositoryGeneration: identity.repositoryGeneration,
		},
		origin: {
			profile: profile.deploymentProfile,
			personId: identity.personId || undefined,
			agentId: identity.agentId || undefined,
		},
		createdAt: new Date().toISOString(),
		versionNegotiation: {
			amberProtocolVersion: require(path.join(__dirname, "..", "..", "..", "package.json")).version,
			minCompatibleVersion: "1.0.0",
			capabilities: [...LOCAL_CAPABILITIES],
		},
	};
}

/**
 * Pack an artifact into an envelope and write it to .amber/sync/envelopes/.
 * @param {string} cwd - Repository root.
 * @param {string} artifactType - One of ARTIFACT_TYPES.
 * @param {string} relPath - Repository-relative artifact path.
 * @returns {{envelope: object, errors: string[]}}
 */
function packEnvelope(cwd, artifactType, relPath) {
	try {
		const envelope = envelopeFromArtifact(cwd, artifactType, relPath);
		// Sync envelopes are a post-rename state kind (ADR-0019, #158 Stage 3):
		// they never existed under .harness, so the create policy (always
		// .amber) is correct for both fresh writes and re-packs.
		const dir = statePathForCreate(cwd, "sync", "envelopes");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, `${envelope.envelopeId}.json`),
			JSON.stringify(envelope, null, 2) + "\n",
		);
		return { envelope, errors: [] };
	} catch (err) {
		return { envelope: null, errors: [err.message] };
	}
}

/**
 * The one envelope admission pipeline (F035). Fixed order:
 * schema → artifact path/type → protocol → tenant → repository →
 * generation → content hash. Identity is compared BEFORE any artifact
 * content is read. Every semantic refusal carries its conflict type; only
 * path/type/schema violations are invalid input (never a semantic conflict).
 * @param {string} cwd - Repository root.
 * @param {object} envelope - The envelope to admit.
 * @returns {{status: "admitted"|"refused"|"invalid", conflictType: string|null, artifactPath: string|null, errors: string[]}}
 */
function admitEnvelope(cwd, envelope) {
	const validation = validateEnvelope(envelope);
	if (!validation.valid) {
		return { status: "invalid", conflictType: null, artifactPath: null, errors: validation.errors };
	}
	let canonicalPath;
	try {
		canonicalPath = resolveSyncArtifact(cwd, envelope.artifactType, envelope.artifactRef.path);
	} catch (err) {
		return { status: "invalid", conflictType: null, artifactPath: null, errors: [err.message] };
	}
	const compat = checkCompatibility(envelope);
	if (!compat.compatible) {
		return {
			status: "refused",
			conflictType: "version-mismatch",
			artifactPath: canonicalPath,
			errors: compat.reasons,
		};
	}
	const identity = resolveIdentity(cwd);
	const incoming = envelope.structuralIdentity;
	if (incoming.tenantId !== identity.tenantId) {
		return {
			status: "refused",
			conflictType: "identity-mismatch",
			artifactPath: canonicalPath,
			errors: [
				`envelope tenant "${incoming.tenantId}" does not match local tenant "${identity.tenantId}"`,
			],
		};
	}
	if (incoming.repositoryId !== identity.repositoryId) {
		return {
			status: "refused",
			conflictType: "identity-mismatch",
			artifactPath: canonicalPath,
			errors: [
				`envelope repository "${incoming.repositoryId}" does not match local repository "${identity.repositoryId}"`,
			],
		};
	}
	if (incoming.repositoryGeneration !== identity.repositoryGeneration) {
		return {
			status: "refused",
			conflictType: "generation-mismatch",
			artifactPath: canonicalPath,
			errors: [
				`envelope generation ${incoming.repositoryGeneration} does not match local generation ${identity.repositoryGeneration}`,
			],
		};
	}
	const absPath = path.join(cwd, canonicalPath);
	if (fs.existsSync(absPath)) {
		const localHash = hashFile(absPath);
		if (localHash !== envelope.artifactRef.hash) {
			return {
				status: "refused",
				conflictType: "concurrent-edit",
				artifactPath: canonicalPath,
				errors: [
					`local hash ${localHash} differs from envelope ${envelope.artifactRef.hash}; local artifact preserved`,
				],
			};
		}
	}
	return { status: "admitted", conflictType: null, artifactPath: canonicalPath, errors: [] };
}

/**
 * Validate, compatibility-check, and admit an incoming envelope through the
 * shared admission pipeline. An envelope can never read or hash a file
 * outside the selected repository or outside its artifact type's canonical
 * path family, and a foreign tenant/repository/generation is refused.
 * @param {string} cwd - Repository root.
 * @param {object} envelope - The envelope to unpack.
 * @returns {{artifactPath: string|null, errors: string[]}}
 */
function unpackEnvelope(cwd, envelope) {
	const admission = admitEnvelope(cwd, envelope);
	if (admission.status !== "admitted") {
		return { artifactPath: null, errors: admission.errors };
	}
	return { artifactPath: admission.artifactPath, errors: [] };
}

module.exports = {
	ARTIFACT_TYPES,
	ARTIFACT_PATH_REGISTRY,
	LOCAL_CAPABILITIES,
	hashFile,
	compareVersions,
	checkCompatibility,
	validateEnvelope,
	resolveSyncArtifact,
	admitEnvelope,
	envelopeFromArtifact,
	packEnvelope,
	unpackEnvelope,
};
