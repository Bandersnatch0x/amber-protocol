"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("ajv");

const ROOT = path.resolve(__dirname, "..", "..");
const REGISTRY_PATH = path.join(
	ROOT,
	"docs",
	"architecture",
	"distributed-governance-contract-registry.json",
);
const SCHEMA_PATH = path.join(
	ROOT,
	"schemas",
	"distributed-governance-contract-registry.schema.json",
);

function loadRegistry(registryPath = REGISTRY_PATH) {
	return JSON.parse(fs.readFileSync(registryPath, "utf8"));
}

function loadSchema(schemaPath = SCHEMA_PATH) {
	return JSON.parse(fs.readFileSync(schemaPath, "utf8"));
}

function domainIdsFrom(schema) {
	return schema.properties.versionDomains.items.properties.id.enum;
}

function contextIdsFrom(schema) {
	return schema.properties.boundedContexts.items.properties.id.enum;
}

function outcomePrecedenceFrom(schema) {
	return schema.properties.compatibility.properties.outcomePrecedence.const;
}

function expectedOutcomesFrom(schema) {
	return schema.properties.compatibility.properties.cases.items.properties.expectedOutcome.enum;
}

function camelCase(value) {
	return value.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}

function combinationKeysFrom(domainIds) {
	return domainIds.map((domainId) => camelCase(domainId));
}

function hasDuplicates(values) {
	return new Set(values).size !== values.length;
}

function canonicalCombination(combination, domainIds) {
	const ordered = {};
	for (const domainId of domainIds) {
		const key = camelCase(domainId);
		ordered[key] = combination[key];
	}
	return ordered;
}

function sameCombination(left, right, domainIds) {
	return (
		JSON.stringify(canonicalCombination(left, domainIds)) ===
		JSON.stringify(canonicalCombination(right, domainIds))
	);
}

function classifyVersion(domain, version) {
	if (version === domain.currentVersion) {
		return "supported";
	}
	if (domain.deprecatedVersions.includes(version)) {
		return "deprecated";
	}
	if (domain.refusedVersions.includes(version)) {
		return "refused";
	}
	return "unknown";
}

function deriveEvidenceId(outcome, combination, domainIds) {
	const canonical = JSON.stringify(canonicalCombination(combination, domainIds));
	const digest = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
	return `amber.distributed-governance.evidence.compatibility.${outcome}.${digest}`;
}

function evaluateCompatibility(registry, combination, schema = loadSchema()) {
	const domainIds = domainIdsFrom(schema);
	const expectedKeys = combinationKeysFrom(domainIds);
	const actualKeys = Object.keys(combination ?? {}).sort();
	const reasons = [];

	if (!combination || actualKeys.join(",") !== [...expectedKeys].sort().join(",")) {
		return {
			outcome: "unknown",
			evidenceId: deriveEvidenceId("unknown", combination ?? {}, domainIds),
			reasons: ["compatibility combination must name every version domain exactly once"],
		};
	}

	const domains = new Map(registry.versionDomains.map((domain) => [domain.id, domain]));
	const outcomes = [];
	for (const domainId of domainIds) {
		const key = camelCase(domainId);
		const version = combination[key];
		const domain = domains.get(domainId);
		if (!domain || typeof version !== "string") {
			outcomes.push("unknown");
			reasons.push(`${domainId} version is missing or not a string`);
			continue;
		}
		const outcome = classifyVersion(domain, version);
		outcomes.push(outcome);
		if (outcome !== "supported") {
			reasons.push(`${domainId} ${version} is ${outcome}`);
		}
	}

	const outcomePrecedence = outcomePrecedenceFrom(schema);
	const outcome = outcomePrecedence.find((candidate) => outcomes.includes(candidate));
	const registeredCase = registry.compatibility.cases.find((candidate) =>
		sameCombination(candidate.combination, combination, domainIds),
	);

	return {
		outcome,
		evidenceId: registeredCase
			? registeredCase.evidenceId
			: deriveEvidenceId(outcome, combination, domainIds),
		reasons,
	};
}

function schemaErrors(registry, schema) {
	const ajv = new Ajv({ allErrors: true });
	const validate = ajv.compile(schema);
	if (validate(registry)) {
		return [];
	}
	return (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`);
}

function taxonomyErrors(registry, schema) {
	const errors = [];
	const domainIds = domainIdsFrom(schema);
	const contextIds = contextIdsFrom(schema);
	const actualDomainIds = registry.versionDomains.map((domain) => domain.id);
	const actualContextIds = registry.boundedContexts.map((context) => context.id);

	if (hasDuplicates(actualDomainIds)) {
		errors.push("version domain identifiers must be unique");
	}
	if (hasDuplicates(actualContextIds)) {
		errors.push("bounded context identifiers must be unique");
	}
	if (actualDomainIds.join(",") !== domainIds.join(",")) {
		errors.push(
			`version domains must match ${domainIds.length} distributed-governance domains exactly`,
		);
	}
	if (actualContextIds.join(",") !== contextIds.join(",")) {
		errors.push(
			`bounded contexts must match ${contextIds.length} distributed-governance contexts exactly`,
		);
	}

	for (const domain of registry.versionDomains) {
		const knownVersions = [
			domain.currentVersion,
			...domain.deprecatedVersions,
			...domain.refusedVersions,
		];
		if (hasDuplicates(knownVersions)) {
			errors.push(`version domain ${domain.id} assigns a version to multiple dispositions`);
		}
	}

	return errors;
}

function entryErrors(registry, schema) {
	const errors = [];
	const domainIds = new Set(domainIdsFrom(schema));
	const contextIds = new Set(contextIdsFrom(schema));
	const artifactTypes = schema.properties.entries.items.properties.artifactType.enum;
	const artifactEntries = registry.entries.filter((entry) => entry.kind === "artifact");
	const entryIds = registry.entries.map((entry) => entry.id);

	if (hasDuplicates(entryIds)) {
		errors.push("registry entry identifiers must be unique");
	}

	for (const entry of registry.entries) {
		if (!domainIds.has(entry.versionDomain)) {
			errors.push(`entry ${entry.id} names an unknown version domain`);
		}
		if (!contextIds.has(entry.owningContext)) {
			errors.push(`entry ${entry.id} names an unknown owning context`);
		}
		if (entry.kind === "contract" && !entry.bindings) {
			errors.push(`contract entry ${entry.id} is missing version-domain bindings`);
		}
		if (entry.kind === "invariant" && (!entry.sourceResolutions || !entry.adrs)) {
			errors.push(`invariant entry ${entry.id} is missing source or ADR traceability`);
		}
		if (entry.kind === "artifact" && (!entry.artifactType || !entry.sourceResolutions)) {
			errors.push(`artifact entry ${entry.id} is missing artifact type or source traceability`);
		}
		if (
			entry.kind === "artifact" &&
			entry.artifactType &&
			entry.id.split(".").pop() !== entry.artifactType
		) {
			errors.push(`artifact entry ${entry.id} does not identify its artifact type`);
		}
	}

	for (const artifactType of artifactTypes) {
		if (!artifactEntries.some((entry) => entry.artifactType === artifactType)) {
			errors.push(`registry is missing the public ${artifactType} artifact`);
		}
	}

	return errors;
}

function compatibilityErrors(registry, schema) {
	const errors = [];
	const cases = registry.compatibility.cases;
	const caseIds = cases.map((entry) => entry.caseId);
	const evidenceIds = cases.map((entry) => entry.evidenceId);
	const expectedOutcomes = expectedOutcomesFrom(schema);
	const outcomes = cases.map((entry) => entry.expectedOutcome);

	if (hasDuplicates(caseIds)) {
		errors.push("compatibility case identifiers must be unique");
	}
	if (hasDuplicates(evidenceIds)) {
		errors.push("compatibility evidence identifiers must be unique");
	}
	for (const expectedOutcome of expectedOutcomes) {
		if (!outcomes.includes(expectedOutcome)) {
			errors.push(`compatibility matrix must cover ${expectedOutcome} combinations`);
		}
	}
	if (
		registry.compatibility.outcomePrecedence.join(",") !== outcomePrecedenceFrom(schema).join(",")
	) {
		errors.push(
			`compatibility outcome precedence must be ${outcomePrecedenceFrom(schema).join(", ")}`,
		);
	}

	for (const compatibilityCase of cases) {
		const actual = evaluateCompatibility(registry, compatibilityCase.combination, schema);
		if (actual.outcome !== compatibilityCase.expectedOutcome) {
			errors.push(
				`case ${compatibilityCase.caseId} expects ${compatibilityCase.expectedOutcome} but evaluates as ${actual.outcome}`,
			);
		}
		if (actual.evidenceId !== compatibilityCase.evidenceId) {
			errors.push(`case ${compatibilityCase.caseId} has an unstable evidence identifier`);
		}
	}

	return errors;
}

function validateRegistry(registry = loadRegistry(), schema = loadSchema()) {
	const errors = [
		...schemaErrors(registry, schema),
		...taxonomyErrors(registry, schema),
		...entryErrors(registry, schema),
		...compatibilityErrors(registry, schema),
	];
	return { valid: errors.length === 0, errors };
}

module.exports = {
	loadRegistry,
	evaluateCompatibility,
	validateRegistry,
};
