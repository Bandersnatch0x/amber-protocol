"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// The exit hook only runs at process exit, so the check spawns a child that
// builds one fixture, prints its path, and dies; the dir must then be gone.
// argv is passed as an array (no shell), so quoting is not a concern here.
test("mkTarget fixture roots are removed when the process exits", () => {
	const harness = JSON.stringify(path.join(__dirname, "..", "helpers", "harness.js"));
	const dir = execFileSync(
		process.execPath,
		["-e", `const { mkTarget } = require(${harness}); console.log(mkTarget("exit-cleanup"));`],
		{ encoding: "utf8" },
	).trim();

	assert.ok(dir.startsWith(os.tmpdir()), `fixture lives in tmpdir: ${dir}`);
	assert.equal(fs.existsSync(dir), false, "fixture was removed at process exit");
});
