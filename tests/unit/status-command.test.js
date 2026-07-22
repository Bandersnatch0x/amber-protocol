"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { scaffoldHarness } = require("../../scripts/lib/core/scaffold");
const { buildStatus, renderStatus } = require("../../scripts/lib/status-command");

function seedWiki(dir) {
  const { REQUIRED_HARNESS_FILES } = require("../../scripts/lib/core/constants");
  for (const rel of REQUIRED_HARNESS_FILES) {
    if (!rel.startsWith("docs/wiki/")) continue;
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "# stub\n");
  }
}

test("status surfaces wiki drift counts when available", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-st-"));
  execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
  fs.writeFileSync(path.join(dir, ".gitignore"), ".amber/\n");
  execSync("git add -A && git commit -qm init", { cwd: dir });
  scaffoldHarness(dir, {});
  seedWiki(dir);
  const status = buildStatus(dir);
  assert.ok(status.wikiDrift.available);
  assert.ok(typeof status.wikiDrift.counts.missingRequired === "number");
  const text = renderStatus(status);
  assert.match(text, /Wiki drift:/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("status renders a local hint when wiki signals are non-zero", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-st-"));
  execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
  fs.writeFileSync(path.join(dir, ".gitignore"), ".amber/\n");
  execSync("git add -A && git commit -qm init", { cwd: dir });
  scaffoldHarness(dir, {});
  seedWiki(dir);
  // Remove one required wiki page to create a non-zero signal.
  const { REQUIRED_HARNESS_FILES } = require("../../scripts/lib/core/constants");
  const missingRel = REQUIRED_HARNESS_FILES.find((r) => r.startsWith("docs/wiki/"));
  fs.unlinkSync(path.join(dir, missingRel));
  const text = renderStatus(buildStatus(dir));
  assert.match(text, /Wiki drift:/);
  assert.match(text, /hint:/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("status top-level nextStep is unchanged shape (still present)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-st-"));
  execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
  fs.writeFileSync(path.join(dir, ".gitignore"), ".amber/\n");
  execSync("git add -A && git commit -qm init", { cwd: dir });
  scaffoldHarness(dir, {});
  seedWiki(dir);
  const status = buildStatus(dir);
  assert.ok(typeof status.nextStep === "string" && status.nextStep.length > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

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
	assert.ok(s.artifactDrift.available);
	assert.ok(typeof s.artifactDrift.counts.drifted === "number");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("status surfaces artifact drift counts and honesty caveat", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-st-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
	fs.writeFileSync(path.join(dir, ".gitignore"), ".amber/\n");
	execSync("git add -A && git commit -qm init", { cwd: dir });
	scaffoldHarness(dir, {});
	const text = renderStatus(buildStatus(dir));
	assert.match(text, /Artifact drift:/);
	assert.match(text, /not a re-verification/);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("status nextStep points to feature verify when drifted > 0", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-st-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
	fs.writeFileSync(path.join(dir, ".gitignore"), ".amber/\n");
	fs.mkdirSync(path.join(dir, "src"), { recursive: true });
	fs.writeFileSync(path.join(dir, "src", "a.js"), "x");
	execSync("git add -A && git commit -qm init", { cwd: dir });
	scaffoldHarness(dir, {});
	const featureList = JSON.parse(fs.readFileSync(path.join(dir, "feature_list.json"), "utf8"));
	featureList.features.push({
		id: "F900",
		priority: 2,
		area: "test",
		title: "Drifted feature",
		user_visible_behavior: "b",
		status: "passing",
		verification: ["v"],
		paths: ["src/a.js"],
		evidence: [{ command: "c", result: "pass", date: "2020-01-01" }],
		notes: [],
	});
	fs.writeFileSync(path.join(dir, "feature_list.json"), JSON.stringify(featureList, null, 2));
	const s = buildStatus(dir);
	assert.ok(s.artifactDrift.counts.drifted > 0);
	assert.match(s.nextStep, /amber feature verify/);
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

test("renderStatus labels untracked-only trees distinctly from tracked dirty", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-st-ut-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
	fs.writeFileSync(path.join(dir, "README.md"), "# x\n");
	execSync("git add -A && git commit -qm init", { cwd: dir });
	fs.writeFileSync(path.join(dir, "scratch.tmp"), "noise\n"); // ?? only
	const untrackedOnly = renderStatus(buildStatus(dir));
	assert.match(untrackedOnly, /dirty \(untracked only\)/);

	fs.writeFileSync(path.join(dir, "README.md"), "# changed\n");
	const trackedDirty = renderStatus(buildStatus(dir));
	assert.match(trackedDirty, /dirty/);
	assert.doesNotMatch(trackedDirty, /untracked only/);
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
