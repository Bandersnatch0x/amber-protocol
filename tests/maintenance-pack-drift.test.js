"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function tempDir(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `pack-drift-${name}-`));
}

function runAmber(args) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd: ROOT,
		encoding: "utf8",
	});
}

test("amber maintenance pack-drift - installed != latest", () => {
	const target = tempDir("drifted");
	const amberDir = path.join(target, ".amber", "team");
	const registryPath = path.join(target, "registry.json");

	fs.mkdirSync(amberDir, { recursive: true });
	fs.writeFileSync(
		path.join(amberDir, "lock.json"),
		JSON.stringify({
			installedVersion: "1.0.0",
			rulePacks: ["standards/amber-delivery.json"],
		}),
	);
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
					rulePacks: ["standards/amber-delivery.json"],
					managedProjectFiles: [],
					compatibility: {},
				},
				"1.1.0": {
					preset: "safe-bootstrap",
					profile: "default",
					workflowPacks: [],
					rulePacks: ["rule-packs/amber-delivery.rule-pack.json", "standards/amber-delivery.json"],
					managedProjectFiles: [],
					compatibility: {},
				},
			},
		}),
	);

	const result = runAmber([
		"maintenance",
		"pack-drift",
		"--target",
		target,
		"--registry",
		registryPath,
		"--json",
	]);

	assert.strictEqual(result.status, 0);
	const json = JSON.parse(result.stdout);
	assert.strictEqual(json.drifted, true);
	assert.deepStrictEqual(json.installed, ["standards/amber-delivery.json"]);
	assert.deepStrictEqual(json.latest, [
		"rule-packs/amber-delivery.rule-pack.json",
		"standards/amber-delivery.json",
	]);

	fs.rmSync(target, { recursive: true, force: true });
});

test("amber maintenance pack-drift rejects a schema-invalid registry", () => {
	const target = tempDir("invalid-registry");
	const amberDir = path.join(target, ".amber", "team");
	const registryPath = path.join(target, "registry.json");

	fs.mkdirSync(amberDir, { recursive: true });
	fs.writeFileSync(
		path.join(amberDir, "lock.json"),
		JSON.stringify({ installedVersion: "1.0.0", rulePacks: [] }),
	);
	fs.writeFileSync(registryPath, "{}\n");

	const result = runAmber([
		"maintenance",
		"pack-drift",
		"--target",
		target,
		"--registry",
		registryPath,
		"--json",
	]);

	assert.equal(result.status, 1, result.stderr);
	const payload = JSON.parse(result.stdout);
	assert.ok(payload.errors.includes("Team registry must define versions."));
	assert.equal("drifted" in payload, false);
	assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /TypeError|Cannot read properties/);

	fs.rmSync(target, { recursive: true, force: true });
});
