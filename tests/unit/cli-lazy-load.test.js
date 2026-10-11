"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const AMBER = path.join(__dirname, "..", "..", "scripts", "amber.js");

const PROBE = `
const amber = require(process.argv[1]);
console.log = () => {};
console.error = () => {};
Promise.resolve(amber.run(process.argv.slice(2))).then(() => {
	process.stdout.write(String(Object.keys(require.cache).length));
});
`;

function modulesLoadedBy(args) {
	const run = spawnSync(process.execPath, ["-e", PROBE, AMBER, ...args], { encoding: "utf8" });
	assert.equal(run.status, 0, run.stderr);
	return Number(run.stdout);
}

test("--version and --help load no command module", () => {
	assert.ok(modulesLoadedBy(["--version"]) <= 10);
	assert.ok(modulesLoadedBy(["--help"]) <= 10);
});

test("a command loads its own chain, not every command", () => {
	assert.ok(modulesLoadedBy(["doctor", "--target", os.tmpdir()]) <= 40);
	assert.ok(modulesLoadedBy(["next", "--objective", "x", "--target", os.tmpdir()]) <= 180);
});
