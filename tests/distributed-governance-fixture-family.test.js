"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const {
	REQUIRED_OUTPUT_KINDS,
	REQUIRED_VARIANT_CATEGORIES,
	computeGoldenOutputDigest,
	loadFixtureFamily,
	validateFixtureFamily,
} = require("../scripts/lib/distributed-governance-fixture-family");
const { loadRegistry } = require("../scripts/lib/distributed-governance-contract-registry");

const repoRoot = path.resolve(__dirname, "..");
const fixtureFamily = loadFixtureFamily();
const registry = loadRegistry();
const registryEntriesById = new Map(registry.entries.map((entry) => [entry.id, entry]));
const invariantEntries = registry.entries.filter((entry) => entry.kind === "invariant");
const contextIds = new Set(registry.boundedContexts.map((context) => context.id));
const requiredProfiles = ["personal-node", "team-hub", "organization-profile"];

function cloneFixtureFamily() {
	return JSON.parse(JSON.stringify(fixtureFamily));
}

test("fixture family validates against schema and semantic rules", () => {
	const result = validateFixtureFamily(fixtureFamily);
	assert.deepEqual(result.errors, []);
	assert.equal(result.valid, true);
});

test("one canonical fixture family supports all three profile tracers", () => {
	const profiles = fixtureFamily.profiles.map((profile) => profile.id);
	assert.deepEqual(profiles.sort(), [...requiredProfiles].sort());

	const canonicalProfiles = fixtureFamily.fixtures
		.filter((fixture) => fixture.kind === "canonical")
		.map((fixture) => fixture.profile);
	assert.deepEqual(canonicalProfiles.sort(), [...requiredProfiles].sort());

	const personal = fixtureFamily.fixtures.find((fixture) => fixture.profile === "personal-node");
	assert.deepEqual(Object.keys(personal.inputs.localScope).sort(), [
		"organization",
		"person",
		"tenant",
	]);
	assert.equal(personal.inputs.agentIdentities.length > 0, true);
	assert.equal(personal.inputs.repositoryRegistrations.length > 0, true);
	assert.equal(personal.inputs.decisions.length > 0, true);
	assert.equal(personal.inputs.evidence.length > 0, true);
	assert.equal(personal.inputs.knowledgeCandidates.length > 0, true);
	assert.equal(personal.inputs.offlineOperation.required, true);
	assert.deepEqual(
		personal.inputs.localProjections.map((projection) => projection.context).sort(),
		["governance-graph", "governed-knowledge-base", "visualization-workbench"],
	);

	const team = fixtureFamily.fixtures.find((fixture) => fixture.profile === "team-hub");
	for (const property of [
		"personIdentities",
		"agentIdentities",
		"team",
		"memberships",
		"repositoryRegistrations",
		"roleAssignments",
		"policyAssignments",
	]) {
		assert.equal(team.inputs.organizationControlPlane[property] !== undefined, true);
	}
	for (const property of ["syncSession", "envelopes", "checkpoint"]) {
		assert.equal(team.inputs.syncRuntime[property] !== undefined, true);
	}
	assert.equal(team.inputs.sharedProjections.length > 0, true);

	const organization = fixtureFamily.fixtures.find(
		(fixture) => fixture.profile === "organization-profile",
	);
	assert.deepEqual(
		organization.inputs.boundedContextEvidence.map((evidence) => evidence.context).sort(),
		[
			"amber-core",
			"governance-graph",
			"governed-knowledge-base",
			"organization-control-plane",
			"sync-runtime",
			"visualization-workbench",
		],
	);
	assert.equal(organization.inputs.crossRepositoryGovernance.scope, "organization-wide");
});

test("semantic validation rejects duplicate profile identifiers", () => {
	const family = cloneFixtureFamily();
	family.profiles.push({ ...family.profiles[0], title: `${family.profiles[0].title} duplicate` });
	const result = validateFixtureFamily(family);

	assert.equal(result.valid, false);
	assert.equal(result.errors.includes("profile identifiers must be unique"), true);
});

test("semantic validation rejects a second canonical fixture for a profile", () => {
	const family = cloneFixtureFamily();
	family.fixtures.push({ ...family.fixtures[0], fixtureId: "DG-FIXTURE-PERSONAL-NODE-002" });
	const result = validateFixtureFamily(family);

	assert.equal(result.valid, false);
	assert.equal(result.errors.includes("canonical fixture profiles must be unique"), true);
});

test("adversarial variants cover every required evidence category", () => {
	const categories = fixtureFamily.adversarialVariants.map((variant) => variant.category);
	assert.deepEqual([...new Set(categories)].sort(), [...REQUIRED_VARIANT_CATEGORIES].sort());

	for (const variant of fixtureFamily.adversarialVariants) {
		assert.equal(variant.inputs.adversarialVariant.category, variant.category);
		assert.equal(variant.inputs.adversarialVariant.expectedOutcome, variant.expectedOutcome);
		assert.equal(variant.inputs.adversarialVariant.threatEvidence !== undefined, true);
	}
});

test("semantic validation rejects duplicate adversarial variant categories", () => {
	const family = cloneFixtureFamily();
	family.adversarialVariants.push({
		...family.adversarialVariants[0],
		variantId: "DG-FIXTURE-ADVERSARIAL-UNKNOWN-VERSION-002",
	});
	const result = validateFixtureFamily(family);

	assert.equal(result.valid, false);
	assert.equal(result.errors.includes("adversarial variant categories must be unique"), true);
});

test("golden outputs bind deterministic expected outputs and named inputs", () => {
	const outputKinds = fixtureFamily.goldenOutputs.map((output) => output.outputKind);
	assert.deepEqual([...new Set(outputKinds)].sort(), [...REQUIRED_OUTPUT_KINDS].sort());

	for (const goldenOutput of fixtureFamily.goldenOutputs) {
		const first = computeGoldenOutputDigest(fixtureFamily, goldenOutput);
		const second = computeGoldenOutputDigest(fixtureFamily, { ...goldenOutput });
		assert.equal(first, second);
		assert.equal(first, goldenOutput.digest);

		const recordIds = goldenOutput.expectedOutput.records.map((record) => record.recordId);
		assert.deepEqual(goldenOutput.expectedOutput.order, recordIds);
		assert.deepEqual(
			goldenOutput.expectedOutput.records.map((record) => record.position),
			recordIds.map((_, index) => index + 1),
		);
	}

	const changed = JSON.parse(JSON.stringify(fixtureFamily));
	changed.goldenOutputs[0].expectedOutput.records[0].content = "changed expected output";
	const result = validateFixtureFamily(changed);
	assert.equal(result.valid, false);
	assert.equal(
		result.errors.includes(
			"golden output DG-GOLDEN-ENVELOPE-001 rejects its changed expected output",
		),
		true,
	);
});

test("semantic validation rejects duplicate golden output kinds", () => {
	const family = cloneFixtureFamily();
	const duplicateOutput = {
		...family.goldenOutputs[0],
		outputId: "DG-GOLDEN-ENVELOPE-002",
	};
	duplicateOutput.digest = computeGoldenOutputDigest(family, duplicateOutput);
	family.goldenOutputs.push(duplicateOutput);
	const result = validateFixtureFamily(family);

	assert.equal(result.valid, false);
	assert.equal(result.errors.includes("golden output kinds must be unique"), true);
});

test("semantic validation rejects pattern-valid unknown fixture references without a TypeError", () => {
	const family = cloneFixtureFamily();
	family.goldenOutputs[0].fixtureIds[0] = "DG-FIXTURE-UNKNOWN-001";
	const result = validateFixtureFamily(family);

	assert.equal(result.valid, false);
	assert.equal(
		result.errors.includes("golden output DG-GOLDEN-ENVELOPE-001 names an unknown fixture"),
		true,
	);
});

test("acceptance criteria cover every invariant and adversarial threat", () => {
	const criterionIds = new Set();
	const outputIds = new Set(fixtureFamily.goldenOutputs.map((output) => output.outputId));
	const coveredInvariants = new Set();
	const coveredThreats = new Set();

	for (const criterion of fixtureFamily.acceptanceMatrix) {
		assert.match(criterion.criterionId, /^DG-ACC-[A-Z0-9-]+$/);
		assert.equal(criterionIds.has(criterion.criterionId), false);
		criterionIds.add(criterion.criterionId);
		assert.equal(["154", "158"].includes(criterion.sourceDecision), true);
		assert.match(criterion.evidenceType, /^[a-z0-9-]+(-adversary)?-digest$/);
		assert.equal(contextIds.has(criterion.owningContext), true);
		const requiredEntry = registryEntriesById.get(criterion.requiredArtifactOrContract);
		assert.equal(requiredEntry.owningContext, criterion.owningContext);
		assert.match(criterion.invariant, /^amber\.distributed-governance\.invariant\.[a-z0-9-]+$/);
		assert.match(
			criterion.requiredArtifactOrContract,
			/^amber\.distributed-governance\.(contract|invariant)\.[a-z0-9-]+$/,
		);
		for (const goldenOutputId of criterion.goldenOutputIds) {
			assert.equal(outputIds.has(goldenOutputId), true);
		}
		coveredInvariants.add(criterion.invariant);
		if (criterion.threatCategory !== undefined) {
			coveredThreats.add(criterion.threatCategory);
		}
	}

	assert.deepEqual([...coveredInvariants].sort(), invariantEntries.map((entry) => entry.id).sort());
	assert.deepEqual([...coveredThreats].sort(), [...REQUIRED_VARIANT_CATEGORIES].sort());
});

test("fixture family preserves repository-local, offline, no-execution, append-only boundaries", () => {
	assert.deepEqual(fixtureFamily.authorityBoundaries, {
		repositoryLocalAuthority: true,
		offlineCapability: true,
		executesAnything: false,
		appendOnlyLineage: true,
		languageBoundary: "amber-internal",
	});
});

test("target validation uses the registry declared by the target", () => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-fixture-family-"));
	const resolvedTarget = path.resolve(target);
	const temporaryRoot = path.resolve(os.tmpdir());
	assert.equal(resolvedTarget.startsWith(temporaryRoot + path.sep), true);
	try {
		fs.mkdirSync(path.join(target, "docs", "architecture"), { recursive: true });
		fs.writeFileSync(
			path.join(target, "docs", "architecture", "distributed-governance-fixture-family.json"),
			JSON.stringify(fixtureFamily, null, "\t"),
		);
		const inconsistentRegistry = JSON.parse(JSON.stringify(registry));
		inconsistentRegistry.entries = inconsistentRegistry.entries.filter(
			(entry) => entry.id !== "amber.distributed-governance.contract.read-snapshot",
		);
		fs.writeFileSync(
			path.join(target, "docs", "architecture", "distributed-governance-contract-registry.json"),
			JSON.stringify(inconsistentRegistry, null, "\t"),
		);

		const run = spawnSync(
			process.execPath,
			[path.join(repoRoot, "scripts", "validate-fixture-family.js"), "--target", target, "--json"],
			{ encoding: "utf8" },
		);
		assert.notEqual(run.status, 0);
		assert.match(run.stdout, /names an unknown required artifact or contract/);
		assert.equal(run.stderr, "");
	} finally {
		fs.rmSync(resolvedTarget, { recursive: true, force: true });
	}
});
