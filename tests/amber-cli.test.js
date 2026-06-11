"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-${name}-`));
}

function runHarness(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    ...options
  });
}

test("init command scaffolds a Harness without overwriting existing files", () => {
  const target = tempDir("init");
  fs.writeFileSync(path.join(target, "AGENTS.md"), "# Existing rules\n");

  const result = runHarness(["init", "--target", target]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Created:/);
  assert.match(result.stdout, /Skipped:/);
  assert.equal(fs.readFileSync(path.join(target, "AGENTS.md"), "utf8"), "# Existing rules\n");
  assert.equal(fs.existsSync(path.join(target, "feature_list.json")), true);
});

test("audit command is read-only and reports missing Harness files", () => {
  const target = tempDir("audit");
  fs.writeFileSync(path.join(target, "AGENTS.md"), "# Existing rules\n");
  fs.mkdirSync(path.join(target, "docs"), { recursive: true });
  fs.writeFileSync(path.join(target, "docs", "README.md"), "# Existing docs\n");

  const result = runHarness(["audit", "--target", target]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Read-only: true/);
  assert.match(result.stdout, /Missing Harness files:/);
  assert.match(result.stdout, /Suggested additions:/);
  assert.match(result.stdout, /Existing docs:/);
  assert.match(result.stdout, /docs\/README\.md/);
  assert.match(result.stdout, /Suggested patches requiring approval:/);
  assert.match(result.stdout, /Unknowns:/);
  assert.match(result.stdout, /No package, test, build, or verification command detected/);
  assert.match(result.stdout, /Next safe command:/);
  assert.equal(fs.readFileSync(path.join(target, "AGENTS.md"), "utf8"), "# Existing rules\n");
});

test("audit command reports tooling evidence without detected commands", () => {
  const target = tempDir("audit-tooling");
  fs.writeFileSync(path.join(target, "package-lock.json"), "{}\n");

  const result = runHarness(["audit", "--target", target]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Tooling evidence:/);
  assert.match(result.stdout, /package-lock\.json: npm/);
  assert.doesNotMatch(result.stdout, /Detected commands:/);
  assert.match(result.stdout, /exact verification command is unknown/);
});

test("audit summary limits long docs output while preserving actions", () => {
  const target = tempDir("audit-summary");
  fs.writeFileSync(path.join(target, "pyproject.toml"), "[project]\nname = 'example'\n");
  fs.mkdirSync(path.join(target, "tests"), { recursive: true });
  fs.mkdirSync(path.join(target, "docs"), { recursive: true });
  for (let index = 0; index < 20; index += 1) {
    fs.writeFileSync(path.join(target, "docs", `page-${index}.md`), `# Page ${index}\n`);
  }

  const result = runHarness(["audit", "--target", target, "--summary"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Audit summary/);
  assert.match(result.stdout, /Existing docs: 20/);
  assert.match(result.stdout, /Wiki-like files: 20/);
  assert.match(result.stdout, /Suggested additions: 17/);
  assert.match(result.stdout, /Candidate commands requiring confirmation:/);
  assert.match(result.stdout, /python -m pytest/);
  assert.match(result.stdout, /Unknowns:/);
  assert.match(result.stdout, /Next safe command:/);
  assert.equal(result.stdout.includes("docs/page-19.md"), false);
  assert.doesNotMatch(result.stdout, /Suggested additions:\\n\\s+- AGENTS\\.md/);
});

test("adoption report aggregates safe trial steps without initializing target", () => {
  const target = tempDir("adoption-report-target");
  const outputDir = tempDir("adoption-report-output");
  const output = path.join(outputDir, "report.md");
  fs.writeFileSync(path.join(target, "pyproject.toml"), "[project]\nname = 'example'\n");
  fs.mkdirSync(path.join(target, "tests"), { recursive: true });
  fs.mkdirSync(path.join(target, "docs"), { recursive: true });
  fs.writeFileSync(path.join(target, "docs", "README.md"), "# Existing docs\n");

  const result = runHarness(["adoption", "report", "--target", target, "--output", output, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.target, target);
  assert.equal(payload.reportPath, output);
  assert.equal(payload.readOnlyTargetRoot, true);
  assert.equal(payload.sections.map((section) => section.id).join(","), "audit,init-dry-run,team,maintenance");
  assert.equal(fs.existsSync(output), true);
  const report = fs.readFileSync(output, "utf8");
  assert.match(report, /# Coding Harness Adoption Report/);
  assert.match(report, /## Audit Summary/);
  assert.match(report, /python -m pytest/);
  assert.match(report, /## Init Dry Run/);
  assert.match(report, /## Team Distribution/);
  assert.match(report, /## Maintenance/);
  assert.match(report, /No target project files were initialized by this report/);
  assert.equal(fs.existsSync(path.join(target, "AGENTS.md")), false);
  assert.equal(fs.existsSync(path.join(target, ".amber", "team", "lock.json")), false);
});

test("adoption report output-dir creates non-conflicting timestamped reports", () => {
  const target = tempDir("adoption-output-dir-target");
  const outputDir = tempDir("adoption-output-dir");
  fs.writeFileSync(path.join(target, "pyproject.toml"), "[project]\nname = 'example'\n");
  fs.mkdirSync(path.join(target, "tests"), { recursive: true });

  const first = runHarness(["adoption", "report", "--target", target, "--output-dir", outputDir, "--json"]);
  const second = runHarness(["adoption", "report", "--target", target, "--output-dir", outputDir, "--json"]);

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  const firstPayload = JSON.parse(first.stdout);
  const secondPayload = JSON.parse(second.stdout);
  assert.equal(path.dirname(firstPayload.reportPath), outputDir);
  assert.equal(path.dirname(secondPayload.reportPath), outputDir);
  assert.notEqual(firstPayload.reportPath, secondPayload.reportPath);
  assert.match(path.basename(firstPayload.reportPath), /adoption-output-dir-target-.*-adoption-report-\d{4}-\d{2}-\d{2}t\d{2}-\d{2}-\d{2}/i);
  assert.equal(fs.existsSync(firstPayload.reportPath), true);
  assert.equal(fs.existsSync(secondPayload.reportPath), true);
});

test("adoption report rejects output and output-dir together", () => {
  const target = tempDir("adoption-output-conflict-target");
  const outputDir = tempDir("adoption-output-conflict-dir");
  const output = path.join(outputDir, "report.md");

  const result = runHarness(["adoption", "report", "--target", target, "--output", output, "--output-dir", outputDir, "--json"]);

  assert.notEqual(result.status, 0);
  assert.match(JSON.parse(result.stdout).errors.join("\n"), /Use either --output or --output-dir/);
});

test("adoption list reads report metadata without writing an index", () => {
  const reportsDir = tempDir("adoption-list-reports");
  const olderReport = path.join(reportsDir, "project-a.md");
  const newerReport = path.join(reportsDir, "project-b.md");
  fs.writeFileSync(
    olderReport,
    "# Coding Harness Adoption Report\n\nTarget: C:\\tmp\\ProjectA\nGenerated: 2026-06-09T01:00:00.000Z\n"
  );
  fs.writeFileSync(
    newerReport,
    "# Coding Harness Adoption Report\n\nTarget: C:\\tmp\\ProjectB\nGenerated: 2026-06-09T02:00:00.000Z\n"
  );

  const result = runHarness(["adoption", "list", "--reports-dir", reportsDir, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.reportsDir, reportsDir);
  assert.equal(payload.reports.length, 2);
  assert.deepEqual(
    payload.reports.map((report) => path.basename(report.file)),
    ["project-b.md", "project-a.md"]
  );
  assert.equal(payload.reports[0].target, "C:\\tmp\\ProjectB");
  assert.equal(payload.reports[0].generatedAt, "2026-06-09T02:00:00.000Z");
  assert.equal(fs.existsSync(path.join(reportsDir, "index.md")), false);

  const textResult = runHarness(["adoption", "list", "--reports-dir", reportsDir]);
  assert.equal(textResult.status, 0, textResult.stderr);
  assert.match(textResult.stdout, /Reports: 2/);
  assert.match(textResult.stdout, /project-b\.md/);
});

test("adoption index writes a markdown index and refuses to overwrite it", () => {
  const reportsDir = tempDir("adoption-index-reports");
  const output = path.join(reportsDir, "adoptions-index.md");
  fs.writeFileSync(
    path.join(reportsDir, "project-a.md"),
    "# Coding Harness Adoption Report\n\nTarget: C:\\tmp\\ProjectA\nGenerated: 2026-06-09T01:00:00.000Z\n"
  );
  fs.writeFileSync(
    path.join(reportsDir, "project-b.md"),
    "# Coding Harness Adoption Report\n\nTarget: C:\\tmp\\ProjectB\nGenerated: 2026-06-09T02:00:00.000Z\n"
  );

  const result = runHarness(["adoption", "index", "--reports-dir", reportsDir, "--output", output, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.reportsDir, reportsDir);
  assert.equal(payload.outputPath, output);
  assert.equal(payload.reports.length, 2);
  const index = fs.readFileSync(output, "utf8");
  assert.match(index, /# Adoption Reports Index/);
  assert.match(index, /project-b\.md/);
  assert.match(index, /C:\\tmp\\ProjectB/);

  const second = runHarness(["adoption", "index", "--reports-dir", reportsDir, "--output", output, "--json"]);
  assert.notEqual(second.status, 0);
  assert.match(JSON.parse(second.stdout).errors.join("\n"), /Index already exists|already exists/);
});

test("adoption validate checks report metadata without writing files", () => {
  const reportsDir = tempDir("adoption-validate-reports");
  fs.writeFileSync(
    path.join(reportsDir, "project-a.md"),
    "# Coding Harness Adoption Report\n\nTarget: C:\\tmp\\ProjectA\nGenerated: 2026-06-09T01:00:00.000Z\n"
  );

  const result = runHarness(["adoption", "validate", "--reports-dir", reportsDir, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.reportsDir, reportsDir);
  assert.equal(payload.valid, true);
  assert.equal(payload.reports.length, 1);
  assert.equal(payload.checkedIndex, false);
  assert.equal(fs.existsSync(path.join(reportsDir, "adoptions-index.md")), false);

  const textResult = runHarness(["adoption", "validate", "--reports-dir", reportsDir]);
  assert.equal(textResult.status, 0, textResult.stderr);
  assert.match(textResult.stdout, /Valid: true/);
  assert.match(textResult.stdout, /Reports: 1/);
});

test("adoption validate reports broken index links", () => {
  const reportsDir = tempDir("adoption-validate-index-reports");
  const indexPath = path.join(reportsDir, "adoptions-index.md");
  fs.writeFileSync(
    path.join(reportsDir, "project-a.md"),
    "# Coding Harness Adoption Report\n\nTarget: C:\\tmp\\ProjectA\nGenerated: 2026-06-09T01:00:00.000Z\n"
  );
  fs.writeFileSync(
    indexPath,
    "# Adoption Reports Index\n\n| Generated | Target | Report |\n| --- | --- | --- |\n| now | target | [missing.md](missing.md) |\n"
  );

  const result = runHarness(["adoption", "validate", "--reports-dir", reportsDir, "--index", indexPath, "--json"]);

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.valid, false);
  assert.equal(payload.checkedIndex, true);
  assert.match(payload.errors.join("\n"), /missing\.md/);
});

test("adoption validate reports invalid markdown in the reports directory", () => {
  const reportsDir = tempDir("adoption-validate-invalid-reports");
  fs.writeFileSync(path.join(reportsDir, "notes.md"), "# Notes\n\nNot an adoption report.\n");

  const result = runHarness(["adoption", "validate", "--reports-dir", reportsDir, "--json"]);

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.valid, false);
  assert.match(payload.errors.join("\n"), /Invalid adoption report metadata: .*notes\.md/);
});

test("adoption compare auto-selects the latest two reports and reports deltas", () => {
  const reportsDir = tempDir("adoption-compare-reports");
  const olderReport = path.join(reportsDir, "older.md");
  const newerReport = path.join(reportsDir, "newer.md");
  fs.writeFileSync(
    olderReport,
    [
      "# Coding Harness Adoption Report",
      "",
      "Target: C:\\tmp\\ProjectA",
      "Generated: 2026-06-09T01:00:00.000Z",
      "",
      "## Audit Summary",
      "",
      "- Existing Harness files: 10",
      "- Missing Harness files: 5",
      "- Existing docs: 2",
      "- Wiki-like files: 1",
      "- Conflicts: 0",
      "",
      "### Candidate Commands",
      "",
      "- python: test -> python -m pytest",
      "",
      "### Unknowns",
      "",
      "- exact lint command unknown",
      "",
      "## Maintenance",
      "",
      "- Stale docs: 4",
      "- Rule-pack drift: true",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    newerReport,
    [
      "# Coding Harness Adoption Report",
      "",
      "Target: C:\\tmp\\ProjectA",
      "Generated: 2026-06-09T02:00:00.000Z",
      "",
      "## Audit Summary",
      "",
      "- Existing Harness files: 12",
      "- Missing Harness files: 3",
      "- Existing docs: 4",
      "- Wiki-like files: 2",
      "- Conflicts: 0",
      "",
      "### Candidate Commands",
      "",
      "- python: test -> python -m pytest",
      "- package.json: lint -> npm run lint",
      "",
      "### Unknowns",
      "",
      "- none",
      "",
      "## Maintenance",
      "",
      "- Stale docs: 2",
      "- Rule-pack drift: false",
      ""
    ].join("\n")
  );

  const result = runHarness(["adoption", "compare", "--reports-dir", reportsDir, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(path.basename(payload.base.file), "older.md");
  assert.equal(path.basename(payload.head.file), "newer.md");
  assert.equal(payload.sameTarget, true);
  assert.equal(payload.metrics.missingHarnessFiles.delta, -2);
  assert.equal(payload.metrics.existingDocs.delta, 2);
  assert.deepEqual(payload.candidateCommands.added, ["package.json: lint -> npm run lint"]);
  assert.deepEqual(payload.unknowns.removed, ["exact lint command unknown"]);
  assert.equal(fs.existsSync(path.join(reportsDir, "adoption-diff.md")), false);
});

test("adoption compare writes markdown diff and refuses to overwrite it", () => {
  const reportsDir = tempDir("adoption-compare-output-reports");
  const base = path.join(reportsDir, "base.md");
  const head = path.join(reportsDir, "head.md");
  const output = path.join(reportsDir, "diff.md");
  fs.writeFileSync(
    base,
    "# Coding Harness Adoption Report\n\nTarget: C:\\tmp\\ProjectA\nGenerated: 2026-06-09T01:00:00.000Z\n\n## Audit Summary\n\n- Missing Harness files: 5\n\n### Candidate Commands\n\n- python: test -> python -m pytest\n\n### Unknowns\n\n- exact lint command unknown\n"
  );
  fs.writeFileSync(
    head,
    "# Coding Harness Adoption Report\n\nTarget: C:\\tmp\\ProjectA\nGenerated: 2026-06-09T02:00:00.000Z\n\n## Audit Summary\n\n- Missing Harness files: 3\n\n### Candidate Commands\n\n- python: test -> python -m pytest\n- package.json: lint -> npm run lint\n\n### Unknowns\n\n- none\n"
  );

  const result = runHarness(["adoption", "compare", "--base", base, "--head", head, "--output", output, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.outputPath, output);
  assert.equal(payload.metrics.missingHarnessFiles.delta, -2);
  const diff = fs.readFileSync(output, "utf8");
  assert.match(diff, /# Adoption Report Diff/);
  assert.match(diff, /Missing Harness files/);
  assert.match(diff, /package\.json: lint -> npm run lint/);

  const second = runHarness(["adoption", "compare", "--base", base, "--head", head, "--output", output, "--json"]);
  assert.notEqual(second.status, 0);
  assert.match(JSON.parse(second.stdout).errors.join("\n"), /Diff already exists|already exists/);
});

test("adoption gate reports a conservative wait decision for risky reports", () => {
  const reportsDir = tempDir("adoption-gate-report");
  const report = path.join(reportsDir, "report.md");
  fs.writeFileSync(
    report,
    [
      "# Coding Harness Adoption Report",
      "",
      "Target: C:\\tmp\\ProjectA",
      "Generated: 2026-06-09T01:00:00.000Z",
      "",
      "## Audit Summary",
      "",
      "- Missing Harness files: 2",
      "- Conflicts: 0",
      "",
      "### Candidate Commands",
      "",
      "- python: test -> python -m pytest",
      "",
      "### Unknowns",
      "",
      "- exact lint command unknown",
      ""
    ].join("\n")
  );

  const result = runHarness(["adoption", "gate", "--report", report, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.decision, "wait");
  assert.equal(payload.report.file, report);
  assert.deepEqual(
    payload.findings.map((finding) => finding.id),
    ["missing-harness-files", "candidate-commands-unconfirmed", "unknowns-present"]
  );
  assert.equal(fs.existsSync(path.join(reportsDir, "gate.md")), false);
});

test("adoption gate selects the latest report from a reports directory", () => {
  const reportsDir = tempDir("adoption-gate-reports-dir");
  fs.writeFileSync(
    path.join(reportsDir, "older.md"),
    "# Coding Harness Adoption Report\n\nTarget: C:\\tmp\\ProjectA\nGenerated: 2026-06-09T01:00:00.000Z\n\n## Audit Summary\n\n- Missing Harness files: 4\n- Conflicts: 0\n\n### Candidate Commands\n\n- none\n\n### Unknowns\n\n- none\n"
  );
  fs.writeFileSync(
    path.join(reportsDir, "newer.md"),
    "# Coding Harness Adoption Report\n\nTarget: C:\\tmp\\ProjectA\nGenerated: 2026-06-09T02:00:00.000Z\n\n## Audit Summary\n\n- Missing Harness files: 0\n- Conflicts: 0\n\n### Candidate Commands\n\n- none\n\n### Unknowns\n\n- none\n"
  );

  const result = runHarness(["adoption", "gate", "--reports-dir", reportsDir, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.decision, "ready");
  assert.equal(path.basename(payload.report.file), "newer.md");
  assert.deepEqual(payload.findings, []);
});

test("adoption gate writes markdown output and refuses to overwrite it", () => {
  const reportsDir = tempDir("adoption-gate-output");
  const report = path.join(reportsDir, "report.md");
  const output = path.join(reportsDir, "gate.md");
  fs.writeFileSync(
    report,
    "# Coding Harness Adoption Report\n\nTarget: C:\\tmp\\ProjectA\nGenerated: 2026-06-09T01:00:00.000Z\n\n## Audit Summary\n\n- Missing Harness files: 0\n- Conflicts: 0\n\n### Candidate Commands\n\n- none\n\n### Unknowns\n\n- none\n"
  );

  const result = runHarness(["adoption", "gate", "--report", report, "--output", output, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.outputPath, output);
  assert.equal(payload.decision, "ready");
  const gate = fs.readFileSync(output, "utf8");
  assert.match(gate, /# Adoption Gate Report/);
  assert.match(gate, /Decision: ready/);

  const second = runHarness(["adoption", "gate", "--report", report, "--output", output, "--json"]);
  assert.notEqual(second.status, 0);
  assert.match(JSON.parse(second.stdout).errors.join("\n"), /Gate report already exists|already exists/);
});

test("adoption status summarizes reports index gate compare and next action", () => {
  const reportsDir = tempDir("adoption-status-reports");
  const older = path.join(reportsDir, "older.md");
  const newer = path.join(reportsDir, "newer.md");
  const indexPath = path.join(reportsDir, "adoptions-index.md");
  fs.writeFileSync(
    older,
    "# Coding Harness Adoption Report\n\nTarget: C:\\tmp\\ProjectA\nGenerated: 2026-06-09T01:00:00.000Z\n\n## Audit Summary\n\n- Missing Harness files: 4\n- Existing docs: 1\n- Conflicts: 0\n\n### Candidate Commands\n\n- none\n\n### Unknowns\n\n- none\n"
  );
  fs.writeFileSync(
    newer,
    "# Coding Harness Adoption Report\n\nTarget: C:\\tmp\\ProjectA\nGenerated: 2026-06-09T02:00:00.000Z\n\n## Audit Summary\n\n- Missing Harness files: 2\n- Existing docs: 3\n- Conflicts: 0\n\n### Candidate Commands\n\n- python: test -> python -m pytest\n\n### Unknowns\n\n- exact lint command unknown\n"
  );
  fs.writeFileSync(
    indexPath,
    "# Adoption Reports Index\n\n| Generated | Target | Report |\n| --- | --- | --- |\n| now | target | [older.md](older.md) |\n| now | target | [newer.md](newer.md) |\n"
  );

  const result = runHarness(["adoption", "status", "--reports-dir", reportsDir, "--index", indexPath, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.reports.count, 2);
  assert.equal(path.basename(payload.latestReport.file), "newer.md");
  assert.equal(payload.index.valid, true);
  assert.equal(payload.gate.decision, "wait");
  assert.equal(payload.compare.metrics.missingHarnessFiles.delta, -2);
  assert.deepEqual(payload.blockers.map((blocker) => blocker.id), ["missing-harness-files", "candidate-commands-unconfirmed", "unknowns-present"]);
  assert.match(payload.nextSafeAction, /Review adoption gate findings/);
  assert.equal(fs.existsSync(path.join(reportsDir, "status.md")), false);
});

test("adoption status writes markdown output and refuses to overwrite it", () => {
  const reportsDir = tempDir("adoption-status-output");
  const output = path.join(reportsDir, "status.md");
  fs.writeFileSync(
    path.join(reportsDir, "report.md"),
    "# Coding Harness Adoption Report\n\nTarget: C:\\tmp\\ProjectA\nGenerated: 2026-06-09T01:00:00.000Z\n\n## Audit Summary\n\n- Missing Harness files: 0\n- Conflicts: 0\n\n### Candidate Commands\n\n- none\n\n### Unknowns\n\n- none\n"
  );

  const result = runHarness(["adoption", "status", "--reports-dir", reportsDir, "--output", output, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.outputPath, output);
  assert.equal(payload.gate.decision, "ready");
  const status = fs.readFileSync(output, "utf8");
  assert.match(status, /# Adoption Status/);
  assert.match(status, /Gate decision: ready/);

  const second = runHarness(["adoption", "status", "--reports-dir", reportsDir, "--output", output, "--json"]);
  assert.notEqual(second.status, 0);
  assert.match(JSON.parse(second.stdout).errors.join("\n"), /Status report already exists|already exists/);
});

test("adoption bundle writes a review bundle with manifest and refuses overwrite", () => {
  const reportsDir = tempDir("adoption-bundle-reports");
  const outputDir = path.join(tempDir("adoption-bundle-output"), "bundle");
  const indexPath = path.join(reportsDir, "adoptions-index.md");
  fs.writeFileSync(
    path.join(reportsDir, "older.md"),
    "# Coding Harness Adoption Report\n\nTarget: C:\\tmp\\ProjectA\nGenerated: 2026-06-09T01:00:00.000Z\n\n## Audit Summary\n\n- Missing Harness files: 4\n- Existing docs: 1\n- Conflicts: 0\n\n### Candidate Commands\n\n- none\n\n### Unknowns\n\n- none\n"
  );
  fs.writeFileSync(
    path.join(reportsDir, "newer.md"),
    "# Coding Harness Adoption Report\n\nTarget: C:\\tmp\\ProjectA\nGenerated: 2026-06-09T02:00:00.000Z\n\n## Audit Summary\n\n- Missing Harness files: 2\n- Existing docs: 3\n- Conflicts: 0\n\n### Candidate Commands\n\n- python: test -> python -m pytest\n\n### Unknowns\n\n- exact lint command unknown\n"
  );
  fs.writeFileSync(
    indexPath,
    "# Adoption Reports Index\n\n| Generated | Target | Report |\n| --- | --- | --- |\n| now | target | [older.md](older.md) |\n| now | target | [newer.md](newer.md) |\n"
  );

  const result = runHarness(["adoption", "bundle", "--reports-dir", reportsDir, "--index", indexPath, "--output-dir", outputDir, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.outputDir, outputDir);
  assert.deepEqual(
    payload.files.map((file) => file.relativePath).sort(),
    ["README.md", "diff.md", "gate.md", "index.md", "manifest.json", "status.md"]
  );
  for (const relativePath of ["README.md", "status.md", "index.md", "diff.md", "gate.md", "manifest.json"]) {
    assert.equal(fs.existsSync(path.join(outputDir, relativePath)), true);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, "manifest.json"), "utf8"));
  assert.equal(manifest.target, "C:\\tmp\\ProjectA");
  assert.equal(manifest.latestReport.endsWith("newer.md"), true);
  assert.equal(manifest.gateDecision, "wait");
  assert.equal(manifest.boundaries.targetProjectFilesCopied, false);
  assert.equal(manifest.boundaries.targetProjectCommandsExecuted, false);
  assert.match(fs.readFileSync(path.join(outputDir, "README.md"), "utf8"), /Next safe action/);

  const second = runHarness(["adoption", "bundle", "--reports-dir", reportsDir, "--index", indexPath, "--output-dir", outputDir, "--json"]);
  assert.notEqual(second.status, 0);
  assert.match(JSON.parse(second.stdout).errors.join("\n"), /Bundle output directory already exists|already exists/);
});

test("adoption next-actions writes a gate checklist from a bundle and refuses overwrite", () => {
  const root = tempDir("adoption-next-actions");
  const reportsDir = path.join(root, "adoptions");
  const bundleDir = path.join(root, "bundle");
  const reportPath = path.join(reportsDir, "newer.md");
  const output = path.join(root, "next-actions.md");
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(
    reportPath,
    "# Coding Harness Adoption Report\n\nTarget: C:\\tmp\\ProjectA\nGenerated: 2026-06-09T02:00:00.000Z\n\n## Audit Summary\n\n- Missing Harness files: 2\n- Existing docs: 3\n- Conflicts: 0\n\n### Candidate Commands\n\n- python: test -> python -m pytest\n\n### Unknowns\n\n- exact lint command unknown\n"
  );
  fs.writeFileSync(
    path.join(bundleDir, "gate.md"),
    "# Adoption Gate Report\n\nReport: newer.md\nTarget: C:\\tmp\\ProjectA\nGenerated: 2026-06-09T02:00:00.000Z\nDecision: wait\n\n## Findings\n\n- missing-harness-files: 2 Harness files are still missing.\n- candidate-commands-unconfirmed: 1 candidate command(s) require human confirmation.\n- unknowns-present: 1 unknown(s) remain unresolved.\n\n## Metrics\n\n- Existing Harness files: 0\n- Missing Harness files: 2\n- Conflicts: 0\n"
  );
  fs.writeFileSync(
    path.join(bundleDir, "status.md"),
    "# Adoption Status\n\nReports: 1\nLatest report: newer.md\nGate decision: wait\nNext safe action: Review adoption gate findings before initializing or changing the target project.\n"
  );
  fs.writeFileSync(
    path.join(bundleDir, "manifest.json"),
    `${JSON.stringify({
      kind: "adoption-bundle",
      target: "C:\\tmp\\ProjectA",
      reportsDir,
      latestReport: reportPath,
      gateDecision: "wait",
      nextSafeAction: "Review adoption gate findings before initializing or changing the target project.",
      boundaries: {
        targetProjectFilesCopied: false,
        targetProjectCommandsExecuted: false,
        dynamicWorkflowExecuted: false,
        liveSubagentsInvoked: false
      }
    }, null, 2)}\n`
  );

  const result = runHarness(["adoption", "next-actions", "--bundle-dir", bundleDir, "--output", output, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kind, "adoption-next-actions");
  assert.equal(payload.target, "C:\\tmp\\ProjectA");
  assert.equal(payload.outputPath, output);
  assert.equal(payload.gateDecision, "wait");
  assert.deepEqual(payload.approvalGates.map((gate) => gate.id), ["command-confirmation", "bootstrap-write", "wiki-scope"]);
  assert.equal(payload.boundaries.targetProjectFilesCopied, false);
  assert.equal(payload.boundaries.targetProjectCommandsExecuted, false);
  const content = fs.readFileSync(output, "utf8");
  assert.match(content, /Required Harness Files Pending Approval/);
  assert.match(content, /Candidate Command To Confirm/);
  assert.match(content, /python -m pytest/);
  assert.match(content, /Human Approval Gates/);

  const second = runHarness(["adoption", "next-actions", "--bundle-dir", bundleDir, "--output", output, "--json"]);
  assert.notEqual(second.status, 0);
  assert.match(JSON.parse(second.stdout).errors.join("\n"), /Next-actions output already exists|already exists/);
});

test("adoption decision-record writes pending approval gates from a bundle and refuses overwrite", () => {
  const root = tempDir("adoption-decision-record");
  const bundleDir = path.join(root, "bundle");
  const output = path.join(root, "decision-record.md");
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(
    path.join(bundleDir, "gate.md"),
    "# Adoption Gate Report\n\nReport: newer.md\nTarget: C:\\tmp\\ProjectA\nGenerated: 2026-06-09T02:00:00.000Z\nDecision: wait\n\n## Findings\n\n- missing-harness-files: 2 Harness files are still missing.\n- candidate-commands-unconfirmed: 1 candidate command(s) require human confirmation.\n\n## Metrics\n\n- Missing Harness files: 2\n- Conflicts: 0\n"
  );
  fs.writeFileSync(
    path.join(bundleDir, "manifest.json"),
    `${JSON.stringify({
      kind: "adoption-bundle",
      target: "C:\\tmp\\ProjectA",
      latestReport: "newer.md",
      gateDecision: "wait",
      nextSafeAction: "Review adoption gate findings before initializing or changing the target project.",
      boundaries: {
        targetProjectFilesCopied: false,
        targetProjectCommandsExecuted: false,
        dynamicWorkflowExecuted: false,
        liveSubagentsInvoked: false
      }
    }, null, 2)}\n`
  );

  const result = runHarness(["adoption", "decision-record", "--bundle-dir", bundleDir, "--output", output, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kind, "adoption-decision-record");
  assert.equal(payload.target, "C:\\tmp\\ProjectA");
  assert.equal(payload.outputPath, output);
  assert.equal(payload.gateDecision, "wait");
  assert.equal(payload.approvalStatus, "pending");
  assert.deepEqual(payload.decisions.map((decision) => decision.id), ["command-confirmation", "bootstrap-write", "wiki-scope"]);
  assert.deepEqual([...new Set(payload.decisions.map((decision) => decision.status))], ["pending"]);
  assert.equal(payload.boundaries.targetProjectFilesCopied, false);
  assert.equal(payload.boundaries.targetProjectCommandsExecuted, false);
  const content = fs.readFileSync(output, "utf8");
  assert.match(content, /# Adoption Decision Record/);
  assert.match(content, /Gate A: Command Confirmation/);
  assert.match(content, /Gate B: Bootstrap Write/);
  assert.match(content, /Gate C: Wiki Scope/);
  assert.match(content, /Status: pending/);

  const second = runHarness(["adoption", "decision-record", "--bundle-dir", bundleDir, "--output", output, "--json"]);
  assert.notEqual(second.status, 0);
  assert.match(JSON.parse(second.stdout).errors.join("\n"), /Decision record already exists|already exists/);
});

test("adoption decision-record records explicit decision statuses and notes", () => {
  const root = tempDir("adoption-decision-record-decisions");
  const bundleDir = path.join(root, "bundle");
  const output = path.join(root, "decision-record.md");
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(
    path.join(bundleDir, "manifest.json"),
    `${JSON.stringify({
      kind: "adoption-bundle",
      target: "C:\\tmp\\ProjectA",
      latestReport: "newer.md",
      gateDecision: "wait",
      nextSafeAction: "Review adoption gate findings before initializing or changing the target project.",
      boundaries: {
        targetProjectFilesCopied: false,
        targetProjectCommandsExecuted: false,
        dynamicWorkflowExecuted: false,
        liveSubagentsInvoked: false
      }
    }, null, 2)}\n`
  );

  const result = runHarness([
    "adoption",
    "decision-record",
    "--bundle-dir",
    bundleDir,
    "--output",
    output,
    "--decision",
    "command-confirmation=approved:Use python -m pytest",
    "--decision",
    "bootstrap-write=deferred:Wait for owner review",
    "--decision",
    "wiki-scope=rejected"
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Approval status: recorded/);
  const content = fs.readFileSync(output, "utf8");
  assert.match(content, /Status: approved/);
  assert.match(content, /Note: Use python -m pytest/);
  assert.match(content, /Status: deferred/);
  assert.match(content, /Note: Wait for owner review/);
  assert.match(content, /Status: rejected/);
});

test("adoption decision-record rejects unknown decision gates and statuses", () => {
  const root = tempDir("adoption-decision-record-invalid");
  const bundleDir = path.join(root, "bundle");
  const output = path.join(root, "decision-record.md");
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(
    path.join(bundleDir, "manifest.json"),
    `${JSON.stringify({ kind: "adoption-bundle", target: "C:\\tmp\\ProjectA" }, null, 2)}\n`
  );

  const badGate = runHarness(["adoption", "decision-record", "--bundle-dir", bundleDir, "--output", output, "--decision", "unknown-gate=approved", "--json"]);
  assert.notEqual(badGate.status, 0);
  assert.match(JSON.parse(badGate.stdout).errors.join("\n"), /Unknown decision gate/);
  assert.equal(fs.existsSync(output), false);

  const badStatus = runHarness(["adoption", "decision-record", "--bundle-dir", bundleDir, "--output", output, "--decision", "command-confirmation=maybe", "--json"]);
  assert.notEqual(badStatus.status, 0);
  assert.match(JSON.parse(badStatus.stdout).errors.join("\n"), /Unknown decision status/);
  assert.equal(fs.existsSync(output), false);
});

test("adoption apply-plan writes a dry-run bootstrap plan and refuses overwrite", () => {
  const root = tempDir("adoption-apply-plan");
  const target = path.join(root, "target");
  const bundleDir = path.join(root, "bundle");
  const output = path.join(root, "apply-plan.md");
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(target, "AGENTS.md"), "# Existing agent rules\n");
  fs.writeFileSync(
    path.join(bundleDir, "manifest.json"),
    `${JSON.stringify({
      kind: "adoption-bundle",
      target,
      gateDecision: "wait",
      nextSafeAction: "Review adoption gate findings before initializing or changing the target project.",
      boundaries: {
        targetProjectFilesCopied: false,
        targetProjectCommandsExecuted: false,
        dynamicWorkflowExecuted: false,
        liveSubagentsInvoked: false
      }
    }, null, 2)}\n`
  );

  const result = runHarness(["adoption", "apply-plan", "--bundle-dir", bundleDir, "--output", output, "--dry-run", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kind, "adoption-apply-plan");
  assert.equal(payload.target, target);
  assert.equal(payload.outputPath, output);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.boundaries.targetProjectFilesWritten, false);
  assert.equal(payload.boundaries.targetProjectCommandsExecuted, false);
  assert.ok(payload.preview.created.includes("feature_list.json"));
  assert.ok(payload.preview.skipped.includes("AGENTS.md"));
  const content = fs.readFileSync(output, "utf8");
  assert.match(content, /# Adoption Apply Plan/);
  assert.match(content, /Dry run: true/);
  assert.match(content, /feature_list\.json/);
  assert.match(content, /AGENTS\.md/);

  const second = runHarness(["adoption", "apply-plan", "--bundle-dir", bundleDir, "--output", output, "--dry-run", "--json"]);
  assert.notEqual(second.status, 0);
  assert.match(JSON.parse(second.stdout).errors.join("\n"), /Apply plan already exists|already exists/);
});

test("adoption apply-plan requires dry-run in V1", () => {
  const root = tempDir("adoption-apply-plan-no-dry-run");
  const target = path.join(root, "target");
  const bundleDir = path.join(root, "bundle");
  const output = path.join(root, "apply-plan.md");
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(bundleDir, "manifest.json"), `${JSON.stringify({ kind: "adoption-bundle", target }, null, 2)}\n`);

  const result = runHarness(["adoption", "apply-plan", "--bundle-dir", bundleDir, "--output", output, "--json"]);

  assert.notEqual(result.status, 0);
  assert.match(JSON.parse(result.stdout).errors.join("\n"), /requires --dry-run/);
  assert.equal(fs.existsSync(output), false);
});

test("adoption selected-files writes a proposal with included files and refuses overwrite", () => {
  const root = tempDir("adoption-selected-files");
  const target = path.join(root, "target");
  const bundleDir = path.join(root, "bundle");
  const output = path.join(root, "selected-files.md");
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(
    path.join(bundleDir, "manifest.json"),
    `${JSON.stringify({
      kind: "adoption-bundle",
      target,
      gateDecision: "wait",
      boundaries: {
        targetProjectFilesCopied: false,
        targetProjectCommandsExecuted: false,
        dynamicWorkflowExecuted: false,
        liveSubagentsInvoked: false
      }
    }, null, 2)}\n`
  );

  const result = runHarness([
    "adoption",
    "selected-files",
    "--bundle-dir",
    bundleDir,
    "--output",
    output,
    "--include",
    "AGENTS.md",
    "--include",
    "docs/wiki/index.md",
    "--include",
    "docs/wiki/product/feature-map.md",
    "--json"
  ]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kind, "adoption-selected-files");
  assert.equal(payload.target, target);
  assert.equal(payload.outputPath, output);
  assert.deepEqual(payload.selectedFiles, ["AGENTS.md", "docs/wiki/index.md", "docs/wiki/product/feature-map.md"]);
  assert.equal(payload.requiredSelected.length, 2);
  assert.equal(payload.optionalSelected.length, 1);
  assert.equal(payload.boundaries.targetProjectFilesWritten, false);
  assert.equal(payload.boundaries.targetProjectCommandsExecuted, false);
  const content = fs.readFileSync(output, "utf8");
  assert.match(content, /# Adoption Selected Files Proposal/);
  assert.match(content, /Selected Files/);
  assert.match(content, /AGENTS\.md/);
  assert.ok(content.includes("docs/wiki/product/feature-map.md"));

  const second = runHarness(["adoption", "selected-files", "--bundle-dir", bundleDir, "--output", output, "--json"]);
  assert.notEqual(second.status, 0);
  assert.match(JSON.parse(second.stdout).errors.join("\n"), /Selected-files proposal already exists|already exists/);
});

test("adoption selected-files rejects unknown included files", () => {
  const root = tempDir("adoption-selected-files-invalid");
  const target = path.join(root, "target");
  const bundleDir = path.join(root, "bundle");
  const output = path.join(root, "selected-files.md");
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(bundleDir, "manifest.json"), `${JSON.stringify({ kind: "adoption-bundle", target }, null, 2)}\n`);

  const result = runHarness(["adoption", "selected-files", "--bundle-dir", bundleDir, "--output", output, "--include", "not-a-harness-file.md", "--json"]);

  assert.notEqual(result.status, 0);
  assert.match(JSON.parse(result.stdout).errors.join("\n"), /Unknown selected file/);
  assert.equal(fs.existsSync(output), false);
});

test("adoption selected-files rejects unsafe included paths", () => {
  const root = tempDir("adoption-selected-files-unsafe");
  const target = path.join(root, "target");
  const bundleDir = path.join(root, "bundle");
  const output = path.join(root, "selected-files.md");
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(bundleDir, "manifest.json"), `${JSON.stringify({ kind: "adoption-bundle", target }, null, 2)}\n`);

  const result = runHarness([
    "adoption",
    "selected-files",
    "--bundle-dir",
    bundleDir,
    "--output",
    output,
    "--include",
    "../AGENTS.md",
    "--include",
    path.join(target, "CLAUDE.md"),
    "--json"
  ]);

  assert.notEqual(result.status, 0);
  assert.match(JSON.parse(result.stdout).errors.join("\n"), /Unsafe selected file path/);
  assert.equal(fs.existsSync(output), false);
});

test("wiki, handoff, and doctor commands validate a scaffolded Harness", () => {
  const target = tempDir("validators");
  assert.equal(runHarness(["init", "--target", target]).status, 0);

  for (const command of ["wiki", "handoff", "doctor"]) {
    const result = runHarness([command, "--target", target]);
    assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Errors: 0/);
  }
});

test("wiki command creates missing wiki files without overwriting existing pages", () => {
  const target = tempDir("wiki");
  const wikiRoot = path.join(target, "docs", "wiki");
  fs.mkdirSync(wikiRoot, { recursive: true });
  fs.writeFileSync(path.join(wikiRoot, "index.md"), "# Custom Wiki\n");

  const result = runHarness(["wiki", "--target", target]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Created:/);
  assert.match(result.stdout, /Skipped:/);
  assert.equal(fs.readFileSync(path.join(wikiRoot, "index.md"), "utf8"), "# Custom Wiki\n");
  assert.equal(fs.existsSync(path.join(wikiRoot, "engineering", "verification.md")), true);
});

test("wiki command dry-run reports missing wiki files without writing them", () => {
  const target = tempDir("wiki-dry-run");

  const result = runHarness(["wiki", "--target", target, "--dry-run"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Created:/);
  assert.equal(fs.existsSync(path.join(target, "docs", "wiki", "index.md")), false);
});

test("unknown command returns a clear error", () => {
  const result = runHarness(["work", "--target", tempDir("unknown")]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown command: work/);
  assert.match(result.stderr, /init, audit, wiki, doctor, handoff, plan, gate/);
});

test("help scopes dry-run to commands that support it", () => {
  const globalHelp = runHarness(["--help"]);
  const adoptionHelp = runHarness(["adoption", "--help"]);
  const initHelp = runHarness(["init", "--help"]);
  const wikiHelp = runHarness(["wiki", "--help"]);
  const doctorHelp = runHarness(["doctor", "--help"]);

  assert.equal(globalHelp.status, 0);
  assert.equal(adoptionHelp.status, 0);
  assert.equal(initHelp.status, 0);
  assert.equal(wikiHelp.status, 0);
  assert.equal(doctorHelp.status, 0);
  assert.doesNotMatch(globalHelp.stdout, /--dry-run/);
  assert.match(adoptionHelp.stdout, /adoption apply-plan/);
  assert.match(adoptionHelp.stdout, /--dry-run/);
  assert.match(initHelp.stdout, /--dry-run/);
  assert.match(wikiHelp.stdout, /--dry-run/);
  assert.doesNotMatch(doctorHelp.stdout, /--dry-run/);
});

test("package exposes amber as primary bin with a legacy coding-harness alias", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

  assert.equal(packageJson.name, "amber-protocol");
  assert.equal(packageJson.bin.amber, "scripts/amber.js");
  assert.equal(packageJson.bin["coding-harness"], "scripts/compat/coding-harness.js");
});

test("migrate state copies legacy .harness into .amber via the CLI", () => {
  const target = tempDir("migrate-state");
  const legacySession = path.join(target, ".harness", "sessions", "legacy-1");
  fs.mkdirSync(legacySession, { recursive: true });
  fs.writeFileSync(path.join(legacySession, "manifest.json"), JSON.stringify({ sessionId: "legacy-1" }));

  const result = runHarness(["migrate", "state", "--target", target, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.errors.length, 0);
  assert.ok(payload.copied.length >= 1);
  assert.equal(fs.existsSync(path.join(target, ".amber", "sessions", "legacy-1", "manifest.json")), true);
  assert.equal(fs.existsSync(path.join(target, ".harness", "sessions", "legacy-1", "manifest.json")), true);
});

test("legacy entrypoints forward to the amber CLI", () => {
  for (const entry of ["scripts/harness.js", "scripts/compat/coding-harness.js"]) {
    const result = spawnSync(process.execPath, [path.join(ROOT, entry), "--help"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${entry} --help should exit 0`);
    assert.match(result.stdout, /amber|harness/i);
  }
  const compat = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts", "compat", "coding-harness.js"), "--help"],
    { encoding: "utf8" },
  );
  assert.match(compat.stderr, /deprecated/i, "compat shim warns on stderr");
});
