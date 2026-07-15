"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { runMaintenanceAction } = require("../scripts/lib/core/maintenance");

test("previewUpgrade shows pack changes from 1.0.0 to 1.1.0", () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-test-"));
	const amberDir = path.join(tmpDir, ".amber");
	const teamDir = path.join(amberDir, "team");
	fs.mkdirSync(teamDir, { recursive: true });

	const lockPath = path.join(teamDir, "lock.json");
	fs.writeFileSync(
		lockPath,
		JSON.stringify({
			installedVersion: "1.0.0",
			rulePacks: ["pack-a", "pack-b"],
		}),
	);

	const registryPath = path.join(tmpDir, "registry.json");
	fs.writeFileSync(
		registryPath,
		JSON.stringify({
			versions: {
				"1.0.0": {
					rulePacks: ["pack-a", "pack-b"],
				},
				"1.1.0": {
					rulePacks: ["pack-a", "pack-b", "pack-c"],
				},
			},
		}),
	);

	const preview = runMaintenanceAction("upgrade-preview", tmpDir, { version: "1.1.0", registry: registryPath });

	assert.equal(preview.currentVersion, "1.0.0");
	assert.equal(preview.targetVersion, "1.1.0");
	assert.deepEqual(preview.changes.addedPacks, ["pack-c"]);
	assert.deepEqual(preview.changes.removedPacks, []);
	assert.deepEqual(preview.changes.updatedPacks, ["pack-a", "pack-b"]);

	fs.rmSync(tmpDir, { recursive: true, force: true });
});
