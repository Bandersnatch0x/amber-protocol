"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	FIXTURES_DIR,
	PATH_IDS,
	DEPLOYMENT_PROFILES,
	VARIANTS,
	loadFixture,
	validateFixture,
	loadFamily,
	detectDuplicateIds,
} = require("../../scripts/lib/core/fixture-family");

test("fixture family directory exists", () => {
	assert.ok(fs.existsSync(FIXTURES_DIR), `expected fixtures dir at ${FIXTURES_DIR}`);
});

test("manifest schema is committed alongside fixtures", () => {
	const schema = path.join(FIXTURES_DIR, "manifest.schema.json");
	assert.ok(fs.existsSync(schema), "manifest.schema.json must be committed");
	const raw = JSON.parse(fs.readFileSync(schema, "utf8"));
	assert.equal(raw.title, "Governance Fixture Family Manifest");
});

test("loadFamily returns at least the success-minimal fixture with no errors", () => {
	const { fixtures, errors } = loadFamily();
	assert.deepEqual(errors, []);
	assert.ok(fixtures.length >= 1, "expected at least one fixture in the family");
	const ids = fixtures.map((f) => f.fixture.fixtureId).sort();
	assert.ok(ids.includes("success-minimal"), `expected success-minimal, got: ${ids.join(", ")}`);
});

test("every loaded fixture passes validation and has stable identifiers", () => {
	const { fixtures } = loadFamily();
	for (const { fixture, path: sourcePath } of fixtures) {
		assert.ok(
			PATH_IDS.includes(fixture.path),
			`${sourcePath}: path "${fixture.path}" not in ${PATH_IDS.join(", ")}`,
		);
		assert.ok(fixture.fixtureId, `${sourcePath}: fixtureId missing`);
		assert.ok(fixture.description, `${sourcePath}: description missing`);
		assert.ok(
			typeof fixture.golden.exitCode === "number",
			`${sourcePath}: golden.exitCode must be a number`,
		);
		assert.ok(
			typeof fixture.golden.summary === "object",
			`${sourcePath}: golden.summary must be an object`,
		);
	}
});

test("no duplicate fixtureIds in the family", () => {
	const { fixtures } = loadFamily();
	const duplicates = detectDuplicateIds(fixtures);
	assert.deepEqual(duplicates, []);
});

test("loadFixture throws on a missing file", () => {
	assert.throws(
		() => loadFixture(path.join(FIXTURES_DIR, "does-not-exist.json")),
		/fixture not found/,
	);
});

test("validateFixture rejects a fixture with an unsupported path", () => {
	const bad = {
		schemaVersion: "1.0.0",
		fixtureId: "bad-path",
		path: "not-a-real-path",
		description: "x",
		inputs: { targetSeed: { packageJson: {}, initialCommit: true } },
		golden: { exitCode: 0, summary: {} },
	};
	assert.throws(() => validateFixture(bad, "bad-path.json"), /path "not-a-real-path"/);
});

test("validateFixture rejects a fixture with a missing golden.exitCode", () => {
	const bad = {
		schemaVersion: "1.0.0",
		fixtureId: "no-exit",
		path: "success",
		description: "x",
		inputs: { targetSeed: { packageJson: {}, initialCommit: true } },
		golden: { summary: {} },
	};
	assert.throws(() => validateFixture(bad, "no-exit.json"), /golden\.exitCode/);
});

test("the success-minimal golden asserts a closed success path with zero high findings", () => {
	const { fixtures } = loadFamily();
	const success = fixtures.find((f) => f.fixture.fixtureId === "success-minimal");
	assert.ok(success, "success-minimal fixture missing");
	assert.equal(success.fixture.golden.exitCode, 0);
	assert.equal(success.fixture.golden.summary.successClosed, true);
	assert.deepEqual(success.fixture.golden.summary.highFindings, []);
});

test("fixture family schema enumerates the three deployment profiles #160 requires", () => {
	assert.ok(DEPLOYMENT_PROFILES.includes("personal-node"));
	assert.ok(DEPLOYMENT_PROFILES.includes("team-hub"));
	assert.ok(DEPLOYMENT_PROFILES.includes("organization"));
});

test("fixture family schema enumerates canonical and adversarial variants", () => {
	assert.ok(VARIANTS.includes("canonical"));
	assert.ok(VARIANTS.includes("adversarial"));
});

test("the success-minimal fixture targets personal-node deployment profile", () => {
	const { fixtures } = loadFamily();
	const success = fixtures.find((f) => f.fixture.fixtureId === "success-minimal");
	assert.equal(success.fixture.deploymentProfile, "personal-node");
});

test("fixture family covers all three deployment profiles (#160)", () => {
	const { fixtures } = loadFamily();
	const profiles = new Set(fixtures.map((f) => f.fixture.deploymentProfile));
	assert.ok(profiles.has("personal-node"), "missing personal-node fixture");
	assert.ok(profiles.has("team-hub"), "missing team-hub fixture");
	assert.ok(profiles.has("organization"), "missing organization fixture");
});

test("team-hub fixture exists and targets team-hub profile", () => {
	const { fixtures } = loadFamily();
	const teamHub = fixtures.find((f) => f.fixture.fixtureId === "success-team-hub");
	assert.ok(teamHub, "success-team-hub fixture missing");
	assert.equal(teamHub.fixture.deploymentProfile, "team-hub");
	assert.equal(teamHub.fixture.golden.exitCode, 0);
});

test("organization fixture exists and targets organization profile", () => {
	const { fixtures } = loadFamily();
	const org = fixtures.find((f) => f.fixture.fixtureId === "success-organization");
	assert.ok(org, "success-organization fixture missing");
	assert.equal(org.fixture.deploymentProfile, "organization");
	assert.equal(org.fixture.golden.exitCode, 0);
});
