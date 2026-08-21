"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
	evaluateCompatibility,
	loadRegistry,
	validateRegistry,
} = require("../scripts/lib/distributed-governance-contract-registry");

const registry = loadRegistry();

const requiredContracts = [
	"sync-envelope",
	"domain-fact",
	"domain-event",
	"sync-control-record",
	"sync-session",
	"sync-operation",
	"checkpoint",
	"ownership-handoff",
	"conflict",
	"resolution",
	"rejection",
	"corruption",
	"read-snapshot",
	"query-contract",
	"projection-query-envelope",
	"projection-read-receipt",
	"knowledge-candidate",
	"knowledge-record",
	"context-page",
	"projection-generation",
];

const requiredInvariants = [
	"repository-local-authority",
	"offline-operation",
	"optional-non-executing-sync-runtime",
	"one-versioned-protocol-and-artifact-model",
	"rebuildable-read-only-projections",
	"exact-scope-deny-wins-authorization-and-privacy-minimization",
	"fail-closed-degraded-read-only",
	"append-only-lineage-and-immutable-records",
	"source-and-resolution-ownership",
	"conflict-preservation-and-governed-resolution",
	"tenant-and-repository-isolation",
	"no-hidden-authority-or-execution",
];

test("registry validates against its schema and semantic rules", () => {
	const result = validateRegistry(registry);
	assert.deepEqual(result.errors, []);
	assert.equal(result.valid, true);
});

test("registry enumerates every required contract, artifact, and invariant", () => {
	const contracts = registry.entries.filter((entry) => entry.kind === "contract");
	const invariants = registry.entries.filter((entry) => entry.kind === "invariant");
	const contractSlugs = contracts.map((entry) =>
		entry.id.replace(/^amber\.distributed-governance\.contract\./, ""),
	);
	const invariantSlugs = invariants.map((entry) =>
		entry.id.replace(/^amber\.distributed-governance\.invariant\./, ""),
	);

	assert.equal(contracts.length, 20);
	assert.equal(invariants.length, 12);
	assert.deepEqual(contractSlugs.sort(), [...requiredContracts].sort());
	assert.deepEqual(invariantSlugs.sort(), [...requiredInvariants].sort());
});

test("every entry has a stable identifier, version domain, owner, and disposition", () => {
	const domainIds = new Set(registry.versionDomains.map((domain) => domain.id));
	const contextIds = new Set(registry.boundedContexts.map((context) => context.id));
	const seenIds = new Set();

	for (const entry of registry.entries) {
		assert.match(entry.id, /^amber\.distributed-governance\.(contract|invariant)\.[a-z0-9-]+$/);
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
		} else {
			assert.ok(entry.sourceResolutions.length > 0);
			assert.ok(entry.adrs.length > 0);
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

test("unknown combinations fail closed with stable evidence identifiers", () => {
	const combination = {
		runtimeProtocol: "3.0.0",
		contractSchema: "1.0.0",
		capability: "1.0.0",
		projectionRule: "1.0.0",
		componentGeneration: "1.0.0",
		sourceGeneration: "1.0.0",
	};
	const first = evaluateCompatibility(registry, combination);
	const second = evaluateCompatibility(registry, { ...combination });

	assert.equal(first.outcome, "unknown");
	assert.equal(second.outcome, "unknown");
	assert.equal(first.evidenceId, second.evidenceId);
	assert.match(
		first.evidenceId,
		/^amber\.distributed-governance\.evidence\.compatibility\.unknown\.[a-f0-9]{16}$/,
	);
	assert.ok(first.reasons.includes("runtime-protocol 3.0.0 is unknown"));

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
