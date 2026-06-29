"use strict";

// Integration coverage for the team distribution state-mutation lifecycle:
// install -> update. These functions write lock.json and version snapshots and
// previously had only export-existence checks — no test exercised the actual
// on-disk state they produce. Uses the real bundled registry.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	installTeamDistribution,
	updateTeamDistribution,
	rollbackTeamDistribution,
	pinTeamDistribution,
} = require("../scripts/lib/core/team");

const ROOT = path.resolve(__dirname, "..");
const REGISTRY = path.join(ROOT, "registry", "amber-protocol.registry.json");
const LOCK_REL = path.join(".amber", "team", "lock.json");

function tempTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "team-lifecycle-"));
}

function readLock(target) {
	return JSON.parse(fs.readFileSync(path.join(target, LOCK_REL), "utf8"));
}

test("installTeamDistribution writes a lock and snapshot for the selected version", () => {
	const target = tempTarget();
	const result = installTeamDistribution(target, {
		registry: REGISTRY,
		version: "1.0.0",
	});

	assert.deepEqual(result.errors, []);
	// Lock is persisted on disk with the selected version.
	assert.ok(fs.existsSync(path.join(target, LOCK_REL)));
	assert.equal(readLock(target).installedVersion, "1.0.0");
	// A version snapshot is written for later rollback.
	assert.ok(fs.existsSync(path.join(target, ".amber", "team", "snapshots", "1.0.0.json")));

	fs.rmSync(target, { recursive: true, force: true });
});

test("installTeamDistribution refuses to install over an existing lock", () => {
	const target = tempTarget();
	installTeamDistribution(target, { registry: REGISTRY, version: "1.0.0" });
	const second = installTeamDistribution(target, {
		registry: REGISTRY,
		version: "1.0.0",
	});

	assert.ok(second.errors.length > 0);
	// The original lock is untouched.
	assert.equal(readLock(target).installedVersion, "1.0.0");

	fs.rmSync(target, { recursive: true, force: true });
});

test("installTeamDistribution --dry-run previews without writing team state", () => {
	const target = tempTarget();
	const result = installTeamDistribution(target, {
		registry: REGISTRY,
		version: "1.0.0",
		preset: "safe-bootstrap",
		dryRun: true,
	});

	assert.deepEqual(result.errors, []);
	assert.equal(result.preview.willWrite, false);
	assert.equal(result.preview.toVersion, "1.0.0");
	assert.equal(result.preview.preset, "safe-bootstrap");
	assert.deepEqual(result.preview.targetWrites, [
		".amber/team/lock.json",
		".amber/team/snapshots/1.0.0.json",
	]);
	assert.equal(fs.existsSync(path.join(target, LOCK_REL)), false);
	assert.equal(
		fs.existsSync(path.join(target, ".amber", "team", "snapshots", "1.0.0.json")),
		false,
	);

	fs.rmSync(target, { recursive: true, force: true });
});

test("updateTeamDistribution --dry-run previews without writing the new version", () => {
	const target = tempTarget();
	installTeamDistribution(target, { registry: REGISTRY, version: "1.0.0" });

	const preview = updateTeamDistribution(target, {
		registry: REGISTRY,
		version: "1.1.0",
		dryRun: true,
	});

	assert.deepEqual(preview.errors, []);
	assert.equal(preview.preview.fromVersion, "1.0.0");
	assert.equal(preview.preview.toVersion, "1.1.0");
	assert.equal(preview.preview.willWrite, false);
	// Dry-run must not mutate the lock on disk.
	assert.equal(readLock(target).installedVersion, "1.0.0");

	fs.rmSync(target, { recursive: true, force: true });
});

test("updateTeamDistribution --confirm advances the lock and records the previous version", () => {
	const target = tempTarget();
	installTeamDistribution(target, { registry: REGISTRY, version: "1.0.0" });

	const updated = updateTeamDistribution(target, {
		registry: REGISTRY,
		version: "1.1.0",
		confirm: true,
	});

	assert.deepEqual(updated.errors, []);
	const lock = readLock(target);
	assert.equal(lock.installedVersion, "1.1.0");
	assert.equal(lock.previousVersion, "1.0.0");

	fs.rmSync(target, { recursive: true, force: true });
});

test("rollbackTeamDistribution restores an earlier version and records a ledger entry", () => {
	const target = tempTarget();
	installTeamDistribution(target, { registry: REGISTRY, version: "1.0.0" });
	updateTeamDistribution(target, {
		registry: REGISTRY,
		version: "1.1.0",
		confirm: true,
	});

	const result = rollbackTeamDistribution(target, {
		registry: REGISTRY,
		version: "1.0.0",
		confirm: true,
	});

	assert.deepEqual(result.errors, []);
	assert.equal(result.previousVersion, "1.1.0");
	const lock = readLock(target);
	assert.equal(lock.installedVersion, "1.0.0");
	assert.equal(lock.previousVersion, "1.1.0");

	// The rollback is journalled for audit.
	const ledgerPath = path.join(target, ".amber", "team", "rollback-ledger.json");
	assert.ok(fs.existsSync(ledgerPath));
	const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
	assert.equal(ledger.length, 1);
	assert.equal(ledger[0].fromVersion, "1.1.0");
	assert.equal(ledger[0].toVersion, "1.0.0");

	fs.rmSync(target, { recursive: true, force: true });
});

test("rollbackTeamDistribution requires --confirm", () => {
	const target = tempTarget();
	installTeamDistribution(target, { registry: REGISTRY, version: "1.0.0" });

	const result = rollbackTeamDistribution(target, {
		registry: REGISTRY,
		version: "1.0.0",
	});

	assert.ok(result.errors.some((e) => /confirm/i.test(e)));
	fs.rmSync(target, { recursive: true, force: true });
});

test("rollbackTeamDistribution errors when no snapshot exists for the version", () => {
	const target = tempTarget();
	installTeamDistribution(target, { registry: REGISTRY, version: "1.0.0" });

	const result = rollbackTeamDistribution(target, {
		registry: REGISTRY,
		version: "9.9.9",
		confirm: true,
	});

	assert.ok(result.errors.some((e) => /snapshot/i.test(e)));
	// The lock is left untouched at the installed version.
	assert.equal(readLock(target).installedVersion, "1.0.0");
	fs.rmSync(target, { recursive: true, force: true });
});

test("pinTeamDistribution records a pinnedVersion without changing installedVersion", () => {
	const target = tempTarget();
	installTeamDistribution(target, { registry: REGISTRY, version: "1.0.0" });

	const result = pinTeamDistribution(target, {
		registry: REGISTRY,
		version: "1.0.0",
	});

	assert.deepEqual(result.errors, []);
	const lock = readLock(target);
	assert.equal(lock.pinnedVersion, "1.0.0");
	assert.equal(lock.installedVersion, "1.0.0");

	fs.rmSync(target, { recursive: true, force: true });
});

test("pinTeamDistribution requires a --version", () => {
	const target = tempTarget();
	installTeamDistribution(target, { registry: REGISTRY, version: "1.0.0" });

	const result = pinTeamDistribution(target, { registry: REGISTRY });
	assert.ok(result.errors.some((e) => /version/i.test(e)));

	fs.rmSync(target, { recursive: true, force: true });
});

test("pinTeamDistribution errors when the version is not in the registry", () => {
	const target = tempTarget();
	installTeamDistribution(target, { registry: REGISTRY, version: "1.0.0" });

	const result = pinTeamDistribution(target, {
		registry: REGISTRY,
		version: "9.9.9",
	});
	assert.ok(result.errors.some((e) => /not available/i.test(e)));
	// The lock keeps its installed version and gains no pin (stays at the
	// initial null that buildTeamLock seeds).
	const lock = readLock(target);
	assert.equal(lock.installedVersion, "1.0.0");
	assert.equal(lock.pinnedVersion, null);

	fs.rmSync(target, { recursive: true, force: true });
});

