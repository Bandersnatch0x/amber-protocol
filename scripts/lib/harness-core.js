"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TEMPLATE_ROOT = path.join(REPO_ROOT, "templates");
const DEFAULT_TEAM_REGISTRY = path.join(REPO_ROOT, "registry", "coding-harness.registry.json");

const MINIMUM_HARNESS_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "feature_list.json",
  "PROGRESS.md",
  "session-handoff.md",
  "clean-state-checklist.md",
  "evaluator-rubric.md",
  "docs/wiki/index.md",
  "docs/wiki/product/overview.md",
  "docs/wiki/architecture/system-map.md",
  "docs/wiki/engineering/runbook.md",
  "docs/wiki/engineering/verification.md",
  "docs/wiki/agent/harness.md",
  "docs/wiki/agent/continuous-improvement.md",
  "docs/wiki/agent/workflow-packets.md",
  ".workflow/continuous-improvement/state.json",
  "docs/wiki/glossary.md"
];
const OPTIONAL_STARTER_WIKI_FILES = [
  "docs/wiki/product/feature-map.md",
  "docs/wiki/product/user-scenarios.md",
  "docs/wiki/architecture/module-boundaries.md",
  "docs/wiki/architecture/data-flow.md",
  "docs/wiki/architecture/decisions/0001-record-architecture-decisions.md",
  "docs/wiki/engineering/local-development.md",
  "docs/wiki/engineering/release.md",
  "docs/wiki/engineering/troubleshooting.md",
  "docs/wiki/agent/working-rules.md",
  "docs/wiki/agent/prompt-recipes.md",
  "docs/wiki/agent/failure-patterns.md",
  "docs/wiki/features/F001-example-feature.md"
];
const REQUIRED_HARNESS_FILES = MINIMUM_HARNESS_FILES;

const VALID_STATUSES = new Set(["not_started", "in_progress", "blocked", "passing"]);
const REQUIRED_HANDOFF_SECTIONS = [
  "Summary",
  "Repo State",
  "Runtime / Verification State",
  "Feature State",
  "Verification Evidence",
  "Blockers",
  "Next Actions"
];
const WIKI_CONTEXT_STARTER_FILES = new Set([
  "docs/wiki/product/overview.md",
  "docs/wiki/product/feature-map.md",
  "docs/wiki/product/user-scenarios.md",
  "docs/wiki/architecture/system-map.md",
  "docs/wiki/architecture/module-boundaries.md",
  "docs/wiki/architecture/data-flow.md",
  "docs/wiki/architecture/decisions/0001-record-architecture-decisions.md",
  "docs/wiki/engineering/runbook.md",
  "docs/wiki/engineering/verification.md",
  "docs/wiki/engineering/local-development.md",
  "docs/wiki/engineering/release.md",
  "docs/wiki/engineering/troubleshooting.md",
  "docs/wiki/features/F001-example-feature.md"
]);
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/;

function resolveTarget(target) {
  return path.resolve(target || process.cwd());
}

function pathExists(filePath) {
  return fs.existsSync(filePath);
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function walkFiles(root) {
  if (!pathExists(root)) {
    return [];
  }

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

const AUDIT_IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".mypy_cache",
  ".next",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "env",
  "env_new",
  "node_modules",
  "site-packages",
  "venv"
]);

function isIgnoredAuditPath(relativePath) {
  const normalized = relativePath.split(path.sep).join("/").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => AUDIT_IGNORED_DIRECTORY_NAMES.has(segment))) {
    return true;
  }
  return normalized === "data/reports" || normalized.startsWith("data/reports/") || segments[0] === "results";
}

function walkProjectFiles(root, current = root) {
  if (!pathExists(current)) {
    return [];
  }

  const entries = fs.readdirSync(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    const relativePath = relativeSlash(root, fullPath);
    if (entry.isDirectory()) {
      if (isIgnoredAuditPath(relativePath)) {
        continue;
      }
      files.push(...walkProjectFiles(root, fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function relativeSlash(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

function repoRelativePath(filePath) {
  const resolved = path.resolve(filePath);
  if (resolved.startsWith(REPO_ROOT)) {
    return relativeSlash(REPO_ROOT, resolved);
  }
  return resolved;
}

function listTemplateFiles(templateRoot = TEMPLATE_ROOT) {
  return walkFiles(templateRoot).map((filePath) => ({
    source: filePath,
    relativePath: relativeSlash(templateRoot, filePath)
  }));
}

function copyTemplateFiles(targetRoot, items, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const created = [];
  const skipped = [];

  for (const item of items) {
    const destination = path.join(targetRoot, item.relativePath);
    if (pathExists(destination)) {
      skipped.push(item.relativePath);
      continue;
    }

    created.push(item.relativePath);
    if (!dryRun) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(item.source, destination);
    }
  }

  return { created, skipped };
}

function scaffoldHarness(target, options = {}) {
  const targetRoot = resolveTarget(target);
  const templateRoot = options.templateRoot || TEMPLATE_ROOT;
  const result = copyTemplateFiles(targetRoot, listTemplateFiles(templateRoot), options);

  return {
    target: targetRoot,
    created: result.created,
    skipped: result.skipped
  };
}

function scaffoldWiki(target, options = {}) {
  const targetRoot = resolveTarget(target);
  const wikiTemplateRoot = path.join(TEMPLATE_ROOT, "docs", "wiki");
  const items = listTemplateFiles(wikiTemplateRoot).map((item) => ({
    source: item.source,
    relativePath: path.join("docs", "wiki", item.relativePath)
  }));
  const result = copyTemplateFiles(targetRoot, items, options);
  const validation = options.dryRun ? { errors: [], warnings: [] } : validateWiki(targetRoot);

  return {
    target: targetRoot,
    created: result.created,
    skipped: result.skipped,
    errors: validation.errors,
    warnings: validation.warnings
  };
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "plan";
}

function loadFeatureList(targetRoot) {
  return readJson(path.join(targetRoot, "feature_list.json"));
}

function findFeatureById(targetRoot, featureId) {
  const data = loadFeatureList(targetRoot);
  if (!Array.isArray(data.features)) {
    return null;
  }
  return data.features.find((feature) => feature && feature.id === featureId) || null;
}

function buildPlanContent(feature, title) {
  return [
    `# Plan: ${title}`,
    "",
    `Feature: ${feature.id}`,
    "Status: implementation-ready",
    "User Confirmation: pending",
    "",
    "## Goal",
    "",
    feature.user_visible_behavior || "Describe the user-visible outcome.",
    "",
    "## High Level Design",
    "",
    "- Context:",
    "- Proposed approach:",
    "- Risks:",
    "",
    "## Vertical Slices",
    "",
    "- [ ] Slice 1: make the smallest safe change that advances the feature.",
    "",
    "## Acceptance Criteria",
    "",
    "- The user-visible behavior is demonstrably satisfied.",
    "- Existing Harness guardrails still pass.",
    "",
    "## Verification",
    "",
    ...feature.verification.map((step) => `- ${step}`),
    "",
    "## Evidence Schema",
    "",
    "- Command:",
    "- Result:",
    "- Date:",
    "- Notes:",
    ""
  ].join("\n");
}

function scaffoldPlan(target, options = {}) {
  const targetRoot = resolveTarget(target);
  const errors = [];
  const warnings = [];
  const created = [];
  const skipped = [];
  const featureId = options.feature;

  if (!featureId) {
    errors.push("Plan requires --feature <feature-id>.");
    return { target: targetRoot, created, skipped, errors, warnings };
  }

  let feature;
  try {
    feature = findFeatureById(targetRoot, featureId);
  } catch (error) {
    errors.push(`Cannot read feature_list.json: ${error.message}`);
    return { target: targetRoot, created, skipped, errors, warnings };
  }

  if (!feature) {
    errors.push(`Feature ${featureId} was not found in feature_list.json.`);
    return { target: targetRoot, created, skipped, errors, warnings };
  }

  const title = options.title || feature.title;
  const relativePath = path.join("docs", "plans", `${feature.id}-${slugify(title)}.md`);
  const destination = path.join(targetRoot, relativePath);

  if (pathExists(destination)) {
    skipped.push(relativePath);
  } else {
    created.push(relativePath);
    if (!options.dryRun) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, buildPlanContent(feature, title));
    }
  }

  return { target: targetRoot, plan: relativePath, created, skipped, errors, warnings };
}

function readPlanField(content, field) {
  const pattern = new RegExp(`^${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(.+)$`, "im");
  const match = content.match(pattern);
  return match ? match[1].trim() : "";
}

function validatePlanGate(target, planRelativePath) {
  const targetRoot = resolveTarget(target);
  const errors = [];
  const warnings = [];

  if (!planRelativePath) {
    return { target: targetRoot, plan: null, errors: ["Gate requires --plan <relative-plan-path>."], warnings };
  }

  const planPath = path.resolve(targetRoot, planRelativePath);
  if (!planPath.startsWith(targetRoot)) {
    return { target: targetRoot, plan: planRelativePath, errors: ["Plan path must stay inside the target repository."], warnings };
  }
  if (!pathExists(planPath)) {
    return { target: targetRoot, plan: planRelativePath, errors: [`Plan file is missing: ${planRelativePath}`], warnings };
  }

  const content = readText(planPath);
  const featureId = readPlanField(content, "Feature");
  const userConfirmation = readPlanField(content, "User Confirmation");

  if (!featureId) {
    errors.push("Plan must include a Feature field.");
  } else {
    try {
      if (!findFeatureById(targetRoot, featureId)) {
        errors.push(`Plan feature ${featureId} was not found in feature_list.json.`);
      }
    } catch (error) {
      errors.push(`Cannot read feature_list.json: ${error.message}`);
    }
  }

  for (const section of ["High Level Design", "Vertical Slices", "Acceptance Criteria", "Verification", "Evidence Schema"]) {
    if (!hasSectionWithBody(content, section)) {
      errors.push(`Plan must include a non-empty ${section} section.`);
    }
  }

  if (!/^confirmed$/i.test(userConfirmation)) {
    errors.push("User confirmation is required before implementation-ready status.");
  }

  return { target: targetRoot, plan: planRelativePath, feature: featureId || null, errors, warnings };
}

function discoverStandards() {
  const standardsRoot = path.join(REPO_ROOT, "standards");
  return walkFiles(standardsRoot)
    .filter((filePath) => filePath.endsWith(".json"))
    .map((filePath) => {
      try {
        const data = readJson(filePath);
        return {
          id: data.id,
          title: data.title,
          checks: Array.isArray(data.checks) ? data.checks : [],
          file: relativeSlash(REPO_ROOT, filePath)
        };
      } catch (error) {
        return {
          id: relativeSlash(REPO_ROOT, filePath),
          title: "Invalid standard",
          checks: [],
          file: relativeSlash(REPO_ROOT, filePath),
          error: error.message
        };
      }
    });
}

function reviewPlan(target, planRelativePath) {
  const targetRoot = resolveTarget(target);
  const standards = discoverStandards();
  const gateResult = validatePlanGate(targetRoot, planRelativePath);
  const findings = gateResult.errors.map((message) => ({
    severity: "error",
    checkId: /User confirmation/.test(message) ? "user-confirmation" : "plan-gate",
    message
  }));

  const applicableChecks = standards.flatMap((standard) =>
    standard.checks.map((check) => ({
      standard: standard.id,
      id: check.id,
      description: check.description
    }))
  );

  const requiredUserAction = findings.length > 0 ? ["Confirm the plan and resolve review findings before acceptance."] : [];

  return {
    target: targetRoot,
    plan: planRelativePath,
    loadedStandards: standards.map((standard) => standard.id),
    applicableChecks,
    nonApplicableChecks: [],
    findings,
    requiredUserAction,
    releaseReadiness: { status: findings.length > 0 ? "blocked" : "ready" },
    errors: findings.map((finding) => finding.message),
    warnings: gateResult.warnings
  };
}

function acceptPlan(target, planRelativePath) {
  const targetRoot = resolveTarget(target);
  const review = reviewPlan(targetRoot, planRelativePath);
  if (review.errors.length > 0) {
    return {
      target: targetRoot,
      plan: planRelativePath,
      accepted: false,
      errors: review.errors,
      warnings: review.warnings,
      review
    };
  }

  const evolutionRelativePath = path.join("docs", "wiki", "engineering", "harness-evolution.md");
  const evolutionPath = path.join(targetRoot, evolutionRelativePath);
  const date = new Date().toISOString().slice(0, 10);
  const entry = [
    "",
    `## ${date} ${planRelativePath}`,
    "",
    `- Plan: \`${planRelativePath}\``,
    "- Review status: ready",
    "- Required user action: none",
    ""
  ].join("\n");

  fs.mkdirSync(path.dirname(evolutionPath), { recursive: true });
  if (!pathExists(evolutionPath)) {
    fs.writeFileSync(evolutionPath, `# Harness Evolution Log\n${entry}`);
  } else {
    fs.appendFileSync(evolutionPath, entry);
  }

  return {
    target: targetRoot,
    plan: planRelativePath,
    accepted: true,
    evolutionLog: evolutionRelativePath,
    errors: [],
    warnings: review.warnings,
    review
  };
}

function prepareTaskExecution(target, planRelativePath, taskIdInput) {
  const targetRoot = resolveTarget(target);
  const taskId = slugify(taskIdInput);
  const errors = [];
  const warnings = [];

  if (!taskIdInput) {
    errors.push("task prepare requires --task <task-id>.");
    return { target: targetRoot, task: null, errors, warnings };
  }

  const review = reviewPlan(targetRoot, planRelativePath);
  if (review.errors.length > 0) {
    return { target: targetRoot, task: taskId, plan: planRelativePath, errors: review.errors, warnings: review.warnings, review };
  }

  const worktreeRelativePath = path.join(".harness", "worktrees", taskId);
  const executionRelativePath = path.join(".harness", "executions", taskId);
  const worktreePath = path.join(targetRoot, worktreeRelativePath);
  const executionPath = path.join(targetRoot, executionRelativePath);
  fs.mkdirSync(worktreePath, { recursive: true });
  fs.mkdirSync(executionPath, { recursive: true });

  const ledger = {
    taskId,
    plan: planRelativePath,
    status: "prepared",
    worktree: {
      type: "directory-worktree",
      path: worktreeRelativePath
    },
    commands: [],
    failureAttribution: null,
    createdAt: new Date().toISOString()
  };
  const evidence = {
    taskId,
    plan: planRelativePath,
    evidence: [],
    requiredForReplay: ["ledger.json", "evidence.json", "replay.md"],
    chatHistoryRequired: false
  };
  const replay = [
    "# Replay",
    "",
    `Task: ${taskId}`,
    `Plan: ${planRelativePath}`,
    `Worktree: ${worktreeRelativePath}`,
    "",
    "This prepared result contains no executed commands yet. Replay starts from the ledger, evidence pack, and worktree path recorded here.",
    ""
  ].join("\n");

  fs.writeFileSync(path.join(executionPath, "ledger.json"), JSON.stringify(ledger, null, 2));
  fs.writeFileSync(path.join(executionPath, "evidence.json"), JSON.stringify(evidence, null, 2));
  fs.writeFileSync(path.join(executionPath, "replay.md"), replay);

  return {
    target: targetRoot,
    task: taskId,
    plan: planRelativePath,
    worktree: worktreeRelativePath,
    execution: executionRelativePath,
    errors,
    warnings
  };
}

function inspectTaskResult(target, taskIdInput) {
  const targetRoot = resolveTarget(target);
  const taskId = slugify(taskIdInput);
  const errors = [];
  const warnings = [];

  if (!taskIdInput) {
    errors.push("result inspect requires --task <task-id>.");
    return { target: targetRoot, task: null, replayable: false, chatHistoryRequired: true, errors, warnings };
  }

  const executionPath = path.join(targetRoot, ".harness", "executions", taskId);
  const ledgerPath = path.join(executionPath, "ledger.json");
  const evidencePath = path.join(executionPath, "evidence.json");
  const replayPath = path.join(executionPath, "replay.md");
  let ledger = null;
  let evidence = null;

  try {
    ledger = readJson(ledgerPath);
  } catch (error) {
    errors.push(`Cannot read execution ledger: ${error.message}`);
  }
  try {
    evidence = readJson(evidencePath);
  } catch (error) {
    errors.push(`Cannot read evidence pack: ${error.message}`);
  }
  if (!pathExists(replayPath)) {
    errors.push("Replay file is missing.");
  }

  const replayable = errors.length === 0 && ledger && evidence && evidence.chatHistoryRequired === false;

  return {
    target: targetRoot,
    task: taskId,
    replayable,
    chatHistoryRequired: !replayable,
    ledger,
    evidence,
    replay: pathExists(replayPath) ? relativeSlash(targetRoot, replayPath) : null,
    errors,
    warnings
  };
}

function orchestrationPaths(targetRoot, taskId) {
  const root = path.join(targetRoot, ".harness", "orchestration", taskId);
  return {
    root,
    dispatchPath: path.join(root, "dispatch.json"),
    reviewerEvidencePath: path.join(root, "reviewer-evidence.json")
  };
}

function dispatchAgentTask(target, options = {}) {
  const targetRoot = resolveTarget(target);
  const taskId = slugify(options.task);
  const errors = [];
  const warnings = [];
  const worker = options.worker;
  const reviewer = options.reviewer;
  const concurrency = Number.parseInt(options.concurrency || "1", 10);

  if (!options.task) {
    errors.push("agent dispatch requires --task <task-id>.");
  }
  if (!worker) {
    errors.push("agent dispatch requires --worker <worker-id>.");
  }
  if (!reviewer) {
    errors.push("agent dispatch requires --reviewer <reviewer-id>.");
  }
  if (worker && reviewer && worker === reviewer) {
    errors.push("Workers cannot self-approve; worker and reviewer must be different.");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    errors.push("agent dispatch concurrency must be an integer between 1 and 4.");
  }
  if (!pathExists(path.join(targetRoot, ".harness", "executions", taskId, "ledger.json"))) {
    errors.push(`Prepared task ledger is missing for ${taskId}.`);
  }
  if (errors.length > 0) {
    return { target: targetRoot, task: taskId || null, errors, warnings };
  }

  const paths = orchestrationPaths(targetRoot, taskId);
  fs.mkdirSync(paths.root, { recursive: true });
  const dispatch = {
    taskId,
    status: "dispatched",
    worker: { id: worker },
    reviewer: { id: reviewer },
    backend: { name: options.backend || "local" },
    concurrencyLimit: concurrency,
    workerOutput: null,
    reviewerEvidence: null,
    controls: { stop: true, resume: true },
    workersCannotSelfApprove: true,
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(paths.dispatchPath, JSON.stringify(dispatch, null, 2));

  return { target: targetRoot, task: taskId, dispatch, errors, warnings };
}

function setAgentDispatchStatus(target, taskIdInput, status) {
  const targetRoot = resolveTarget(target);
  const taskId = slugify(taskIdInput);
  const errors = [];
  const warnings = [];

  try {
    const paths = orchestrationPaths(targetRoot, taskId);
    const dispatch = readJson(paths.dispatchPath);
    dispatch.status = status;
    dispatch.updatedAt = new Date().toISOString();
    fs.writeFileSync(paths.dispatchPath, JSON.stringify(dispatch, null, 2));
    return { target: targetRoot, task: taskId, dispatch, errors, warnings };
  } catch (error) {
    errors.push(`Cannot update agent dispatch: ${error.message}`);
    return { target: targetRoot, task: taskId || null, errors, warnings };
  }
}

function recordAgentReview(target, options = {}) {
  const targetRoot = resolveTarget(target);
  const taskId = slugify(options.task);
  const errors = [];
  const warnings = [];

  try {
    const paths = orchestrationPaths(targetRoot, taskId);
    const dispatch = readJson(paths.dispatchPath);
    if (dispatch.reviewer.id !== options.reviewer) {
      errors.push("Reviewer evidence must be recorded by the assigned reviewer.");
      return { target: targetRoot, task: taskId, errors, warnings };
    }
    const reviewerEvidence = {
      taskId,
      reviewer: options.reviewer,
      decision: options.decision || "needs_changes",
      evidence: options.evidence || "",
      workerOutputPath: dispatch.workerOutput,
      recordedAt: new Date().toISOString()
    };
    fs.writeFileSync(paths.reviewerEvidencePath, JSON.stringify(reviewerEvidence, null, 2));
    dispatch.reviewerEvidence = relativeSlash(targetRoot, paths.reviewerEvidencePath);
    dispatch.status = "reviewed";
    fs.writeFileSync(paths.dispatchPath, JSON.stringify(dispatch, null, 2));
    return { target: targetRoot, task: taskId, reviewerEvidence, dispatch, errors, warnings };
  } catch (error) {
    errors.push(`Cannot record agent review: ${error.message}`);
    return { target: targetRoot, task: taskId || null, errors, warnings };
  }
}

function resolveRegistryPath(registryPath) {
  if (!registryPath) {
    return DEFAULT_TEAM_REGISTRY;
  }
  return path.isAbsolute(registryPath) ? registryPath : path.join(REPO_ROOT, registryPath);
}

function validateTeamRegistryData(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { errors: ["Team registry must contain an object."], warnings };
  }
  if (data.name !== "coding-harness-team-registry") {
    errors.push("Team registry name must be coding-harness-team-registry.");
  }
  if (!Array.isArray(data.presets) || data.presets.length === 0) {
    errors.push("Team registry must define at least one preset.");
  }
  if (!Array.isArray(data.rulePacks) || data.rulePacks.length === 0) {
    errors.push("Team registry must define at least one rule pack.");
  }
  if (!Array.isArray(data.profiles) || data.profiles.length === 0) {
    errors.push("Team registry must define at least one project profile.");
  }
  if (!data.versions || typeof data.versions !== "object" || Array.isArray(data.versions)) {
    errors.push("Team registry must define versions.");
  } else {
    for (const [version, release] of Object.entries(data.versions)) {
      if (!SEMVER_PATTERN.test(version)) {
        errors.push(`Registry version ${version} is not valid semver.`);
      }
      if (!release || typeof release !== "object" || Array.isArray(release)) {
        errors.push(`Registry version ${version} must be an object.`);
        continue;
      }
      if (!release.preset) {
        errors.push(`Registry version ${version} must declare a preset.`);
      }
      if (!release.profile) {
        errors.push(`Registry version ${version} must declare a profile.`);
      }
      if (!Array.isArray(release.workflowPacks)) {
        errors.push(`Registry version ${version} must declare workflowPacks.`);
      }
      if (!Array.isArray(release.rulePacks)) {
        errors.push(`Registry version ${version} must declare rulePacks.`);
      }
      if (!Array.isArray(release.managedProjectFiles)) {
        errors.push(`Registry version ${version} must declare managedProjectFiles.`);
      }
      if (!release.compatibility || typeof release.compatibility !== "object") {
        errors.push(`Registry version ${version} must declare compatibility.`);
      }
    }
  }

  return { errors, warnings };
}

function loadTeamRegistry(registryPath) {
  const resolvedRegistryPath = resolveRegistryPath(registryPath);
  const registry = readJson(resolvedRegistryPath);
  const validation = validateTeamRegistryData(registry);
  return { registryPath: resolvedRegistryPath, registry, errors: validation.errors, warnings: validation.warnings };
}

function compareSemver(left, right) {
  const leftParts = String(left).split(/[+-]/)[0].split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = String(right).split(/[+-]/)[0].split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

function latestTeamVersion(registry) {
  return Object.keys(registry.versions || {}).sort(compareSemver).at(-1);
}

function findTeamVersion(registry, version) {
  const selectedVersion = version || latestTeamVersion(registry);
  return { version: selectedVersion, release: registry.versions && registry.versions[selectedVersion] };
}

function teamStatePaths(targetRoot) {
  const root = path.join(targetRoot, ".harness", "team");
  return {
    root,
    lockPath: path.join(root, "lock.json"),
    snapshotsRoot: path.join(root, "snapshots"),
    rollbackLedgerPath: path.join(root, "rollback-ledger.json")
  };
}

function summarizeTeamRegistry(registry) {
  return {
    name: registry.name,
    schemaVersion: registry.schemaVersion,
    presets: registry.presets,
    rulePacks: registry.rulePacks,
    profiles: registry.profiles,
    versions: registry.versions
  };
}

function buildCompatibilityMatrix(registry) {
  const releases = Object.values(registry.versions || {});
  const os = new Set();
  const profileVersions = new Set();

  for (const release of releases) {
    for (const name of (release.compatibility && release.compatibility.os) || []) {
      os.add(name);
    }
    if (release.compatibility && release.compatibility.profileVersion) {
      profileVersions.add(release.compatibility.profileVersion);
    }
  }

  return {
    codex: { minimum: "0.0.0" },
    claudeCode: { support: "optional" },
    os: [...os].sort(),
    runtime: { node: ">=20.0.0" },
    profileVersions: [...profileVersions].sort(compareSemver)
  };
}

function buildTeamLock(registryPath, registry, version, release, preset, previousLock = null) {
  return {
    schemaVersion: "1.0.0",
    registry: {
      name: registry.name,
      path: repoRelativePath(registryPath)
    },
    installedVersion: version,
    pinnedVersion: previousLock ? previousLock.pinnedVersion || null : null,
    preset,
    profile: release.profile,
    workflowPacks: release.workflowPacks,
    rulePacks: release.rulePacks,
    managedProjectFiles: release.managedProjectFiles,
    customizationsPreserved: release.managedProjectFiles.length === 0,
    installedAt: previousLock ? previousLock.installedAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function writeTeamSnapshot(targetRoot, registryPath, registry, version, release) {
  const paths = teamStatePaths(targetRoot);
  const snapshotPath = path.join(paths.snapshotsRoot, `${version}.json`);
  const snapshot = {
    version,
    registry: registry.name,
    registryPath: repoRelativePath(registryPath),
    release,
    capturedAt: new Date().toISOString()
  };
  writeJson(snapshotPath, snapshot);
  return relativeSlash(targetRoot, snapshotPath);
}

function loadTeamLock(paths) {
  if (!pathExists(paths.lockPath)) {
    return null;
  }
  return readJson(paths.lockPath);
}

function inspectTeamDistribution(target, options = {}) {
  const targetRoot = resolveTarget(target);
  const paths = teamStatePaths(targetRoot);
  const loaded = loadTeamRegistry(options.registry);
  const lock = loadTeamLock(paths);

  return {
    target: targetRoot,
    installed: Boolean(lock),
    lock,
    registry: summarizeTeamRegistry(loaded.registry),
    compatibilityMatrix: buildCompatibilityMatrix(loaded.registry),
    errors: loaded.errors,
    warnings: loaded.warnings
  };
}

function installTeamDistribution(target, options = {}) {
  const targetRoot = resolveTarget(target);
  const paths = teamStatePaths(targetRoot);
  const loaded = loadTeamRegistry(options.registry);
  const errors = [...loaded.errors];
  const warnings = [...loaded.warnings];
  const selected = findTeamVersion(loaded.registry, options.version);
  const preset = options.preset || (selected.release && selected.release.preset);

  if (pathExists(paths.lockPath)) {
    errors.push("Team Harness is already installed; use team update or team rollback.");
  }
  if (!selected.release) {
    errors.push(`Team registry version ${selected.version || "<latest>"} is not available.`);
  }
  if (preset && !loaded.registry.presets.some((item) => item.id === preset)) {
    errors.push(`Team preset ${preset} is not registered.`);
  }
  if (errors.length > 0) {
    return { target: targetRoot, errors, warnings };
  }

  const lock = buildTeamLock(loaded.registryPath, loaded.registry, selected.version, selected.release, preset);
  const snapshot = writeTeamSnapshot(targetRoot, loaded.registryPath, loaded.registry, selected.version, selected.release);
  writeJson(paths.lockPath, lock);

  return {
    target: targetRoot,
    lock,
    snapshot,
    created: [relativeSlash(targetRoot, paths.lockPath), snapshot],
    projectFileWrites: [],
    errors,
    warnings
  };
}

function diffArtifactLists(fromList = [], toList = []) {
  const fromSet = new Set(fromList);
  const toSet = new Set(toList);
  return [...new Set([...fromList, ...toList])].filter((item) => !fromSet.has(item) || !toSet.has(item)).sort();
}

function buildTeamUpdatePreview(targetRoot, lock, version, release) {
  const current = {
    profile: lock.profile,
    workflowPacks: lock.workflowPacks || [],
    rulePacks: lock.rulePacks || [],
    managedProjectFiles: lock.managedProjectFiles || []
  };
  const changedArtifacts = [
    ...(lock.installedVersion !== version ? release.workflowPacks : []),
    ...diffArtifactLists(current.workflowPacks, release.workflowPacks),
    ...diffArtifactLists(current.rulePacks, release.rulePacks)
  ];
  if (current.profile !== release.profile) {
    changedArtifacts.push(release.profile);
  }

  return {
    fromVersion: lock.installedVersion,
    toVersion: version,
    willWrite: false,
    targetWrites: [
      ".harness/team/lock.json",
      `.harness/team/snapshots/${version}.json`
    ],
    projectFileWrites: release.managedProjectFiles,
    customizationsPreserved: release.managedProjectFiles.length === 0,
    changedArtifacts: [...new Set(changedArtifacts)].sort(),
    target: targetRoot
  };
}

function updateTeamDistribution(target, options = {}) {
  const targetRoot = resolveTarget(target);
  const paths = teamStatePaths(targetRoot);
  const loaded = loadTeamRegistry(options.registry);
  const errors = [...loaded.errors];
  const warnings = [...loaded.warnings];
  const lock = loadTeamLock(paths);
  const selected = findTeamVersion(loaded.registry, options.version);

  if (!lock) {
    errors.push("Team Harness is not installed; use team install first.");
  }
  if (!options.dryRun && !options.confirm) {
    errors.push("team update requires --dry-run or --confirm.");
  }
  if (!selected.release) {
    errors.push(`Team registry version ${selected.version || "<latest>"} is not available.`);
  }
  if (errors.length > 0) {
    return { target: targetRoot, errors, warnings };
  }

  const preview = buildTeamUpdatePreview(targetRoot, lock, selected.version, selected.release);
  if (options.dryRun) {
    return { target: targetRoot, lock, preview, errors, warnings };
  }

  const nextLock = buildTeamLock(
    loaded.registryPath,
    loaded.registry,
    selected.version,
    selected.release,
    selected.release.preset,
    lock
  );
  nextLock.previousVersion = lock.installedVersion;
  const snapshot = writeTeamSnapshot(targetRoot, loaded.registryPath, loaded.registry, selected.version, selected.release);
  writeJson(paths.lockPath, nextLock);

  return { target: targetRoot, lock: nextLock, preview: { ...preview, willWrite: true }, snapshot, errors, warnings };
}

function pinTeamDistribution(target, options = {}) {
  const targetRoot = resolveTarget(target);
  const paths = teamStatePaths(targetRoot);
  const loaded = loadTeamRegistry(options.registry);
  const errors = [...loaded.errors];
  const warnings = [...loaded.warnings];
  const lock = loadTeamLock(paths);
  const selected = findTeamVersion(loaded.registry, options.version);

  if (!lock) {
    errors.push("Team Harness is not installed; use team install first.");
  }
  if (!options.version) {
    errors.push("team pin requires --version <semver>.");
  }
  if (!selected.release) {
    errors.push(`Team registry version ${selected.version || "<latest>"} is not available.`);
  }
  if (errors.length > 0) {
    return { target: targetRoot, errors, warnings };
  }

  lock.pinnedVersion = selected.version;
  lock.updatedAt = new Date().toISOString();
  writeJson(paths.lockPath, lock);
  return { target: targetRoot, lock, errors, warnings };
}

function rollbackTeamDistribution(target, options = {}) {
  const targetRoot = resolveTarget(target);
  const paths = teamStatePaths(targetRoot);
  const errors = [];
  const warnings = [];
  const lock = loadTeamLock(paths);
  const version = options.version;

  if (!lock) {
    errors.push("Team Harness is not installed; use team install first.");
  }
  if (!version) {
    errors.push("team rollback requires --version <semver>.");
  }
  if (!options.confirm) {
    errors.push("team rollback requires --confirm.");
  }
  const snapshotPath = version ? path.join(paths.snapshotsRoot, `${version}.json`) : null;
  if (snapshotPath && !pathExists(snapshotPath)) {
    errors.push(`No team snapshot exists for ${version}.`);
  }
  if (errors.length > 0) {
    return { target: targetRoot, errors, warnings };
  }

  const snapshot = readJson(snapshotPath);
  const previousVersion = lock.installedVersion;
  const nextLock = {
    ...lock,
    installedVersion: version,
    profile: snapshot.release.profile,
    workflowPacks: snapshot.release.workflowPacks,
    rulePacks: snapshot.release.rulePacks,
    managedProjectFiles: snapshot.release.managedProjectFiles,
    customizationsPreserved: snapshot.release.managedProjectFiles.length === 0,
    previousVersion,
    rolledBackAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  writeJson(paths.lockPath, nextLock);

  const ledger = pathExists(paths.rollbackLedgerPath) ? readJson(paths.rollbackLedgerPath) : [];
  ledger.push({ fromVersion: previousVersion, toVersion: version, snapshot: relativeSlash(targetRoot, snapshotPath), rolledBackAt: nextLock.rolledBackAt });
  writeJson(paths.rollbackLedgerPath, ledger);

  return { target: targetRoot, lock: nextLock, previousVersion, snapshot: relativeSlash(targetRoot, snapshotPath), errors, warnings };
}

function listWikiMarkdownFiles(targetRoot) {
  const wikiRoot = path.join(targetRoot, "docs", "wiki");
  return walkFiles(wikiRoot).filter((filePath) => filePath.endsWith(".md"));
}

function detectStaleDocs(targetRoot, options = {}) {
  const now = options.now || new Date();
  const maxAgeDays = options.maxAgeDays || 180;
  const staleDocs = [];

  for (const filePath of listWikiMarkdownFiles(targetRoot)) {
    const content = readText(filePath);
    const relativePath = relativeSlash(targetRoot, filePath);
    const match = content.match(/^Last Reviewed:\s*(\d{4}-\d{2}-\d{2})\s*$/m);
    if (!match) {
      staleDocs.push({ path: relativePath, reason: "missing Last Reviewed marker" });
      continue;
    }
    const reviewedAt = new Date(`${match[1]}T00:00:00Z`);
    const ageDays = Math.floor((now.getTime() - reviewedAt.getTime()) / 86400000);
    if (Number.isFinite(ageDays) && ageDays > maxAgeDays) {
      staleDocs.push({ path: relativePath, reason: `last reviewed ${ageDays} days ago`, lastReviewed: match[1] });
    }
  }

  return staleDocs;
}

function buildWikiLintCi(targetRoot) {
  return {
    ciCommand: `node scripts/harness.js wiki --target ${JSON.stringify(targetRoot)} --dry-run --json`,
    localCommand: `node scripts/validate-wiki.js --target ${JSON.stringify(targetRoot)}`,
    check: "wiki-link-and-starter-file-lint"
  };
}

function detectRulePackDrift(targetRoot, registry) {
  const paths = teamStatePaths(targetRoot);
  const lock = loadTeamLock(paths);
  if (!lock) {
    return { installed: false, drifted: false, expected: [], actual: [] };
  }

  const release = registry.versions && registry.versions[lock.installedVersion];
  const expected = release && Array.isArray(release.rulePacks) ? [...release.rulePacks].sort() : [];
  const actual = Array.isArray(lock.rulePacks) ? [...lock.rulePacks].sort() : [];

  return {
    installed: true,
    drifted: JSON.stringify(expected) !== JSON.stringify(actual),
    expected,
    actual,
    installedVersion: lock.installedVersion
  };
}

function buildUpgradeAssistant(targetRoot, registry) {
  const paths = teamStatePaths(targetRoot);
  const lock = loadTeamLock(paths);
  const latestVersion = latestTeamVersion(registry);

  if (!lock) {
    return {
      installed: false,
      currentVersion: null,
      latestVersion,
      installCommand: `node scripts/harness.js team install --target ${JSON.stringify(targetRoot)} --version ${latestVersion} --preset safe-bootstrap`
    };
  }

  return {
    installed: true,
    currentVersion: lock.installedVersion,
    latestVersion,
    updateAvailable: compareSemver(lock.installedVersion, latestVersion) < 0,
    previewCommand: `node scripts/harness.js team update --target ${JSON.stringify(targetRoot)} --version ${latestVersion} --dry-run --json`,
    upgradeCommand: `node scripts/harness.js team update --target ${JSON.stringify(targetRoot)} --version ${latestVersion} --confirm --json`
  };
}

function buildMigrationAssistant(targetRoot, registry) {
  const paths = teamStatePaths(targetRoot);
  const lock = loadTeamLock(paths);
  const latestVersion = latestTeamVersion(registry);
  const latestRelease = registry.versions[latestVersion];

  if (!lock) {
    return {
      needed: true,
      reason: "team distribution is not installed",
      nextCommand: `node scripts/harness.js team install --target ${JSON.stringify(targetRoot)} --version ${latestVersion} --preset safe-bootstrap`
    };
  }

  return {
    needed: lock.profile !== latestRelease.profile || compareSemver(lock.installedVersion, latestVersion) < 0,
    currentProfile: lock.profile,
    targetProfile: latestRelease.profile,
    nextCommand: `node scripts/harness.js team update --target ${JSON.stringify(targetRoot)} --version ${latestVersion} --dry-run --json`
  };
}

function extractEvolutionFindings(targetRoot) {
  const filePath = path.join(targetRoot, "docs", "wiki", "engineering", "harness-evolution.md");
  if (!pathExists(filePath)) {
    return [];
  }

  const counts = new Map();
  for (const line of readText(filePath).split(/\r?\n/)) {
    const match = line.match(/Finding:\s*(.+?)\s*$/);
    if (match) {
      const finding = match[1].trim();
      counts.set(finding, (counts.get(finding) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([finding, count]) => ({ finding, count }))
    .filter((item) => item.count > 1)
    .sort((left, right) => right.count - left.count || left.finding.localeCompare(right.finding));
}

function inspectMaintenance(target, options = {}) {
  const targetRoot = resolveTarget(target);
  const loaded = loadTeamRegistry(options.registry);
  const wikiValidation = validateWiki(targetRoot);

  return {
    target: targetRoot,
    readOnly: true,
    staleDocs: detectStaleDocs(targetRoot),
    wikiLint: {
      ...buildWikiLintCi(targetRoot),
      errors: wikiValidation.errors,
      warnings: wikiValidation.warnings
    },
    rulePackDrift: detectRulePackDrift(targetRoot, loaded.registry),
    migrationAssistant: buildMigrationAssistant(targetRoot, loaded.registry),
    upgradeAssistant: buildUpgradeAssistant(targetRoot, loaded.registry),
    evolutionRollup: extractEvolutionFindings(targetRoot),
    errors: loaded.errors,
    warnings: loaded.warnings
  };
}

function formatList(items, emptyText = "none") {
  if (!Array.isArray(items) || items.length === 0) {
    return [`- ${emptyText}`];
  }
  return items.map((item) => `- ${item}`);
}

function formatCommandList(commands, emptyText = "none") {
  if (!Array.isArray(commands) || commands.length === 0) {
    return [`- ${emptyText}`];
  }
  return commands.map((command) => `- ${command.source}: ${command.name} -> ${command.command}`);
}

function buildAdoptionReportContent(parts) {
  const { targetRoot, audit, initDryRun, team, teamUpdatePreview, maintenance } = parts;
  const lines = [
    "# Coding Harness Adoption Report",
    "",
    `Target: ${targetRoot}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "No target project files were initialized by this report.",
    "",
    "## Audit Summary",
    "",
    `- Read-only: ${audit.readOnly}`,
    `- Existing Harness files: ${audit.existing.length}`,
    `- Missing Harness files: ${audit.missing.length}`,
    `- Existing docs: ${audit.docs.length}`,
    `- Wiki-like files: ${audit.wikiLikeFiles.length}`,
    `- Conflicts: ${audit.conflicts.length}`,
    "",
    "### Candidate Commands",
    "",
    ...formatCommandList(audit.candidateCommands, "none"),
    "",
    "### Unknowns",
    "",
    ...formatList(audit.unknowns, "none"),
    "",
    "## Init Dry Run",
    "",
    `- Would create: ${initDryRun.created.length}`,
    `- Would skip: ${initDryRun.skipped.length}`,
    "",
    "### First Suggested Additions",
    "",
    ...formatList(initDryRun.created.slice(0, 10), "none"),
    "",
    "## Team Distribution",
    "",
    `- Installed: ${team.installed}`,
    `- Registry: ${team.registry.name}`,
    `- Available versions: ${Object.keys(team.registry.versions || {}).join(", ") || "none"}`,
    ""
  ];

  if (team.lock) {
    lines.push(`- Current version: ${team.lock.installedVersion}`);
  } else {
    lines.push("- Current version: not installed");
    lines.push("- Suggested install: `node scripts/harness.js team install --target <target> --version 1.0.0 --preset safe-bootstrap`");
  }

  if (teamUpdatePreview && teamUpdatePreview.preview) {
    lines.push(`- Update preview: ${teamUpdatePreview.preview.fromVersion} -> ${teamUpdatePreview.preview.toVersion}`);
    lines.push(`- Update would write immediately: ${teamUpdatePreview.preview.willWrite}`);
    lines.push(`- Customizations preserved: ${teamUpdatePreview.preview.customizationsPreserved}`);
  }

  lines.push(
    "",
    "## Maintenance",
    "",
    `- Stale docs: ${maintenance.staleDocs.length}`,
    `- Rule-pack drift: ${maintenance.rulePackDrift.drifted}`,
    `- Upgrade: ${maintenance.upgradeAssistant.currentVersion || "not installed"} -> ${maintenance.upgradeAssistant.latestVersion}`,
    "",
    "## Next Safe Commands",
    "",
    `- ${audit.nextSafeCommand}`,
    `- node scripts/harness.js init --target ${JSON.stringify(targetRoot)} --dry-run`,
    `- node scripts/harness.js maintenance inspect --target ${JSON.stringify(targetRoot)} --json`,
    ""
  );

  return lines.join("\n");
}

function timestampForFileName(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-").toLowerCase();
}

function uniqueAdoptionReportPath(targetRoot, outputDir) {
  const directory = path.resolve(outputDir);
  const baseName = `${slugify(path.basename(targetRoot))}-adoption-report-${timestampForFileName()}`;
  let candidate = path.join(directory, `${baseName}.md`);
  let counter = 2;

  while (pathExists(candidate)) {
    candidate = path.join(directory, `${baseName}-${counter}.md`);
    counter += 1;
  }

  return candidate;
}

function parseAdoptionReportMetadata(filePath) {
  const content = readText(filePath);
  const lines = content.split(/\r?\n/).slice(0, 40);
  if (!lines.some((line) => line.trim() === "# Coding Harness Adoption Report")) {
    return null;
  }

  const targetLine = lines.find((line) => line.startsWith("Target:"));
  const generatedLine = lines.find((line) => line.startsWith("Generated:"));
  const fallbackGeneratedAt = fs.statSync(filePath).mtime.toISOString();
  const parsedGeneratedAt = generatedLine ? generatedLine.replace(/^Generated:\s*/, "").trim() : "";
  const generatedAt = Number.isNaN(Date.parse(parsedGeneratedAt)) ? fallbackGeneratedAt : parsedGeneratedAt;

  return {
    file: path.resolve(filePath),
    target: targetLine ? targetLine.replace(/^Target:\s*/, "").trim() : "unknown",
    generatedAt
  };
}

function listAdoptionReports(options = {}) {
  const reportsDir = options.reportsDir ? path.resolve(options.reportsDir) : "";
  const errors = [];
  const warnings = [];
  const reports = [];

  if (!reportsDir) {
    errors.push("adoption list requires --reports-dir.");
    return { target: "n/a", reportsDir, reports, readOnlyReportsDir: true, errors, warnings };
  }

  if (!pathExists(reportsDir) || !fs.statSync(reportsDir).isDirectory()) {
    errors.push(`Reports directory does not exist: ${reportsDir}`);
    return { target: reportsDir, reportsDir, reports, readOnlyReportsDir: true, errors, warnings };
  }

  for (const entry of fs.readdirSync(reportsDir, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
      continue;
    }

    const filePath = path.join(reportsDir, entry.name);
    const metadata = parseAdoptionReportMetadata(filePath);
    if (metadata) {
      reports.push(metadata);
    }
  }

  reports.sort((left, right) => {
    const byGeneratedAt = Date.parse(right.generatedAt) - Date.parse(left.generatedAt);
    if (byGeneratedAt !== 0) {
      return byGeneratedAt;
    }
    return left.file.localeCompare(right.file);
  });

  return { target: reportsDir, reportsDir, reports, readOnlyReportsDir: true, errors, warnings };
}

function escapeMarkdownTableCell(value) {
  return String(value || "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function buildAdoptionReportsIndexContent(listing, outputPath) {
  const outputDir = path.dirname(outputPath);
  const lines = [
    "# Adoption Reports Index",
    "",
    `Reports directory: ${listing.reportsDir}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Reports are sorted newest first.",
    ""
  ];

  if (listing.reports.length === 0) {
    lines.push("No adoption reports found.", "");
    return lines.join("\n");
  }

  lines.push("| Generated | Target | Report |", "| --- | --- | --- |");
  for (const report of listing.reports) {
    const linkTarget = relativeSlash(outputDir, report.file);
    const fileName = path.basename(report.file);
    lines.push(`| ${escapeMarkdownTableCell(report.generatedAt)} | ${escapeMarkdownTableCell(report.target)} | [${escapeMarkdownTableCell(fileName)}](${linkTarget}) |`);
  }
  lines.push("");
  return lines.join("\n");
}

function writeAdoptionReportsIndex(options = {}) {
  const reportsDir = options.reportsDir ? path.resolve(options.reportsDir) : "";
  const outputPath = options.output ? path.resolve(options.output) : "";
  const errors = [];
  const warnings = [];

  if (!reportsDir) {
    errors.push("adoption index requires --reports-dir.");
  }
  if (!outputPath) {
    errors.push("adoption index requires --output.");
  }
  if (outputPath && pathExists(outputPath)) {
    errors.push(`Index already exists: ${outputPath}`);
  }
  if (errors.length > 0) {
    return { target: reportsDir || "n/a", reportsDir, outputPath, reports: [], errors, warnings };
  }

  const listing = listAdoptionReports({ reportsDir });
  if (listing.errors.length > 0) {
    return { ...listing, outputPath };
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buildAdoptionReportsIndexContent(listing, outputPath));

  return {
    ...listing,
    outputPath
  };
}

function isLocalMarkdownLink(linkTarget) {
  return Boolean(linkTarget)
    && !/^[a-z][a-z0-9+.-]*:/i.test(linkTarget)
    && !linkTarget.startsWith("#")
    && linkTarget.split(/[?#]/)[0].toLowerCase().endsWith(".md");
}

function extractMarkdownLinks(content) {
  const links = [];
  const pattern = /\[[^\]]+\]\(([^)]+)\)/g;
  let match = pattern.exec(content);
  while (match) {
    const linkTarget = match[1].trim();
    if (isLocalMarkdownLink(linkTarget)) {
      links.push(linkTarget);
    }
    match = pattern.exec(content);
  }
  return links;
}

function isInsideDirectory(parentDir, childPath) {
  const relativePath = path.relative(parentDir, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function validateAdoptionReports(options = {}) {
  const reportsDir = options.reportsDir ? path.resolve(options.reportsDir) : "";
  const indexPath = options.index ? path.resolve(options.index) : "";
  const errors = [];
  const warnings = [];
  const invalidReports = [];
  const indexLinks = [];

  if (!reportsDir) {
    errors.push("adoption validate requires --reports-dir.");
    return {
      target: "n/a",
      reportsDir,
      indexPath,
      checkedIndex: Boolean(indexPath),
      valid: false,
      reports: [],
      invalidReports,
      indexLinks,
      readOnlyReportsDir: true,
      errors,
      warnings
    };
  }

  const listing = listAdoptionReports({ reportsDir });
  errors.push(...listing.errors);
  warnings.push(...listing.warnings);

  if (errors.length === 0) {
    for (const entry of fs.readdirSync(reportsDir, { withFileTypes: true })) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
        continue;
      }

      const filePath = path.join(reportsDir, entry.name);
      if (indexPath && path.resolve(filePath) === indexPath) {
        continue;
      }
      if (!parseAdoptionReportMetadata(filePath)) {
        invalidReports.push(filePath);
        errors.push(`Invalid adoption report metadata: ${filePath}`);
      }
    }
  }

  if (indexPath) {
    if (!pathExists(indexPath)) {
      errors.push(`Index does not exist: ${indexPath}`);
    } else {
      const reportFiles = new Set(listing.reports.map((report) => path.resolve(report.file)));
      for (const linkTarget of extractMarkdownLinks(readText(indexPath))) {
        const cleanTarget = linkTarget.split(/[?#]/)[0];
        const resolvedLink = path.resolve(path.dirname(indexPath), cleanTarget);
        indexLinks.push({ target: linkTarget, file: resolvedLink });

        if (!isInsideDirectory(reportsDir, resolvedLink)) {
          errors.push(`Index link points outside reports directory: ${linkTarget}`);
        } else if (!pathExists(resolvedLink)) {
          errors.push(`Index link target does not exist: ${linkTarget}`);
        } else if (!reportFiles.has(resolvedLink)) {
          errors.push(`Index link target is not a valid adoption report: ${linkTarget}`);
        }
      }

      for (const report of listing.reports) {
        if (!indexLinks.some((link) => path.resolve(link.file) === path.resolve(report.file))) {
          errors.push(`Index is missing report: ${path.basename(report.file)}`);
        }
      }
    }
  }

  return {
    ...listing,
    target: reportsDir,
    indexPath,
    checkedIndex: Boolean(indexPath),
    valid: errors.length === 0,
    invalidReports,
    indexLinks,
    errors,
    warnings
  };
}

function extractMarkdownListUnderSubheading(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const headingPattern = new RegExp(`^###\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start === -1) {
    return [];
  }

  const items = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^#{2,3}\s+/.test(line)) {
      break;
    }
    const match = line.match(/^\s*-\s+(.+?)\s*$/);
    if (match && match[1].toLowerCase() !== "none") {
      items.push(match[1]);
    }
  }
  return items;
}

function readAdoptionReportMetric(markdown, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^\\s*-\\s+${escapedLabel}:\\s+(.+?)\\s*$`, "im"));
  if (!match) {
    return null;
  }

  const numeric = Number(match[1]);
  return Number.isNaN(numeric) ? match[1] : numeric;
}

const ADOPTION_COMPARE_METRICS = [
  ["existingHarnessFiles", "Existing Harness files"],
  ["missingHarnessFiles", "Missing Harness files"],
  ["existingDocs", "Existing docs"],
  ["wikiLikeFiles", "Wiki-like files"],
  ["conflicts", "Conflicts"],
  ["staleDocs", "Stale docs"]
];

function parseAdoptionReportForComparison(filePath) {
  const resolved = path.resolve(filePath);
  if (!pathExists(resolved)) {
    return { error: `Report does not exist: ${resolved}` };
  }

  const metadata = parseAdoptionReportMetadata(resolved);
  if (!metadata) {
    return { error: `Invalid adoption report metadata: ${resolved}` };
  }

  const markdown = readText(resolved);
  const metrics = {};
  for (const [key, label] of ADOPTION_COMPARE_METRICS) {
    metrics[key] = readAdoptionReportMetric(markdown, label);
  }

  return {
    report: {
      ...metadata,
      metrics,
      candidateCommands: extractMarkdownListUnderSubheading(markdown, "Candidate Commands"),
      unknowns: extractMarkdownListUnderSubheading(markdown, "Unknowns"),
      rulePackDrift: readAdoptionReportMetric(markdown, "Rule-pack drift"),
      teamInstalled: readAdoptionReportMetric(markdown, "Installed")
    }
  };
}

function compareStringLists(baseItems, headItems) {
  const baseSet = new Set(baseItems);
  const headSet = new Set(headItems);
  return {
    added: headItems.filter((item) => !baseSet.has(item)),
    removed: baseItems.filter((item) => !headSet.has(item)),
    unchanged: headItems.filter((item) => baseSet.has(item))
  };
}

function buildMetricComparison(baseMetrics, headMetrics) {
  const metrics = {};
  for (const [key, label] of ADOPTION_COMPARE_METRICS) {
    const baseValue = baseMetrics[key];
    const headValue = headMetrics[key];
    metrics[key] = {
      label,
      base: baseValue,
      head: headValue,
      delta: typeof baseValue === "number" && typeof headValue === "number" ? headValue - baseValue : null
    };
  }
  return metrics;
}

function buildAdoptionReportDiffContent(comparison) {
  const lines = [
    "# Adoption Report Diff",
    "",
    `Base: ${comparison.base.file}`,
    `Head: ${comparison.head.file}`,
    `Same target: ${comparison.sameTarget}`,
    "",
    "## Metric Deltas",
    "",
    "| Metric | Base | Head | Delta |",
    "| --- | ---: | ---: | ---: |"
  ];

  for (const metric of Object.values(comparison.metrics)) {
    lines.push(`| ${metric.label} | ${metric.base ?? "n/a"} | ${metric.head ?? "n/a"} | ${metric.delta ?? "n/a"} |`);
  }

  lines.push("", "## Candidate Commands Added", "");
  lines.push(...formatList(comparison.candidateCommands.added, "none"));
  lines.push("", "## Candidate Commands Removed", "");
  lines.push(...formatList(comparison.candidateCommands.removed, "none"));
  lines.push("", "## Unknowns Added", "");
  lines.push(...formatList(comparison.unknowns.added, "none"));
  lines.push("", "## Unknowns Removed", "");
  lines.push(...formatList(comparison.unknowns.removed, "none"));
  lines.push("");

  return lines.join("\n");
}

function compareAdoptionReports(options = {}) {
  const reportsDir = options.reportsDir ? path.resolve(options.reportsDir) : "";
  const outputPath = options.output ? path.resolve(options.output) : "";
  const errors = [];
  const warnings = [];
  let basePath = options.base ? path.resolve(options.base) : "";
  let headPath = options.head ? path.resolve(options.head) : "";

  if (outputPath && pathExists(outputPath)) {
    errors.push(`Diff already exists: ${outputPath}`);
  }

  if (reportsDir && (!basePath || !headPath)) {
    const listing = listAdoptionReports({ reportsDir });
    errors.push(...listing.errors);
    warnings.push(...listing.warnings);
    if (listing.reports.length < 2) {
      errors.push(`Need at least two adoption reports to compare in: ${reportsDir}`);
    } else {
      headPath = listing.reports[0].file;
      basePath = listing.reports[1].file;
    }
  }

  if (!basePath || !headPath) {
    errors.push("adoption compare requires --reports-dir or both --base and --head.");
  }

  if (errors.length > 0) {
    return { target: reportsDir || "n/a", reportsDir, outputPath, base: null, head: null, errors, warnings };
  }

  const baseParsed = parseAdoptionReportForComparison(basePath);
  const headParsed = parseAdoptionReportForComparison(headPath);
  if (baseParsed.error) {
    errors.push(baseParsed.error);
  }
  if (headParsed.error) {
    errors.push(headParsed.error);
  }
  if (errors.length > 0) {
    return { target: reportsDir || "n/a", reportsDir, outputPath, base: null, head: null, errors, warnings };
  }

  const base = baseParsed.report;
  const head = headParsed.report;
  const comparison = {
    target: head.target,
    reportsDir,
    outputPath,
    base: {
      file: base.file,
      target: base.target,
      generatedAt: base.generatedAt
    },
    head: {
      file: head.file,
      target: head.target,
      generatedAt: head.generatedAt
    },
    sameTarget: base.target === head.target,
    generatedOrder: Date.parse(head.generatedAt) >= Date.parse(base.generatedAt) ? "head-after-base" : "head-before-base",
    metrics: buildMetricComparison(base.metrics, head.metrics),
    candidateCommands: compareStringLists(base.candidateCommands, head.candidateCommands),
    unknowns: compareStringLists(base.unknowns, head.unknowns),
    statusChanges: {
      teamInstalled: { base: base.teamInstalled, head: head.teamInstalled, changed: base.teamInstalled !== head.teamInstalled },
      rulePackDrift: { base: base.rulePackDrift, head: head.rulePackDrift, changed: base.rulePackDrift !== head.rulePackDrift }
    },
    errors,
    warnings
  };

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buildAdoptionReportDiffContent(comparison));
  }

  return comparison;
}

function adoptionGateFindings(report) {
  const findings = [];
  const missingHarnessFiles = report.metrics.missingHarnessFiles;
  const conflicts = report.metrics.conflicts;

  if (typeof missingHarnessFiles === "number" && missingHarnessFiles > 0) {
    findings.push({
      id: "missing-harness-files",
      severity: "wait",
      message: `${missingHarnessFiles} Harness files are still missing.`
    });
  }

  if (typeof conflicts === "number" && conflicts > 0) {
    findings.push({
      id: "conflicts-present",
      severity: "wait",
      message: `${conflicts} conflicting files require manual review.`
    });
  }

  if (report.candidateCommands.length > 0) {
    findings.push({
      id: "candidate-commands-unconfirmed",
      severity: "wait",
      message: `${report.candidateCommands.length} candidate command(s) require human confirmation.`
    });
  }

  if (report.unknowns.length > 0) {
    findings.push({
      id: "unknowns-present",
      severity: "wait",
      message: `${report.unknowns.length} unknown(s) remain unresolved.`
    });
  }

  return findings;
}

function buildAdoptionGateContent(gate) {
  const lines = [
    "# Adoption Gate Report",
    "",
    `Report: ${gate.report.file}`,
    `Target: ${gate.report.target}`,
    `Generated: ${gate.report.generatedAt}`,
    `Decision: ${gate.decision}`,
    "",
    "## Findings",
    ""
  ];

  if (gate.findings.length === 0) {
    lines.push("- none");
  } else {
    for (const finding of gate.findings) {
      lines.push(`- ${finding.id}: ${finding.message}`);
    }
  }

  lines.push("", "## Metrics", "");
  for (const metric of Object.values(gate.metrics)) {
    lines.push(`- ${metric.label}: ${metric.value ?? "n/a"}`);
  }
  lines.push("");

  return lines.join("\n");
}

function gateAdoptionReport(options = {}) {
  const reportsDir = options.reportsDir ? path.resolve(options.reportsDir) : "";
  const outputPath = options.output ? path.resolve(options.output) : "";
  let reportPath = options.report ? path.resolve(options.report) : "";
  const errors = [];
  const warnings = [];

  if (outputPath && pathExists(outputPath)) {
    errors.push(`Gate report already exists: ${outputPath}`);
  }

  if (reportsDir && !reportPath) {
    const listing = listAdoptionReports({ reportsDir });
    errors.push(...listing.errors);
    warnings.push(...listing.warnings);
    if (listing.reports.length === 0) {
      errors.push(`No adoption reports found in: ${reportsDir}`);
    } else {
      reportPath = listing.reports[0].file;
    }
  }

  if (!reportPath) {
    errors.push("adoption gate requires --report or --reports-dir.");
  }

  if (errors.length > 0) {
    return { target: reportsDir || "n/a", reportsDir, outputPath, report: null, decision: "wait", findings: [], errors, warnings };
  }

  const parsed = parseAdoptionReportForComparison(reportPath);
  if (parsed.error) {
    errors.push(parsed.error);
    return { target: reportsDir || "n/a", reportsDir, outputPath, report: null, decision: "wait", findings: [], errors, warnings };
  }

  const report = parsed.report;
  const findings = adoptionGateFindings(report);
  const metrics = {};
  for (const [key, label] of ADOPTION_COMPARE_METRICS) {
    metrics[key] = { label, value: report.metrics[key] };
  }

  const gate = {
    target: report.target,
    reportsDir,
    outputPath,
    report: {
      file: report.file,
      target: report.target,
      generatedAt: report.generatedAt
    },
    decision: findings.length === 0 ? "ready" : "wait",
    findings,
    metrics,
    candidateCommands: report.candidateCommands,
    unknowns: report.unknowns,
    errors,
    warnings
  };

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buildAdoptionGateContent(gate));
  }

  return gate;
}

function nextAdoptionStatusAction(status) {
  if (status.errors.length > 0) {
    return "Fix adoption status errors before sharing this summary.";
  }
  if (status.index.checked && !status.index.valid) {
    return "Fix adoption index links before relying on this status.";
  }
  if (status.gate.decision === "wait") {
    return "Review adoption gate findings before initializing or changing the target project.";
  }
  return "Ready for human approval of the next safe Harness action.";
}

function buildAdoptionStatusContent(status) {
  const lines = [
    "# Adoption Status",
    "",
    `Reports directory: ${status.reportsDir}`,
    `Reports: ${status.reports.count}`,
    `Latest report: ${status.latestReport ? status.latestReport.file : "none"}`,
    `Index checked: ${status.index.checked}`,
    `Index valid: ${status.index.valid ?? "n/a"}`,
    `Gate decision: ${status.gate.decision}`,
    `Next safe action: ${status.nextSafeAction}`,
    "",
    "## Blockers",
    ""
  ];

  if (status.blockers.length === 0) {
    lines.push("- none");
  } else {
    for (const blocker of status.blockers) {
      lines.push(`- ${blocker.id}: ${blocker.message}`);
    }
  }

  lines.push("", "## Compare Summary", "");
  if (!status.compare) {
    lines.push("- Not enough reports to compare.");
  } else {
    lines.push(`- Base: ${status.compare.base.file}`);
    lines.push(`- Head: ${status.compare.head.file}`);
    lines.push(`- Missing Harness files delta: ${status.compare.metrics.missingHarnessFiles.delta ?? "n/a"}`);
    lines.push(`- Candidate commands added: ${status.compare.candidateCommands.added.length}`);
    lines.push(`- Unknowns removed: ${status.compare.unknowns.removed.length}`);
  }

  lines.push("");
  return lines.join("\n");
}

function statusAdoptionReports(options = {}) {
  const reportsDir = options.reportsDir ? path.resolve(options.reportsDir) : "";
  const indexPath = options.index ? path.resolve(options.index) : "";
  const outputPath = options.output ? path.resolve(options.output) : "";
  const errors = [];
  const warnings = [];

  if (!reportsDir) {
    errors.push("adoption status requires --reports-dir.");
  }
  if (outputPath && pathExists(outputPath)) {
    errors.push(`Status report already exists: ${outputPath}`);
  }
  if (errors.length > 0) {
    return {
      kind: "adoption-status",
      target: reportsDir || "n/a",
      reportsDir,
      outputPath,
      reports: { count: 0 },
      latestReport: null,
      index: { checked: Boolean(indexPath), valid: null, errors: [] },
      gate: { decision: "wait", findings: [] },
      compare: null,
      blockers: [],
      nextSafeAction: "Fix adoption status errors before sharing this summary.",
      errors,
      warnings
    };
  }

  const listing = listAdoptionReports({ reportsDir });
  errors.push(...listing.errors);
  warnings.push(...listing.warnings);
  if (listing.reports.length === 0) {
    errors.push(`No adoption reports found in: ${reportsDir}`);
  }

  const latestReport = listing.reports[0] || null;
  const index = { checked: Boolean(indexPath), valid: null, errors: [] };
  if (indexPath) {
    const validation = validateAdoptionReports({ reportsDir, index: indexPath });
    index.valid = validation.errors.length === 0;
    index.errors = validation.errors;
    warnings.push(...validation.warnings);
  }

  const gate = latestReport
    ? gateAdoptionReport({ report: latestReport.file })
    : { decision: "wait", findings: [] };
  warnings.push(...(gate.warnings || []));
  errors.push(...(gate.errors || []));

  let compare = null;
  if (listing.reports.length >= 2) {
    compare = compareAdoptionReports({ reportsDir });
    warnings.push(...(compare.warnings || []));
    errors.push(...(compare.errors || []));
  }

  const status = {
    kind: "adoption-status",
    target: latestReport ? latestReport.target : reportsDir,
    reportsDir,
    outputPath,
    reports: {
      count: listing.reports.length,
      files: listing.reports.map((report) => report.file)
    },
    latestReport,
    index,
    gate: {
      decision: gate.decision,
      findings: gate.findings || []
    },
    compare,
    blockers: gate.findings || [],
    nextSafeAction: "",
    errors,
    warnings
  };

  status.nextSafeAction = nextAdoptionStatusAction(status);

  if (outputPath && errors.length === 0) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buildAdoptionStatusContent(status));
  }

  return status;
}

function adoptionBundleBoundaries() {
  return {
    targetProjectFilesCopied: false,
    targetProjectCommandsExecuted: false,
    dynamicWorkflowExecuted: false,
    liveSubagentsInvoked: false
  };
}

function buildAdoptionBundleDiffFallbackContent(status) {
  const lines = [
    "# Adoption Report Diff",
    "",
    "No diff was generated for this bundle.",
    "",
    "## Reason",
    ""
  ];

  if (status.reports.count < 2) {
    lines.push("- Need at least two adoption reports to compare.");
  } else if (status.compare && Array.isArray(status.compare.errors) && status.compare.errors.length > 0) {
    for (const error of status.compare.errors) {
      lines.push(`- ${error}`);
    }
  } else {
    lines.push("- Compare data was unavailable.");
  }

  lines.push("");
  return lines.join("\n");
}

function buildAdoptionBundleReadmeContent(bundle) {
  const lines = [
    "# Adoption Review Bundle",
    "",
    `Target: ${bundle.target}`,
    `Generated: ${bundle.generatedAt}`,
    `Reports directory: ${bundle.reportsDir}`,
    `Latest report: ${bundle.latestReport || "none"}`,
    `Gate decision: ${bundle.gateDecision}`,
    `Next safe action: ${bundle.nextSafeAction}`,
    "",
    "## Files",
    ""
  ];

  for (const file of bundle.files) {
    lines.push(`- [${file.relativePath}](${file.relativePath})`);
  }

  lines.push(
    "",
    "## V1 Boundaries",
    "",
    `- Target project files copied: ${bundle.boundaries.targetProjectFilesCopied}`,
    `- Target project commands executed: ${bundle.boundaries.targetProjectCommandsExecuted}`,
    `- Dynamic Workflow executed: ${bundle.boundaries.dynamicWorkflowExecuted}`,
    `- Live subagents invoked: ${bundle.boundaries.liveSubagentsInvoked}`,
    "",
    "This bundle is a read-only review artifact. It does not copy files from the target project and does not run target project commands.",
    ""
  );

  return lines.join("\n");
}

function adoptionBundleErrorResult(fields, errors, warnings) {
  const outputDir = fields.outputDir || "";
  return {
    kind: "adoption-bundle",
    target: fields.target || fields.reportsDir || "n/a",
    reportsDir: fields.reportsDir || "",
    indexPath: fields.indexPath || "",
    outputDir,
    latestReport: null,
    gateDecision: "wait",
    nextSafeAction: "Fix adoption bundle errors before sharing this bundle.",
    files: [],
    manifestPath: outputDir ? path.join(outputDir, "manifest.json") : "",
    boundaries: adoptionBundleBoundaries(),
    errors,
    warnings
  };
}

function bundleAdoptionArtifacts(options = {}) {
  const reportsDir = options.reportsDir ? path.resolve(options.reportsDir) : "";
  const indexPath = options.index ? path.resolve(options.index) : "";
  const outputDir = options.outputDir ? path.resolve(options.outputDir) : "";
  const errors = [];
  const warnings = [];

  if (!reportsDir) {
    errors.push("adoption bundle requires --reports-dir.");
  }
  if (!outputDir) {
    errors.push("adoption bundle requires --output-dir.");
  }
  if (outputDir && pathExists(outputDir)) {
    errors.push(`Bundle output directory already exists: ${outputDir}`);
  }
  if (errors.length > 0) {
    return adoptionBundleErrorResult({ reportsDir, indexPath, outputDir }, errors, warnings);
  }

  const status = statusAdoptionReports({ reportsDir, index: indexPath });
  warnings.push(...(status.warnings || []));
  errors.push(...(status.errors || []));
  if (errors.length > 0) {
    return adoptionBundleErrorResult({ target: status.target, reportsDir, indexPath, outputDir }, errors, warnings);
  }

  const listing = listAdoptionReports({ reportsDir });
  warnings.push(...listing.warnings);
  errors.push(...listing.errors);
  if (errors.length > 0) {
    return adoptionBundleErrorResult({ target: status.target, reportsDir, indexPath, outputDir }, errors, warnings);
  }

  const gate = status.latestReport ? gateAdoptionReport({ report: status.latestReport.file }) : null;
  if (gate) {
    warnings.push(...(gate.warnings || []));
    errors.push(...(gate.errors || []));
  }
  if (errors.length > 0) {
    return adoptionBundleErrorResult({ target: status.target, reportsDir, indexPath, outputDir }, errors, warnings);
  }

  const relativePaths = ["README.md", "status.md", "index.md", "diff.md", "gate.md", "manifest.json"];
  const files = relativePaths.map((relativePath) => ({
    relativePath,
    path: path.join(outputDir, relativePath)
  }));
  const manifestPath = path.join(outputDir, "manifest.json");
  const generatedAt = new Date().toISOString();
  const boundaries = adoptionBundleBoundaries();
  const bundle = {
    kind: "adoption-bundle",
    generatedAt,
    target: status.target,
    reportsDir,
    indexPath,
    outputDir,
    latestReport: status.latestReport ? status.latestReport.file : null,
    gateDecision: status.gate.decision,
    nextSafeAction: status.nextSafeAction,
    files,
    manifestPath,
    boundaries,
    errors,
    warnings
  };

  const manifest = {
    kind: bundle.kind,
    generatedAt,
    target: bundle.target,
    reportsDir,
    indexPath,
    outputDir,
    latestReport: bundle.latestReport,
    gateDecision: bundle.gateDecision,
    nextSafeAction: bundle.nextSafeAction,
    files,
    sources: {
      reports: listing.reports.map((report) => ({
        file: report.file,
        target: report.target,
        generatedAt: report.generatedAt
      })),
      index: indexPath || null
    },
    boundaries
  };

  fs.mkdirSync(path.dirname(outputDir), { recursive: true });
  fs.mkdirSync(outputDir);
  fs.writeFileSync(path.join(outputDir, "README.md"), buildAdoptionBundleReadmeContent(bundle));
  fs.writeFileSync(path.join(outputDir, "status.md"), buildAdoptionStatusContent(status));
  fs.writeFileSync(path.join(outputDir, "index.md"), buildAdoptionReportsIndexContent(listing, path.join(outputDir, "index.md")));
  fs.writeFileSync(
    path.join(outputDir, "diff.md"),
    status.compare ? buildAdoptionReportDiffContent(status.compare) : buildAdoptionBundleDiffFallbackContent(status)
  );
  fs.writeFileSync(path.join(outputDir, "gate.md"), gate ? buildAdoptionGateContent(gate) : "# Adoption Gate Report\n\nNo latest report was available.\n");
  writeJson(manifestPath, manifest);

  return bundle;
}

function generateAdoptionReport(target, options = {}) {
  const targetRoot = resolveTarget(target);
  const errors = [];
  const outputPath = (() => {
    if (options.output && options.outputDir) {
      errors.push("Use either --output or --output-dir, not both.");
      return path.resolve(options.output);
    }
    if (options.output) {
      return path.resolve(options.output);
    }
    if (options.outputDir) {
      return uniqueAdoptionReportPath(targetRoot, options.outputDir);
    }
    return path.join(REPO_ROOT, "docs", "examples", `${slugify(path.basename(targetRoot))}-adoption-report.md`);
  })();
  const warnings = [];

  if (errors.length > 0) {
    return { target: targetRoot, reportPath: outputPath, errors, warnings };
  }

  if (pathExists(outputPath)) {
    errors.push(`Report already exists: ${outputPath}`);
    return { target: targetRoot, reportPath: outputPath, errors, warnings };
  }

  const audit = auditProject(targetRoot);
  const initDryRun = scaffoldHarness(targetRoot, { dryRun: true });
  const team = inspectTeamDistribution(targetRoot, options);
  let teamUpdatePreview = null;
  if (team.installed && team.lock && team.registry.versions["1.1.0"]) {
    teamUpdatePreview = updateTeamDistribution(targetRoot, { ...options, version: "1.1.0", dryRun: true });
  }
  const maintenance = inspectMaintenance(targetRoot, options);

  errors.push(...(team.errors || []), ...(maintenance.errors || []));
  warnings.push(...(team.warnings || []), ...(maintenance.warnings || []));
  if (teamUpdatePreview) {
    errors.push(...(teamUpdatePreview.errors || []));
    warnings.push(...(teamUpdatePreview.warnings || []));
  }
  if (errors.length > 0) {
    return { target: targetRoot, reportPath: outputPath, errors, warnings };
  }

  const content = buildAdoptionReportContent({ targetRoot, audit, initDryRun, team, teamUpdatePreview, maintenance });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content);

  return {
    target: targetRoot,
    reportPath: outputPath,
    readOnlyTargetRoot: true,
    sections: [
      { id: "audit", status: "included" },
      { id: "init-dry-run", status: "included" },
      { id: "team", status: "included" },
      { id: "maintenance", status: "included" }
    ],
    errors,
    warnings
  };
}

function buildMaintenanceProposalContent(inspection) {
  const lines = [
    "# Harness Maintenance Proposal",
    "",
    `Target: ${inspection.target}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Stale Docs",
    ""
  ];

  if (inspection.staleDocs.length === 0) {
    lines.push("- None detected.");
  } else {
    for (const doc of inspection.staleDocs) {
      lines.push(`- ${doc.path}: ${doc.reason}`);
    }
  }

  lines.push("", "## Upgrade Assistant", "");
  lines.push(`- Current: ${inspection.upgradeAssistant.currentVersion || "not installed"}`);
  lines.push(`- Latest: ${inspection.upgradeAssistant.latestVersion}`);
  if (inspection.upgradeAssistant.previewCommand) {
    lines.push(`- Preview: \`${inspection.upgradeAssistant.previewCommand}\``);
  }

  lines.push("", "## Rule-Pack Drift", "");
  lines.push(`- Drifted: ${inspection.rulePackDrift.drifted}`);
  lines.push(`- Expected: ${(inspection.rulePackDrift.expected || []).join(", ") || "none"}`);
  lines.push(`- Actual: ${(inspection.rulePackDrift.actual || []).join(", ") || "none"}`);

  lines.push("", "## Evolution Rollup", "");
  if (inspection.evolutionRollup.length === 0) {
    lines.push("- No repeated findings detected.");
  } else {
    for (const item of inspection.evolutionRollup) {
      lines.push(`- ${item.finding} (${item.count} occurrences)`);
    }
  }

  lines.push("", "## Suggested Standards Diff", "", "```diff");
  if (inspection.evolutionRollup.length === 0) {
    lines.push("# No repeated delivery findings to promote.");
  } else {
    lines.push("--- standards/harness-delivery.json");
    lines.push("+++ standards/harness-delivery.json");
    for (const item of inspection.evolutionRollup) {
      lines.push(`+ delivery finding: ${item.finding}`);
    }
  }
  lines.push("```", "", "No source docs or standards were changed by this proposal.", "");

  return lines.join("\n");
}

function proposeMaintenance(target, options = {}) {
  const inspection = inspectMaintenance(target, options);
  if (inspection.errors.length > 0) {
    return { target: inspection.target, errors: inspection.errors, warnings: inspection.warnings };
  }

  const proposalRoot = path.join(inspection.target, ".harness", "maintenance", "proposals");
  const proposalPath = path.join(proposalRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-maintenance-proposal.md`);
  fs.mkdirSync(proposalRoot, { recursive: true });
  fs.writeFileSync(proposalPath, buildMaintenanceProposalContent(inspection));

  return {
    target: inspection.target,
    proposalPath: relativeSlash(inspection.target, proposalPath),
    reviewable: true,
    sourceFilesChanged: false,
    inspection,
    errors: [],
    warnings: inspection.warnings
  };
}

function validateFeatureListData(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { errors: ["feature_list.json must contain an object."], warnings };
  }

  if (!Array.isArray(data.features)) {
    return { errors: ["feature_list.json must contain a features array."], warnings };
  }

  const ids = new Set();
  let inProgressCount = 0;

  data.features.forEach((feature, index) => {
    const prefix = `features[${index}]`;
    if (!feature || typeof feature !== "object" || Array.isArray(feature)) {
      errors.push(`${prefix} must be an object.`);
      return;
    }

    for (const field of ["id", "area", "title", "user_visible_behavior", "status"]) {
      if (typeof feature[field] !== "string" || feature[field].trim() === "") {
        errors.push(`${prefix}.${field} must be a non-empty string.`);
      }
    }

    if (!Number.isInteger(feature.priority)) {
      errors.push(`${prefix}.priority must be an integer.`);
    }

    if (!Array.isArray(feature.verification) || feature.verification.length === 0) {
      errors.push(`${prefix}.verification must contain at least one step.`);
    } else if (feature.verification.some((step) => typeof step !== "string" || step.trim() === "")) {
      errors.push(`${prefix}.verification steps must be non-empty strings.`);
    }

    if (!Array.isArray(feature.evidence)) {
      errors.push(`${prefix}.evidence must be an array.`);
    }

    if (!Array.isArray(feature.notes)) {
      errors.push(`${prefix}.notes must be an array.`);
    }

    if (typeof feature.id === "string") {
      if (ids.has(feature.id)) {
        errors.push(`${prefix}.id duplicates ${feature.id}.`);
      }
      ids.add(feature.id);
    }

    if (!VALID_STATUSES.has(feature.status)) {
      errors.push(`${prefix}.status must be one of ${Array.from(VALID_STATUSES).join(", ")}.`);
    }

    if (feature.status === "in_progress") {
      inProgressCount += 1;
    }

    if (feature.status === "passing" && (!Array.isArray(feature.evidence) || feature.evidence.length === 0)) {
      errors.push(`${prefix} is passing but has no evidence.`);
    }

    if (feature.status === "blocked" && (!Array.isArray(feature.notes) || feature.notes.length === 0)) {
      warnings.push(`${prefix} is blocked but has no notes.`);
    }
  });

  if (inProgressCount > 1) {
    errors.push("At most one feature can be in_progress.");
  }

  return { errors, warnings };
}

function validateFeatureListFile(filePath) {
  try {
    return validateFeatureListData(readJson(filePath));
  } catch (error) {
    return { errors: [`Cannot read feature_list.json: ${error.message}`], warnings: [] };
  }
}

function validateContinuousImprovementStateFile(filePath) {
  const errors = [];
  const warnings = [];
  let data;

  try {
    data = readJson(filePath);
  } catch (error) {
    return { errors: [`Cannot read .workflow/continuous-improvement/state.json: ${error.message}`], warnings };
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { errors: [".workflow/continuous-improvement/state.json must contain an object."], warnings };
  }

  if (!Number.isInteger(data.version)) {
    errors.push(".workflow/continuous-improvement/state.json version must be an integer.");
  }

  if (typeof data.mode !== "string" || data.mode.trim() === "") {
    errors.push(".workflow/continuous-improvement/state.json mode must be a non-empty string.");
  }

  for (const field of ["queue", "approvalGates", "resultNotes"]) {
    if (!Array.isArray(data[field])) {
      errors.push(`.workflow/continuous-improvement/state.json ${field} must be an array.`);
    }
  }

  if (data.activeWorkflow !== null && data.activeWorkflow !== undefined && typeof data.activeWorkflow !== "object") {
    errors.push(".workflow/continuous-improvement/state.json activeWorkflow must be null or an object.");
  }

  if (Array.isArray(data.queue)) {
    data.queue.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        errors.push(`.workflow/continuous-improvement/state.json queue[${index}] must be an object.`);
        return;
      }
      for (const field of ["id", "title", "status"]) {
        if (typeof item[field] !== "string" || item[field].trim() === "") {
          errors.push(`.workflow/continuous-improvement/state.json queue[${index}].${field} must be a non-empty string.`);
        }
      }
    });
  }

  return { errors, warnings };
}

function extractMarkdownLinks(markdown) {
  const links = [];
  const pattern = /!?\[[^\]]*]\(([^)]+)\)/g;
  let match;

  while ((match = pattern.exec(markdown)) !== null) {
    const raw = match[1].trim();
    if (!raw) {
      continue;
    }
    const target = raw.split(/\s+/)[0].replace(/^<|>$/g, "");
    links.push(target);
  }

  return links;
}

function isExternalLink(link) {
  return /^(https?:|mailto:|tel:|#)/i.test(link);
}

function stripAnchorAndQuery(link) {
  return link.split("#")[0].split("?")[0];
}

function validateWiki(target) {
  const targetRoot = resolveTarget(target);
  const wikiRoot = path.join(targetRoot, "docs", "wiki");
  const errors = [];
  const warnings = [];

  if (!pathExists(wikiRoot)) {
    return { target: targetRoot, errors: ["docs/wiki directory is missing."], warnings };
  }

  const markdownFiles = walkFiles(wikiRoot).filter((filePath) => filePath.toLowerCase().endsWith(".md"));
  if (markdownFiles.length === 0) {
    errors.push("docs/wiki has no markdown files.");
  }

  const indexPath = path.join(wikiRoot, "index.md");
  if (!pathExists(indexPath)) {
    errors.push("docs/wiki/index.md is missing.");
  }

  for (const filePath of markdownFiles) {
    const content = readText(filePath);
    const relativePath = relativeSlash(targetRoot, filePath);
    const fileDir = path.dirname(filePath);
    for (const link of extractMarkdownLinks(content)) {
      if (isExternalLink(link)) {
        continue;
      }
      const withoutAnchor = stripAnchorAndQuery(link);
      if (!withoutAnchor) {
        continue;
      }
      const resolved = path.resolve(fileDir, withoutAnchor);
      if (!pathExists(resolved)) {
        errors.push(`${relativePath} links to missing ${link}.`);
      }
    }

    if (WIKI_CONTEXT_STARTER_FILES.has(relativePath) && !hasSectionWithBody(content, "Unknowns / Needs Confirmation")) {
      warnings.push(`${relativePath} is missing an Unknowns / Needs Confirmation section.`);
    }
  }

  return { target: targetRoot, errors, warnings };
}

function detectCommands(targetRoot, parseIssues = []) {
  const commands = [];
  const packageJsonPath = path.join(targetRoot, "package.json");
  if (pathExists(packageJsonPath)) {
    try {
      const packageJson = readJson(packageJsonPath);
      for (const [name, command] of Object.entries(packageJson.scripts || {})) {
        commands.push({ source: "package.json", name, command });
      }
    } catch (error) {
      parseIssues.push({ source: "package.json", message: error.message });
    }
  }

  for (const fileName of ["Makefile", "makefile"]) {
    if (pathExists(path.join(targetRoot, fileName))) {
      commands.push({ source: fileName, name: "make", command: "make <target>" });
      break;
    }
  }

  return commands;
}

function detectToolingEvidence(targetRoot) {
  const candidates = [
    { source: "package-lock.json", name: "npm" },
    { source: "npm-shrinkwrap.json", name: "npm" },
    { source: "pnpm-lock.yaml", name: "pnpm" },
    { source: "yarn.lock", name: "yarn" },
    { source: "bun.lock", name: "bun" },
    { source: "bun.lockb", name: "bun" },
    { source: "pyproject.toml", name: "python" },
    { source: "requirements.txt", name: "python" }
  ];

  return candidates.filter((candidate) => pathExists(path.join(targetRoot, candidate.source)));
}

function addCandidateCommand(candidateCommands, command) {
  if (!candidateCommands.some((candidate) => candidate.command === command.command)) {
    candidateCommands.push(command);
  }
}

function fileContains(targetRoot, relativePath, pattern) {
  const filePath = path.join(targetRoot, relativePath);
  return pathExists(filePath) && pattern.test(readText(filePath));
}

function detectCandidateCommands(targetRoot, toolingEvidence = []) {
  const candidateCommands = [];
  const hasPythonEvidence = toolingEvidence.some((item) => item.name === "python");
  if (!hasPythonEvidence) {
    return candidateCommands;
  }

  const hasTestsDirectory = pathExists(path.join(targetRoot, "tests")) || pathExists(path.join(targetRoot, "test"));
  const hasPytestEvidence =
    hasTestsDirectory ||
    pathExists(path.join(targetRoot, "pytest.ini")) ||
    fileContains(targetRoot, "requirements.txt", /^pytest(?:[<>=~! ]|$)/im) ||
    fileContains(targetRoot, "pyproject.toml", /\[tool\.pytest/i);
  const hasRuffEvidence =
    fileContains(targetRoot, "requirements.txt", /^ruff(?:[<>=~! ]|$)/im) ||
    fileContains(targetRoot, "pyproject.toml", /\[tool\.ruff/i);

  if (hasPytestEvidence) {
    addCandidateCommand(candidateCommands, {
      source: hasTestsDirectory ? "tests/" : "python tooling evidence",
      name: "pytest",
      command: "python -m pytest",
      confidence: "candidate",
      reason: "Python test evidence was found, but the command must be confirmed by the project owner."
    });
  }

  if (hasRuffEvidence) {
    addCandidateCommand(candidateCommands, {
      source: "python tooling evidence",
      name: "ruff",
      command: "python -m ruff check .",
      confidence: "candidate",
      reason: "Ruff evidence was found, but lint settings and scope must be confirmed by the project owner."
    });
  }

  if (candidateCommands.length === 0) {
    addCandidateCommand(candidateCommands, {
      source: "python tooling evidence",
      name: "pytest",
      command: "python -m pytest",
      confidence: "candidate",
      reason: "Python project files were found, but no explicit verification command was declared."
    });
  }

  return candidateCommands;
}

function isLikelyDocumentation(relativePath) {
  const normalized = relativePath.toLowerCase();
  return (
    normalized === "readme.md" ||
    normalized === "agents.md" ||
    normalized === "claude.md" ||
    normalized.startsWith("docs/") ||
    normalized.endsWith(".md")
  );
}

function listProjectDocs(targetRoot) {
  return walkProjectFiles(targetRoot)
    .map((filePath) => relativeSlash(targetRoot, filePath))
    .filter((relativePath) => {
      const normalized = relativePath.toLowerCase();
      if (isIgnoredAuditPath(normalized)) {
        return false;
      }
      return isLikelyDocumentation(relativePath);
    })
    .sort();
}

function isWikiLike(relativePath) {
  const normalized = relativePath.toLowerCase();
  return (
    normalized.includes("wiki") ||
    normalized.startsWith("docs/") ||
    normalized.includes("architecture") ||
    normalized.includes("runbook") ||
    normalized.includes("progress") ||
    normalized.includes("handoff")
  );
}

function buildSuggestedPatches(conflicts) {
  return conflicts.map((file) => ({
    file,
    requiresApproval: true,
    reason: "Existing project instruction file must be merged by a human.",
    suggestion: "Review the Harness template and add a link to docs/wiki/index.md if appropriate."
  }));
}

function buildAuditUnknowns(commands, toolingEvidence = [], parseIssues = [], candidateCommands = []) {
  const unknowns = [];
  if (commands.length === 0) {
    unknowns.push("No package, test, build, or verification command detected.");
  }

  for (const issue of parseIssues) {
    unknowns.push(`${issue.source} could not be parsed: ${issue.message}`);
  }

  if (commands.length === 0 && toolingEvidence.length > 0) {
    const sources = toolingEvidence.map((item) => item.source).join(", ");
    unknowns.push(`Tooling evidence found (${sources}), but the exact verification command is unknown.`);
  }

  if (candidateCommands.length > 0) {
    unknowns.push("Python candidate verification commands require confirmation before being treated as project commands.");
  }

  return unknowns;
}

function buildNextSafeCommand(targetRoot) {
  return `node scripts/harness.js audit --target ${JSON.stringify(targetRoot)} --json`;
}

function auditProject(target) {
  const targetRoot = resolveTarget(target);
  const existing = [];
  const missing = [];

  for (const relativePath of REQUIRED_HARNESS_FILES) {
    if (pathExists(path.join(targetRoot, relativePath))) {
      existing.push(relativePath);
    } else {
      missing.push(relativePath);
    }
  }

  const agentDocs = ["AGENTS.md", "CLAUDE.md", ".cursorrules", ".windsurfrules"].filter((fileName) =>
    pathExists(path.join(targetRoot, fileName))
  );

  const conflicts = agentDocs.filter((fileName) => ["AGENTS.md", "CLAUDE.md"].includes(fileName));
  const docs = listProjectDocs(targetRoot);
  const wikiLikeFiles = docs.filter(isWikiLike);
  const parseIssues = [];
  const commands = detectCommands(targetRoot, parseIssues);
  const toolingEvidence = detectToolingEvidence(targetRoot);
  const candidateCommands = detectCandidateCommands(targetRoot, toolingEvidence);
  const unknowns = buildAuditUnknowns(commands, toolingEvidence, parseIssues, candidateCommands);

  return {
    target: targetRoot,
    readOnly: true,
    existing,
    missing,
    agentDocs,
    docs,
    wikiLikeFiles,
    commands,
    candidateCommands,
    toolingEvidence,
    parseIssues,
    conflicts,
    suggestedAdditions: missing,
    suggestedPatches: buildSuggestedPatches(conflicts),
    untouchedFiles: conflicts,
    unknowns,
    nextSafeCommand: buildNextSafeCommand(targetRoot)
  };
}

function fileMentionsWiki(filePath) {
  if (!pathExists(filePath)) {
    return false;
  }
  return /docs[\\/]+wiki|docs\/wiki|Project Wiki|wiki\/index/i.test(readText(filePath));
}

function hasNextAction(filePath) {
  if (!pathExists(filePath)) {
    return false;
  }
  const content = readText(filePath);
  const body = getSectionBody(content, "Next Action") ?? getSectionBody(content, "Next Actions");
  if (!body) {
    return false;
  }

  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => {
      if (line === "" || /^<!--.*-->$/.test(line)) {
        return false;
      }
      const normalized = line.replace(/^[-*]\s+/, "").replace(/\.$/, "").trim();
      return !/^(none|n\/a|tbd|todo|pending|no next actions?(?: is| are)? recorded(?: here)?)$/i.test(normalized);
    });
}

function hasVerificationCommand(targetRoot) {
  const verificationPath = path.join(targetRoot, "docs", "wiki", "engineering", "verification.md");
  if (!pathExists(verificationPath)) {
    return false;
  }
  const content = readText(verificationPath);
  return /```(?:sh|bash|powershell|ps1|cmd)?\s*[\r\n]+[^`]+```/i.test(content);
}

function getSectionBody(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const headingPattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start === -1) {
    return null;
  }

  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      break;
    }
    body.push(lines[index]);
  }

  return body.join("\n");
}

function hasSectionWithBody(markdown, heading) {
  const body = getSectionBody(markdown, heading);
  return body !== null && body.trim().length > 0;
}

function validateHandoff(target) {
  const targetRoot = resolveTarget(target);
  const handoffPath = path.join(targetRoot, "session-handoff.md");
  const errors = [];
  const warnings = [];

  if (!pathExists(handoffPath)) {
    return { target: targetRoot, errors: ["session-handoff.md is missing."], warnings };
  }

  const content = readText(handoffPath);
  for (const section of REQUIRED_HANDOFF_SECTIONS) {
    if (!hasSectionWithBody(content, section)) {
      errors.push(`session-handoff.md must include a non-empty ${section} section.`);
    }
  }

  return { target: targetRoot, errors, warnings };
}

function loadManifest(pluginRoot, relativePath, errors) {
  const manifestPath = path.join(pluginRoot, relativePath);
  if (!pathExists(manifestPath)) {
    errors.push(`Missing required manifest: ${relativePath}`);
    return null;
  }

  try {
    const payload = readJson(manifestPath);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      errors.push(`${relativePath} must contain a JSON object.`);
      return null;
    }
    return payload;
  } catch (error) {
    errors.push(`${relativePath} must contain valid JSON: ${error.message}`);
    return null;
  }
}

function requireManifestString(manifest, relativePath, field, errors) {
  const value = field.split(".").reduce((current, key) => (current && current[key] !== undefined ? current[key] : undefined), manifest);
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${relativePath} field ${field} must be a non-empty string.`);
    return null;
  }
  return value;
}

function validateSkillsPath(pluginRoot, manifestDir, relativePath, rawSkillsPath, errors) {
  if (typeof rawSkillsPath !== "string" || rawSkillsPath.trim() === "") {
    errors.push(`${relativePath} field skills must be a non-empty string.`);
    return;
  }

  const candidates = [
    path.resolve(pluginRoot, rawSkillsPath),
    path.resolve(manifestDir, rawSkillsPath)
  ];
  if (!candidates.some(pathExists)) {
    errors.push(`${relativePath} skills path does not exist: ${rawSkillsPath}`);
  }
}

function validateCommonManifest(pluginRoot, relativePath, manifest, errors) {
  const manifestDir = path.dirname(path.join(pluginRoot, relativePath));
  requireManifestString(manifest, relativePath, "name", errors);
  const version = requireManifestString(manifest, relativePath, "version", errors);
  if (version && !SEMVER_PATTERN.test(version)) {
    errors.push(`${relativePath} field version must be semver.`);
  }
  requireManifestString(manifest, relativePath, "description", errors);
  requireManifestString(manifest, relativePath, "author.name", errors);
  validateSkillsPath(pluginRoot, manifestDir, relativePath, manifest.skills, errors);
}

function validateCodexManifest(pluginRoot, manifest, errors) {
  const relativePath = ".codex-plugin/plugin.json";
  validateCommonManifest(pluginRoot, relativePath, manifest, errors);

  if (!manifest.interface || typeof manifest.interface !== "object" || Array.isArray(manifest.interface)) {
    errors.push(`${relativePath} field interface must be an object.`);
    return;
  }

  for (const field of ["displayName", "shortDescription", "longDescription", "developerName", "category"]) {
    requireManifestString(manifest, relativePath, `interface.${field}`, errors);
  }

  if (!Array.isArray(manifest.interface.capabilities) || manifest.interface.capabilities.some((value) => typeof value !== "string")) {
    errors.push(`${relativePath} field interface.capabilities must be an array of strings.`);
  }

  if (typeof manifest.interface.defaultPrompt !== "string" && typeof manifest.interface.default_prompt !== "string") {
    errors.push(`${relativePath} field interface.defaultPrompt or interface.default_prompt must be a non-empty string.`);
  }
}

function validateManifests(target) {
  const pluginRoot = resolveTarget(target);
  const errors = [];
  const warnings = [];

  const codexManifest = loadManifest(pluginRoot, ".codex-plugin/plugin.json", errors);
  const claudeManifest = loadManifest(pluginRoot, ".claude-plugin/plugin.json", errors);

  if (codexManifest) {
    validateCodexManifest(pluginRoot, codexManifest, errors);
  }
  if (claudeManifest) {
    validateCommonManifest(pluginRoot, ".claude-plugin/plugin.json", claudeManifest, errors);
  }

  return { target: pluginRoot, errors, warnings };
}

function classifyTarget(target) {
  const targetRoot = resolveTarget(target);
  const evidence = [];

  if (
    pathExists(path.join(targetRoot, "SPEC.md")) &&
    pathExists(path.join(targetRoot, "ROADMAP.md")) &&
    pathExists(path.join(targetRoot, "scripts", "harness.js")) &&
    pathExists(path.join(targetRoot, "templates"))
  ) {
    evidence.push("SPEC.md", "ROADMAP.md", "scripts/harness.js", "templates/");
    return { type: "product-repo", evidence };
  }

  for (const relativePath of MINIMUM_HARNESS_FILES) {
    if (pathExists(path.join(targetRoot, relativePath))) {
      evidence.push(relativePath);
    }
  }

  if (evidence.length > 0) {
    return { type: "harnessed-target-repo", evidence };
  }

  return { type: "unharnessed-target-repo", evidence };
}

function validateWorkflowPackData(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { errors: ["Workflow pack must contain an object."], warnings };
  }

  for (const field of ["id", "title", "version"]) {
    if (typeof data[field] !== "string" || data[field].trim() === "") {
      errors.push(`Workflow pack field ${field} must be a non-empty string.`);
    }
  }

  if (typeof data.version === "string" && !SEMVER_PATTERN.test(data.version)) {
    errors.push("Workflow pack version must be semver.");
  }

  if (!Array.isArray(data.steps) || data.steps.length === 0) {
    errors.push("Workflow pack steps must contain at least one step.");
  } else {
    data.steps.forEach((step, index) => {
      const prefix = `Workflow pack steps[${index}]`;
      if (!step || typeof step !== "object" || Array.isArray(step)) {
        errors.push(`${prefix} must be an object.`);
        return;
      }
      for (const field of ["id", "title", "kind"]) {
        if (typeof step[field] !== "string" || step[field].trim() === "") {
          errors.push(`${prefix}.${field} must be a non-empty string.`);
        }
      }
      if (step.execute === true || step.run !== undefined || step.command !== undefined || step.script !== undefined) {
        errors.push(`${prefix} must not declare executable scripts in smoke validation.`);
      }
    });
  }

  for (const field of ["skills", "standards", "externalIntegrations"]) {
    if (data[field] !== undefined && !Array.isArray(data[field])) {
      errors.push(`Workflow pack ${field} must be an array when present.`);
    }
  }

  return { errors, warnings };
}

function validateWorkflowPackReferences(packPath, data) {
  const errors = [];
  const standards = new Set(discoverStandards().map((standard) => standard.id));

  for (const skill of data.skills || []) {
    if (typeof skill !== "string" || skill.trim() === "") {
      errors.push("Workflow pack skills must be non-empty strings.");
      continue;
    }
    const skillPath = path.join(REPO_ROOT, "skills", skill, "SKILL.md");
    if (!pathExists(skillPath)) {
      errors.push(`Workflow pack references missing skill: skills/${skill}/SKILL.md.`);
    }
  }

  for (const standard of data.standards || []) {
    if (!standards.has(standard)) {
      errors.push(`Workflow pack references missing standard: ${standard}.`);
    }
  }

  const declaredIntegrations = new Set(data.externalIntegrations || []);
  for (const step of data.steps || []) {
    if (step && typeof step === "object" && typeof step.externalIntegration === "string") {
      if (!declaredIntegrations.has(step.externalIntegration)) {
        errors.push(`Workflow pack step ${step.id || "(unknown)"} uses undeclared external integration ${step.externalIntegration}.`);
      }
    }
  }

  return errors;
}

function inspectWorkflowPack(filePath) {
  const packPath = path.resolve(filePath);
  const errors = [];
  const warnings = [];
  let data = null;

  try {
    data = readJson(packPath);
  } catch (error) {
    return {
      file: packPath,
      errors: [`Cannot read workflow pack: ${error.message}`],
      warnings,
      execution: { executesAnything: false }
    };
  }

  const validation = validateWorkflowPackData(data);
  errors.push(...validation.errors);
  warnings.push(...validation.warnings);
  errors.push(...validateWorkflowPackReferences(packPath, data));

  return {
    file: packPath,
    errors,
    warnings,
    pack: {
      id: data.id,
      title: data.title,
      version: data.version,
      stepCount: Array.isArray(data.steps) ? data.steps.length : 0
    },
    execution: {
      executesAnything: false,
      reason: "V1.5 smoke inspection reads declarative pack metadata only."
    },
    dryRun: {
      summary: "This inspection explains the workflow without dispatching workers, executing scripts, or calling external systems.",
      steps: Array.isArray(data.steps)
        ? data.steps.map((step) => ({ id: step.id, title: step.title, kind: step.kind }))
        : [],
      stopConditions: ["missing approval", "unsafe script declaration", "undeclared external integration"]
    }
  };
}

function validateProjectProfileData(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { errors: ["Project profile must contain an object."], warnings };
  }

  for (const field of ["id", "title", "version"]) {
    if (typeof data[field] !== "string" || data[field].trim() === "") {
      errors.push(`Project profile field ${field} must be a non-empty string.`);
    }
  }

  if (typeof data.version === "string" && !SEMVER_PATTERN.test(data.version)) {
    errors.push("Project profile version must be semver.");
  }

  if (!Array.isArray(data.packIds) || data.packIds.length === 0) {
    errors.push("Project profile packIds must contain at least one pack id.");
  } else if (data.packIds.some((packId) => typeof packId !== "string" || packId.trim() === "")) {
    errors.push("Project profile packIds must be non-empty strings.");
  }

  if (data.standards !== undefined && !Array.isArray(data.standards)) {
    errors.push("Project profile standards must be an array when present.");
  }

  if (data.environment !== undefined && (!data.environment || typeof data.environment !== "object" || Array.isArray(data.environment))) {
    errors.push("Project profile environment must be an object when present.");
  }

  return { errors, warnings };
}

function inspectProjectProfile(filePath) {
  const profilePath = path.resolve(filePath);
  const errors = [];
  const warnings = [];
  let data = null;

  try {
    data = readJson(profilePath);
  } catch (error) {
    return {
      file: profilePath,
      errors: [`Cannot read project profile: ${error.message}`],
      warnings
    };
  }

  const validation = validateProjectProfileData(data);
  errors.push(...validation.errors);
  warnings.push(...validation.warnings);
  const standards = new Set(discoverStandards().map((standard) => standard.id));
  for (const standard of data.standards || []) {
    if (!standards.has(standard)) {
      errors.push(`Project profile references missing standard: ${standard}.`);
    }
  }

  return {
    file: profilePath,
    errors,
    warnings,
    profile: {
      id: data.id,
      title: data.title,
      version: data.version,
      packIds: Array.isArray(data.packIds) ? data.packIds : []
    }
  };
}

function hasPluginManifestDirectory(targetRoot) {
  return pathExists(path.join(targetRoot, ".codex-plugin")) || pathExists(path.join(targetRoot, ".claude-plugin"));
}

function doctorProductRepo(targetRoot, classification) {
  const errors = [];
  const warnings = [];
  const productChecks = [];

  if (hasPluginManifestDirectory(targetRoot)) {
    const manifestResult = validateManifests(targetRoot);
    errors.push(...manifestResult.errors);
    warnings.push(...manifestResult.warnings);
    productChecks.push({ name: "plugin-manifests", errors: manifestResult.errors.length, warnings: manifestResult.warnings.length });
  }

  const samplePackPath = path.join(targetRoot, "workflow-packs", "safe-harness-bootstrap.pack.json");
  const sampleProfilePath = path.join(targetRoot, "profiles", "default.profile.json");
  const packResult = inspectWorkflowPack(samplePackPath);
  const profileResult = inspectProjectProfile(sampleProfilePath);
  errors.push(...packResult.errors);
  warnings.push(...packResult.warnings);
  errors.push(...profileResult.errors);
  warnings.push(...profileResult.warnings);
  productChecks.push({ name: "workflow-pack-smoke", errors: packResult.errors.length, warnings: packResult.warnings.length });
  productChecks.push({ name: "project-profile-smoke", errors: profileResult.errors.length, warnings: profileResult.warnings.length });

  return { target: targetRoot, classification, productChecks, errors, warnings };
}

function doctor(target) {
  const targetRoot = resolveTarget(target);
  const classification = classifyTarget(targetRoot);
  if (classification.type === "product-repo") {
    return doctorProductRepo(targetRoot, classification);
  }

  const errors = [];
  const warnings = [];

  for (const relativePath of REQUIRED_HARNESS_FILES) {
    if (!pathExists(path.join(targetRoot, relativePath))) {
      errors.push(`Missing required file: ${relativePath}`);
    }
  }

  const featureResult = validateFeatureListFile(path.join(targetRoot, "feature_list.json"));
  errors.push(...featureResult.errors);
  warnings.push(...featureResult.warnings);

  const continuousImprovementResult = validateContinuousImprovementStateFile(
    path.join(targetRoot, ".workflow", "continuous-improvement", "state.json")
  );
  errors.push(...continuousImprovementResult.errors);
  warnings.push(...continuousImprovementResult.warnings);

  const wikiResult = validateWiki(targetRoot);
  errors.push(...wikiResult.errors);
  warnings.push(...wikiResult.warnings);

  if (!fileMentionsWiki(path.join(targetRoot, "AGENTS.md"))) {
    errors.push("AGENTS.md does not route agents to docs/wiki.");
  }

  if (pathExists(path.join(targetRoot, "CLAUDE.md")) && !fileMentionsWiki(path.join(targetRoot, "CLAUDE.md"))) {
    errors.push("CLAUDE.md does not route agents to docs/wiki.");
  }

  if (!hasVerificationCommand(targetRoot)) {
    errors.push("docs/wiki/engineering/verification.md does not contain a verification command block.");
  }

  if (!hasNextAction(path.join(targetRoot, "PROGRESS.md"))) {
    errors.push("PROGRESS.md does not contain a next action.");
  }

  const handoffResult = validateHandoff(targetRoot);
  errors.push(...handoffResult.errors);
  warnings.push(...handoffResult.warnings);

  if (hasPluginManifestDirectory(targetRoot)) {
    const manifestResult = validateManifests(targetRoot);
    errors.push(...manifestResult.errors);
    warnings.push(...manifestResult.warnings);
  }

  return { target: targetRoot, classification, errors, warnings };
}

function parseArgs(argv) {
  const args = { target: process.cwd(), json: false, dryRun: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") {
      args.target = argv[index + 1];
      index += 1;
    } else if (arg === "--feature") {
      args.feature = argv[index + 1];
      index += 1;
    } else if (arg === "--title") {
      args.title = argv[index + 1];
      index += 1;
    } else if (arg === "--plan") {
      args.plan = argv[index + 1];
      index += 1;
    } else if (arg === "--file") {
      args.file = argv[index + 1];
      index += 1;
    } else if (arg === "--task") {
      args.task = argv[index + 1];
      index += 1;
    } else if (arg === "--worker") {
      args.worker = argv[index + 1];
      index += 1;
    } else if (arg === "--reviewer") {
      args.reviewer = argv[index + 1];
      index += 1;
    } else if (arg === "--backend") {
      args.backend = argv[index + 1];
      index += 1;
    } else if (arg === "--concurrency") {
      args.concurrency = argv[index + 1];
      index += 1;
    } else if (arg === "--decision") {
      args.decision = argv[index + 1];
      index += 1;
    } else if (arg === "--evidence") {
      args.evidence = argv[index + 1];
      index += 1;
    } else if (arg === "--version") {
      args.version = argv[index + 1];
      index += 1;
    } else if (arg === "--preset") {
      args.preset = argv[index + 1];
      index += 1;
    } else if (arg === "--registry") {
      args.registry = argv[index + 1];
      index += 1;
    } else if (arg === "--output") {
      args.output = argv[index + 1];
      index += 1;
    } else if (arg === "--output-dir") {
      args.outputDir = argv[index + 1];
      index += 1;
    } else if (arg === "--report") {
      args.report = argv[index + 1];
      index += 1;
    } else if (arg === "--base") {
      args.base = argv[index + 1];
      index += 1;
    } else if (arg === "--head") {
      args.head = argv[index + 1];
      index += 1;
    } else if (arg === "--index") {
      args.index = argv[index + 1];
      index += 1;
    } else if (arg === "--reports-dir") {
      args.reportsDir = argv[index + 1];
      index += 1;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--confirm") {
      args.confirm = true;
    } else if (arg === "--summary") {
      args.summary = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      args._ = args._ || [];
      args._.push(arg);
    }
  }

  return args;
}

function printAuditSummary(result) {
  console.log(`Audit summary: ${result.target}`);
  console.log(`Read-only: ${result.readOnly}`);
  console.log(`Existing Harness files: ${result.existing.length}`);
  console.log(`Missing Harness files: ${result.missing.length}`);
  console.log(`Suggested additions: ${Array.isArray(result.suggestedAdditions) ? result.suggestedAdditions.length : 0}`);
  console.log(`Existing docs: ${Array.isArray(result.docs) ? result.docs.length : 0}`);
  console.log(`Wiki-like files: ${Array.isArray(result.wikiLikeFiles) ? result.wikiLikeFiles.length : 0}`);
  console.log(`Conflicts: ${Array.isArray(result.conflicts) ? result.conflicts.length : 0}`);

  if (Array.isArray(result.commands) && result.commands.length > 0) {
    console.log("Detected commands:");
    for (const command of result.commands) {
      console.log(`  - ${command.source}: ${command.name} -> ${command.command}`);
    }
  }

  if (Array.isArray(result.candidateCommands) && result.candidateCommands.length > 0) {
    console.log("Candidate commands requiring confirmation:");
    for (const command of result.candidateCommands) {
      console.log(`  - ${command.source}: ${command.name} -> ${command.command}`);
    }
  }

  if (Array.isArray(result.toolingEvidence) && result.toolingEvidence.length > 0) {
    console.log("Tooling evidence:");
    for (const item of result.toolingEvidence) {
      console.log(`  - ${item.source}: ${item.name}`);
    }
  }

  if (Array.isArray(result.unknowns)) {
    console.log("Unknowns:");
    if (result.unknowns.length === 0) {
      console.log("  - none");
    } else {
      for (const item of result.unknowns) {
        console.log(`  - ${item}`);
      }
    }
  }

  if (typeof result.nextSafeCommand === "string") {
    console.log(`Next safe command: ${result.nextSafeCommand}`);
  }
}

function printResult(result, options = {}) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (Array.isArray(result.created)) {
    const skipped = Array.isArray(result.skipped) ? result.skipped : [];
    console.log(`Target: ${result.target}`);
    console.log(`Created: ${result.created.length}`);
    for (const item of result.created) {
      console.log(`  + ${item}`);
    }
    console.log(`Skipped: ${skipped.length}`);
    for (const item of skipped) {
      console.log(`  - ${item}`);
    }
    if (Array.isArray(result.errors)) {
      if (result.errors.length === 0) {
        console.log("Errors: 0");
      } else {
        console.log(`Errors: ${result.errors.length}`);
        for (const error of result.errors) {
          console.log(`  - ${error}`);
        }
      }
    }
    if (Array.isArray(result.warnings) && result.warnings.length > 0) {
      console.log(`Warnings: ${result.warnings.length}`);
      for (const warning of result.warnings) {
        console.log(`  - ${warning}`);
      }
    }
    return;
  }

  if (Array.isArray(result.missing)) {
    if (options.summary) {
      printAuditSummary(result);
      return;
    }
    console.log(`Target: ${result.target}`);
    console.log(`Read-only: ${result.readOnly}`);
    console.log(`Existing Harness files: ${result.existing.length}`);
    console.log(`Missing Harness files: ${result.missing.length}`);
    for (const item of result.missing) {
      console.log(`  - ${item}`);
    }
    if (Array.isArray(result.suggestedAdditions) && result.suggestedAdditions.length > 0) {
      console.log("Suggested additions:");
      for (const item of result.suggestedAdditions) {
        console.log(`  - ${item}`);
      }
    }
    if (result.commands.length > 0) {
      console.log("Detected commands:");
      for (const command of result.commands) {
        console.log(`  - ${command.source}: ${command.name} -> ${command.command}`);
      }
    }
    if (Array.isArray(result.candidateCommands) && result.candidateCommands.length > 0) {
      console.log("Candidate commands requiring confirmation:");
      for (const command of result.candidateCommands) {
        console.log(`  - ${command.source}: ${command.name} -> ${command.command}`);
      }
    }
    if (Array.isArray(result.toolingEvidence) && result.toolingEvidence.length > 0) {
      console.log("Tooling evidence:");
      for (const item of result.toolingEvidence) {
        console.log(`  - ${item.source}: ${item.name}`);
      }
    }
    if (Array.isArray(result.docs) && result.docs.length > 0) {
      console.log("Existing docs:");
      for (const item of result.docs) {
        console.log(`  - ${item}`);
      }
    }
    if (Array.isArray(result.wikiLikeFiles) && result.wikiLikeFiles.length > 0) {
      console.log("Wiki-like files:");
      for (const item of result.wikiLikeFiles) {
        console.log(`  - ${item}`);
      }
    }
    if (Array.isArray(result.suggestedPatches) && result.suggestedPatches.length > 0) {
      console.log("Suggested patches requiring approval:");
      for (const patch of result.suggestedPatches) {
        console.log(`  - ${patch.file}: ${patch.suggestion}`);
      }
    }
    if (Array.isArray(result.unknowns)) {
      console.log("Unknowns:");
      if (result.unknowns.length === 0) {
        console.log("  - none");
      } else {
        for (const item of result.unknowns) {
          console.log(`  - ${item}`);
        }
      }
    }
    if (result.conflicts.length > 0) {
      console.log("Files that will not be touched:");
      for (const item of result.conflicts) {
        console.log(`  - ${item}`);
      }
    }
    if (typeof result.nextSafeCommand === "string") {
      console.log(`Next safe command: ${result.nextSafeCommand}`);
    }
    return;
  }

  if (Array.isArray(result.reports)) {
    console.log(`Reports directory: ${result.reportsDir || "n/a"}`);
    if (result.outputPath) {
      console.log(`Index: ${result.outputPath}`);
    }
    if (result.indexPath) {
      console.log(`Index: ${result.indexPath}`);
    }
    if (typeof result.valid === "boolean") {
      console.log(`Valid: ${result.valid}`);
      console.log(`Index checked: ${result.checkedIndex}`);
    }
    console.log(`Reports: ${result.reports.length}`);
    for (const report of result.reports) {
      console.log(`  - ${report.generatedAt}: ${path.basename(report.file)} -> ${report.target}`);
    }
    if (Array.isArray(result.errors) && result.errors.length > 0) {
      console.log(`Errors: ${result.errors.length}`);
      for (const error of result.errors) {
        console.log(`  - ${error}`);
      }
    } else {
      console.log("Errors: 0");
    }
    if (Array.isArray(result.warnings) && result.warnings.length > 0) {
      console.log(`Warnings: ${result.warnings.length}`);
      for (const warning of result.warnings) {
        console.log(`  - ${warning}`);
      }
    }
    return;
  }

  if (result.base && result.head && result.metrics) {
    console.log(`Base: ${result.base.file}`);
    console.log(`Head: ${result.head.file}`);
    console.log(`Same target: ${result.sameTarget}`);
    if (result.outputPath) {
      console.log(`Diff: ${result.outputPath}`);
    }
    console.log("Metric deltas:");
    for (const metric of Object.values(result.metrics)) {
      console.log(`  - ${metric.label}: ${metric.base ?? "n/a"} -> ${metric.head ?? "n/a"} (${metric.delta ?? "n/a"})`);
    }
    console.log(`Candidate commands added: ${result.candidateCommands.added.length}`);
    console.log(`Unknowns removed: ${result.unknowns.removed.length}`);
    if (Array.isArray(result.errors) && result.errors.length > 0) {
      console.log(`Errors: ${result.errors.length}`);
      for (const error of result.errors) {
        console.log(`  - ${error}`);
      }
    } else {
      console.log("Errors: 0");
    }
    return;
  }

  if (result.report && result.decision && Array.isArray(result.findings)) {
    console.log(`Report: ${result.report.file}`);
    console.log(`Target: ${result.report.target}`);
    console.log(`Decision: ${result.decision}`);
    if (result.outputPath) {
      console.log(`Gate report: ${result.outputPath}`);
    }
    console.log(`Findings: ${result.findings.length}`);
    for (const finding of result.findings) {
      console.log(`  - ${finding.id}: ${finding.message}`);
    }
    if (Array.isArray(result.errors) && result.errors.length > 0) {
      console.log(`Errors: ${result.errors.length}`);
      for (const error of result.errors) {
        console.log(`  - ${error}`);
      }
    } else {
      console.log("Errors: 0");
    }
    return;
  }

  if (result.kind === "adoption-bundle") {
    console.log(`Bundle directory: ${result.outputDir || "n/a"}`);
    console.log(`Target: ${result.target || "n/a"}`);
    console.log(`Latest report: ${result.latestReport || "none"}`);
    console.log(`Gate decision: ${result.gateDecision}`);
    console.log(`Files: ${Array.isArray(result.files) ? result.files.length : 0}`);
    if (Array.isArray(result.files)) {
      for (const file of result.files) {
        console.log(`  - ${file.relativePath}`);
      }
    }
    console.log(`Next safe action: ${result.nextSafeAction}`);
    if (Array.isArray(result.errors) && result.errors.length > 0) {
      console.log(`Errors: ${result.errors.length}`);
      for (const error of result.errors) {
        console.log(`  - ${error}`);
      }
    } else {
      console.log("Errors: 0");
    }
    return;
  }

  if (result.kind === "adoption-status") {
    console.log(`Reports directory: ${result.reportsDir || "n/a"}`);
    console.log(`Reports: ${result.reports.count}`);
    console.log(`Latest report: ${result.latestReport ? result.latestReport.file : "none"}`);
    console.log(`Index checked: ${result.index.checked}`);
    console.log(`Index valid: ${result.index.valid ?? "n/a"}`);
    console.log(`Gate decision: ${result.gate.decision}`);
    if (result.outputPath) {
      console.log(`Status report: ${result.outputPath}`);
    }
    console.log(`Blockers: ${result.blockers.length}`);
    for (const blocker of result.blockers) {
      console.log(`  - ${blocker.id}: ${blocker.message}`);
    }
    console.log(`Next safe action: ${result.nextSafeAction}`);
    if (Array.isArray(result.errors) && result.errors.length > 0) {
      console.log(`Errors: ${result.errors.length}`);
      for (const error of result.errors) {
        console.log(`  - ${error}`);
      }
    } else {
      console.log("Errors: 0");
    }
    return;
  }

  console.log(`Target: ${result.target || "n/a"}`);
  if (result.classification && result.classification.type) {
    console.log(`Target type: ${result.classification.type}`);
  }
  if (Array.isArray(result.productChecks) && result.productChecks.length > 0) {
    console.log("Product checks:");
    for (const check of result.productChecks) {
      console.log(`  - ${check.name}: errors=${check.errors}, warnings=${check.warnings}`);
    }
  }
  if (result.errors.length === 0) {
    console.log("Errors: 0");
  } else {
    console.log(`Errors: ${result.errors.length}`);
    for (const error of result.errors) {
      console.log(`  - ${error}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log(`Warnings: ${result.warnings.length}`);
    for (const warning of result.warnings) {
      console.log(`  - ${warning}`);
    }
  }
}

module.exports = {
  MINIMUM_HARNESS_FILES,
  OPTIONAL_STARTER_WIKI_FILES,
  REQUIRED_HARNESS_FILES,
  REQUIRED_HANDOFF_SECTIONS,
  TEMPLATE_ROOT,
  DEFAULT_TEAM_REGISTRY,
  acceptPlan,
  auditProject,
  bundleAdoptionArtifacts,
  classifyTarget,
  compareAdoptionReports,
  dispatchAgentTask,
  doctor,
  inspectMaintenance,
  inspectTeamDistribution,
  inspectProjectProfile,
  inspectWorkflowPack,
  inspectTaskResult,
  generateAdoptionReport,
  gateAdoptionReport,
  installTeamDistribution,
  listAdoptionReports,
  listTemplateFiles,
  parseArgs,
  pinTeamDistribution,
  proposeMaintenance,
  printResult,
  prepareTaskExecution,
  recordAgentReview,
  reviewPlan,
  rollbackTeamDistribution,
  scaffoldPlan,
  scaffoldHarness,
  scaffoldWiki,
  setAgentDispatchStatus,
  statusAdoptionReports,
  updateTeamDistribution,
  validateContinuousImprovementStateFile,
  validateFeatureListData,
  validateFeatureListFile,
  validateHandoff,
  validateAdoptionReports,
  validateManifests,
  validatePlanGate,
  validateProjectProfileData,
  validateWorkflowPackData,
  writeAdoptionReportsIndex,
  validateWiki
};
