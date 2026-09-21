"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
	evaluateCompatibility,
	loadRegistry,
	validateRegistry,
} = require("../scripts/lib/distributed-governance-contract-registry");

const ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(ROOT, "docs", "architecture", "distributed-governance-baseline.md");
const registry = loadRegistry();

function slugify(value) {
	return value
		.trim()
		.replace(/[.]/g, "")
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/[\s_]+/g, "-")
		.toLowerCase();
}

function organizationControlPlaneContractsFromBaseline() {
	const baseline = fs.readFileSync(BASELINE_PATH, "utf8");
	const row = baseline.match(/\| \*\*Organization Control Plane\*\* \|([^|]+)\|/);
	assert.ok(row, "baseline must define the Organization Control Plane ownership row");

	const protectedPhrase = "Tenant and Organization structure";
	const placeholder = "__TENANT_ORGANIZATION_STRUCTURE__";
	const normalized = row[1]
		.replace(protectedPhrase, placeholder)
		.replace(/Person and Agent Identity/g, "Person Identity; Agent Identity");

	return normalized
		.split(/,|;|\band\b/)
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => (part === placeholder ? protectedPhrase : part))
		.map(slugify);
}

function amberCoreArtifactTypesFromBaseline() {
	const baseline = fs.readFileSync(BASELINE_PATH, "utf8");
	const row = baseline.match(/\| \*\*Amber Core\*\* \|([^|]+)\|/);
	assert.ok(row, "baseline must define the Amber Core ownership row");

	const artifactModel = row[1].match(/canonical ([^|]+?) artifacts/);
	assert.ok(artifactModel, "baseline must enumerate the canonical Amber Core artifact model");

	return artifactModel[1]
		.split(/,|;|\band\b/)
		.map((part) => part.trim())
		.filter(Boolean)
		.map(slugify)
		.map((part) => part.replace(/s$/, ""));
}

function combinationWith(domainId, disposition) {
	const domain = registry.versionDomains.find((candidate) => candidate.id === domainId);
	const version =
		disposition === "supported"
			? domain.currentVersion
			: disposition === "deprecated"
				? domain.deprecatedVersions[0]
				: disposition === "refused"
					? domain.refusedVersions[0]
					: "999.0.0";

	const combination = {};
	for (const candidate of registry.versionDomains) {
		const key = candidate.id.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
		combination[key] = candidate.id === domainId ? version : candidate.currentVersion;
	}
	return combination;
}

test("registry validates against its schema and semantic rules", () => {
	const result = validateRegistry(registry);
	assert.deepEqual(result.errors, []);
	assert.equal(result.valid, true);
});

test("registry inventory is independently derived from the accepted baseline", () => {
	const expected = organizationControlPlaneContractsFromBaseline();
	assert.ok(
		expected.length >= 9,
		"baseline must enumerate public Organization Control Plane contracts",
	);

	const actual = registry.entries
		.filter(
			(entry) => entry.kind === "contract" && entry.owningContext === "organization-control-plane",
		)
		.map((entry) => entry.id.replace(/^amber\.distributed-governance\.contract\./, ""))
		.sort();

	assert.deepEqual(actual, [...expected].sort());
});

test("public artifact inventory is independently derived from the accepted baseline", () => {
	const expected = amberCoreArtifactTypesFromBaseline();
	assert.deepEqual(expected, [
		"work",
		"decision",
		"evidence",
		"approval",
		"context",
		"learning",
		"ledger",
		"acceptance",
	]);

	const artifacts = registry.entries.filter((entry) => entry.kind === "artifact");
	assert.equal(artifacts.length, expected.length);

	for (const artifactType of expected) {
		const artifact = artifacts.find((entry) => entry.artifactType === artifactType);
		assert.ok(artifact, `registry must enumerate the public ${artifactType} artifact`);
		assert.equal(artifact.id, `amber.distributed-governance.artifact.${artifactType}`);
		assert.equal(artifact.owningContext, "amber-core");
		assert.ok(artifact.sourceResolutions.includes(145));
	}
});

test("every entry has a stable identifier, version domain, owner, and disposition", () => {
	const domainIds = new Set(registry.versionDomains.map((domain) => domain.id));
	const contextIds = new Set(registry.boundedContexts.map((context) => context.id));
	const seenIds = new Set();

	for (const entry of registry.entries) {
		assert.match(
			entry.id,
			/^amber\.distributed-governance\.(contract|invariant|artifact)\.[a-z0-9-]+$/,
		);
		assert.equal(seenIds.has(entry.id), false);
		seenIds.add(entry.id);
		assert.ok(domainIds.has(entry.versionDomain));
		assert.ok(contextIds.has(entry.owningContext));
		assert.ok(["supported", "deprecated", "refused"].includes(entry.disposition));
		assert.match(entry.version, /^[0-9]+\.[0-9]+\.[0-9]+$/);

		if (entry.kind === "contract") {
			assert.deepEqual(Object.keys(entry.bindings).sort(), [
				"capability",
				"componentGeneration",
				"projectionRule",
				"schema",
				"sourceGeneration",
				"type",
			]);
		} else if (entry.kind === "invariant") {
			assert.ok(entry.sourceResolutions.length > 0);
			assert.ok(entry.adrs.length > 0);
		} else {
			assert.ok(entry.sourceResolutions.length > 0);
			assert.equal(entry.id.split(".").pop(), entry.artifactType);
		}
	}
});

test("compatibility matrix deterministically covers all four outcomes", () => {
	const cases = registry.compatibility.cases;
	const outcomes = cases.map((compatibilityCase) => compatibilityCase.expectedOutcome);
	assert.deepEqual([...new Set(outcomes)].sort(), [
		"deprecated",
		"refused",
		"supported",
		"unknown",
	]);

	for (const compatibilityCase of cases) {
		const result = evaluateCompatibility(registry, compatibilityCase.combination);
		assert.equal(result.outcome, compatibilityCase.expectedOutcome);
		assert.equal(result.evidenceId, compatibilityCase.evidenceId);
	}
});

test("mixed outcomes follow unknown, refused, deprecated, supported precedence", () => {
	const unknownOverRefused = evaluateCompatibility(
		registry,
		(() => {
			const combination = combinationWith("runtime-protocol", "refused");
			combination.contractSchema = "999.0.0";
			return combination;
		})(),
	);
	assert.equal(unknownOverRefused.outcome, "unknown");

	const refusedOverDeprecated = evaluateCompatibility(
		registry,
		(() => {
			const combination = combinationWith("runtime-protocol", "refused");
			combination.contractSchema = registry.versionDomains.find(
				(domain) => domain.id === "contract-schema",
			).deprecatedVersions[0];
			return combination;
		})(),
	);
	assert.equal(refusedOverDeprecated.outcome, "refused");

	const deprecatedOverSupported = evaluateCompatibility(
		registry,
		combinationWith("runtime-protocol", "deprecated"),
	);
	assert.equal(deprecatedOverSupported.outcome, "deprecated");

	const allSupported = evaluateCompatibility(
		registry,
		combinationWith("runtime-protocol", "supported"),
	);
	assert.equal(allSupported.outcome, "supported");
});

test("unknown combinations fail closed with stable evidence identifiers", () => {
	const combination = combinationWith("runtime-protocol", "unknown");
	const first = evaluateCompatibility(registry, combination);
	const second = evaluateCompatibility(registry, { ...combination });

	assert.equal(first.outcome, "unknown");
	assert.equal(second.outcome, "unknown");
	assert.equal(first.evidenceId, second.evidenceId);
	assert.match(
		first.evidenceId,
		/^amber\.distributed-governance\.evidence\.compatibility\.unknown\.[a-f0-9]{16}$/,
	);
	assert.ok(first.reasons.includes("runtime-protocol 999.0.0 is unknown"));

	const missingDomain = evaluateCompatibility(registry, {
		contractSchema: "1.0.0",
		capability: "1.0.0",
		projectionRule: "1.0.0",
		componentGeneration: "1.0.0",
		sourceGeneration: "1.0.0",
	});
	assert.equal(missingDomain.outcome, "unknown");
	assert.ok(
		missingDomain.reasons.includes(
			"compatibility combination must name every version domain exactly once",
		),
	);
});

test("registry preserves repository-local, offline, no-execution boundaries", () => {
	assert.deepEqual(registry.authorityBoundaries, {
		repositoryLocalAuthority: true,
		offlineCapability: true,
		executesAnything: false,
	});
});
