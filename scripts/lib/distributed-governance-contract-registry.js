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

const REQUIRED_DOMAIN_IDS = [
	"runtime-protocol",
	"contract-schema",
	"capability",
	"projection-rule",
	"component-generation",
	"source-generation",
];
const REQUIRED_CONTEXT_IDS = [
	"amber-core",
	"sync-runtime",
	"governance-graph",
	"governed-knowledge-base",
	"visualization-workbench",
	"organization-control-plane",
];
const DOMAIN_COMBINATION_KEYS = new Map([
	["runtime-protocol", "runtimeProtocol"],
	["contract-schema", "contractSchema"],
	["capability", "capability"],
	["projection-rule", "projectionRule"],
	["component-generation", "componentGeneration"],
	["source-generation", "sourceGeneration"],
]);
const OUTCOME_PRECEDENCE = ["unknown", "refused", "deprecated", "supported"];

function loadRegistry(registryPath = REGISTRY_PATH) {
	return JSON.parse(fs.readFileSync(registryPath, "utf8"));
}

function loadSchema(schemaPath = SCHEMA_PATH) {
	return JSON.parse(fs.readFileSync(schemaPath, "utf8"));
}

function hasDuplicates(values) {
	return new Set(values).size !== values.length;
}

function canonicalCombination(combination) {
	const ordered = {};
	for (const domainId of REQUIRED_DOMAIN_IDS) {
		const key = DOMAIN_COMBINATION_KEYS.get(domainId);
		ordered[key] = combination[key];
	}
	return ordered;
}

function sameCombination(left, right) {
	return JSON.stringify(canonicalCombination(left)) === JSON.stringify(canonicalCombination(right));
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

function deriveEvidenceId(outcome, combination) {
	const canonical = JSON.stringify(canonicalCombination(combination));
	const digest = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
	return `amber.distributed-governance.evidence.compatibility.${outcome}.${digest}`;
}

function evaluateCompatibility(registry, combination) {
	const domains = new Map(registry.versionDomains.map((domain) => [domain.id, domain]));
	const expectedKeys = [...DOMAIN_COMBINATION_KEYS.values()];
	const actualKeys = Object.keys(combination ?? {}).sort();
	const reasons = [];

	if (!combination || actualKeys.join(",") !== [...expectedKeys].sort().join(",")) {
		return {
			outcome: "unknown",
			evidenceId: deriveEvidenceId("unknown", combination ?? {}),
			reasons: ["compatibility combination must name every version domain exactly once"],
		};
	}

	const outcomes = [];
	for (const domainId of REQUIRED_DOMAIN_IDS) {
		const key = DOMAIN_COMBINATION_KEYS.get(domainId);
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

	const outcome = OUTCOME_PRECEDENCE.find((candidate) => outcomes.includes(candidate)) ?? "unknown";
	const registeredCase = registry.compatibility.cases.find((candidate) =>
		sameCombination(candidate.combination, combination),
	);

	return {
		outcome,
		evidenceId: registeredCase ? registeredCase.evidenceId : deriveEvidenceId(outcome, combination),
		reasons,
	};
}

function validateRegistry(registry = loadRegistry()) {
	const ajv = new Ajv({ allErrors: true });
	const validate = ajv.compile(loadSchema());
	const errors = [];

	if (!validate(registry)) {
		for (const error of validate.errors ?? []) {
			errors.push(`${error.instancePath || "/"} ${error.message}`);
		}
		return { valid: false, errors };
	}

	const domainIds = registry.versionDomains.map((domain) => domain.id);
	const contextIds = registry.boundedContexts.map((context) => context.id);
	if (hasDuplicates(domainIds)) {
		errors.push("version domain identifiers must be unique");
	}
	if (hasDuplicates(contextIds)) {
		errors.push("bounded context identifiers must be unique");
	}
	if (domainIds.join(",") !== REQUIRED_DOMAIN_IDS.join(",")) {
		errors.push("version domains must match the six distributed-governance domains exactly");
	}
	if (contextIds.join(",") !== REQUIRED_CONTEXT_IDS.join(",")) {
		errors.push("bounded contexts must match the six distributed-governance contexts exactly");
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

	const entryIds = registry.entries.map((entry) => entry.id);
	if (hasDuplicates(entryIds)) {
		errors.push("registry entry identifiers must be unique");
	}
	for (const entry of registry.entries) {
		if (!REQUIRED_DOMAIN_IDS.includes(entry.versionDomain)) {
			errors.push(`entry ${entry.id} names an unknown version domain`);
		}
		if (!REQUIRED_CONTEXT_IDS.includes(entry.owningContext)) {
			errors.push(`entry ${entry.id} names an unknown owning context`);
		}
		if (entry.kind === "contract" && !entry.bindings) {
			errors.push(`contract entry ${entry.id} is missing version-domain bindings`);
		}
		if (entry.kind === "invariant" && (!entry.sourceResolutions || !entry.adrs)) {
			errors.push(`invariant entry ${entry.id} is missing source or ADR traceability`);
		}
	}

	const caseIds = registry.compatibility.cases.map((entry) => entry.caseId);
	const evidenceIds = registry.compatibility.cases.map((entry) => entry.evidenceId);
	if (hasDuplicates(caseIds)) {
		errors.push("compatibility case identifiers must be unique");
	}
	if (hasDuplicates(evidenceIds)) {
		errors.push("compatibility evidence identifiers must be unique");
	}

	const outcomes = registry.compatibility.cases.map((entry) => entry.expectedOutcome);
	for (const expectedOutcome of ["supported", "deprecated", "refused", "unknown"]) {
		if (!outcomes.includes(expectedOutcome)) {
			errors.push(`compatibility matrix must cover ${expectedOutcome} combinations`);
		}
	}
	if (registry.compatibility.outcomePrecedence.join(",") !== OUTCOME_PRECEDENCE.join(",")) {
		errors.push("compatibility outcome precedence must be unknown, refused, deprecated, supported");
	}

	for (const compatibilityCase of registry.compatibility.cases) {
		const actual = evaluateCompatibility(registry, compatibilityCase.combination);
		if (actual.outcome !== compatibilityCase.expectedOutcome) {
			errors.push(
				`case ${compatibilityCase.caseId} expects ${compatibilityCase.expectedOutcome} but evaluates as ${actual.outcome}`,
			);
		}
		if (actual.evidenceId !== compatibilityCase.evidenceId) {
			errors.push(`case ${compatibilityCase.caseId} has an unstable evidence identifier`);
		}
	}

	return { valid: errors.length === 0, errors };
}

module.exports = {
	loadRegistry,
	loadSchema,
	evaluateCompatibility,
	validateRegistry,
	REGISTRY_PATH,
	SCHEMA_PATH,
};
