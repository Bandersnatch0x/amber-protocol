"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.join(__dirname, "..", "..");
const AMBER = path.join(ROOT, "scripts", "amber.js");

function amber(args, cwd) {
	return spawnSync(process.execPath, [AMBER, ...args], { cwd, encoding: "utf8" });
}

function scratch() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-c1-"));
}

test("harness runtime warns it is experimental on stderr and keeps stdout JSON", () => {
	const dir = scratch();
	const run = amber(["harness", "runtime", "jobs", "--target", dir, "--json"], dir);
	assert.match(run.stderr, /^\[experimental\] amber harness runtime /m);
	assert.doesNotThrow(() => JSON.parse(run.stdout));
	assert.doesNotMatch(run.stdout, /experimental\]/);
});

test("core commands print no experimental warning", () => {
	const dir = scratch();
	const run = amber(["audit", "--target", dir, "--json"], dir);
	assert.doesNotMatch(run.stderr, /\[experimental\]/);
});

test("harness help labels the runtime experimental", () => {
	const run = amber(["harness", "--help"], ROOT);
	assert.match(run.stdout, /runtime\s+EXPERIMENTAL/);
});

test("docs no longer claim Amber ships no scheduler or daemon", () => {
	const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
	assert.doesNotMatch(read("docs/CLI_REFERENCE.md"), /no daemon command surface/i);
	assert.doesNotMatch(read("README.md"), /or always-on scheduler\n/);
	for (const file of ["README.md", "README.zh-CN.md", "SPEC.md", "docs/CLI_REFERENCE.md"]) {
		assert.match(read(file), /harness runtime/, `${file} names the experimental runtime`);
	}
});
