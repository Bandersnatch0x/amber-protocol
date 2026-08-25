"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMAS_DIR = path.resolve(__dirname, "..", "..", "schemas");

function loadSchema(name) {
	return JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, name), "utf8"));
}

// Minimal AJV-like validator using the built-in approach.
// Amber schemas use draft-07 with additionalProperties: false and enum/required/pattern.
// We validate structurally: required fields present, types correct, enums match, patterns match.
function validateAgainstSchema(instance, schema, label) {
	const errors = [];
	function check(value, prop, def, path) {
		const p = path || label;
		if (def.type === "object" && typeof value !== "object") {
			errors.push(`${p}: expected object, got ${typeof value}`);
			return;
		}
		if (def.type === "string" && typeof value !== "string") {
			errors.push(`${p}: expected string, got ${typeof value}`);
			return;
		}
		if (def.type === "integer" && (!Number.isInteger(value) || value < 0)) {
			errors.push(`${p}: expected non-negative integer, got ${value}`);
			return;
		}
		if (def.enum && !def.enum.includes(value)) {
			errors.push(`${p}: "${value}" not in enum [${def.enum.join(", ")}]`);
		}
		if (def.pattern && typeof value === "string") {
			if (!new RegExp(def.pattern).test(value)) {
				errors.push(`${p}: "${value}" does not match pattern ${def.pattern}`);
			}
		}
		if (def.const && value !== def.const) {
			errors.push(`${p}: expected const "${def.const}", got "${value}"`);
		}
		if (def.minimum !== undefined && typeof value === "number" && value < def.minimum) {
			errors.push(`${p}: ${value} < minimum ${def.minimum}`);
		}
		if (def.minLength !== undefined && typeof value === "string" && value.length < def.minLength) {
			errors.push(`${p}: string too short (min ${def.minLength})`);
		}
	}
	if (schema.type === "object" && typeof instance !== "object") {
		return [`${label}: expected object`];
	}
	if (schema.additionalProperties === false) {
		const allowed = new Set(Object.keys(schema.properties || {}));
		for (const key of Object.keys(instance)) {
			if (!allowed.has(key)) {
				errors.push(`${label}: additional property "${key}" not allowed`);
			}
		}
	}
	for (const field of schema.required || []) {
		if (!(field in instance)) {
			errors.push(`${label}: missing required field "${field}"`);
		}
	}
	for (const [key, def] of Object.entries(schema.properties || {})) {
		if (key in instance) {
			check(instance[key], key, def, `${label}.${key}`);
			if (def.type === "object" && typeof instance[key] === "object" && def.properties) {
				for (const [subKey, subDef] of Object.entries(def.properties)) {
					if (subKey in instance[key]) {
						check(instance[key][subKey], subKey, subDef, `${label}.${key}.${subKey}`);
					}
				}
				if (def.additionalProperties === false) {
					const subAllowed = new Set(Object.keys(def.properties));
					for (const subKey of Object.keys(instance[key])) {
						if (!subAllowed.has(subKey)) {
							errors.push(`${label}.${key}: additional property "${subKey}" not allowed`);
						}
					}
				}
				for (const req of def.required || []) {
					if (!(req in instance[key])) {
						errors.push(`${label}.${key}: missing required field "${req}"`);
					}
				}
			}
		}
	}
	return errors;
}

const envelopeSchema = loadSchema("sync-envelope.schema.json");
const identitySchema = loadSchema("structural-identity.schema.json");
const { envelopeFixture, structuralMatrix } = require("../helpers/sync-envelope-fixtures");

function loadAdapter() {
	return require("../../scripts/lib/core/sync-envelope-contract");
}

// ── Sync Envelope ──────────────────────────────────────────────

test("sync-envelope.schema.json exists and is valid JSON", () => {
	assert.ok(envelopeSchema);
	assert.equal(envelopeSchema.title, "Sync Envelope");
	assert.equal(envelopeSchema.additionalProperties, false);
});

test("sync-envelope schema requires the 8 core fields", () => {
	const required = envelopeSchema.required;
	assert.deepEqual(required.sort(), [
		"artifactRef",
		"artifactType",
		"createdAt",
		"envelopeId",
		"origin",
		"schemaVersion",
		"structuralIdentity",
		"versionNegotiation",
	]);
});

test("versionNegotiation requires every negotiation field", () => {
	const neg = envelopeSchema.properties.versionNegotiation;
	assert.ok(neg, "versionNegotiation property must exist");
	assert.deepEqual((neg.required || []).sort(), [
		"amberProtocolVersion",
		"capabilities",
		"minCompatibleVersion",
	]);
});

test("versionNegotiation versions are constrained to semantic versions", () => {
	const neg = envelopeSchema.properties.versionNegotiation;
	assert.ok(
		typeof neg.properties.amberProtocolVersion.pattern === "string",
		"amberProtocolVersion must carry a semver pattern",
	);
	assert.ok(
		typeof neg.properties.minCompatibleVersion.pattern === "string",
		"minCompatibleVersion must carry a semver pattern",
	);
	assert.ok(
		(neg.properties.capabilities.minItems || 0) >= 1,
		"capabilities must declare at least one capability",
	);
});

test("a valid sync envelope passes validation", () => {
	const errors = validateAgainstSchema(envelopeFixture(), envelopeSchema, "envelope");
	assert.deepEqual(errors, [], errors.join("\n"));
});

test("an envelope with an invalid artifactType fails validation", () => {
	const invalid = envelopeFixture({ artifactType: "not-a-real-type" });
	const errors = validateAgainstSchema(invalid, envelopeSchema, "envelope");
	assert.ok(errors.some((e) => e.includes("not-a-real-type")));
});

test("an envelope with an invalid envelopeId (not a UUID) fails validation", () => {
	const invalid = envelopeFixture({ envelopeId: "not-a-uuid" });
	const errors = validateAgainstSchema(invalid, envelopeSchema, "envelope");
	assert.ok(errors.some((e) => e.includes("envelopeId")));
});

test("an envelope with an additional property fails validation", () => {
	const invalid = envelopeFixture();
	invalid.extraField = "should not be here";
	const errors = validateAgainstSchema(invalid, envelopeSchema, "envelope");
	assert.ok(errors.some((e) => e.includes("extraField")));
});

test("envelope origin.profile accepts all three deployment profiles", () => {
	for (const profile of ["personal-node", "team-hub", "organization"]) {
		const valid = envelopeFixture({ origin: { profile } });
		const errors = validateAgainstSchema(valid, envelopeSchema, "envelope");
		assert.deepEqual(errors, [], `profile ${profile} should be valid`);
	}
});

test("envelope conflictRecord is optional and accepts all conflict types", () => {
	for (const ct of [
		"concurrent-edit",
		"generation-mismatch",
		"version-mismatch",
		"identity-mismatch",
	]) {
		const valid = envelopeFixture({
			conflictRecord: {
				conflictType: ct,
				remoteEnvelopeId: "01234567-89ab-cdef-0123-456789abcdef",
				resolution: "pending",
				recordedAt: "2026-08-23T12:00:00Z",
			},
		});
		const errors = validateAgainstSchema(valid, envelopeSchema, "envelope");
		assert.deepEqual(errors, [], `conflictType ${ct} should be valid`);
	}
});

// ── F035 S2: runtime adapter is the schema SSOT ────────────────
// The cached AJV adapter compiles schemas/sync-envelope.schema.json itself,
// so schema tests and runtime tests share one fixture matrix and cannot
// drift apart again.

test("sync-envelope-contract adapter is cached", () => {
	const first = loadAdapter();
	const second = loadAdapter();
	assert.equal(first, second, "adapter module is require-cached");
	assert.equal(typeof first.validateSyncEnvelope, "function");
});

for (const { name, envelope, expectValid, errorPattern } of structuralMatrix()) {
	test(`adapter structural matrix: ${name}`, () => {
		const { validateSyncEnvelope } = loadAdapter();
		const result = validateSyncEnvelope(envelope);
		assert.equal(result.valid, expectValid, JSON.stringify(result.errors));
		if (!expectValid && errorPattern) {
			assert.ok(
				result.errors.some((e) => errorPattern.test(e)),
				`expected an error matching ${errorPattern}, got: ${result.errors.join("; ")}`,
			);
		}
	});
}

// ── Structural Identity ────────────────────────────────────────

test("structural-identity.schema.json exists and is valid JSON", () => {
	assert.ok(identitySchema);
	assert.equal(identitySchema.title, "Structural Identity");
	assert.equal(identitySchema.additionalProperties, false);
});

test("structural-identity schema requires the 4 core fields", () => {
	const required = identitySchema.required;
	assert.deepEqual(required.sort(), [
		"repositoryGeneration",
		"repositoryId",
		"schemaVersion",
		"tenantId",
	]);
});

test("a valid structural identity passes validation", () => {
	const valid = {
		schemaVersion: "1.0.0",
		tenantId: "local",
		repositoryId: "my-repo",
		repositoryGeneration: 0,
	};
	const errors = validateAgainstSchema(valid, identitySchema, "identity");
	assert.deepEqual(errors, [], errors.join("\n"));
});

test("structural identity with organizationId and transferRecord passes", () => {
	const valid = {
		schemaVersion: "1.0.0",
		tenantId: "team-a",
		repositoryId: "shared-repo",
		repositoryGeneration: 1,
		organizationId: "my-org",
		transferRecord: {
			fromTenantId: "local",
			toTenantId: "team-a",
			transferredAt: "2026-08-23T12:00:00Z",
			previousGeneration: 0,
		},
	};
	const errors = validateAgainstSchema(valid, identitySchema, "identity");
	assert.deepEqual(errors, [], errors.join("\n"));
});

test("structural identity with negative generation fails", () => {
	const invalid = {
		schemaVersion: "1.0.0",
		tenantId: "local",
		repositoryId: "r",
		repositoryGeneration: -1,
	};
	const errors = validateAgainstSchema(invalid, identitySchema, "identity");
	assert.ok(errors.some((e) => e.includes("repositoryGeneration")));
});

test("structural identity with an additional property fails", () => {
	const invalid = {
		schemaVersion: "1.0.0",
		tenantId: "local",
		repositoryId: "r",
		repositoryGeneration: 0,
		extraField: "no",
	};
	const errors = validateAgainstSchema(invalid, identitySchema, "identity");
	assert.ok(errors.some((e) => e.includes("extraField")));
});

// ── Schema registry ────────────────────────────────────────────

test("both new schemas are in the schemas/ directory", () => {
	assert.ok(fs.existsSync(path.join(SCHEMAS_DIR, "sync-envelope.schema.json")));
	assert.ok(fs.existsSync(path.join(SCHEMAS_DIR, "structural-identity.schema.json")));
});

test("schemas count is now 19 (18 + sync-transport-report)", () => {
	const files = fs.readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith(".schema.json"));
	assert.equal(files.length, 19, `expected 19 schemas, got ${files.length}`);
});
