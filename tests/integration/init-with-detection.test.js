"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function gitAvailable() {
	try {
		return spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
	} catch {
		return false;
	}
}

const GIT_OK = gitAvailable();

function tmp(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-init-detect-${name}-`));
}

function git(cwd, args) {
	const r = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (r.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
	}
}

// A github-flow-shaped repo: main + a feature/* branch + squash-style commits.
function makeGithubFlowRepo(dir) {
	git(dir, ["init", "-q"]);
	git(dir, ["config", "user.email", "dev@example.com"]);
	git(dir, ["config", "user.name", "Dev"]);
	git(dir, ["config", "commit.gpgsign", "false"]);
	git(dir, ["commit", "-q", "--allow-empty", "-m", "initial"]);
	git(dir, ["branch", "-M", "main"]);
	git(dir, ["branch", "feature/login"]);
	git(dir, ["commit", "-q", "--allow-empty", "-m", "Add login (#12)"]);
	git(dir, ["commit", "-q", "--allow-empty", "-m", "Fix bug (#13)"]);
}

function runInit(target, extraArgs = []) {
	return spawnSync(process.execPath, [CLI, "init", "--target", target, ...extraArgs], {
		cwd: ROOT,
		encoding: "utf8",
	});
}

describe("init with workflow detection", () => {
	it("writes .amber/init-report.json and reports the workflow on a git repo", (t) => {
		if (!GIT_OK) return t.skip("git unavailable");
		const target = tmp("report");
		makeGithubFlowRepo(target);

		const result = runInit(target);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Git workflow:/);
		assert.equal(fs.existsSync(path.join(target, ".amber", "init-report.json")), true);
	});

	it("reports wiki readiness with --with-wiki", (t) => {
		if (!GIT_OK) return t.skip("git unavailable");
		const target = tmp("wiki");
		makeGithubFlowRepo(target);

		const result = runInit(target, ["--with-wiki"]);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Wiki readiness: \d+\/\d+ files present/);
		assert.equal(fs.existsSync(path.join(target, "docs", "wiki", "index.md")), true);
	});

	it("skips detection (no report, no workflow line) with --skip-detection", (t) => {
		if (!GIT_OK) return t.skip("git unavailable");
		const target = tmp("skip");
		makeGithubFlowRepo(target);

		const result = runInit(target, ["--skip-detection"]);
		assert.equal(result.status, 0, result.stderr);
		assert.doesNotMatch(result.stdout, /Git workflow:/);
		assert.equal(fs.existsSync(path.join(target, ".amber", "init-report.json")), false);
	});

	it("emits JSON whose detection is present with --json", (t) => {
		if (!GIT_OK) return t.skip("git unavailable");
		const target = tmp("json");
		makeGithubFlowRepo(target);

		const result = runInit(target, ["--json"]);
		assert.equal(result.status, 0, result.stderr);
		const parsed = JSON.parse(result.stdout);
		assert.ok(parsed.detection, "detection should be present");
		assert.ok(parsed.detection.workflow, "detection.workflow should be present");
		assert.equal(typeof parsed.detection.workflow.detected, "string");
	});

	it("leaves a non-git target unchanged (no detection, no report)", () => {
		const target = tmp("nongit");

		const result = runInit(target);
		assert.equal(result.status, 0, result.stderr);
		assert.doesNotMatch(result.stdout, /Git workflow:/);
		assert.match(result.stdout, /Created: \d+/);
		assert.equal(fs.existsSync(path.join(target, ".amber", "init-report.json")), false);
	});
});
