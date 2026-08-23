"use strict";

/**
 * Deterministic fixture family for governance-loop acceptance (#160).
 *
 * A fixture is a committed JSON file under tests/fixtures/governance/ that
 * encodes the inputs and golden expected outcome for one governance path.
 * The family is the set of all committed fixture files. This loader reads,
 * validates, and returns them as a stable, diffable surface.
 *
 * The runner (scripts/demo/e2e-governance-loop-verify.js) exercises paths on
 * fresh temp targets. The fixture family makes those paths deterministic and
 * regression-detectable: a golden mismatch fails the suite.
 */

const fs = require("node:fs");
const path = require("node:path");

const FIXTURES_DIR = path.resolve(__dirname, "..", "..", "..", "tests", "fixtures", "governance");
const MANIFEST_SCHEMA_PATH = path.join(FIXTURES_DIR, "manifest.schema.json");

const PATH_IDS = Object.freeze([
	"success",
	"rejection",
	"verify-fail-recover",
	"cross-session-handoff",
]);
const DEPLOYMENT_PROFILES = Object.freeze(["personal-node", "team-hub", "organization"]);
const VARIANTS = Object.freeze(["canonical", "adversarial"]);

/**
 * Load and validate a single fixture file.
 * @param {string} fixturePath - Absolute path to a fixture JSON file.
 * @returns {{fixture: object, path: string}} The validated fixture and its source path.
 * @throws {Error} If the file is missing, unparseable, or fails manifest validation.
 */
function loadFixture(fixturePath) {
	const resolved = path.resolve(fixturePath);
	if (!fs.existsSync(resolved)) {
		throw new Error(`fixture not found: ${resolved}`);
	}
	let raw;
	try {
		raw = JSON.parse(fs.readFileSync(resolved, "utf8"));
	} catch (err) {
		throw new Error(`fixture ${resolved} is not valid JSON: ${err.message}`, { cause: err });
	}
	validateFixture(raw, resolved);
	return { fixture: raw, path: resolved };
}

/**
 * Validate a fixture object against the manifest rules.
 * Structural checks mirror manifest.schema.json but are implemented in JS so
 * the loader has no runtime dependency on a JSON-schema validator.
 * @param {object} raw - The parsed fixture object.
 * @param {string} sourcePath - Path for error messages.
 * @throws {Error} On any validation failure.
 */
function validateFixture(raw, sourcePath) {
	const label = sourcePath || "<inline>";
	const prefix = `fixture ${label}:`;
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error(`${prefix} expected a JSON object`);
	}
	for (const field of ["schemaVersion", "fixtureId", "path", "description", "inputs", "golden"]) {
		if (!(field in raw)) {
			throw new Error(`${prefix} missing required field "${field}"`);
		}
	}
	if (raw.schemaVersion !== "1.0.0") {
		throw new Error(
			`${prefix} unsupported schemaVersion "${raw.schemaVersion}" (expected "1.0.0")`,
		);
	}
	if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(raw.fixtureId)) {
		throw new Error(`${prefix} fixtureId "${raw.fixtureId}" must be kebab-case`);
	}
	if (!PATH_IDS.includes(raw.path)) {
		throw new Error(`${prefix} path "${raw.path}" must be one of: ${PATH_IDS.join(", ")}`);
	}
	const variant = raw.variant || "canonical";
	if (!VARIANTS.includes(variant)) {
		throw new Error(`${prefix} variant "${variant}" must be one of: ${VARIANTS.join(", ")}`);
	}
	if (raw.deploymentProfile && !DEPLOYMENT_PROFILES.includes(raw.deploymentProfile)) {
		throw new Error(
			`${prefix} deploymentProfile "${raw.deploymentProfile}" must be one of: ${DEPLOYMENT_PROFILES.join(", ")}`,
		);
	}
	const inputs = raw.inputs;
	if (typeof inputs !== "object" || inputs === null || Array.isArray(inputs)) {
		throw new Error(`${prefix} inputs must be an object`);
	}
	if (!inputs.targetSeed || typeof inputs.targetSeed !== "object") {
		throw new Error(`${prefix} inputs.targetSeed is required`);
	}
	const seed = inputs.targetSeed;
	if (!seed.packageJson || typeof seed.packageJson !== "object") {
		throw new Error(`${prefix} inputs.targetSeed.packageJson is required`);
	}
	if (typeof seed.initialCommit !== "boolean") {
		throw new Error(`${prefix} inputs.targetSeed.initialCommit must be boolean`);
	}
	const golden = raw.golden;
	if (typeof golden !== "object" || golden === null) {
		throw new Error(`${prefix} golden must be an object`);
	}
	if (typeof golden.exitCode !== "number" || golden.exitCode < 0 || golden.exitCode > 1) {
		throw new Error(`${prefix} golden.exitCode must be 0 or 1`);
	}
	if (typeof golden.summary !== "object" || golden.summary === null) {
		throw new Error(`${prefix} golden.summary is required`);
	}
	if (Array.isArray(golden.summary.highFindings)) {
		for (const id of golden.summary.highFindings) {
			if (typeof id !== "string") {
				throw new Error(`${prefix} golden.summary.highFindings must be an array of strings`);
			}
		}
	}
}

/**
 * Load the entire fixture family (every .json file under tests/fixtures/governance/
 * except the manifest schema itself).
 * @returns {{fixtures: Array<{fixture: object, path: string}>, errors: string[]}}
 */
function loadFamily() {
	const fixtures = [];
	const errors = [];
	if (!fs.existsSync(FIXTURES_DIR)) {
		return { fixtures, errors };
	}
	const files = fs
		.readdirSync(FIXTURES_DIR)
		.filter((name) => name.endsWith(".json") && name !== "manifest.schema.json")
		.sort();
	for (const name of files) {
		const fullPath = path.join(FIXTURES_DIR, name);
		try {
			const { fixture } = loadFixture(fullPath);
			fixtures.push({ fixture, path: fullPath });
		} catch (err) {
			errors.push(err.message);
		}
	}
	return { fixtures, errors };
}

/**
 * Assert that the fixture family has no duplicate fixtureIds.
 * @param {Array<{fixture: object}>} fixtures - Loaded fixtures.
 * @returns {string[]} List of duplicate-id error messages (empty if none).
 */
function detectDuplicateIds(fixtures) {
	const seen = new Map();
	const duplicates = [];
	for (const { fixture } of fixtures) {
		const id = fixture.fixtureId;
		if (seen.has(id)) {
			duplicates.push(`duplicate fixtureId "${id}" (also defined in ${seen.get(id)})`);
		} else {
			seen.set(id, fixture.fixtureId);
		}
	}
	return duplicates;
}

module.exports = {
	FIXTURES_DIR,
	MANIFEST_SCHEMA_PATH,
	PATH_IDS,
	DEPLOYMENT_PROFILES,
	VARIANTS,
	loadFixture,
	validateFixture,
	loadFamily,
	detectDuplicateIds,
};
