"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
	generateGovernanceAdvice,
	analyzeTeamSize,
	generateGitignoreAdvice,
	generateDocAdvice,
} = require("../../scripts/lib/core/team-governance-advisor");

function gitAvailable() {
	try {
		return spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
	} catch {
		return false;
	}
}

const GIT_OK = gitAvailable();

function tmp(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-advisor-${name}-`));
}

function run(cwd, args) {
	const r = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (r.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
	}
}

function initSingleCommitterRepo(dir) {
	run(dir, ["init", "-q"]);
	run(dir, ["config", "user.email", "solo@example.com"]);
	run(dir, ["config", "user.name", "Solo Dev"]);
	run(dir, ["config", "commit.gpgsign", "false"]);
	run(dir, ["commit", "-q", "--allow-empty", "-m", "initial"]);
}

describe("team-governance-advisor", () => {
	it("classifies a single committer as a single-person team", (t) => {
		if (!GIT_OK) return t.skip("git unavailable");
		const dir = tmp("single");
		initSingleCommitterRepo(dir);

		const metrics = analyzeTeamSize(dir);
		assert.equal(metrics.category, "single");

		const advice = generateGovernanceAdvice(dir, null);
		assert.equal(advice.teamSize, "single");
		assert.match(advice.recommendations.codeReview.strategy, /self-verify/i);
	});

	it("flags personal patterns missing from .gitignore", () => {
		const { missing } = generateGitignoreAdvice("node_modules/\n*.log\n");
		assert.ok(missing.includes(".amber/sessions/"));
		assert.ok(missing.includes("PROGRESS.md"));
	});

	it("reports nothing missing when all personal patterns are present", () => {
		const content = [
			"node_modules/",
			".amber/sessions/",
			"PROGRESS.md",
			"session-handoff.md",
			"notes.md",
		].join("\n");
		const { missing, patch } = generateGitignoreAdvice(content);
		assert.deepEqual(missing, []);
		assert.equal(patch, "");
	});

	it("recommends CONTRIBUTING.md only when it is absent", () => {
		const small = { category: "small", count: 3 };

		const without = generateDocAdvice(small, { hasContributing: false });
		assert.ok(without.recommended.includes("CONTRIBUTING.md"));

		const withDoc = generateDocAdvice(small, { hasContributing: true });
		assert.ok(!withDoc.recommended.includes("CONTRIBUTING.md"));
	});

	it("tolerates a null workflow detection and returns the documented shape", () => {
		const dir = tmp("shape");
		const advice = generateGovernanceAdvice(dir, null);

		assert.ok(["single", "small", "medium", "large"].includes(advice.teamSize));
		assert.equal(typeof advice.contributors, "number");
		const r = advice.recommendations;
		assert.ok(r.codeReview && typeof r.codeReview.strategy === "string");
		assert.ok(Array.isArray(r.codeReview.tooling));
		assert.ok(Array.isArray(r.gitignore.missing));
		assert.ok(typeof r.gitignore.patch === "string");
		assert.ok(Array.isArray(r.documentation.required));
		assert.ok(Array.isArray(r.documentation.recommended));
	});
});
