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

const { resolveIdentity } = require("./identity");
const { resolveDeploymentProfile } = require("./deployment-profile");

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

/**
 * Compute the sha256: content hash of a file.
 * @param {string} filePath - Absolute path.
 * @returns {string} "sha256:<64 hex>"
 */
function hashFile(filePath) {
	const content = fs.readFileSync(filePath);
	return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
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
 * @throws {Error} When the artifact is missing or the type is unknown.
 */
function envelopeFromArtifact(cwd, artifactType, relPath) {
	if (!ARTIFACT_TYPES.includes(artifactType)) {
		throw new Error(`unknown artifact type "${artifactType}"`);
	}
	const absPath = path.join(cwd, relPath);
	if (!fs.existsSync(absPath)) {
		throw new Error(`artifact not found: ${relPath}`);
	}
	const identity = resolveIdentity(cwd);
	const profile = resolveDeploymentProfile(cwd);
	const hash = hashFile(absPath);
	return {
		schemaVersion: ENVELOPE_SCHEMA_VERSION,
		envelopeId: crypto.randomUUID(),
		artifactType,
		artifactRef: { path: relPath, hash },
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
 * Validate, compatibility-check, and materialize an incoming envelope.
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
	const absPath = path.join(cwd, envelope.artifactRef.path);
	const actualHash = fs.existsSync(absPath) ? hashFile(absPath) : null;
	if (actualHash !== null && actualHash !== envelope.artifactRef.hash) {
		return {
			artifactPath: null,
			errors: [
				`artifact ${envelope.artifactRef.path} hash mismatch: local ${actualHash}, envelope ${envelope.artifactRef.hash}`,
			],
		};
	}
	return { artifactPath: envelope.artifactRef.path, errors: [] };
}

module.exports = {
	SYNC_DIR,
	ENVELOPES_DIR,
	ARTIFACT_TYPES,
	LOCAL_CAPABILITIES,
	hashFile,
	compareVersions,
	checkCompatibility,
	validateEnvelope,
	envelopeFromArtifact,
	packEnvelope,
	unpackEnvelope,
};
