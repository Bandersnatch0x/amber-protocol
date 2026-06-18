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
