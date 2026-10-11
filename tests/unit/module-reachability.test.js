"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "check-reachability.js");

test("every module under scripts/lib is reachable from a shipped entry point", () => {
	const result = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
	assert.equal(result.stdout, "0 unreachable files\n");
	assert.equal(result.status, 0);
});
