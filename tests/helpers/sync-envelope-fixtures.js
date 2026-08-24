"use strict";

// Shared sync-envelope fixture matrix (F035 S2).
//
// One source of truth for envelope fixtures consumed by BOTH the schema
// surface tests (tests/unit/distributed-governance-schemas.test.js) and the
// runtime surface tests (tests/unit/sync-remote.test.js), so the compiled
// schema and the runtime validator cannot drift apart again.

const UUID = "01234567-89ab-cdef-0123-456789abcdef";
const HASH = "sha256:" + "a".repeat(64);

/**
 * A structurally valid envelope.
 * @param {object} [overrides] - Shallow overrides; `versionNegotiation`
 *   replaces the whole block when provided.
 * @returns {object} Envelope fixture.
 */
function envelopeFixture(overrides = {}) {
	return {
		schemaVersion: "1.0.0",
		envelopeId: UUID,
		artifactType: "context-page",
		artifactRef: { path: ".amber/context/pages/note.json", hash: HASH },
		structuralIdentity: { tenantId: "local", repositoryId: "r", repositoryGeneration: 0 },
		origin: { profile: "personal-node" },
		createdAt: "2026-08-23T12:00:00Z",
		versionNegotiation: {
			amberProtocolVersion: "1.6.0",
			minCompatibleVersion: "1.0.0",
			capabilities: ["sync-envelope-v1"],
		},
		...overrides,
	};
}

/**
 * Structural fixture matrix: each case is an envelope mutation that the
 * sync-envelope schema (and therefore the runtime validator) must accept or
 * reject, with the error marker the rejection must mention.
 * @returns {Array<{name: string, envelope: object, expectValid: boolean, errorPattern?: RegExp}>}
 */
function structuralMatrix() {
	const cases = [
		{ name: "valid", envelope: envelopeFixture(), expectValid: true },
		{
			name: "missing-versionNegotiation",
			mutate: (e) => delete e.versionNegotiation,
			errorPattern: /versionNegotiation/,
		},
		{
			name: "missing-producer-version",
			mutate: (e) => delete e.versionNegotiation.amberProtocolVersion,
			errorPattern: /amberProtocolVersion/,
		},
		{
			name: "missing-min-compatible-version",
			mutate: (e) => delete e.versionNegotiation.minCompatibleVersion,
			errorPattern: /minCompatibleVersion/,
		},
		{
			name: "missing-capabilities",
			mutate: (e) => delete e.versionNegotiation.capabilities,
			errorPattern: /capabilities/,
		},
		{
			name: "empty-capabilities",
			mutate: (e) => (e.versionNegotiation.capabilities = []),
			errorPattern: /capabilities/,
		},
		{
			name: "malformed-producer-semver",
			mutate: (e) => (e.versionNegotiation.amberProtocolVersion = "not.a.semver"),
			errorPattern: /amberProtocolVersion/,
		},
		{
			name: "malformed-min-compatible-semver",
			mutate: (e) => (e.versionNegotiation.minCompatibleVersion = "1"),
			errorPattern: /minCompatibleVersion/,
		},
		{
			name: "unknown-schema-version",
			mutate: (e) => (e.schemaVersion = "2.0.0"),
			errorPattern: /schemaVersion/,
		},
		{
			name: "unknown-artifact-type",
			mutate: (e) => (e.artifactType = "not-a-real-type"),
			errorPattern: /artifactType/,
		},
		{
			name: "non-uuid-envelope-id",
			mutate: (e) => (e.envelopeId = "not-a-uuid"),
			errorPattern: /envelopeId/,
		},
		{
			name: "malformed-hash",
			mutate: (e) => (e.artifactRef.hash = "md5:abc"),
			errorPattern: /hash/,
		},
		{
			name: "empty-artifact-path",
			mutate: (e) => (e.artifactRef.path = ""),
			errorPattern: /path/,
		},
		{
			name: "unknown-origin-profile",
			mutate: (e) => (e.origin.profile = "cloud-super-node"),
			errorPattern: /profile/,
		},
		{
			name: "additional-top-level-property",
			mutate: (e) => (e.extraField = "no"),
			errorPattern: /extraField/,
		},
		{
			name: "additional-versionNegotiation-property",
			mutate: (e) => (e.versionNegotiation.extra = "no"),
			errorPattern: /extra/,
		},
		{
			name: "missing-structuralIdentity",
			mutate: (e) => delete e.structuralIdentity,
			errorPattern: /structuralIdentity/,
		},
		{
			name: "negative-repositoryGeneration",
			mutate: (e) => (e.structuralIdentity.repositoryGeneration = -1),
			errorPattern: /repositoryGeneration/,
		},
	];
	return cases.map(({ name, mutate, envelope, expectValid, errorPattern }) => {
		if (envelope) return { name, envelope, expectValid, errorPattern };
		const mutated = envelopeFixture();
		mutate(mutated);
		return { name, envelope: mutated, expectValid: false, errorPattern };
	});
}

/**
 * Compatibility fixture matrix for checkCompatibility against local 1.6.0.
 * Each case declares the versionNegotiation block and whether a 1.6.0 install
 * must accept or refuse it.
 * @returns {Array<{name: string, versionNegotiation: object|null, localVersion: string, expectCompatible: boolean, reasonPattern?: RegExp}>}
 */
function compatibilityMatrix() {
	return [
		{
			name: "same-version-producer",
			versionNegotiation: {
				amberProtocolVersion: "1.6.0",
				minCompatibleVersion: "1.0.0",
				capabilities: ["sync-envelope-v1"],
			},
			localVersion: "1.6.0",
			expectCompatible: true,
		},
		{
			name: "older-minor-producer",
			versionNegotiation: {
				amberProtocolVersion: "1.2.0",
				minCompatibleVersion: "1.0.0",
				capabilities: ["sync-envelope-v1"],
			},
			localVersion: "1.6.0",
			expectCompatible: true,
		},
		{
			name: "newer-minor-producer-with-low-minimum",
			versionNegotiation: {
				amberProtocolVersion: "1.9.0",
				minCompatibleVersion: "1.0.0",
				capabilities: ["sync-envelope-v1"],
			},
			localVersion: "1.6.0",
			expectCompatible: true,
		},
		{
			name: "future-major-producer-with-low-minimum",
			versionNegotiation: {
				amberProtocolVersion: "99.0.0",
				minCompatibleVersion: "1.0.0",
				capabilities: ["sync-envelope-v1"],
			},
			localVersion: "1.6.0",
			expectCompatible: false,
			reasonPattern: /amberProtocolVersion/,
		},
		{
			name: "min-compatible-above-local",
			versionNegotiation: {
				amberProtocolVersion: "1.6.0",
				minCompatibleVersion: "2.0.0",
				capabilities: ["sync-envelope-v1"],
			},
			localVersion: "1.6.0",
			expectCompatible: false,
			reasonPattern: /minCompatibleVersion/,
		},
		{
			name: "malformed-producer-version",
			versionNegotiation: {
				amberProtocolVersion: "version-nine",
				minCompatibleVersion: "1.0.0",
				capabilities: ["sync-envelope-v1"],
			},
			localVersion: "1.6.0",
			expectCompatible: false,
			reasonPattern: /amberProtocolVersion/,
		},
		{
			name: "malformed-min-compatible-version",
			versionNegotiation: {
				amberProtocolVersion: "1.6.0",
				minCompatibleVersion: "later",
				capabilities: ["sync-envelope-v1"],
			},
			localVersion: "1.6.0",
			expectCompatible: false,
			reasonPattern: /minCompatibleVersion/,
		},
		{
			name: "capability-missing-locally",
			versionNegotiation: {
				amberProtocolVersion: "1.6.0",
				minCompatibleVersion: "1.0.0",
				capabilities: ["sync-envelope-v1", "structural-identity-v1"],
			},
			localVersion: "1.6.0",
			localCapabilities: ["sync-envelope-v1"],
			expectCompatible: false,
			reasonPattern: /structural-identity-v1/,
		},
	];
}

module.exports = { UUID, HASH, envelopeFixture, structuralMatrix, compatibilityMatrix };
