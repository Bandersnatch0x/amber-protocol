"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { dispatch } = require("../../scripts/lib/command-dispatcher");
const { scaffoldHarness } = require("../../scripts/lib/core/scaffold");

function parseArgs(argv) {
	// Minimal: the real parseArgs is in amber-core; mirror the shape dispatch needs.
	const args = { target: process.cwd(), _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--target") { args.target = argv[++i]; continue; }
		if (a.startsWith("--")) { args[a.slice(2)] = argv[++i]; continue; }
		args._.push(a);
	}
	return args;
}

test("maintenance scaffold-drift returns the detector output for an installed target", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-main-"));
	scaffoldHarness(dir, {}); // install + provenance
	const { result } = dispatch("maintenance", parseArgs(["scaffold-drift", "--target", dir]));
	assert.equal(result.target, dir);
	assert.ok(result.scaffoldDrift, "scaffoldDrift present");
	assert.equal(result.scaffoldDrift.installed, true);
	assert.ok(typeof result.scaffoldDrift.counts.fresh === "number");
	assert.deepEqual(result.errors, []);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("maintenance inspect rolls scaffoldDrift into its report", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-main-"));
	scaffoldHarness(dir, {});
	const { result } = dispatch("maintenance", parseArgs(["inspect", "--target", dir]));
	assert.ok(result.scaffoldDrift, "inspect includes scaffoldDrift");
	fs.rmSync(dir, { recursive: true, force: true });
});
