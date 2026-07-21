"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
	resolveRegistryPath,
	validateTeamRegistryData,
	isTeamRegistryValid,
	validateInstallRequest,
	compareSemver,
	latestTeamVersion,
	findTeamVersion,
	summarizeTeamRegistry,
	buildCompatibilityMatrix,
	diffArtifactLists,
	buildTeamUpdatePreview,
	buildRollbackLock,
} = require("../../scripts/lib/core/team");

// Characterization tests for the pure exported helpers in team.js. These
// functions sit behind the fs-coupled install/update/rollback entry points and
// had no direct coverage. Pin current behavior (including the surprising
// edges, like NaN from malformed semver and prerelease stripping) before any
// future refactor of the team distribution pipeline.

// --- resolveRegistryPath ---

test("resolveRegistryPath returns DEFAULT_TEAM_REGISTRY when no path given", () => {
	const result = resolveRegistryPath();
	// DEFAULT_TEAM_REGISTRY points at <repo>/registry/amber-protocol.registry.json
	assert.ok(path.isAbsolute(result));
	assert.ok(result.endsWith(path.join("registry", "amber-protocol.registry.json")));
});

test("resolveRegistryPath passes absolute paths through unchanged", () => {
	const abs = path.resolve("/some/abs/registry.json");
	assert.equal(resolveRegistryPath(abs), abs);
});

test("resolveRegistryPath joins relative paths onto REPO_ROOT", () => {
	const result = resolveRegistryPath("rel/registry.json");
	assert.ok(path.isAbsolute(result));
	assert.ok(result.endsWith(path.join("rel", "registry.json")));
});

// --- compareSemver ---

test("compareSemver returns 0 for equal versions", () => {
	assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
});

test("compareSemver orders by major.minor.patch numerically", () => {
	assert.equal(compareSemver("1.0.0", "1.0.1"), -1);
	assert.equal(compareSemver("1.0.1", "1.0.0"), 1);
	assert.equal(compareSemver("1.10.0", "1.9.0"), 1);
});

test("compareSemver strips prerelease and build metadata before comparing", () => {
	// Both the -rc.1 prerelease and +001 build suffix are split off, so the
	// numeric core is identical -> 0. Prerelease precedence is NOT honored.
	assert.equal(compareSemver("1.0.0-rc.1", "1.0.0"), 0);
	assert.equal(compareSemver("1.0.0+001", "1.0.0"), 0);
});

test("compareSemver coerces non-string inputs via String()", () => {
	assert.equal(compareSemver(1, 2), -1);
});

test("compareSemver yields NaN when a version has fewer than 3 parts", () => {
	// "1.0" splits to ["1","0"], so index 2 is undefined -> Number.parseInt(undefined) = NaN.
	// NaN - 0 === NaN; pin this so a future fix is deliberate.
	assert.ok(Number.isNaN(compareSemver("1.0", "1.0.0")));
});

// --- latestTeamVersion ---

test("latestTeamVersion picks the highest semver via compareSemver sort", () => {
	const registry = { versions: { "1.0.0": {}, "1.2.0": {}, "1.10.0": {} } };
	assert.equal(latestTeamVersion(registry), "1.10.0");
});

test("latestTeamVersion returns undefined when versions is empty or missing", () => {
	assert.equal(latestTeamVersion({}), undefined);
	assert.equal(latestTeamVersion({ versions: {} }), undefined);
	assert.equal(latestTeamVersion({ versions: undefined }), undefined);
});

// --- findTeamVersion ---

test("findTeamVersion returns the requested version and its release", () => {
	const registry = { versions: { "1.0.0": { profile: "p" } } };
	assert.deepEqual(findTeamVersion(registry, "1.0.0"), {
		version: "1.0.0",
		release: { profile: "p" },
	});
});

test("findTeamVersion falls back to latest when no version is given", () => {
	const registry = { versions: { "1.0.0": { profile: "p" } } };
	assert.deepEqual(findTeamVersion(registry), {
		version: "1.0.0",
		release: { profile: "p" },
	});
});

test("findTeamVersion with an unknown version returns the version and an undefined release", () => {
	const registry = { versions: { "1.0.0": { profile: "p" } } };
	const result = findTeamVersion(registry, "9.9.9");
	assert.equal(result.version, "9.9.9");
	// The release key is always present; for an unknown version its value is
	// undefined. JSON.stringify omits it, which is misleading; pin the real
	// shape here.
	assert.equal("release" in result, true);
	assert.equal(result.release, undefined);
});

// --- validateTeamRegistryData ---

test("validateTeamRegistryData rejects non-object input with a single error", () => {
	assert.deepEqual(validateTeamRegistryData(null), {
		errors: ["Team registry must contain an object."],
		warnings: [],
	});
	assert.deepEqual(validateTeamRegistryData([1, 2]), {
		errors: ["Team registry must contain an object."],
		warnings: [],
	});
});

test("validateTeamRegistryData reports every missing top-level field for an empty object", () => {
	const result = validateTeamRegistryData({});
	assert.deepEqual(result, {
		errors: [
			"Team registry name must be amber-protocol-team-registry.",
			"Team registry must define at least one preset.",
			"Team registry must define at least one rule pack.",
			"Team registry must define at least one project profile.",
			"Team registry must define versions.",
		],
		warnings: [],
	});
});

test("validateTeamRegistryData rejects an empty versions object", () => {
	const result = validateTeamRegistryData({
		name: "amber-protocol-team-registry",
		presets: [{ id: "p" }],
		rulePacks: [{ id: "r" }],
		profiles: [{ id: "pr" }],
		versions: {},
	});

	assert.deepEqual(result, {
		errors: ["Team registry must define versions."],
		warnings: [],
	});
});

test("validateTeamRegistryData rejects malformed catalog entries", () => {
	const result = validateTeamRegistryData({
		name: "amber-protocol-team-registry",
		presets: [null],
		rulePacks: ["not-an-object"],
		profiles: [{ id: "" }],
		versions: {
			"1.0.0": {
				preset: "p",
				profile: "pr",
				workflowPacks: [],
				rulePacks: [],
				managedProjectFiles: [],
				compatibility: {},
			},
		},
	});

	assert.deepEqual(result, {
		errors: [
			"Team registry presets[0] must be an object.",
			"Team registry rulePacks[0] must be an object.",
			"Team registry profiles[0] must declare a non-empty id.",
		],
		warnings: [],
	});
});

test("invalid registries stop install validation before registry-derived checks", () => {
	const loaded = {
		registry: null,
		errors: ["Team registry must contain an object."],
		warnings: [],
	};

	assert.equal(isTeamRegistryValid(loaded), false);
	assert.deepEqual(
		validateInstallRequest({
			loaded,
			selected: { version: "1.0.0", release: undefined },
			preset: "safe-bootstrap",
			lockExists: true,
		}),
		{
			errors: ["Team registry must contain an object."],
			warnings: [],
		},
	);
});

test("validateTeamRegistryData flags a non-semver version key", () => {
	const data = {
		name: "amber-protocol-team-registry",
		presets: [{ id: "p" }],
		rulePacks: [{ id: "r" }],
		profiles: [{ id: "pr" }],
		versions: {
			bad: {
				preset: "p",
				profile: "pr",
				workflowPacks: [],
				rulePacks: [],
				managedProjectFiles: [],
				compatibility: {},
			},
		},
	};
	const result = validateTeamRegistryData(data);
	assert.deepEqual(result, {
		errors: ["Registry version bad is not valid semver."],
		warnings: [],
	});
});

test("validateTeamRegistryData flags a release missing compatibility", () => {
	const data = {
		name: "amber-protocol-team-registry",
		presets: [{ id: "p" }],
		rulePacks: [{ id: "r" }],
		profiles: [{ id: "pr" }],
		versions: {
			"1.0.0": {
				preset: "p",
				profile: "pr",
				workflowPacks: [],
				rulePacks: [],
				managedProjectFiles: [],
			},
		},
	};
	const result = validateTeamRegistryData(data);
	assert.deepEqual(result, {
		errors: ["Registry version 1.0.0 must declare compatibility."],
		warnings: [],
	});
});

test("validateTeamRegistryData passes a fully well-formed registry", () => {
	const data = {
		name: "amber-protocol-team-registry",
		presets: [{ id: "p" }],
		rulePacks: [{ id: "r" }],
		profiles: [{ id: "pr" }],
		versions: {
			"1.0.0": {
				preset: "p",
				profile: "pr",
				workflowPacks: [],
				rulePacks: [],
				managedProjectFiles: [],
				compatibility: { os: ["linux"], profileVersion: "1.0.0" },
			},
		},
	};
	const result = validateTeamRegistryData(data);
	assert.deepEqual(result, { errors: [], warnings: [] });
});

// --- summarizeTeamRegistry ---

test("summarizeTeamRegistry projects only the documented fields and drops extras", () => {
	const result = summarizeTeamRegistry({
		name: "n",
		schemaVersion: "1.0.0",
		presets: [1],
		rulePacks: [2],
		profiles: [3],
		versions: { a: 1 },
		extra: "ignored",
	});
	assert.deepEqual(result, {
		name: "n",
		schemaVersion: "1.0.0",
		presets: [1],
		rulePacks: [2],
		profiles: [3],
		versions: { a: 1 },
	});
	assert.equal("extra" in result, false);
});

// --- buildCompatibilityMatrix ---

test("buildCompatibilityMatrix returns static defaults plus empty sets for a versionless registry", () => {
	assert.deepEqual(buildCompatibilityMatrix({}), {
		codex: { minimum: "0.0.0" },
		claudeCode: { support: "optional" },
		os: [],
		runtime: { node: ">=20.0.0" },
		profileVersions: [],
	});
});

test("buildCompatibilityMatrix collects, dedupes, and sorts os and profileVersions across releases", () => {
	const registry = {
		versions: {
			"1.0.0": { compatibility: { os: ["linux", "darwin"], profileVersion: "1.0.0" } },
			"1.2.0": { compatibility: { os: ["linux", "win32"], profileVersion: "1.1.0" } },
			"1.1.0": { compatibility: {} },
		},
	};
	assert.deepEqual(buildCompatibilityMatrix(registry), {
		codex: { minimum: "0.0.0" },
		claudeCode: { support: "optional" },
		os: ["darwin", "linux", "win32"],
		runtime: { node: ">=20.0.0" },
		profileVersions: ["1.0.0", "1.1.0"],
	});
});

// --- diffArtifactLists ---

test("diffArtifactLists defaults both args to empty and returns []", () => {
	assert.deepEqual(diffArtifactLists(), []);
});

test("diffArtifactLists returns only items present in exactly one list, sorted", () => {
	assert.deepEqual(diffArtifactLists(["a"], ["a", "b"]), ["b"]);
	assert.deepEqual(diffArtifactLists(["a", "b"], ["a"]), ["b"]);
	assert.deepEqual(diffArtifactLists(["b", "a"], ["c"]), ["a", "b", "c"]);
});

test("diffArtifactLists returns empty when lists are identical", () => {
	assert.deepEqual(diffArtifactLists(["a", "b"], ["a", "b"]), []);
});

// --- buildTeamUpdatePreview ---

test("buildTeamUpdatePreview reports changed artifacts and preserves managed files for a same-version update", () => {
	const lock = {
		profile: "old",
		workflowPacks: ["w1"],
		rulePacks: ["r1"],
		managedProjectFiles: ["f1"],
		installedVersion: "1.0.0",
	};
	const release = {
		profile: "new",
		workflowPacks: ["w1", "w2"],
		rulePacks: ["r1"],
		managedProjectFiles: ["f1"],
	};
	const result = buildTeamUpdatePreview("/tgt", lock, "1.0.0", release);
	assert.deepEqual(result, {
		fromVersion: "1.0.0",
		toVersion: "1.0.0",
		willWrite: false,
		targetWrites: [".amber/team/lock.json", ".amber/team/snapshots/1.0.0.json"],
		projectFileWrites: ["f1"],
		customizationsPreserved: false,
		changedArtifacts: ["new", "w2"],
		target: "/tgt",
	});
});

test("buildRollbackLock records previousVersion from the current lock", () => {
	const lock = {
		installedVersion: "1.2.0",
		profile: "current",
		workflowPacks: ["w1"],
		rulePacks: ["r1"],
		managedProjectFiles: [],
	};
	const snapshot = {
		release: {
			profile: "rolled",
			workflowPacks: ["w0"],
			rulePacks: ["r0"],
			managedProjectFiles: ["f1"],
		},
	};
	const now = "2026-06-18T00:00:00.000Z";
	const nextLock = buildRollbackLock({
		lock,
		snapshot,
		version: "1.0.0",
		now,
	});
	assert.equal(nextLock.installedVersion, "1.0.0");
	assert.equal(nextLock.previousVersion, "1.2.0");
	assert.equal(nextLock.rolledBackAt, now);
});

test("buildTeamUpdatePreview includes all release workflowPacks when the version changes", () => {
	const lock = {
		profile: "old",
		workflowPacks: ["w1"],
		rulePacks: ["r1"],
		managedProjectFiles: ["f1"],
		installedVersion: "1.0.0",
	};
	const release = {
		profile: "new",
		workflowPacks: ["w1", "w2"],
		rulePacks: ["r1"],
		managedProjectFiles: ["f1"],
	};
	const result = buildTeamUpdatePreview("/tgt", lock, "1.2.0", release);
	assert.equal(result.toVersion, "1.2.0");
	// Version changed -> the entire release.workflowPacks list is seeded into
	// changedArtifacts before diffing, so w1 appears even though it is
	// unchanged between lock and release.
	assert.deepEqual(result.changedArtifacts, ["new", "w1", "w2"]);
	assert.deepEqual(result.targetWrites, [
		".amber/team/lock.json",
		".amber/team/snapshots/1.2.0.json",
	]);
});
