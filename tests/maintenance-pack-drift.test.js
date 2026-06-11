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
		})
	);
	fs.writeFileSync(
		registryPath,
		JSON.stringify({
			name: "amber-protocol-team-registry",
			versions: {
				"1.0.0": {
					rulePacks: ["standards/amber-delivery.json"],
				},
				"1.1.0": {
					rulePacks: ["rule-packs/amber-delivery.rule-pack.json", "standards/amber-delivery.json"],
				},
			},
		})
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
	assert.deepStrictEqual(json.latest, ["rule-packs/amber-delivery.rule-pack.json", "standards/amber-delivery.json"]);

	fs.rmSync(target, { recursive: true, force: true });
});
