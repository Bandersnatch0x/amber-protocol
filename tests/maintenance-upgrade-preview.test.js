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
			name: "amber-protocol-team-registry",
			presets: [{ id: "safe-bootstrap" }],
			rulePacks: [{ id: "amber-delivery" }],
			profiles: [{ id: "default" }],
			versions: {
				"1.0.0": {
					preset: "safe-bootstrap",
					profile: "default",
					workflowPacks: [],
					rulePacks: ["pack-a", "pack-b"],
					managedProjectFiles: [],
					compatibility: {},
				},
				"1.1.0": {
					preset: "safe-bootstrap",
					profile: "default",
					workflowPacks: [],
					rulePacks: ["pack-a", "pack-b", "pack-c"],
					managedProjectFiles: [],
					compatibility: {},
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

test("previewUpgrade rejects a schema-invalid registry before computing changes", () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-test-invalid-registry-"));
	const registryPath = path.join(tmpDir, "registry.json");
	fs.writeFileSync(registryPath, "{}\n");

	const preview = runMaintenanceAction("upgrade-preview", tmpDir, {
		registry: registryPath,
	});

	assert.ok(preview.errors.includes("Team registry must define versions."));
	assert.deepEqual(preview.warnings, []);
	assert.equal("changes" in preview, false);

	fs.rmSync(tmpDir, { recursive: true, force: true });
});
