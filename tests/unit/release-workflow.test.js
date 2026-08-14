"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "ci.yml");
const PACKAGES_WORKFLOW = path.join(ROOT, ".github", "workflows", "publish-github-packages.yml");

function releaseJob(workflow) {
	const start = workflow.search(/^ {2}release:/m);
	assert.ok(start >= 0, "ci.yml must define the stable release job");
	const rest = workflow.slice(start + "  release:".length);
	const next = rest.search(/\n {2}[A-Za-z]/);
	return next === -1
		? workflow.slice(start)
		: workflow.slice(start, start + "  release:".length + next);
}

function stepBody(workflow, name, nextName) {
	const start = workflow.indexOf(`- name: ${name}`);
	assert.ok(start >= 0, `missing step: ${name}`);
	const end = nextName ? workflow.indexOf(`- name: ${nextName}`, start) : workflow.length;
	assert.ok(end > start, `${name} must precede ${nextName}`);
	return workflow.slice(start, end);
}

test("stable release skips an already-published npm version and still reaches GitHub Release", () => {
	const workflow = fs.readFileSync(WORKFLOW, "utf8");
	const publishStep = stepBody(workflow, "Publish to npm", "Publish DSH to npm");
	assert.match(publishStep, /if npm view "amber-protocol@\$VERSION"/);
	assert.match(publishStep, /already published .* skipping/);
	assert.match(publishStep, /else\s+npm publish\s+fi/);
	assert.doesNotMatch(publishStep, /exit\s+1/);
});

test("stable release validates lockstep versions before publishing either package", () => {
	const workflow = fs.readFileSync(WORKFLOW, "utf8");
	const validateStart = workflow.indexOf("- name: Validate lockstep versions");
	const publishStart = workflow.indexOf("- name: Publish to npm");
	assert.ok(validateStart >= 0, "stable release must validate lockstep versions");
	assert.ok(validateStart < publishStart, "version contract must run before npm publish");
	assert.match(
		stepBody(workflow, "Validate lockstep versions", "Publish to npm"),
		/node scripts\/validate-release-versions\.js/,
	);
});

test("stable release publishes DSH after the main package and before GitHub Release", () => {
	const workflow = fs.readFileSync(WORKFLOW, "utf8");
	const mainStart = workflow.indexOf("- name: Publish to npm");
	const dshStart = workflow.indexOf("- name: Publish DSH to npm");
	const releaseStart = workflow.indexOf("- name: Create GitHub Release");
	assert.ok(dshStart > mainStart, "DSH publish must follow the main package");
	assert.ok(releaseStart > dshStart, "GitHub Release must follow DSH publish");

	const dshStep = stepBody(workflow, "Publish DSH to npm", "Check GitHub Release");
	assert.match(dshStep, /working-directory:\s*dsh/);
	assert.match(dshStep, /if npm view "dsh-amber-protocol@\$VERSION"/);
	assert.match(dshStep, /already published .* skipping/);
	// The already-published path skips without failing so the re-run can still
	// reach GitHub Release creation.
	const skipBranch = dshStep.slice(
		dshStep.indexOf("already published"),
		dshStep.indexOf("visible=false"),
	);
	assert.doesNotMatch(skipBranch, /exit\s+1/);
});

test("stable release confirms the amber-protocol dependency is visible before publishing DSH", () => {
	const workflow = fs.readFileSync(WORKFLOW, "utf8");
	const dshStep = stepBody(workflow, "Publish DSH to npm", "Check GitHub Release");
	const visibilityCheck = dshStep.indexOf('npm view "amber-protocol@$VERSION"');
	const publishCall = dshStep.indexOf("npm publish");
	assert.ok(
		visibilityCheck >= 0 && publishCall > visibilityCheck,
		"DSH publish must wait for amber-protocol@$VERSION visibility before npm publish",
	);
	// Fail closed: an unresolvable dependency must abort the DSH publish.
	assert.match(dshStep, /not visible on npmjs[\s\S]*exit 1/);
});

test("stable release skips GitHub Release creation when the release already exists", () => {
	const workflow = fs.readFileSync(WORKFLOW, "utf8");
	const checkStart = workflow.indexOf("- name: Check GitHub Release");
	const releaseStart = workflow.indexOf("- name: Create GitHub Release");
	assert.ok(checkStart >= 0, "stable release must check for an existing GitHub Release");
	assert.ok(checkStart < releaseStart, "release existence check must precede release creation");

	const checkStep = stepBody(workflow, "Check GitHub Release", "Create GitHub Release");
	assert.match(checkStep, /gh release view/);
	assert.match(checkStep, /exists=true/);
	assert.match(checkStep, /exists=false/);
	assert.match(
		workflow.slice(releaseStart),
		/if:\s*steps\.check_release\.outputs\.exists == 'false'/,
		"release creation must be gated on the existence check",
	);
});

test("stable release still excludes prerelease tags", () => {
	const job = releaseJob(fs.readFileSync(WORKFLOW, "utf8"));
	assert.match(job, /!contains\(github\.ref, '-rc'\)/);
	assert.match(job, /!contains\(github\.ref, '-beta'\)/);
});

test("GitHub Packages mirror skips prerelease tags and keeps manual dispatch", () => {
	const workflow = fs.readFileSync(PACKAGES_WORKFLOW, "utf8");
	assert.match(workflow, /workflow_dispatch/);
	assert.match(workflow, /!contains\(github\.ref, '-rc'\)/);
	assert.match(workflow, /!contains\(github\.ref, '-beta'\)/);
	assert.match(
		workflow,
		/github\.event_name\s*==\s*'workflow_dispatch'\s*\|\|[\s\S]*!contains\(github\.ref, '-rc'\)[\s\S]*!contains\(github\.ref, '-beta'\)/,
	);
});
