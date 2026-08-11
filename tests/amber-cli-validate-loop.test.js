"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function runAmber(args) {
	return spawnSync(process.execPath, [path.join(ROOT, "scripts", "amber.js"), ...args], {
		cwd: ROOT,
		encoding: "utf8",
	});
}

test("amber loop validate-loop - valid contract returns exit 0 with JSON", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-validate-"));
	const contractPath = path.join(tempDir, "valid.json");
	const contract = {
		trigger: "manual",
		cadence: "daily",
		stateSpine: ["state1"],
		hardStops: { maxIterations: 10, timeout: 3600 },
	};
	fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2));

	const result = runAmber(["loop", "validate-loop", "--contract", contractPath, "--json"]);

	assert.strictEqual(result.status, 0);
	const parsed = JSON.parse(result.stdout);
	assert.strictEqual(parsed.valid, true);
	assert.strictEqual(parsed.errors.length, 0);

	fs.rmSync(tempDir, { recursive: true, force: true });
});

test("amber loop validate-loop - missing hardStops returns exit 1 with JSON", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-validate-"));
	const contractPath = path.join(tempDir, "invalid.json");
	const contract = {
		trigger: "manual",
		cadence: "daily",
		stateSpine: ["state1"],
	};
	fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2));

	const result = runAmber(["loop", "validate-loop", "--contract", contractPath, "--json"]);

	assert.strictEqual(result.status, 1);
	const parsed = JSON.parse(result.stdout);
	assert.strictEqual(parsed.valid, false);
	assert.ok(parsed.errors.includes("Missing required field: hardStops"));

	fs.rmSync(tempDir, { recursive: true, force: true });
});
