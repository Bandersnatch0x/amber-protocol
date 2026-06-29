"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "validate-encoding.js");

test("encoding validator exists and accepts tracked UTF-8 text", () => {
	assert.equal(fs.existsSync(SCRIPT), true);

	const result = spawnSync(process.execPath, [SCRIPT], {
		cwd: ROOT,
		encoding: "utf8",
	});

	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /Encoding check passed/);
});
