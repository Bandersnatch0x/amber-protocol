"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
	detectGitWorkflow,
	isGitRepository,
	calculateConfidence,
	getTopWorkflow,
} = require("../../scripts/lib/core/git-workflow-detector");

function gitAvailable() {
	try {
		return spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
	} catch {
		return false;
	}
}

const GIT_OK = gitAvailable();

function tmp(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-detector-${name}-`));
}

function run(cwd, args) {
	const r = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (r.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
	}
	return r.stdout;
}

function commit(dir, message) {
	run(dir, ["commit", "-q", "--allow-empty", "-m", message]);
}

// Initialise a repo with one commit on a guaranteed `main` branch. `git branch -M`
// renames whatever the default branch is (master or main) to main, so the helper
// is independent of the host git's init.defaultBranch.
function initRepo(dir) {
	run(dir, ["init", "-q"]);
	run(dir, ["config", "user.email", "test@example.com"]);
	run(dir, ["config", "user.name", "Amber Test"]);
	run(dir, ["config", "commit.gpgsign", "false"]);
	commit(dir, "initial commit");
	run(dir, ["branch", "-M", "main"]);
}

describe("git-workflow-detector", () => {
	it("returns null for a non-git directory", () => {
		const dir = tmp("nongit");
		assert.equal(detectGitWorkflow(dir), null);
		assert.equal(isGitRepository(dir), false);
	});

	it("detects gitflow from develop/release/hotfix branches", (t) => {
		if (!GIT_OK) return t.skip("git unavailable");
		const dir = tmp("gitflow");
		initRepo(dir);
		commit(dir, "second commit");
		run(dir, ["branch", "develop"]);
		run(dir, ["branch", "release/1.0"]);
		run(dir, ["branch", "hotfix/urgent"]);

		const result = detectGitWorkflow(dir);
		assert.equal(result.detected, "gitflow");
		assert.ok(result.scores.gitflow >= 60, `expected >=60, got ${result.scores.gitflow}`);
		assert.equal(result.confidence, "high");
	});

	it("detects github-flow from a feature branch and squash-style commits", (t) => {
		if (!GIT_OK) return t.skip("git unavailable");
		const dir = tmp("ghflow");
		initRepo(dir);
		run(dir, ["branch", "feature/login"]);
		commit(dir, "Add login (#12)");
		commit(dir, "Fix bug (#13)");
		commit(dir, "Improve UI (#14)");

		const result = detectGitWorkflow(dir);
		assert.equal(result.detected, "github-flow");
		assert.ok(result.evidence.length > 0);
	});

	it("detects trunk-based from direct commits on main only", (t) => {
		if (!GIT_OK) return t.skip("git unavailable");
		const dir = tmp("trunk");
		initRepo(dir);
		commit(dir, "work 1");
		commit(dir, "work 2");
		commit(dir, "work 3");
		commit(dir, "work 4");

		const result = detectGitWorkflow(dir);
		assert.equal(result.detected, "trunk-based");
	});

	it("always returns the three score keys and a string[] evidence", (t) => {
		if (!GIT_OK) return t.skip("git unavailable");
		const dir = tmp("shape");
		initRepo(dir);

		const result = detectGitWorkflow(dir);
		assert.deepEqual(
			Object.keys(result.scores).sort(),
			["github-flow", "gitflow", "trunk-based"].sort(),
		);
		assert.ok(Array.isArray(result.evidence));
		assert.ok(result.evidence.every((e) => typeof e === "string"));
	});

	it("scores helpers: argmax and confidence bands", () => {
		assert.equal(getTopWorkflow({ gitflow: 65, "github-flow": 10, "trunk-based": 0 }), "gitflow");
		assert.equal(calculateConfidence({ gitflow: 65, "github-flow": 10, "trunk-based": 0 }), "high");
		assert.equal(
			calculateConfidence({ gitflow: 45, "github-flow": 30, "trunk-based": 0 }),
			"medium",
		);
		assert.equal(calculateConfidence({ gitflow: 20, "github-flow": 15, "trunk-based": 0 }), "low");
	});
});
