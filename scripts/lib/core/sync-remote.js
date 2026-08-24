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
const { resolveDeploymentProfile } = require("./deployment-profile");
const { resolvePathWithin, toPortablePath } = require("./fs-utils");

const SYNC_DIR = ".amber/sync";
const ENVELOPES_DIR = path.join(SYNC_DIR, "envelopes");
const ENVELOPE_SCHEMA_VERSION = "1.0.0";
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
 * @param {object} envelope - The envelope to check.
 * @param {{version?: string, capabilities?: string[]}} [local] - Local install metadata.
 * @returns {{compatible: boolean, reasons: string[]}}
 */
function checkCompatibility(envelope, local = {}) {
	const reasons = [];
	const neg = envelope.versionNegotiation;
	if (!neg || typeof neg !== "object") {
		return { compatible: false, reasons: ["envelope has no versionNegotiation block"] };
	}
	const localVersion =
		local.version || require(path.join(__dirname, "..", "..", "..", "package.json")).version;
	const minCompat = neg.minCompatibleVersion;
	if (typeof minCompat === "string" && minCompat && compareVersions(localVersion, minCompat) < 0) {
		reasons.push(
			`envelope requires minCompatibleVersion ${minCompat}; local is ${localVersion} (silent downgrade refused)`,
		);
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
 * Simple semver-ish comparison. Returns <0, 0, >0.
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
 * Structural checks mirror schemas/sync-envelope.schema.json without a runtime
 * AJV dependency.
 * @param {object} envelope - The envelope to validate.
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateEnvelope(envelope) {
	const errors = [];
	if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
		return { valid: false, errors: ["envelope must be an object"] };
	}
	for (const field of [
		"schemaVersion",
		"envelopeId",
		"artifactType",
		"artifactRef",
		"structuralIdentity",
		"origin",
		"createdAt",
	]) {
		if (!(field in envelope)) {
			errors.push(`missing required field "${field}"`);
		}
	}
	if (envelope.schemaVersion && envelope.schemaVersion !== ENVELOPE_SCHEMA_VERSION) {
		errors.push(
			`unsupported schemaVersion "${envelope.schemaVersion}" (expected "${ENVELOPE_SCHEMA_VERSION}")`,
		);
	}
	if (
		envelope.envelopeId &&
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(envelope.envelopeId)
	) {
		errors.push(`envelopeId "${envelope.envelopeId}" is not a UUID`);
	}
	if (envelope.artifactType && !ARTIFACT_TYPES.includes(envelope.artifactType)) {
		errors.push(`artifactType "${envelope.artifactType}" is not a known artifact type`);
	}
	if (envelope.artifactRef) {
		if (typeof envelope.artifactRef !== "object") {
			errors.push("artifactRef must be an object");
		} else {
			if (
				typeof envelope.artifactRef.hash !== "string" ||
				!/^sha256:[0-9a-f]{64}$/.test(envelope.artifactRef.hash)
			) {
				errors.push("artifactRef.hash must be sha256:<64 hex>");
			}
			if (typeof envelope.artifactRef.path !== "string" || envelope.artifactRef.path.length === 0) {
				errors.push("artifactRef.path must be a non-empty string");
			}
		}
	}
	if (envelope.structuralIdentity) {
		for (const field of ["tenantId", "repositoryId", "repositoryGeneration"]) {
			if (!(field in envelope.structuralIdentity)) {
				errors.push(`structuralIdentity missing "${field}"`);
			}
		}
	}
	if (envelope.origin) {
		if (!["personal-node", "team-hub", "organization"].includes(envelope.origin.profile)) {
			errors.push(`origin.profile "${envelope.origin.profile}" is not a known profile`);
		}
	}
	return { valid: errors.length === 0, errors };
}

/**
 * Build an envelope from a local artifact.
 * @param {string} cwd - Repository root.
 * @param {string} artifactType - One of ARTIFACT_TYPES.
 * @param {string} relPath - Repository-relative path to the artifact.
 * @returns {object} The envelope.
 * @throws {Error} When the artifact is missing, the type is unknown, or the
 *   path is not canonical for the type (see resolveSyncArtifact).
 */
function envelopeFromArtifact(cwd, artifactType, relPath) {
	const canonicalPath = resolveSyncArtifact(cwd, artifactType, relPath);
	const absPath = path.join(cwd, canonicalPath);
	if (!fs.existsSync(absPath)) {
		throw new Error(`artifact not found: ${canonicalPath}`);
	}
	const identity = resolveIdentity(cwd);
	const profile = resolveDeploymentProfile(cwd);
	const hash = hashFile(absPath);
	return {
		schemaVersion: ENVELOPE_SCHEMA_VERSION,
		envelopeId: crypto.randomUUID(),
		artifactType,
		artifactRef: { path: canonicalPath, hash },
		structuralIdentity: {
			tenantId: identity.tenantId,
			repositoryId: path.basename(cwd),
			repositoryGeneration: identity.repositoryGeneration,
		},
		origin: {
			profile: profile.deploymentProfile || "personal-node",
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
		const dir = path.join(cwd, ENVELOPES_DIR);
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
 * Validate, compatibility-check, and materialize an incoming envelope. The
 * artifact path passes the same canonical admission as packing; an envelope
 * can never read or hash a file outside the selected repository or outside
 * its artifact type's canonical path family.
 * @param {string} cwd - Repository root.
 * @param {object} envelope - The envelope to unpack.
 * @returns {{artifactPath: string|null, errors: string[]}}
 */
function unpackEnvelope(cwd, envelope) {
	const validation = validateEnvelope(envelope);
	if (!validation.valid) {
		return { artifactPath: null, errors: validation.errors };
	}
	const compat = checkCompatibility(envelope);
	if (!compat.compatible) {
		return { artifactPath: null, errors: compat.reasons };
	}
	let canonicalPath;
	try {
		canonicalPath = resolveSyncArtifact(cwd, envelope.artifactType, envelope.artifactRef.path);
	} catch (err) {
		return { artifactPath: null, errors: [err.message] };
	}
	const absPath = path.join(cwd, canonicalPath);
	const actualHash = fs.existsSync(absPath) ? hashFile(absPath) : null;
	if (actualHash !== null && actualHash !== envelope.artifactRef.hash) {
		return {
			artifactPath: null,
			errors: [
				`artifact ${canonicalPath} hash mismatch: local ${actualHash}, envelope ${envelope.artifactRef.hash}`,
			],
		};
	}
	return { artifactPath: canonicalPath, errors: [] };
}

module.exports = {
	SYNC_DIR,
	ENVELOPES_DIR,
	ARTIFACT_TYPES,
	ARTIFACT_PATH_REGISTRY,
	LOCAL_CAPABILITIES,
	hashFile,
	compareVersions,
	checkCompatibility,
	validateEnvelope,
	resolveSyncArtifact,
	envelopeFromArtifact,
	packEnvelope,
	unpackEnvelope,
};
