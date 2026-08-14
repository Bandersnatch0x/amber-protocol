"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "ci.yml");

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

	const dshStep = stepBody(workflow, "Publish DSH to npm", "Create GitHub Release");
	assert.match(dshStep, /working-directory:\s*dsh/);
	assert.match(dshStep, /if npm view "dsh-amber-protocol@\$VERSION"/);
	assert.match(dshStep, /already published .* skipping/);
	assert.match(dshStep, /else\s+npm publish\s+fi/);
	assert.doesNotMatch(dshStep, /exit\s+1/);
});

test("stable release still excludes prerelease tags", () => {
	const job = releaseJob(fs.readFileSync(WORKFLOW, "utf8"));
	assert.match(job, /!contains\(github\.ref, '-rc'\)/);
	assert.match(job, /!contains\(github\.ref, '-beta'\)/);
});
