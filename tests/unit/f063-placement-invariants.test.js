"use strict";

// F063 spec N4/N4.1 placement invariants, pinned by tests so the consolidated
// layout cannot silently regress: root-level tracked .md budget, docs tree
// single-responsibility dirs, .gitignore active-line budget, SPEC.md status
// header, router one-line index, and git-status cleanliness after a full run.
// The budgets carry the recorded deviations (spec §N4.1): ROADMAP/PRODUCT/
// UBIQUITOUS stay root-pending their own P2 tickets.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REPO = path.join(__dirname, "..", "..");

function git(args) {
	return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}

function trackedFiles() {
	return git(["ls-files", "--cached"]).split(/\r?\n/).filter(Boolean);
}

test("F063 N4: root-level tracked markdown stays within the 13-file budget", () => {
	const rootMd = trackedFiles().filter((f) => !f.includes("/") && f.endsWith(".md"));
	const expectedRootMd = [
		"AGENTS.md",
		"CHANGELOG.md",
		"CLAUDE.md",
		"CONTEXT.md",
		"CONTRIBUTING.md",
		"MEMORY.md",
		"PRODUCT.md",
		"README.md",
		"README.zh-CN.md",
		"ROADMAP.md",
		"SPEC.md",
		"UBIQUITOUS_LANGUAGE.md",
	];
	assert.deepEqual(rootMd.sort(), expectedRootMd.sort(), "root tracked .md set must match the spec N4.1 recorded state");
	assert.ok(rootMd.length <= 13, `root tracked .md count ${rootMd.length} exceeds the N4 budget of 13`);
});

test("F063 N4: docs/ first-level directories each carry ≥3 tracked files or a named single responsibility", () => {
	const docsFiles = trackedFiles().filter((f) => f.startsWith("docs/"));
	const byDir = new Map();
	for (const f of docsFiles) {
		const rel = f.slice("docs/".length);
		const dir = rel.includes("/") ? rel.split("/")[0] : "(root files)";
		byDir.set(dir, (byDir.get(dir) || 0) + 1);
	}
	// Single-responsibility exceptions (spec N4.1 #4): toolchain-owned namespaces.
	const singleResponsibility = new Set(["knowledge-corpus", "architecture"]);
	const smallDirs = [...byDir.entries()].filter(([, count]) => count < 3).map(([dir]) => dir);
	const offenders = smallDirs.filter((dir) => !singleResponsibility.has(dir));
	assert.deepEqual(offenders, [], `docs/ dirs with <3 tracked files and no recorded single responsibility: ${offenders.join(", ")}`);
});

test("F063 N4: .gitignore stays within the 60 active-line budget", () => {
	const lines = fs.readFileSync(path.join(REPO, ".gitignore"), "utf8").split(/\r?\n/);
	const active = lines.filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
	assert.ok(active.length <= 60, `.gitignore active lines ${active.length} exceed the N4 budget of 60`);
	// Guard entries kept after the .scratch/ move (spec N4.1 #5).
	for (const guard of ["docs/research/", "docs/legacy/", "spec-compliance*/", "tests/fixtures/worktree-test-repo/"]) {
		assert.ok(active.includes(guard), `.gitignore must keep the guard entry ${guard}`);
	}
});

test("F063 N3: SPEC.md answers the project status in its header without rewriting the body", () => {
	const spec = fs.readFileSync(path.join(REPO, "SPEC.md"), "utf8");
	const head = spec.split(/\r?\n/).slice(0, 6).join("\n");
	assert.match(head, /V1–V5\.5 implemented \(60 features accepted\)/);
	assert.match(head, /superseded by docs\/CLI_REFERENCE\.md/);
	assert.match(head, /§11 roadmap is historical/);
	assert.match(spec, /This spec defines the first shippable shape/);
});

test("F063 N2: the router skill body is a one-screen index, journey skills byte-stable", () => {
	const router = fs.readFileSync(path.join(REPO, "skills", "amber", "SKILL.md"), "utf8");
	assert.match(router, /^# Amber Journey Router$/m);
	assert.match(router, /Index: the seven primary verbs/);
	assert.match(router, /four deep journeys/);
	// The four journey skills keep their governed content markers.
	for (const name of ["amber-delivery", "amber-diagnosis-adoption", "amber-context-continuity", "amber-continuous-improvement"]) {
		const skill = fs.readFileSync(path.join(REPO, "skills", name, "SKILL.md"), "utf8");
		assert.match(skill, /^---\nname: /, `${name} keeps its frontmatter`);
		assert.ok(skill.length > 300, `${name} body must not have been gutted`);
	}
});

test("F063 N4: no stray untracked roots after a full run (known runtime writes excluded)", () => {
	const porcelain = git(["status", "--porcelain", "--untracked-files=all"]);
	const parallelPaths = [
		"apps/web/server/lib/suggestions/",
		"apps/web/server/routers/suggestions.ts",
		"apps/web/src/routes/suggestions/",
		"apps/web/tests/e2e/fixtures/suggestions-fixture.ts",
		"apps/web/tests/e2e/suggestions.spec.ts",
		"apps/web/tests/server/suggestions-router.test.ts",
		"apps/web/tests/suggestions-",
		"docs/plans/F064-",
		"docs/specs/F064-",
		"docs/quality/external-framework-reference-improvement-plan.md",
	];
	const untracked = porcelain
		.split(/\r?\n/)
		.filter((line) => line.startsWith("??"))
		.map((line) => line.slice(3).trim())
		.filter((p) => !p.startsWith("docs/agents/f013-f014-recovery")
			&& !p.startsWith("docs/agents/spec-source-migration")
			&& !p.startsWith("docs/plans/F063")
			&& !p.startsWith("docs/specs/F063")
			&& !p.startsWith("issues/")
			&& !parallelPaths.some((prefix) => p.startsWith(prefix)));
	// Pre-existing parallel-session artifacts are excluded above; nothing else may appear.
	assert.deepEqual(untracked, [], `unexpected untracked paths: ${untracked.join(", ")}`);
});
