"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { scaffoldHarness } = require("../../scripts/lib/core/scaffold");
const { buildStatus, renderStatus } = require("../../scripts/lib/status-command");

test("buildStatus on an installed harnessed git target reports repo + init + provenance + drift counts", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-st-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
	fs.writeFileSync(path.join(dir, ".gitignore"), ".amber/\n");
	execSync("git add -A && git commit -qm init", { cwd: dir });
	scaffoldHarness(dir, {}); // install scaffold + provenance
	const s = buildStatus(dir);
	assert.equal(s.repo.isGit, true);
	assert.equal(s.init.classification, "harnessed-target-repo");
	assert.equal(s.init.stateDir, ".amber");
	assert.equal(s.init.provenance.present, true);
	assert.ok(s.scaffoldDrift.counts, "scaffold drift counts present");
	assert.ok(typeof s.scaffoldDrift.counts.fresh === "number");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("buildStatus on a non-git unharnessed dir reports non-git + unharnessed + no provenance", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-st-"));
	const s = buildStatus(dir);
	assert.equal(s.repo.isGit, false);
	assert.equal(s.repo.branch, null);
	assert.equal(s.init.classification, "unharnessed-target-repo");
	assert.equal(s.init.stateDir, "none");
	assert.equal(s.init.provenance.present, false);
	assert.match(s.nextStep, /amber init/);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("buildStatus marks scaffold drift n/a on a product-repo (skips the detector)", () => {
	// The Amber repo itself classifies as product-repo (SPEC.md/ROADMAP.md/scripts/amber.js/templates).
	const s = buildStatus(path.join(__dirname, "..", ".."));
	assert.equal(s.init.classification, "product-repo");
	assert.ok(!s.scaffoldDrift.counts, "counts skipped for product-repo");
	assert.match(s.scaffoldDrift.note, /n\/a \(product-repo/i);
});

test("renderStatus produces a readable multi-line report", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-st-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
	fs.writeFileSync(path.join(dir, ".gitignore"), ".amber/\n");
	execSync("git add -A && git commit -qm init", { cwd: dir });
	scaffoldHarness(dir, {});
	const text = renderStatus(buildStatus(dir));
	assert.match(text, /Target:/);
	assert.match(text, /Repo:/);
	assert.match(text, /Init:/);
	assert.match(text, /Scaffold drift:/);
	assert.match(text, /Next:/);
	const initLine = text.split("\n").find((l) => l.startsWith("Init:"));
	assert.ok(initLine, "Init line present");
	assert.ok(!initLine.includes("})"), `no stray brace in Init line: ${initLine}`);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("buildStatus surfaces the no-provenance note and points to init when provenance is missing", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-st-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
	fs.writeFileSync(path.join(dir, ".gitignore"), ".amber/\n");
	execSync("git add -A && git commit -qm init", { cwd: dir });
	scaffoldHarness(dir, {});
	fs.unlinkSync(path.join(dir, ".amber", "provenance.json")); // harnessed, no provenance
	const s = buildStatus(dir);
	assert.equal(s.scaffoldDrift.installed, false);
	assert.match(s.nextStep, /amber init/);
	const text = renderStatus(s);
	assert.match(text, /No install provenance/i); // the note is surfaced, not an all-zero line
	fs.rmSync(dir, { recursive: true, force: true });
});
