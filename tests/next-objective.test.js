"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");
const { inferNext } = require(path.join(ROOT, "scripts", "lib", "next-command"));
const { parseArgs } = require(path.join(ROOT, "scripts", "lib", "core", "cli-output"));

function tempDir(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-next-objective-${name}-`));
}

function runHarness(args, options = {}) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd: ROOT,
		encoding: "utf8",
		...options,
	});
}

function writeTargetJson(target, relativePath, value) {
	const filePath = path.join(target, ...relativePath.split("/"));
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function copyProductAsset(target, relativePath) {
	const destination = path.join(target, ...relativePath.split("/"));
	fs.mkdirSync(path.dirname(destination), { recursive: true });
	fs.copyFileSync(path.join(ROOT, ...relativePath.split("/")), destination);
}

test("next without --objective is byte-compatible with the prior envelope", () => {
	const target = tempDir("no-objective");
	const envelope = inferNext(target);
	assert.equal(Object.hasOwn(envelope, "routingSuggestion"), false);
	assert.doesNotMatch(envelope.text, /Route suggestion/);

	const jsonResult = runHarness(["next", "--target", target, "--json"]);
	assert.equal(jsonResult.status, 0, jsonResult.stderr);
	const payload = JSON.parse(jsonResult.stdout);
	assert.equal(Object.hasOwn(payload, "routingSuggestion"), false);

	const textResult = runHarness(["next", "--target", target]);
	assert.equal(textResult.status, 0, textResult.stderr);
	assert.doesNotMatch(textResult.stdout, /Route suggestion/);
});

test("next --objective matches bugfix-quick for a bug-fixing objective", () => {
	const target = tempDir("match-bugfix");
	copyProductAsset(target, "routes/bugfix-quick.route.json");
	const envelope = inferNext(target, { objective: "fix login bug" });
	const suggestion = envelope.routingSuggestion;
	assert.equal(suggestion.matched, true);
	assert.equal(suggestion.routeId, "bugfix-quick");
	assert.equal(suggestion.workflowPackId, null);

	const jsonResult = runHarness([
		"next",
		"--target",
		target,
		"--objective",
		"fix login bug",
		"--json",
	]);
	assert.equal(jsonResult.status, 0, jsonResult.stderr);
	const payload = JSON.parse(jsonResult.stdout);
	assert.equal(payload.routingSuggestion.matched, true);
	assert.equal(payload.routingSuggestion.routeId, "bugfix-quick");

	const textResult = runHarness(["next", "--target", target, "--objective", "fix login bug"]);
	assert.equal(textResult.status, 0, textResult.stderr);
	assert.match(textResult.stdout, /Route suggestion: bugfix-quick/);
});

test("next --objective resolves routes from the Target Repository", () => {
	const target = tempDir("target-route");
	const route = JSON.parse(
		fs.readFileSync(path.join(ROOT, "routes", "feature-standard.route.json"), "utf8"),
	);
	route.routeId = "lunar-calibration";
	route.objective = "lunar calibration";
	route.description = "Calibrate lunar instruments.";
	writeTargetJson(target, "routes/lunar-calibration.route.json", route);

	const suggestion = inferNext(target, {
		objective: "perform lunar calibration",
	}).routingSuggestion;
	assert.equal(suggestion.matched, true);
	assert.equal(suggestion.routeId, "lunar-calibration");
});

test("next keeps its Journey coherent with the selected Route affinity", () => {
	const target = tempDir("route-affinity");
	const route = JSON.parse(
		fs.readFileSync(path.join(ROOT, "routes", "feature-standard.route.json"), "utf8"),
	);
	route.routeId = "context-delivery";
	route.objective = "refresh context loadout";
	route.description = "Deliver a context refresh through the delivery journey.";
	route.journeyAffinity = ["amber-delivery"];
	writeTargetJson(target, "routes/context-delivery.route.json", route);

	const envelope = inferNext(target, { objective: "refresh context loadout" });
	assert.equal(envelope.routingSuggestion.routeId, "context-delivery");
	assert.equal(envelope.journeyId, "amber-delivery");
});

test("next --objective matches feature-standard plus secure-code-review pack", () => {
	const target = tempDir("match-feature");
	copyProductAsset(target, "routes/feature-standard.route.json");
	copyProductAsset(target, "workflow-packs/secure-code-review.pack.json");
	const envelope = inferNext(target, { objective: "add payment integration" });
	const suggestion = envelope.routingSuggestion;
	assert.equal(suggestion.matched, true);
	assert.equal(suggestion.routeId, "feature-standard");
	assert.equal(suggestion.workflowPackId, "secure-code-review");
	assert.equal(suggestion.confidence, 0.75);
});

test("next --objective degrades to plan-gate advice when nothing matches", () => {
	const target = tempDir("no-match");
	const envelope = inferNext(target, { objective: "write documentation" });
	const suggestion = envelope.routingSuggestion;
	assert.equal(suggestion.matched, false);
	assert.equal(suggestion.routeId, null);
	assert.match(suggestion.suggestion, /plan gate/);

	const textResult = runHarness(["next", "--target", target, "--objective", "write documentation"]);
	assert.equal(textResult.status, 0, textResult.stderr);
	assert.match(textResult.stdout, /Route suggestion:/);
	assert.match(textResult.stdout, /plan gate/);
});

test("--objective is parsed as a value flag without disturbing other flags", () => {
	const args = parseArgs(["--objective", "fix login bug"]);
	assert.equal(args.objective, "fix login bug");

	const mixed = parseArgs([
		"next",
		"--target",
		".",
		"--objective",
		"add payment integration",
		"--json",
	]);
	assert.equal(mixed.objective, "add payment integration");
	assert.equal(mixed.target, ".");
	assert.equal(mixed.json, true);

	const empty = parseArgs(["--target", "repo", "--objective", ""]);
	assert.equal(empty.objective, "");
	assert.equal(empty.target, "repo");
});
