"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { writeTargetRoute, withRoutesJunctionEscape } = require("../helpers/target-routes");

const ROOT = path.resolve(__dirname, "../..");

function runHarness(args) {
	return spawnSync(process.execPath, [path.join(ROOT, "scripts", "harness.js"), ...args], {
		cwd: ROOT,
		encoding: "utf8",
	});
}

test("route list shows all three reference routes and exits 0", () => {
	const result = runHarness(["route", "list"]);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /feature-standard/);
	assert.match(result.stdout, /bugfix-quick/);
	assert.match(result.stdout, /refactor-safe/);
});

test("route inspect feature-standard outputs parseable full JSON", () => {
	const result = runHarness(["route", "inspect", "feature-standard"]);
	assert.equal(result.status, 0);
	const jsonStart = result.stdout.indexOf("{");
	const jsonEnd = result.stdout.lastIndexOf("}") + 1;
	const parsed = JSON.parse(result.stdout.slice(jsonStart, jsonEnd));
	assert.equal(parsed.routeId, "feature-standard");
	assert.ok(Array.isArray(parsed.stages));
});

test("route validate rejects the broken fixture with non-zero exit", () => {
	const result = runHarness(["route", "validate", "tests/fixtures/routes/broken.route.json"]);
	assert.notEqual(result.status, 0);
	assert.match(result.stdout, /INVALID/);
});

test("route validate accepts a valid reference route with exit 0", () => {
	const result = runHarness(["route", "validate", "routes/feature-standard.route.json"]);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /VALID/);
});

test("route test --dry-run prints the ordered stage sequence", () => {
	const result = runHarness(["route", "test", "refactor-safe", "--dry-run"]);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /1\. characterize/);
	assert.match(result.stdout, /2\. refactor/);
	assert.match(result.stdout, /3\. verify/);
});

test("target-bound route reads use only the selected repository routes", () => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-route-target-"));
	try {
		writeTargetRoute(target, "target-only", {
			sourceRouteId: "bugfix-quick",
			displayName: "Target Only",
		});

		const list = runHarness(["route", "list", "--target", target]);
		assert.equal(list.status, 0, list.stderr || list.stdout);
		assert.match(list.stdout, /target-only/);
		assert.doesNotMatch(list.stdout, /feature-standard/);

		const inspect = runHarness(["route", "inspect", "target-only", "--target", target]);
		assert.equal(inspect.status, 0, inspect.stderr || inspect.stdout);
		assert.match(inspect.stdout, /Target Only/);

		const dryRun = runHarness(["route", "test", "target-only", "--target", target]);
		assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
		assert.match(dryRun.stdout, /Dry-run for route: target-only/);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("target-bound route reads reject a routes junction outside the repository", () => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-route-target-"));
	try {
		withRoutesJunctionEscape(target, () => {
			const list = runHarness(["route", "list", "--target", target]);
			assert.notEqual(list.status, 0);
			assert.match(`${list.stdout}\n${list.stderr}`, /Routes directory is outside the target root/);
		});
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("route --json emits a standard envelope with an errors array", () => {
	const result = runHarness([
		"route",
		"validate",
		"tests/fixtures/routes/broken.route.json",
		"--json",
	]);
	assert.notEqual(result.status, 0);
	const payload = JSON.parse(result.stdout);
	assert.ok(Array.isArray(payload.errors));
	assert.ok(payload.errors.length > 0);
});

test("unknown route subcommand exits non-zero", () => {
	const result = runHarness(["route", "frobnicate"]);
	assert.notEqual(result.status, 0);
});
