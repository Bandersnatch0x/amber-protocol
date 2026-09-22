"use strict";

// Registry self-consistency validator for the distributed-governance contract
// registry (F062 adjacent; revive of the #176 deliverable, never merged).
//
// Scope, deliberately narrow: does the registry agree with itself and with its
// own schema. It does NOT check whether master's code conforms to the contracts
// — every entry carries a measured `implementation` plus a file pointer for that,
// and re-measuring is a review act, not a validation.
//
// Two design notes carried over from the never-merged 586ae63 validator:
//
//   1. The schema is the single source of truth for the identifier sets. The
//      version-domain and bounded-context enumerations are read out of
//      schemas/distributed-governance-contract-registry.schema.json, so a domain
//      rename cannot leave the validator checking a stale list.
//   2. A compatibility case is checked by evaluating it, not by trusting its
//      `expectedOutcome`, and its `evidenceId` is recomputed rather than read.
//
// The one thing it does NOT carry over is the reference's private Ajv instance:
// schema compilation goes through scripts/lib/core/schema-contract.js, the
// repository's only Ajv seam (tests/unit/schema-contract-guard.test.js enforces
// it by scanning for construction sites, comments included).

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { validate, SCHEMAS_DIR } = require("./schema-contract");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCHEMA_NAME = "distributed-governance-contract-registry";
const REGISTRY_PATH = path.join(
	ROOT,
	"docs",
	"architecture",
	"distributed-governance-contract-registry.json",
);
const SCHEMA_PATH = path.join(SCHEMAS_DIR, `${SCHEMA_NAME}.schema.json`);

const KINDS = ["contract", "artifact", "invariant"];

/**
 * Read the registry JSON. A missing or unparseable registry is a repository
 * defect, so it throws rather than returning a verdict.
 * @param {string} [registryPath]
 * @returns {object}
 */
function loadRegistry(registryPath = REGISTRY_PATH) {
	return JSON.parse(fs.readFileSync(registryPath, "utf8"));
}

/**
 * The registry a given root carries. `root` is an Amber checkout (the running
 * installation by default); the registry lives at a fixed path inside it.
 * @param {string} [root]
 * @returns {string}
 */
function registryPathFor(root = ROOT) {
	return path.join(root, "docs", "architecture", "distributed-governance-contract-registry.json");
}

/**
 * Read the raw schema object. The compiled validator is not enough here: the
 * identifier enumerations live in the schema text.
 * @param {string} [schemaPath]
 * @returns {object}
 */
function loadSchema(schemaPath = SCHEMA_PATH) {
	return JSON.parse(fs.readFileSync(schemaPath, "utf8"));
}

function versionsOf(domain) {
	return [...(domain.deprecatedVersions || []), ...(domain.refusedVersions || [])];
}

function declaredVersionsOf(domain) {
	return [domain.currentVersion, ...versionsOf(domain)];
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
	return domainIds.map(camelCase);
}

function hasDuplicates(values) {
	return new Set(values).size !== values.length;
}

// The canonical order is the schema's domain order, so it is the registry's
// declared order too — reordering the domains changes every derived evidenceId.
function canonicalCombination(combination, domainIds) {
	const ordered = {};
	for (const domainId of domainIds) {
		ordered[camelCase(domainId)] = (combination || {})[camelCase(domainId)];
	}
	return ordered;
}

function sameCombination(left, right, domainIds) {
	return (
		JSON.stringify(canonicalCombination(left, domainIds)) ===
		JSON.stringify(canonicalCombination(right, domainIds))
	);
}

// Most severe outcome wins when domains disagree.
function classifyVersion(domain, version) {
	if (version === domain.currentVersion) {
		return "supported";
	}
	if ((domain.deprecatedVersions || []).includes(version)) {
		return "deprecated";
	}
	if ((domain.refusedVersions || []).includes(version)) {
		return "refused";
	}
	return "unknown";
}

function deriveEvidenceId(outcome, combination, domainIds) {
	const canonical = JSON.stringify(canonicalCombination(combination, domainIds));
	const digest = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
	return `amber.distributed-governance.evidence.compatibility.${outcome}.${digest}`;
}

/**
 * Evaluate a version combination against the declared version domains.
 * @param {object} registry
 * @param {object} combination - One version per domain, keyed by camelCase domain id.
 * @param {object} [schema]
 * @returns {{outcome: string, evidenceId: string, reasons: string[]}}
 */
function evaluateCompatibility(registry, combination, schema = loadSchema()) {
	const domainIds = domainIdsFrom(schema);
	const reasons = [];
	const supplied = Object.keys(combination || {}).sort();
	const expected = [...combinationKeysFrom(domainIds)].sort();

	if (!combination || supplied.join(",") !== expected.join(",")) {
		return {
			outcome: "unknown",
			evidenceId: deriveEvidenceId("unknown", combination || {}, domainIds),
			reasons: ["compatibility combination must name every version domain exactly once"],
		};
	}

	const domains = new Map(registry.versionDomains.map((domain) => [domain.id, domain]));
	const outcomes = [];
	for (const domainId of domainIds) {
		const version = combination[camelCase(domainId)];
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
	const registeredCase = (registry.compatibility.cases || []).find((candidate) =>
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

function schemaErrors(registry) {
	const result = validate(SCHEMA_NAME, registry);
	return result.errors;
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
	// The domain check is order-sensitive on purpose: the declared order is the
	// canonical order every derived combination evidence identifier is computed
	// over. The context check is not — nothing is derived from a context order.
	if (actualDomainIds.join(",") !== domainIds.join(",")) {
		errors.push(`version domains must be ${domainIds.join(", ")} in that order`);
	}
	if ([...actualContextIds].sort().join(",") !== [...contextIds].sort().join(",")) {
		errors.push(`bounded contexts must be exactly ${contextIds.join(", ")}`);
	}

	for (const domain of registry.versionDomains) {
		const declared = declaredVersionsOf(domain);
		if (hasDuplicates(declared)) {
			errors.push(`version domain ${domain.id} assigns a version to multiple dispositions`);
		}
	}

	return errors;
}

function entryErrors(registry, schema) {
	const errors = [];
	const domainIds = new Set(domainIdsFrom(schema));
	const contextIds = new Set(contextIdsFrom(schema));
	const entryIds = registry.entries.map((entry) => entry.id);

	if (hasDuplicates(entryIds)) {
		errors.push("registry entry identifiers must be unique");
	}

	for (const entry of registry.entries) {
		const kind = entry.id.split(".")[2];
		if (kind !== entry.kind) {
			errors.push(`entry ${entry.id} is filed as ${entry.kind} but its identifier says ${kind}`);
		}
		if (entry.versionDomain !== null && !domainIds.has(entry.versionDomain)) {
			errors.push(`entry ${entry.id} names an unknown version domain`);
		}
		if (entry.owningContext !== null && !contextIds.has(entry.owningContext)) {
			errors.push(`entry ${entry.id} names an unknown owning context`);
		}

		// Layer shape: a contract is domain-versioned and context-owned, an
		// artifact is context-owned but versions through its own schema, an
		// invariant is cross-cutting and therefore owned by neither.
		if (entry.kind === "contract" && (!entry.versionDomain || !entry.owningContext)) {
			errors.push(`contract entry ${entry.id} must name a version domain and an owning context`);
		}
		if (entry.kind === "artifact" && (!entry.owningContext || entry.versionDomain !== null)) {
			errors.push(`artifact entry ${entry.id} must own a context and carry no version domain`);
		}
		if (
			entry.kind === "invariant" &&
			(entry.versionDomain !== null || entry.owningContext !== null)
		) {
			errors.push(`invariant entry ${entry.id} must be cross-cutting, not owned`);
		}
		if (Boolean(entry.crossCutting) !== (entry.kind === "invariant")) {
			errors.push(`entry ${entry.id} sets crossCutting on a non-invariant entry`);
		}

		// The derived pair. `compatibility` and `masterConcept` are consequences
		// of the measured `implementation`, so they are checked as equalities: a
		// registry where they can disagree is a registry with two verdicts.
		const implemented = entry.implementation === "implemented";
		if ((entry.compatibility === "supported") !== implemented) {
			errors.push(
				`entry ${entry.id} is ${entry.implementation} but ${entry.compatibility}; compatibility is derived`,
			);
		}
		const namingGap = entry.masterConcept === null;
		if (namingGap !== (entry.implementation === "designed-not-implemented")) {
			errors.push(
				`entry ${entry.id} ${namingGap ? "omits" : "names"} a master concept for a ${entry.implementation} entry`,
			);
		}

		// Every verdict must be backed: implemented by a pointer, everything else
		// by a stated reason.
		const paths = entry.paths || [];
		if (implemented && paths.length === 0) {
			errors.push(`implemented entry ${entry.id} carries no path`);
		}
		if (
			!implemented &&
			paths.length === 0 &&
			!entry.note &&
			!entry.nameCollision &&
			!(entry.nearMisses || []).length
		) {
			errors.push(`entry ${entry.id} is ${entry.implementation} with no justification surface`);
		}
		if (entry.implementation === "superseded" && !entry.supersededBy && !entry.note) {
			errors.push(`superseded entry ${entry.id} names neither its successor nor a reason`);
		}
	}

	for (const kind of KINDS) {
		if (!registry.entries.some((entry) => entry.kind === kind)) {
			errors.push(`registry carries no ${kind} entries`);
		}
	}

	return errors;
}

function compatibilityErrors(registry, schema) {
	const errors = [];
	const cases = registry.compatibility.cases || [];
	const caseIds = cases.map((entry) => entry.caseId);
	const evidenceIds = cases.map((entry) => entry.evidenceId);
	const outcomes = cases.map((entry) => entry.expectedOutcome);

	if (hasDuplicates(caseIds)) {
		errors.push("compatibility case identifiers must be unique");
	}
	if (hasDuplicates(evidenceIds)) {
		errors.push("compatibility evidence identifiers must be unique");
	}
	for (const expectedOutcome of expectedOutcomesFrom(schema)) {
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

	const domainIds = domainIdsFrom(schema);
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
		if (
			compatibilityCase.evidenceId !==
			deriveEvidenceId(compatibilityCase.expectedOutcome, compatibilityCase.combination, domainIds)
		) {
			errors.push(
				`case ${compatibilityCase.caseId} has an evidence identifier unrelated to its combination`,
			);
		}
	}

	// The rollup is a summary, so it must equal what it summarizes.
	const rollup = registry.compatibility.entryRollup;
	const counted = registry.entries.reduce(
		(acc, entry) => ({ ...acc, [entry.compatibility]: (acc[entry.compatibility] || 0) + 1 }),
		{},
	);
	for (const outcome of Object.keys(counted)) {
		if (rollup[outcome] !== counted[outcome]) {
			errors.push(
				`entry rollup says ${rollup[outcome]} ${outcome} entries but there are ${counted[outcome]}`,
			);
		}
	}

	return errors;
}

// Every pointer must resolve. This is the check the rebuild exists for: the
// superseded registry's verdicts had nothing behind them, and a pointer that
// resolves to nothing is the same failure with better spelling. Git-tracked-ness
// is deliberately not checked here — that is a review-time question, and an
// installed package has no repository to ask.
function pointerErrors(registry, root = ROOT) {
	const errors = [];
	const pointers = [];
	for (const entry of registry.entries) {
		for (const pointer of entry.paths || []) pointers.push([`entry ${entry.id}`, pointer]);
		for (const near of entry.nearMisses || []) {
			pointers.push([`entry ${entry.id} near miss`, near.path]);
		}
	}
	for (const domain of registry.versionDomains) {
		for (const pointer of domain.paths || [])
			pointers.push([`version domain ${domain.id}`, pointer]);
	}
	for (const context of registry.boundedContexts) {
		for (const pointer of context.paths || [])
			pointers.push([`bounded context ${context.id}`, pointer]);
	}
	for (const pointer of registry.authorityBoundaries.evidence || []) {
		pointers.push(["authority boundary", pointer]);
	}
	for (const [where, pointer] of pointers) {
		if (!fs.existsSync(path.join(root, pointer))) {
			errors.push(`${where} points at ${pointer}, which does not exist`);
		}
	}
	return errors;
}

/**
 * Validate the registry against its schema and against itself.
 * @param {object} [registry]
 * @param {object} [schema]
 * @param {string} [root] - Amber checkout the pointers resolve against.
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateRegistry(registry = loadRegistry(), schema = loadSchema(), root = ROOT) {
	const errors = [
		...schemaErrors(registry),
		...taxonomyErrors(registry, schema),
		...entryErrors(registry, schema),
		...compatibilityErrors(registry, schema),
		...pointerErrors(registry, root),
	];
	return { valid: errors.length === 0, errors };
}

module.exports = {
	loadRegistry,
	loadSchema,
	registryPathFor,
	evaluateCompatibility,
	validateRegistry,
};
