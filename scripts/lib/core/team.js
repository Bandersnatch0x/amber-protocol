"use strict";

const path = require("node:path");
const { resolveStateDirForRead, resolveStateDirForCreate } = require("../state-dir-resolver");

const {
	DEFAULT_TEAM_REGISTRY,
	REPO_ROOT,
	SEMVER_PATTERN,
} = require("./constants");

const {
	pathExists,
	readJson,
	relativeSlash,
	repoRelativePath,
	resolveTarget,
	writeJson,
} = require("./fs-utils");

const {
	MESSAGES,
} = require("./terminology");

function resolveRegistryPath(registryPath) {
	if (!registryPath) {
		return DEFAULT_TEAM_REGISTRY;
	}
	return path.isAbsolute(registryPath)
		? registryPath
		: path.join(REPO_ROOT, registryPath);
}

function validateTeamRegistryData(data) {
	const errors = [];
	const warnings = [];

	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return { errors: ["Team registry must contain an object."], warnings };
	}
	if (data.name !== "amber-protocol-team-registry") {
		errors.push("Team registry name must be amber-protocol-team-registry.");
	}
	if (!Array.isArray(data.presets) || data.presets.length === 0) {
		errors.push("Team registry must define at least one preset.");
	}
	if (!Array.isArray(data.rulePacks) || data.rulePacks.length === 0) {
		errors.push("Team registry must define at least one rule pack.");
	}
	if (!Array.isArray(data.profiles) || data.profiles.length === 0) {
		errors.push("Team registry must define at least one project profile.");
	}
	if (
		!data.versions ||
		typeof data.versions !== "object" ||
		Array.isArray(data.versions)
	) {
		errors.push("Team registry must define versions.");
	} else {
		for (const [version, release] of Object.entries(data.versions)) {
			if (!SEMVER_PATTERN.test(version)) {
				errors.push(`Registry version ${version} is not valid semver.`);
			}
			if (!release || typeof release !== "object" || Array.isArray(release)) {
				errors.push(`Registry version ${version} must be an object.`);
				continue;
			}
			if (!release.preset) {
				errors.push(`Registry version ${version} must declare a preset.`);
			}
			if (!release.profile) {
				errors.push(`Registry version ${version} must declare a profile.`);
			}
			if (!Array.isArray(release.workflowPacks)) {
				errors.push(`Registry version ${version} must declare workflowPacks.`);
			}
			if (!Array.isArray(release.rulePacks)) {
				errors.push(`Registry version ${version} must declare rulePacks.`);
			}
			if (!Array.isArray(release.managedProjectFiles)) {
				errors.push(
					`Registry version ${version} must declare managedProjectFiles.`,
				);
			}
			if (!release.compatibility || typeof release.compatibility !== "object") {
				errors.push(`Registry version ${version} must declare compatibility.`);
			}
		}
	}

	return { errors, warnings };
}

function loadTeamRegistry(registryPath) {
	const resolvedRegistryPath = resolveRegistryPath(registryPath);
	const registry = readJson(resolvedRegistryPath);
	const validation = validateTeamRegistryData(registry);
	return {
		registryPath: resolvedRegistryPath,
		registry,
		errors: validation.errors,
		warnings: validation.warnings,
	};
}

function compareSemver(left, right) {
	const leftParts = String(left)
		.split(/[+-]/)[0]
		.split(".")
		.map((part) => Number.parseInt(part, 10));
	const rightParts = String(right)
		.split(/[+-]/)[0]
		.split(".")
		.map((part) => Number.parseInt(part, 10));
	for (let index = 0; index < 3; index += 1) {
		if (leftParts[index] !== rightParts[index]) {
			return leftParts[index] - rightParts[index];
		}
	}
	return 0;
}

function latestTeamVersion(registry) {
	return Object.keys(registry.versions || {})
		.sort(compareSemver)
		.at(-1);
}

function findTeamVersion(registry, version) {
	const selectedVersion = version || latestTeamVersion(registry);
	return {
		version: selectedVersion,
		release: registry.versions && registry.versions[selectedVersion],
	};
}

function teamStatePaths(targetRoot, options = {}) {
	// install creates new team state (canonical .amber); inspect/update/
	// pin/rollback operate on the state wherever it already lives.
	const stateDir = options.forCreate
		? resolveStateDirForCreate(targetRoot)
		: resolveStateDirForRead(targetRoot);
	const root = path.join(stateDir, "team");
	return {
		root,
		lockPath: path.join(root, "lock.json"),
		snapshotsRoot: path.join(root, "snapshots"),
		rollbackLedgerPath: path.join(root, "rollback-ledger.json"),
	};
}

function summarizeTeamRegistry(registry) {
	return {
		name: registry.name,
		schemaVersion: registry.schemaVersion,
		presets: registry.presets,
		rulePacks: registry.rulePacks,
		profiles: registry.profiles,
		versions: registry.versions,
	};
}

function buildCompatibilityMatrix(registry) {
	const releases = Object.values(registry.versions || {});
	const os = new Set();
	const profileVersions = new Set();

	for (const release of releases) {
		for (const name of (release.compatibility && release.compatibility.os) ||
			[]) {
			os.add(name);
		}
		if (release.compatibility && release.compatibility.profileVersion) {
			profileVersions.add(release.compatibility.profileVersion);
		}
	}

	return {
		codex: { minimum: "0.0.0" },
		claudeCode: { support: "optional" },
		os: [...os].sort(),
		runtime: { node: ">=20.0.0" },
		profileVersions: [...profileVersions].sort(compareSemver),
	};
}

function buildTeamLock(
	registryPath,
	registry,
	version,
	release,
	preset,
	previousLock = null,
) {
	return {
		schemaVersion: "1.0.0",
		registry: {
			name: registry.name,
			path: repoRelativePath(registryPath),
		},
		installedVersion: version,
		pinnedVersion: previousLock ? previousLock.pinnedVersion || null : null,
		preset,
		profile: release.profile,
		workflowPacks: release.workflowPacks,
		rulePacks: release.rulePacks,
		managedProjectFiles: release.managedProjectFiles,
		customizationsPreserved: release.managedProjectFiles.length === 0,
		installedAt: previousLock
			? previousLock.installedAt
			: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
}

function writeTeamSnapshot(
	targetRoot,
	registryPath,
	registry,
	version,
	release,
) {
	const paths = teamStatePaths(targetRoot);
	const snapshotPath = path.join(paths.snapshotsRoot, `${version}.json`);
	const snapshot = {
		version,
		registry: registry.name,
		registryPath: repoRelativePath(registryPath),
		release,
		capturedAt: new Date().toISOString(),
	};
	writeJson(snapshotPath, snapshot);
	return relativeSlash(targetRoot, snapshotPath);
}

function loadTeamLock(paths) {
	if (!pathExists(paths.lockPath)) {
		return null;
	}
	return readJson(paths.lockPath);
}

function inspectTeamDistribution(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const paths = teamStatePaths(targetRoot);
	const loaded = loadTeamRegistry(options.registry);
	const lock = loadTeamLock(paths);

	return {
		target: targetRoot,
		installed: Boolean(lock),
		lock,
		registry: summarizeTeamRegistry(loaded.registry),
		compatibilityMatrix: buildCompatibilityMatrix(loaded.registry),
		errors: loaded.errors,
		warnings: loaded.warnings,
	};
}

function installTeamDistribution(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const paths = teamStatePaths(targetRoot, { forCreate: true });
	const loaded = loadTeamRegistry(options.registry);
	const errors = [...loaded.errors];
	const warnings = [...loaded.warnings];
	const selected = findTeamVersion(loaded.registry, options.version);
	const preset =
		options.preset || (selected.release && selected.release.preset);

	if (pathExists(paths.lockPath)) {
		errors.push(
			MESSAGES.teamAlreadyInstalled,
		);
	}
	if (!selected.release) {
		errors.push(
			`Team registry version ${selected.version || "<latest>"} is not available.`,
		);
	}
	if (preset && !loaded.registry.presets.some((item) => item.id === preset)) {
		errors.push(`Team preset ${preset} is not registered.`);
	}
	if (errors.length > 0) {
		return { target: targetRoot, errors, warnings };
	}

	const lock = buildTeamLock(
		loaded.registryPath,
		loaded.registry,
		selected.version,
		selected.release,
		preset,
	);
	const snapshot = writeTeamSnapshot(
		targetRoot,
		loaded.registryPath,
		loaded.registry,
		selected.version,
		selected.release,
	);
	writeJson(paths.lockPath, lock);

	return {
		target: targetRoot,
		lock,
		snapshot,
		created: [relativeSlash(targetRoot, paths.lockPath), snapshot],
		projectFileWrites: [],
		errors,
		warnings,
	};
}

function diffArtifactLists(fromList = [], toList = []) {
	const fromSet = new Set(fromList);
	const toSet = new Set(toList);
	return [...new Set([...fromList, ...toList])]
		.filter((item) => !fromSet.has(item) || !toSet.has(item))
		.sort();
}

function buildTeamUpdatePreview(targetRoot, lock, version, release) {
	const current = {
		profile: lock.profile,
		workflowPacks: lock.workflowPacks || [],
		rulePacks: lock.rulePacks || [],
		managedProjectFiles: lock.managedProjectFiles || [],
	};
	const changedArtifacts = [
		...(lock.installedVersion !== version ? release.workflowPacks : []),
		...diffArtifactLists(current.workflowPacks, release.workflowPacks),
		...diffArtifactLists(current.rulePacks, release.rulePacks),
	];
	if (current.profile !== release.profile) {
		changedArtifacts.push(release.profile);
	}

	return {
		fromVersion: lock.installedVersion,
		toVersion: version,
		willWrite: false,
		targetWrites: [
			".amber/team/lock.json",
			`.amber/team/snapshots/${version}.json`,
		],
		projectFileWrites: release.managedProjectFiles,
		customizationsPreserved: release.managedProjectFiles.length === 0,
		changedArtifacts: [...new Set(changedArtifacts)].sort(),
		target: targetRoot,
	};
}

function updateTeamDistribution(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const paths = teamStatePaths(targetRoot);
	const loaded = loadTeamRegistry(options.registry);
	const errors = [...loaded.errors];
	const warnings = [...loaded.warnings];
	const lock = loadTeamLock(paths);
	const selected = findTeamVersion(loaded.registry, options.version);

	if (!lock) {
		errors.push(MESSAGES.teamNotInstalled);
	}
	if (!options.dryRun && !options.confirm) {
		errors.push("team update requires --dry-run or --confirm.");
	}
	if (!selected.release) {
		errors.push(
			`Team registry version ${selected.version || "<latest>"} is not available.`,
		);
	}
	if (errors.length > 0) {
		return { target: targetRoot, errors, warnings };
	}

	const preview = buildTeamUpdatePreview(
		targetRoot,
		lock,
		selected.version,
		selected.release,
	);
	if (options.dryRun) {
		return { target: targetRoot, lock, preview, errors, warnings };
	}

	const nextLock = buildTeamLock(
		loaded.registryPath,
		loaded.registry,
		selected.version,
		selected.release,
		selected.release.preset,
		lock,
	);
	nextLock.previousVersion = lock.installedVersion;
	const snapshot = writeTeamSnapshot(
		targetRoot,
		loaded.registryPath,
		loaded.registry,
		selected.version,
		selected.release,
	);
	writeJson(paths.lockPath, nextLock);

	return {
		target: targetRoot,
		lock: nextLock,
		preview: { ...preview, willWrite: true },
		snapshot,
		errors,
		warnings,
	};
}

function pinTeamDistribution(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const paths = teamStatePaths(targetRoot);
	const loaded = loadTeamRegistry(options.registry);
	const errors = [...loaded.errors];
	const warnings = [...loaded.warnings];
	const lock = loadTeamLock(paths);
	const selected = findTeamVersion(loaded.registry, options.version);

	if (!lock) {
		errors.push(MESSAGES.teamNotInstalled);
	}
	if (!options.version) {
		errors.push("team pin requires --version <semver>.");
	}
	if (!selected.release) {
		errors.push(
			`Team registry version ${selected.version || "<latest>"} is not available.`,
		);
	}
	if (errors.length > 0) {
		return { target: targetRoot, errors, warnings };
	}

	lock.pinnedVersion = selected.version;
	lock.updatedAt = new Date().toISOString();
	writeJson(paths.lockPath, lock);
	return { target: targetRoot, lock, errors, warnings };
}

function rollbackTeamDistribution(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const paths = teamStatePaths(targetRoot);
	const errors = [];
	const warnings = [];
	const lock = loadTeamLock(paths);
	const version = options.version;

	if (!lock) {
		errors.push(MESSAGES.teamNotInstalled);
	}
	if (!version) {
		errors.push("team rollback requires --version <semver>.");
	}
	if (!options.confirm) {
		errors.push("team rollback requires --confirm.");
	}
	const snapshotPath = version
		? path.join(paths.snapshotsRoot, `${version}.json`)
		: null;
	if (snapshotPath && !pathExists(snapshotPath)) {
		errors.push(`No team snapshot exists for ${version}.`);
	}
	if (errors.length > 0) {
		return { target: targetRoot, errors, warnings };
	}

	const snapshot = readJson(snapshotPath);
	const previousVersion = lock.installedVersion;
	const nextLock = {
		...lock,
		installedVersion: version,
		profile: snapshot.release.profile,
		workflowPacks: snapshot.release.workflowPacks,
		rulePacks: snapshot.release.rulePacks,
		managedProjectFiles: snapshot.release.managedProjectFiles,
		customizationsPreserved: snapshot.release.managedProjectFiles.length === 0,
		previousVersion,
		rolledBackAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
	writeJson(paths.lockPath, nextLock);

	const ledger = pathExists(paths.rollbackLedgerPath)
		? readJson(paths.rollbackLedgerPath)
		: [];
	ledger.push({
		fromVersion: previousVersion,
		toVersion: version,
		snapshot: relativeSlash(targetRoot, snapshotPath),
		rolledBackAt: nextLock.rolledBackAt,
	});
	writeJson(paths.rollbackLedgerPath, ledger);

	return {
		target: targetRoot,
		lock: nextLock,
		previousVersion,
		snapshot: relativeSlash(targetRoot, snapshotPath),
		errors,
		warnings,
	};
}

module.exports = {
	resolveRegistryPath,
	validateTeamRegistryData,
	loadTeamRegistry,
	compareSemver,
	latestTeamVersion,
	findTeamVersion,
	teamStatePaths,
	summarizeTeamRegistry,
	buildCompatibilityMatrix,
	buildTeamLock,
	writeTeamSnapshot,
	loadTeamLock,
	inspectTeamDistribution,
	installTeamDistribution,
	diffArtifactLists,
	buildTeamUpdatePreview,
	updateTeamDistribution,
	pinTeamDistribution,
	rollbackTeamDistribution,
};
