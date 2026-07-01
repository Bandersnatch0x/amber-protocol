"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  auditProject,
  doctor,
  MINIMUM_HARNESS_FILES,
  OPTIONAL_STARTER_WIKI_FILES,
  scaffoldHarness,
  validateContinuousImprovementStateFile
} = require("../scripts/lib/amber-core");

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `amber-${name}-`));
}

function copyFixture(name) {
  const target = tempDir(name);
  fs.cpSync(path.join(__dirname, "fixtures", name), target, { recursive: true });
  return target;
}

test("scaffold creates a valid Harness in an empty repo", () => {
  const target = copyFixture("empty-repo");
  const result = scaffoldHarness(target);

  assert.ok(result.created.includes("AGENTS.md"));
  assert.ok(result.created.includes("docs/wiki/index.md"));
  assert.ok(result.created.includes(".workflow/continuous-improvement/state.json"));
  assert.equal(result.skipped.length, 0);
  assert.equal(fs.existsSync(path.join(target, "feature_list.json")), true);
  assert.equal(fs.existsSync(path.join(target, ".workflow", "continuous-improvement", "packets", "README.md")), true);

  const doctorResult = doctor(target);
  assert.deepEqual(doctorResult.errors, []);
});

test("continuous improvement state template is validated by doctor", () => {
  const target = copyFixture("empty-repo");
  scaffoldHarness(target);
  const statePath = path.join(target, ".workflow", "continuous-improvement", "state.json");
  fs.writeFileSync(statePath, JSON.stringify({ version: "1", mode: "", queue: {} }, null, 2));

  const stateResult = validateContinuousImprovementStateFile(statePath);
  assert.ok(stateResult.errors.some((error) => /version must be an integer/.test(error)));
  assert.ok(stateResult.errors.some((error) => /queue must be an array/.test(error)));

  const doctorResult = doctor(target);
  assert.ok(doctorResult.errors.some((error) => /continuous-improvement/.test(error)));
});

test("scaffold is idempotent and does not overwrite existing files", () => {
  const target = copyFixture("empty-repo");
  scaffoldHarness(target);

  const agentsPath = path.join(target, "AGENTS.md");
  fs.writeFileSync(agentsPath, "# Custom rules\n\nPreserve this file.\n");

  const result = scaffoldHarness(target);
  assert.ok(result.skipped.includes("AGENTS.md"));
  assert.match(fs.readFileSync(agentsPath, "utf8"), /Preserve this file/);
});

test("audit old repo is read-only and reports conflicts", () => {
  const target = copyFixture("old-repo");
  const before = fs.readFileSync(path.join(target, "AGENTS.md"), "utf8");

  const result = auditProject(target);

  assert.equal(result.readOnly, true);
  assert.ok(result.conflicts.includes("AGENTS.md"));
  assert.ok(result.missing.includes("feature_list.json"));
  assert.deepEqual(fs.readFileSync(path.join(target, "AGENTS.md"), "utf8"), before);
});

test("audit reports existing docs and approval-required patch suggestions", () => {
  const target = copyFixture("old-repo");

  const result = auditProject(target);

  assert.ok(result.suggestedAdditions.includes("feature_list.json"));
  assert.ok(result.docs.includes("docs/README.md"));
  assert.ok(result.wikiLikeFiles.includes("docs/README.md"));
  assert.ok(result.suggestedPatches.some((patch) => patch.file === "AGENTS.md"));
  assert.ok(result.suggestedPatches.every((patch) => patch.requiresApproval === true));
  assert.ok(result.untouchedFiles.includes("AGENTS.md"));
  assert.ok(Array.isArray(result.unknowns));
  assert.match(result.nextSafeCommand, /amber\.js audit --target/);
});

test("audit ignores dependency and generated-output markdown noise", () => {
  const target = copyFixture("empty-repo");
  fs.mkdirSync(path.join(target, "docs"), { recursive: true });
  fs.mkdirSync(path.join(target, "env", "Lib", "site-packages", "demo"), { recursive: true });
  fs.mkdirSync(path.join(target, "env_new", "Lib", "site-packages", "demo"), { recursive: true });
  fs.mkdirSync(path.join(target, ".venv", "Lib", "site-packages", "demo"), { recursive: true });
  fs.mkdirSync(path.join(target, "results", "600000", "reports"), { recursive: true });
  fs.mkdirSync(path.join(target, "data", "reports"), { recursive: true });
  fs.writeFileSync(path.join(target, "docs", "README.md"), "# Project docs\n");
  fs.writeFileSync(path.join(target, "env", "Lib", "site-packages", "demo", "README.md"), "# Dependency docs\n");
  fs.writeFileSync(path.join(target, "env_new", "Lib", "site-packages", "demo", "README.md"), "# Dependency docs\n");
  fs.writeFileSync(path.join(target, ".venv", "Lib", "site-packages", "demo", "README.md"), "# Dependency docs\n");
  fs.writeFileSync(path.join(target, "results", "600000", "reports", "market_report.md"), "# Generated result\n");
  fs.writeFileSync(path.join(target, "data", "reports", "analysis.md"), "# Generated report\n");

  const result = auditProject(target);

  assert.ok(result.docs.includes("docs/README.md"));
  assert.ok(result.wikiLikeFiles.includes("docs/README.md"));
  assert.ok(!result.docs.some((item) => item.startsWith("env/")));
  assert.ok(!result.docs.some((item) => item.startsWith("env_new/")));
  assert.ok(!result.docs.some((item) => item.startsWith(".venv/")));
  assert.ok(!result.docs.some((item) => item.startsWith("results/")));
  assert.ok(!result.docs.some((item) => item.startsWith("data/reports/")));
});

test("audit reports tooling evidence without inventing commands", () => {
  const target = copyFixture("empty-repo");
  fs.writeFileSync(path.join(target, "package-lock.json"), "{}\n");
  fs.writeFileSync(path.join(target, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  fs.writeFileSync(path.join(target, "pyproject.toml"), "[project]\nname = 'example'\n");

  const result = auditProject(target);

  assert.deepEqual(result.commands, []);
  assert.ok(result.toolingEvidence.some((item) => item.source === "package-lock.json" && item.name === "npm"));
  assert.ok(result.toolingEvidence.some((item) => item.source === "pnpm-lock.yaml" && item.name === "pnpm"));
  assert.ok(result.toolingEvidence.some((item) => item.source === "pyproject.toml" && item.name === "python"));
  assert.ok(result.unknowns.some((unknown) => /exact verification command is unknown/.test(unknown)));
});

test("audit suggests Python candidate verification commands without confirming them", () => {
  const target = copyFixture("empty-repo");
  fs.writeFileSync(path.join(target, "pyproject.toml"), "[project]\nname = 'example'\n");
  fs.writeFileSync(path.join(target, "requirements.txt"), "pytest\nruff\n");

  const result = auditProject(target);

  assert.deepEqual(result.commands, []);
  assert.deepEqual(
    result.candidateCommands.map((command) => command.command),
    ["python -m pytest", "python -m ruff check ."]
  );
  assert.ok(result.candidateCommands.every((command) => command.confidence === "candidate"));
  assert.ok(result.unknowns.some((unknown) => /candidate verification commands require confirmation/i.test(unknown)));
});

test("audit reports invalid package json as an unknown without commands", () => {
  const target = copyFixture("empty-repo");
  fs.writeFileSync(path.join(target, "package.json"), "{ broken json");

  const result = auditProject(target);

  assert.deepEqual(result.commands, []);
  assert.ok(result.unknowns.some((unknown) => /package\.json could not be parsed/.test(unknown)));
});

test("doctor aggregates manifest validation when plugin manifests are present", () => {
  const target = copyFixture("bad-manifests-missing-skills");

  const result = doctor(target);

  assert.ok(result.errors.some((error) => /skills path does not exist/.test(error)));
});

test("doctor aggregates V1 Harness guardrails for a broken Harness", () => {
  const target = copyFixture("broken-harness");

  const result = doctor(target);

  assert.ok(result.errors.some((error) => /Missing required file: CLAUDE\.md/.test(error)));
  assert.ok(result.errors.some((error) => /At most one feature can be in_progress/.test(error)));
  assert.ok(result.errors.some((error) => /passing but has no evidence/.test(error)));
  assert.ok(result.errors.some((error) => /links to missing missing\.md/.test(error)));
  assert.ok(result.errors.some((error) => /AGENTS\.md does not route agents to docs\/wiki/.test(error)));
  assert.ok(result.errors.some((error) => /verification\.md does not contain a verification command block/.test(error)));
  assert.ok(result.errors.some((error) => /PROGRESS\.md does not contain a next action/.test(error)));
  assert.ok(result.errors.some((error) => /session-handoff\.md must include a non-empty Summary section/.test(error)));
});

test("doctor accepts a minimum Harness without optional starter Wiki pages", () => {
  const target = copyFixture("empty-repo");
  scaffoldHarness(target);

  assert.ok(MINIMUM_HARNESS_FILES.includes("docs/wiki/product/overview.md"));
  assert.equal(MINIMUM_HARNESS_FILES.includes("docs/wiki/product/feature-map.md"), false);
  assert.ok(OPTIONAL_STARTER_WIKI_FILES.includes("docs/wiki/product/feature-map.md"));

  for (const relativePath of OPTIONAL_STARTER_WIKI_FILES) {
    fs.rmSync(path.join(target, relativePath), { force: true });
  }
  fs.writeFileSync(path.join(target, "docs", "wiki", "index.md"), "# Project Wiki\n");

  const result = doctor(target);

  assert.deepEqual(result.errors, []);
});
