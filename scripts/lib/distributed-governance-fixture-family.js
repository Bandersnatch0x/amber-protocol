"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("ajv");

const { loadRegistry, validateRegistry } = require("./distributed-governance-contract-registry");

const ROOT = path.resolve(__dirname, "..", "..");
const FIXTURE_FAMILY_PATH = path.join(
	ROOT,
	"docs",
	"architecture",
	"distributed-governance-fixture-family.json",
);
const SCHEMA_PATH = path.join(ROOT, "schemas", "distributed-governance-fixture-family.schema.json");

const REQUIRED_PROFILE_IDS = ["personal-node", "team-hub", "organization-profile"];
const REQUIRED_VARIANT_CATEGORIES = [
	"unknown-version",
	"incompatible-version",
	"silent-downgrade",
	"stale-generation",
	"unresolved-conflict",
	"corruption",
	"revoked-authorization",
	"exact-scope-deny-wins",
	"retention-deletion",
	"cross-tenant-escape",
	"execution-boundary-escape",
	"projection-divergence",
	"disclosure",
	"replay",
	"stale-authorization",
	"provenance-forgery",
	"secret-replication",
	"credential-replication",
	"source-replication",
	"arbitrary-file-replication",
	"cross-repository-scope-escape",
	"deny-wins-bypass",
	"compromised-person-surface",
	"compromised-component-surface",
	"compromised-transport-surface",
	"compromised-store-surface",
	"compromised-projection-surface",
	"compromised-admin-surface",
];
const REQUIRED_OUTPUT_KINDS = [
	"golden-envelope",
	"golden-projection",
	"query-envelope",
	"read-snapshot",
	"projection-receipt",
	"knowledge-lifecycle-receipt",
	"replay-result",
	"idempotence-result",
	"migration-evidence",
	"checkpoint-evidence",
	"fencing-evidence",
	"mixed-version-evidence",
	"rebuild-parity",
	"adversarial-evidence",
];

function resolveTargetRelativePath(targetRoot, relativePath) {
	if (
		typeof relativePath !== "string" ||
		relativePath.length === 0 ||
		path.isAbsolute(relativePath)
	) {
		throw new Error("target-relative path must be a non-empty relative path");
	}
	const resolvedPath = path.resolve(targetRoot, relativePath);
	const relativeToTarget = path.relative(path.resolve(targetRoot), resolvedPath);
	if (!relativeToTarget || relativeToTarget.startsWith("..") || path.isAbsolute(relativeToTarget)) {
		throw new Error("target-relative path must stay inside the target");
	}
	return resolvedPath;
}

function loadFixtureFamily(fixtureFamilyPath = FIXTURE_FAMILY_PATH) {
	return JSON.parse(fs.readFileSync(fixtureFamilyPath, "utf8"));
}

function loadSchema(schemaPath = SCHEMA_PATH) {
	return JSON.parse(fs.readFileSync(schemaPath, "utf8"));
}

function canonicalize(value) {
	if (Array.isArray(value)) {
		return value.map(canonicalize);
	}
	if (value && typeof value === "object") {
		return Object.keys(value)
			.sort()
			.reduce((accumulator, key) => {
				accumulator[key] = canonicalize(value[key]);
				return accumulator;
			}, {});
	}
	return value;
}

function computeGoldenOutputDigest(fixtureFamily, goldenOutput) {
	const fixturesById = new Map();
	for (const fixture of fixtureFamily.fixtures) {
		fixturesById.set(fixture.fixtureId, fixture);
	}
	for (const variant of fixtureFamily.adversarialVariants) {
		fixturesById.set(variant.variantId, variant);
	}

	const payload = {
		outputId: goldenOutput.outputId,
		outputKind: goldenOutput.outputKind,
		fixtureIds: goldenOutput.fixtureIds,
		expectedOutput: goldenOutput.expectedOutput,
		fixtures: goldenOutput.fixtureIds.map((fixtureId) => fixturesById.get(fixtureId).inputs),
	};
	const canonical = JSON.stringify(canonicalize(payload));
	return crypto.createHash("sha256").update(canonical).digest("hex");
}

function hasSameMembers(values, expectedValues) {
	const uniqueValues = new Set(values);
	const uniqueExpected = new Set(expectedValues);
	return (
		uniqueValues.size === uniqueExpected.size &&
		expectedValues.every((value) => uniqueValues.has(value))
	);
}

function hasDuplicates(values) {
	return new Set(values).size !== values.length;
}

function escapesTarget(relativePath) {
	const normalizedPath = path.normalize(relativePath);
	return normalizedPath === ".." || normalizedPath.startsWith(`..${path.sep}`);
}

function validateFixtureFamily(fixtureFamily, registry = loadRegistry()) {
	const errors = [];
	const registryResult = validateRegistry(registry);
	if (!registryResult.valid) {
		for (const error of registryResult.errors) {
			errors.push(`contract registry: ${error}`);
		}
	}

	const ajv = new Ajv({ allErrors: true });
	const schema = loadSchema();
	const schemaValid = ajv.validate(schema, fixtureFamily);
	if (!schemaValid) {
		for (const error of ajv.errors) {
			errors.push(`${error.instancePath || "/"} ${error.message}`);
		}
		return { valid: false, errors };
	}

	if (fixtureFamily.fixtureFamilyId !== "amber.distributed-governance.fixture-family") {
		errors.push("fixture family identifier is not canonical");
	}
	if (fixtureFamily.sourceBaseline !== "docs/architecture/distributed-governance-baseline.md") {
		errors.push("fixture family must name the accepted architecture baseline");
	}
	if (
		typeof fixtureFamily.sourceRegistry !== "string" ||
		path.isAbsolute(fixtureFamily.sourceRegistry) ||
		escapesTarget(fixtureFamily.sourceRegistry)
	) {
		errors.push("fixture family source registry must be target-relative");
	}
	if (fixtureFamily.sourceBaseline !== registry.sourceBaseline) {
		errors.push("fixture family and contract registry disagree on the source baseline");
	}
	if (
		fixtureFamily.authorityBoundaries.repositoryLocalAuthority !== true ||
		fixtureFamily.authorityBoundaries.offlineCapability !== true ||
		fixtureFamily.authorityBoundaries.executesAnything !== false ||
		fixtureFamily.authorityBoundaries.appendOnlyLineage !== true ||
		fixtureFamily.authorityBoundaries.languageBoundary !== "amber-internal"
	) {
		errors.push(
			"fixture family must preserve repository-local, offline, no-execution, append-only, and Amber language boundaries",
		);
	}

	const profileIds = fixtureFamily.profiles.map((profile) => profile.id);
	if (hasDuplicates(profileIds)) {
		errors.push("profile identifiers must be unique");
	}
	if (!hasSameMembers(profileIds, REQUIRED_PROFILE_IDS)) {
		errors.push("fixture family must declare exactly the three required profiles");
	}

	const canonicalProfileIds = fixtureFamily.fixtures
		.filter((fixture) => fixture.kind === "canonical")
		.map((fixture) => fixture.profile);
	if (hasDuplicates(canonicalProfileIds)) {
		errors.push("canonical fixture profiles must be unique");
	}
	if (!hasSameMembers(canonicalProfileIds, REQUIRED_PROFILE_IDS)) {
		errors.push("fixture family must contain one canonical fixture for each required profile");
	}

	const profileEvidenceRequirements = {
		"personal-node": [
			["localScope", "tenant"],
			["localScope", "organization"],
			["localScope", "person"],
			["agentIdentities"],
			["repositoryRegistrations"],
			["decisions"],
			["evidence"],
			["knowledgeCandidates"],
			["offlineOperation"],
			["localProjections"],
		],
		"team-hub": [
			["organizationControlPlane", "personIdentities"],
			["organizationControlPlane", "agentIdentities"],
			["organizationControlPlane", "team"],
			["organizationControlPlane", "memberships"],
			["organizationControlPlane", "repositoryRegistrations"],
			["organizationControlPlane", "roleAssignments"],
			["organizationControlPlane", "policyAssignments"],
			["syncRuntime", "syncSession"],
			["syncRuntime", "envelopes"],
			["syncRuntime", "checkpoint"],
			["sharedProjections"],
		],
		"organization-profile": [
			["organizationControlPlane", "personIdentities"],
			["organizationControlPlane", "agentIdentities"],
			["organizationControlPlane", "repositoryRegistrations"],
			["organizationControlPlane", "roleAssignments"],
			["organizationControlPlane", "policyAssignments"],
			["organizationControlPlane", "administrativeFencing"],
			["boundedContextEvidence"],
			["crossRepositoryGovernance"],
		],
	};
	for (const fixture of fixtureFamily.fixtures) {
		const requirements = profileEvidenceRequirements[fixture.profile] ?? [];
		for (const requirement of requirements) {
			const [containerName, propertyName] = requirement;
			const container =
				propertyName === undefined ? fixture.inputs : fixture.inputs?.[containerName];
			const evidence = propertyName === undefined ? container : container?.[propertyName];
			if (!evidence) {
				const evidenceName =
					propertyName === undefined ? containerName : `${containerName}.${propertyName}`;
				errors.push(
					`canonical fixture ${fixture.fixtureId} omits ${evidenceName} profile evidence`,
				);
			}
		}
	}

	const variantCategories = fixtureFamily.adversarialVariants.map((variant) => variant.category);
	if (hasDuplicates(variantCategories)) {
		errors.push("adversarial variant categories must be unique");
	}
	if (!hasSameMembers(variantCategories, REQUIRED_VARIANT_CATEGORIES)) {
		errors.push("fixture family must contain every required adversarial variant category");
	}

	const outputKinds = fixtureFamily.goldenOutputs.map((output) => output.outputKind);
	if (hasDuplicates(outputKinds)) {
		errors.push("golden output kinds must be unique");
	}
	if (!hasSameMembers(outputKinds, REQUIRED_OUTPUT_KINDS)) {
		errors.push("fixture family must contain every required golden output kind");
	}

	const fixtureIds = fixtureFamily.fixtures.map((fixture) => fixture.fixtureId);
	if (hasDuplicates(fixtureIds)) {
		errors.push("fixture identifiers must be unique");
	}
	const variantIds = fixtureFamily.adversarialVariants.map((variant) => variant.variantId);
	if (hasDuplicates(variantIds)) {
		errors.push("adversarial variant identifiers must be unique");
	}
	const outputIds = fixtureFamily.goldenOutputs.map((output) => output.outputId);
	if (hasDuplicates(outputIds)) {
		errors.push("golden output identifiers must be unique");
	}
	const criterionIds = fixtureFamily.acceptanceMatrix.map((criterion) => criterion.criterionId);
	if (hasDuplicates(criterionIds)) {
		errors.push("acceptance criterion identifiers must be unique");
	}

	const knownFixtureIds = new Set([...fixtureIds, ...variantIds]);
	for (const variant of fixtureFamily.adversarialVariants) {
		if (!knownFixtureIds.has(variant.baseFixtureId)) {
			errors.push(`adversarial variant ${variant.variantId} names an unknown base fixture`);
		}
	}

	const knownOutputIds = new Set(outputIds);
	for (const goldenOutput of fixtureFamily.goldenOutputs) {
		const hasUnknownFixtureReference = goldenOutput.fixtureIds.some(
			(fixtureId) => !knownFixtureIds.has(fixtureId),
		);
		for (const fixtureId of goldenOutput.fixtureIds) {
			if (!knownFixtureIds.has(fixtureId)) {
				errors.push(`golden output ${goldenOutput.outputId} names an unknown fixture`);
			}
		}

		const recordIds = goldenOutput.expectedOutput.records.map((record) => record.recordId);
		if (hasDuplicates(recordIds)) {
			errors.push(`golden output ${goldenOutput.outputId} has duplicate expected records`);
		}
		if (JSON.stringify(recordIds) !== JSON.stringify(goldenOutput.expectedOutput.order)) {
			errors.push(
				`golden output ${goldenOutput.outputId} expected record order does not match records`,
			);
		}
		const positions = goldenOutput.expectedOutput.records.map((record) => record.position);
		const expectedPositions = goldenOutput.expectedOutput.records.map((_, index) => index + 1);
		if (JSON.stringify(positions) !== JSON.stringify(expectedPositions)) {
			errors.push(
				`golden output ${goldenOutput.outputId} expected record positions are not canonical`,
			);
		}
		for (const omission of goldenOutput.expectedOutput.omissionRedactionReasons ?? []) {
			if (!recordIds.includes(omission.recordId)) {
				errors.push(
					`golden output ${goldenOutput.outputId} gives an omission reason for an unknown record`,
				);
			}
		}

		if (!hasUnknownFixtureReference) {
			const actualDigest = computeGoldenOutputDigest(fixtureFamily, goldenOutput);
			if (actualDigest !== goldenOutput.digest) {
				errors.push(`golden output ${goldenOutput.outputId} rejects its changed expected output`);
			}
		}
	}

	const registryContextIds = new Set(registry.boundedContexts.map((context) => context.id));
	const registryEntriesById = new Map(registry.entries.map((entry) => [entry.id, entry]));
	const invariantEntryIds = new Set(
		registry.entries.filter((entry) => entry.kind === "invariant").map((entry) => entry.id),
	);
	for (const criterion of fixtureFamily.acceptanceMatrix) {
		if (!["154", "158"].includes(criterion.sourceDecision)) {
			errors.push(
				`acceptance criterion ${criterion.criterionId} must trace to source decision 154 or 158`,
			);
		}
		if (!registryContextIds.has(criterion.owningContext)) {
			errors.push(`acceptance criterion ${criterion.criterionId} names an unknown owning context`);
		}
		if (!invariantEntryIds.has(criterion.invariant)) {
			errors.push(`acceptance criterion ${criterion.criterionId} names an unknown invariant`);
		}
		const requiredEntry = registryEntriesById.get(criterion.requiredArtifactOrContract);
		if (!requiredEntry) {
			errors.push(
				`acceptance criterion ${criterion.criterionId} names an unknown required artifact or contract`,
			);
		}
		if (requiredEntry && requiredEntry.owningContext !== criterion.owningContext) {
			errors.push(
				`acceptance criterion ${criterion.criterionId} and its required artifact disagree on the owning context`,
			);
		}
		for (const goldenOutputId of criterion.goldenOutputIds) {
			if (!knownOutputIds.has(goldenOutputId)) {
				errors.push(`acceptance criterion ${criterion.criterionId} names an unknown golden output`);
			}
		}
	}

	const coveredInvariantIds = new Set(
		fixtureFamily.acceptanceMatrix.map((criterion) => criterion.invariant),
	);
	for (const invariantId of invariantEntryIds) {
		if (!coveredInvariantIds.has(invariantId)) {
			errors.push(`acceptance matrix omits invariant ${invariantId}`);
		}
	}

	const coveredThreatCategories = new Set(
		fixtureFamily.acceptanceMatrix
			.map((criterion) => criterion.threatCategory)
			.filter((category) => category !== undefined),
	);
	for (const category of REQUIRED_VARIANT_CATEGORIES) {
		if (!coveredThreatCategories.has(category)) {
			errors.push(`acceptance matrix omits threat category ${category}`);
		}
	}

	return { valid: errors.length === 0, errors };
}

module.exports = {
	FIXTURE_FAMILY_PATH,
	SCHEMA_PATH,
	REQUIRED_PROFILE_IDS,
	REQUIRED_VARIANT_CATEGORIES,
	REQUIRED_OUTPUT_KINDS,
	resolveTargetRelativePath,
	loadFixtureFamily,
	loadSchema,
	canonicalize,
	computeGoldenOutputDigest,
	validateFixtureFamily,
};
