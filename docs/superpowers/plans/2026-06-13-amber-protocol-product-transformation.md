# Amber Protocol Service Package Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing Amber Protocol toolkit into a clearer repo-local AI coding governance console organized around service packages.

**Architecture:** Keep the current repository-local, artifact-first implementation model. The current package is already `amber-protocol`, the primary CLI is already `scripts/amber.js`, and `scripts/harness.js` is a legacy compatibility shim. This plan adds service-package aliases, continuity surfaces, completion checks, and security governance packs without turning Amber Protocol into a live agent runtime or hosted platform.

**Tech Stack:** Node.js CLI, CommonJS modules, JSON schemas, markdown artifacts, `.amber` repo-local state, Node built-in test runner.

---

## Verified Repo Facts

Use these facts as execution constraints:

- Primary package name: `amber-protocol` in `package.json`.
- Primary CLI entrypoint: `scripts/amber.js`.
- Legacy CLI entrypoints: `scripts/harness.js` and `scripts/compat/coding-harness.js`.
- Primary CLI test file: `tests/amber-cli.test.js`.
- Existing session state uses `.amber`; legacy `.harness` remains readable through migration and resolver shims.
- Security scanner modules exist under `src/security/`, but the public `security` CLI route must be verified and wired before product scenarios depend on it.
- Existing glossary already defines `Amber state`, `Legacy Harness state`, and `State spine`; this plan uses `Continuity surface` instead of `Memory surface` to avoid term collision. Verified: neither `Memory surface` nor `Continuity surface` currently exists in `UBIQUITOUS_LANGUAGE.md`, so `Continuity surface` is free to define.
- CLI command gate: `scripts/amber.js` validates the top-level command against a `COMMANDS` allowlist array (around `scripts/amber.js:69`) and rejects unknown commands before dispatch (around `scripts/amber.js:338`). Any brand-new top-level command (for example `security`) MUST be added to `COMMANDS` or it is rejected before its handler runs.
- Real timeline event vocabulary: code emits `session_created`, `session_resumed`, `stage_started`, `stage_completed`, `stage_failed`, `gate_triggered`, `gate_passed`, `gate_failed`, `budget_warning`, `budget_exceeded`, `error`. There is NO `verification_recorded` or `approval_recorded` event anywhere. Completion logic must read the real vocabulary, not invented event names.
- Workflow packs have NO JSON schema under `schemas/`, and `npm run manifests` does NOT validate `workflow-packs/*.pack.json`. The only existing pack (`safe-amber-bootstrap.pack.json`) uses `approvalPolicy` plus nested `loopContracts[].reviewGates`; it has no top-level `gates` field.
- Session manifests are built by `createManifest()` in `scripts/lib/session-manifest.js` (not in `session-commands.js`) and validated by ajv against `schemas/session-manifest.schema.json`. That schema does not set `additionalProperties: false`, so adding a `continuitySurfaces` field is schema-safe.
- Product decision for this plan: service packages are a documentation and navigation grouping only. They are NOT exposed as CLI command aliases. The CLI keeps its existing command names; service packages organize docs, getting-started, and demo narrative.

## Product Definition

Amber Protocol is a repo-local AI coding governance console for engineering teams. It helps teams prepare, review, verify, hand off, and audit AI-assisted coding work inside a repository.

The product must not promise automatic code completion, live multi-agent execution, scheduled external automation, automatic PR creation, or replacement of human review. The product promise is: users can keep using any coding agent, while Amber Protocol records plans, evidence, approvals, verification, and handoff state in the repository.

Primary service packages (these are documentation and navigation groupings over existing CLI commands; they are not new CLI commands):

| Service package | Audience | User outcome | Existing foundation |
| --- | --- | --- | --- |
| Repository Onboarding | Tech leads, project maintainers | New repo has agent-readable rules, wiki, feature state, handoff, and verification surfaces | `init`, `wiki`, `doctor`, templates |
| Adoption Review | Maintainers of existing repos | Old repo gets read-only readiness review and risk bundle before any changes | `audit`, `adoption report`, `adoption bundle`, `adoption gate` |
| Governed Delivery | Reviewers, AI-heavy teams | One coding task moves through plan, gate, review, accept, and completion check with evidence | `plan`, `gate`, `review`, `accept`, governance evidence |
| Continuity Layer | Developers, reviewers, future agents | Long-running work can resume from session state, checkpoints, timeline, handoff, and continuity surfaces | `session`, checkpoint manager, timeline, manifest |
| Security Governance | Security-sensitive teams | AI coding work is checked against dependency, secret, permission, and secure-review controls | `src/security/*`, security docs, governance docs |

## File Responsibility Map

| File or directory | Responsibility in this plan |
| --- | --- |
| `README.md`, `README.zh-CN.md` | User-facing service-package positioning and safe product claims |
| `docs/architecture/overview.md` | Architecture view aligned to the five service packages and existing `amber` CLI paths |
| `SPEC.md` | Non-goals, service package boundary, completion-gate behavior, and security-governance boundary |
| `UBIQUITOUS_LANGUAGE.md` | Canonical terms: service package, governance console, continuity surface, completion gate, evidence bundle, security governance pack |
| `scripts/amber.js` | Primary command routing for the new `security` command, the `session complete-check` completion check, and the `maintenance distill` command. No service-package aliases are added here. |
| `scripts/harness.js` | Legacy shim only; no new primary behavior should be implemented here |
| `scripts/lib/continuity-surfaces.js` | Path-safe helper for continuity files and structured progress entries |
| `scripts/lib/completion-gate.js` | Deterministic evaluator for whether a session has enough evidence to be marked complete |
| `scripts/lib/distill-candidates.js` | Deterministic proposal generator for repeated workflow patterns |
| `scripts/lib/security-commands.js` | CLI orchestration layer for existing `src/security/*` scanners |
| `src/security/audit-report.js` | Existing markdown report generator; add category metadata without changing scanner behavior |
| `workflow-packs/*.pack.json` | Declarative, dry-run-safe governance packs |
| `standards/security-governance.json` | Category names, severity names, required evidence, remediation expectations |
| `tests/amber-cli.test.js` | CLI smoke tests for the primary `amber` entrypoint, including the new `security` and `session complete-check` commands |
| `tests/unit/*.test.js` | Deterministic unit tests for new helper modules |
| `tests/e2e/product-service-packages.test.js` | End-to-end temp-repo validation by service package |

## Task 1: Product Language And Navigation

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/architecture/overview.md`
- Modify: `SPEC.md`
- Modify: `UBIQUITOUS_LANGUAGE.md`
- Test: manual grep checks with `rg`

- [ ] **Step 1.1: Update the product definition in `README.md`.**

> Verified: `README.md` already says "Amber Protocol (formerly Coding Harness)" (around line 45), so this step is mostly confirmation and light tightening, not a rewrite.

Replace any remaining wording that treats Amber Protocol as a future rename from Coding Harness with wording that states the current product is already Amber Protocol:

```markdown
Amber Protocol is a repo-local AI coding governance console for engineering teams. It helps teams prepare, review, verify, hand off, and audit AI-assisted coding work inside a repository.

Legacy `coding-harness` entrypoints remain compatibility shims, but new documentation and commands should lead with `amber` and Amber Protocol terminology.
```

- [ ] **Step 1.2: Add service-package navigation to `README.md` and `README.zh-CN.md`.**

Use this English table in `README.md`:

```markdown
| Service package | Start here | Outcome |
| --- | --- | --- |
| Repository Onboarding | `node scripts/amber.js doctor --target .` | Confirm the repo has agent-facing rules, wiki, feature state, handoff, and verification surfaces. |
| Adoption Review | `node scripts/amber.js adoption report --target . --output-dir docs/examples/adoptions` | Produce read-only readiness evidence before changing an existing repo. |
| Governed Delivery | `node scripts/amber.js plan --target . --feature F001 --title "Small slice"` | Move one task through plan, gate, review, accept, and completion evidence. |
| Continuity Layer | `node scripts/amber.js session start --goal "fix login bug"` | Start or resume work with session, checkpoint, timeline, and continuity-surface references. |
| Security Governance | `node scripts/amber.js security audit --target . --output docs/examples/security-audit.md` | Review dependency, secret, permission, and secure-review evidence. |

These are the real CLI commands; the "Service package" column is a documentation grouping, not a command namespace.
```

Use equivalent Chinese wording in `README.zh-CN.md`, keeping command strings identical.

- [ ] **Step 1.3: Update `docs/architecture/overview.md`.**

Ensure the architecture overview names `scripts/amber.js` and `scripts/lib/amber-core.js` as current paths. Do not introduce `scripts/harness.js` as a primary path.

- [ ] **Step 1.4: Update `UBIQUITOUS_LANGUAGE.md`.**

Add these terms:

```markdown
| Service package | Documentation and navigation grouping of existing CLI commands and artifacts around a complete governance outcome, such as onboarding, adoption review, delivery, continuity, or security governance. Service packages are not CLI commands themselves. | feature bucket, marketing category, CLI command group |
| Governance console | Repository-local command and artifact surface that records plans, evidence, approvals, verification, and handoff state for AI-assisted coding work. | hosted platform, live agent runtime |
| Continuity surface | Repo-local files that help humans and agents resume work without injecting content into a model automatically. | memory when ambiguous, state spine |
| Completion gate | Deterministic report-only check that explains whether a session has enough goal, timeline, verification, approval, and handoff evidence to be treated as complete. | LLM judgement, auto-accept |
| Evidence bundle | Reviewable set of repo-local artifacts that support a decision, such as a gate, adoption review, completion check, or audit. | chat transcript dump |
| Security governance pack | Declarative workflow pack and standard set for dependency, secret, permission, insecure-code, repair-verification, and high-risk-action review. | scanner implementation, exploit framework |
```

- [ ] **Step 1.5: Update `SPEC.md`.**

Add a short section that states service packages are command groupings over existing artifact-first behavior and do not imply hosted execution, external automation, live agent dispatch, or automatic PR creation.

- [ ] **Step 1.6: Run wording checks.**

```sh
rg -n "current package is Coding Harness|general agent platform|auto PR|replace human review" README.md README.zh-CN.md SPEC.md docs
rg -n "repo-local AI coding governance console|Repository Onboarding|Adoption Review|Governed Delivery|Continuity Layer|Security Governance|Continuity surface" README.md README.zh-CN.md docs SPEC.md UBIQUITOUS_LANGUAGE.md
```

Expected result: the first command has no matches except intentional non-goal wording for `auto PR` or `replace human review`; the second command shows the service package names and continuity term in the main docs.

## Task 2: Service Package Documentation Map

**Decision:** Service packages are a documentation and navigation grouping only. They are NOT added as CLI command aliases. The CLI keeps its existing command names. This task documents the mapping so users can navigate by service package while running real commands. There is no `normalizeServicePackageArgs`, no alias tests, and no change to `scripts/amber.js` or `scripts/harness.js` in this task.

**Files:**
- Modify: `docs/api/cli-commands.md`
- (README/README.zh-CN service-package navigation is handled by Task 1.2)

Service package -> existing command mapping (documentation only):

| Service package | Existing commands |
| --- | --- |
| Repository Onboarding | `init`, `doctor`, `wiki` |
| Adoption Review | `adoption report`, `adoption bundle`, `adoption gate` |
| Governed Delivery | `plan`, `gate`, `review`, `accept`, `session complete-check` (new, Task 5) |
| Continuity Layer | `session start`, `session status`, `session continue` |
| Security Governance | `security audit` (new, Task 3), security governance packs (Task 7) |

- [ ] **Step 2.1: Add a "Service packages" section to `docs/api/cli-commands.md`.**

Add the mapping table above with a one-line note that service packages are a navigation grouping over existing commands, not new CLI commands. Where practical, link each row to the existing command's documentation.

- [ ] **Step 2.2: Confirm no CLI behavior changed.**

```sh
node scripts/amber.js --help
npm test -- tests/amber-cli.test.js
```

Expected result: existing CLI help and tests are unchanged. This task introduces no new command. The only new top-level command in this plan is `security` (Task 3), and the only new leaf command is `session complete-check` (Task 5).

## Task 3: Security CLI Wiring

**Files:**
- Create: `scripts/lib/security-commands.js`
- Modify: `scripts/amber.js`
- Modify: `docs/api/cli-commands.md`
- Test: `tests/amber-cli.test.js`
- Test: `tests/security/audit-report.test.js`

Wire the existing security modules into the public CLI before any service-package scenario depends on `security audit`.

> Naming caution: there are TWO `generateAuditReport` functions in this repo — `src/security/audit-report.js` (the security one, used here) and `scripts/lib/core/governance.js` (the governance one, re-exported via `amber-core.js`). They have different signatures and outputs. Import the security one explicitly from `../../src/security/audit-report` and do not confuse it with the governance audit.

- [ ] **Step 3.1: Write failing CLI tests for `security audit --help`.**

Add to `tests/amber-cli.test.js`:

```js
test("security audit command exposes help", () => {
  const result = runHarness(["security", "audit", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /security audit/);
  assert.match(result.stdout, /--target/);
  assert.match(result.stdout, /--output/);
});
```

- [ ] **Step 3.2: Run the focused test and verify it fails.**

```sh
npm test -- tests/amber-cli.test.js
```

Expected result: FAIL because `scripts/amber.js` does not route `security` yet.

- [ ] **Step 3.3: Implement `scripts/lib/security-commands.js`.**

Create a small orchestration module that uses existing scanner output shapes and keeps file writes explicit:

```js
const fs = require("node:fs");
const path = require("node:path");
const { generateAuditReport } = require("../../src/security/audit-report");

function result(text, exitCode = 0, extra = {}) {
  return { text, exitCode, ...extra };
}

function runSecurityAudit(targetRoot, options = {}) {
  const target = path.resolve(targetRoot || ".");
  const depResult = { pass: true, summary: "Dependency scan not executed by CLI wrapper in report-only mode.", vulnerabilities: [] };
  const secretResult = [];
  const permResult = { pass: true, findings: [] };
  const report = generateAuditReport(depResult, secretResult, permResult);

  if (options.output) {
    const outputPath = path.resolve(options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, report);
    return result(`Security audit written: ${outputPath}`, 0, { outputPath, target });
  }

  return result(report, 0, { target });
}

module.exports = { runSecurityAudit };
```

This first CLI wrapper is report-only. The `exitCode` field on the returned object is ignored by the CLI dispatch (exit status is derived from `result.errors.length`); keep it only for direct unit-test assertions. If a later task executes real dependency or filesystem scans and needs to signal failure through the CLI, it must return an `errors` array and add separate tests for side effects and runtime assumptions.

- [ ] **Step 3.4: Register and route `security` in `scripts/amber.js`.**

First add `"security"` to the `COMMANDS` allowlist array (around `scripts/amber.js:69`). Without this, the command is rejected at the validation gate (around `scripts/amber.js:338`) before any handler runs.

Then add a dispatch arm. Read the action from `args._[0]` (the post-`parseArgs` positional), matching how existing two-word commands like `adoption` route. Signal failure with an `errors` array, not an `exitCode` field, because `security` is not one of the early-return commands (`route`, `session`, `migrate`, `daemon`) and its exit status is derived from `result.errors.length`:

```js
} else if (command === "security") {
  const action = args._ && args._[0];
  if (action === "audit") {
    const { runSecurityAudit } = require("./lib/security-commands");
    result = runSecurityAudit(args.target || ".", args);
  } else {
    result = { errors: ["security requires audit."], warnings: [] };
  }
}
```

- [ ] **Step 3.5: Document the current boundary.**

In `docs/api/cli-commands.md`, state that `security audit` currently produces a governance audit report from the security report generator and does not mutate target code.

- [ ] **Step 3.6: Verify.**

```sh
npm test -- tests/amber-cli.test.js tests/security/audit-report.test.js
node scripts/amber.js security audit --target . --output docs/examples/security-audit.md
```

Expected result: command exists, writes a markdown report, and existing security report tests keep passing.

## Task 4: Continuity Surfaces

**Files:**
- Create: `scripts/lib/continuity-surfaces.js`
- Modify: `scripts/lib/session-commands.js`
- Modify: `templates/MEMORY.md`
- Modify: `templates/notes.md`
- Modify: `templates/tasks/README.md`
- Modify: `docs/api/cli-commands.md`
- Test: `tests/unit/continuity-surfaces.test.js`
- Test: `tests/unit/session-commands.test.js`

Add stable artifact paths for continuity without adding a database, hidden model memory, or loop state spine replacement.

Continuity files:

| File | Purpose |
| --- | --- |
| `MEMORY.md` | Durable project knowledge, constraints, and architecture decisions selected by humans |
| `notes.md` | Session-local notes that can be reviewed and promoted |
| `tasks/<id>/progress.md` | Task-specific progress and recovery state |

- [ ] **Step 4.1: Write path-safety tests.**

Create `tests/unit/continuity-surfaces.test.js`:

```js
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ensureContinuitySurfaces, appendTaskProgress } = require("../../scripts/lib/continuity-surfaces");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "amber-continuity-"));
}

test("ensureContinuitySurfaces creates stable repo-local paths idempotently", () => {
  const root = tempRoot();
  const first = ensureContinuitySurfaces(root);
  const second = ensureContinuitySurfaces(root);
  assert.deepEqual(first, second);
  assert.ok(fs.existsSync(path.join(root, "MEMORY.md")));
  assert.ok(fs.existsSync(path.join(root, "notes.md")));
  assert.ok(fs.existsSync(path.join(root, "tasks", "README.md")));
});

test("appendTaskProgress rejects unsafe task ids", () => {
  const root = tempRoot();
  assert.throws(() => appendTaskProgress(root, "../escape", "bad"), /unsafe task id/);
});
```

- [ ] **Step 4.2: Run tests and verify they fail.**

```sh
npm test -- tests/unit/continuity-surfaces.test.js
```

Expected result: FAIL because `scripts/lib/continuity-surfaces.js` does not exist.

- [ ] **Step 4.3: Implement `scripts/lib/continuity-surfaces.js`.**

```js
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_FILES = {
  memory: "MEMORY.md",
  notes: "notes.md",
  tasksReadme: path.join("tasks", "README.md"),
};

function assertSafeTaskId(taskId) {
  if (!/^[A-Za-z0-9._-]+$/.test(taskId || "")) {
    throw new Error("unsafe task id");
  }
}

function writeIfMissing(filePath, content) {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

function ensureContinuitySurfaces(projectRoot) {
  const root = path.resolve(projectRoot || ".");
  const files = {
    memory: path.join(root, DEFAULT_FILES.memory),
    notes: path.join(root, DEFAULT_FILES.notes),
    tasksReadme: path.join(root, DEFAULT_FILES.tasksReadme),
  };

  writeIfMissing(files.memory, "# Memory\n\nDurable project knowledge selected by humans.\n");
  writeIfMissing(files.notes, "# Notes\n\nSession-local notes awaiting review.\n");
  writeIfMissing(files.tasksReadme, "# Tasks\n\nTask progress files live here.\n");

  return {
    memory: DEFAULT_FILES.memory,
    notes: DEFAULT_FILES.notes,
    tasksReadme: DEFAULT_FILES.tasksReadme.replace(/\\/g, "/"),
  };
}

function appendTaskProgress(projectRoot, taskId, entry) {
  assertSafeTaskId(taskId);
  const root = path.resolve(projectRoot || ".");
  const relativePath = path.join("tasks", taskId, "progress.md");
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${entry.trim()}\n`);
  return relativePath.replace(/\\/g, "/");
}

module.exports = { ensureContinuitySurfaces, appendTaskProgress };
```

- [ ] **Step 4.4: Connect session start.**

In `scripts/lib/session-commands.js`, call `ensureContinuitySurfaces(projectRoot)` during `startSession`. The manifest object is built by `createManifest()` in `scripts/lib/session-manifest.js`, not inline in `session-commands.js`, so attach the returned relative paths the same way `startSession` already adds optional fields like `manifest.worktree` and `manifest.mode` (mutate the manifest after `createManifest` returns, then persist). Store them under `manifest.continuitySurfaces`. Do not read these files into the model context.

> Schema note: `schemas/session-manifest.schema.json` does not set `additionalProperties: false`, so adding `continuitySurfaces` passes ajv validation in `validateManifest`. Do not add it to the schema's `required` list, and do not flip `additionalProperties` to `false`.

- [ ] **Step 4.5: Add starter templates.**

Create or update `templates/MEMORY.md`, `templates/notes.md`, and `templates/tasks/README.md` with short starter text. Keep them generic and repo-local.

- [ ] **Step 4.6: Verify.**

```sh
npm test -- tests/unit/continuity-surfaces.test.js tests/unit/session-commands.test.js
```

Expected result: continuity artifacts are created idempotently and new sessions reference them in manifest metadata.

## Task 5: Completion Gate

**Files:**
- Create: `scripts/lib/completion-gate.js`
- Modify: `scripts/amber.js`
- Modify: `docs/api/cli-commands.md`
- Test: `tests/unit/completion-gate.test.js`
- Test: `tests/amber-cli.test.js`

Add a deterministic completion check that reports whether a session has enough evidence to be treated as complete. Phase 1 is report-only unless `--strict` is passed to a command that explicitly opts in.

Evidence source resolution:

| Input | Source |
| --- | --- |
| Goal | `.amber/sessions/<id>/manifest.json` field `goal` |
| Timeline | `.amber/sessions/<id>/timeline.jsonl` |
| Verification / stage completion | timeline event type `stage_completed` (real, emitted by `execution-engine.js`), or manifest field `completedStages` non-empty |
| Approval or gate status | timeline event type `gate_passed` (real, emitted by `execution-engine.js`), or manifest field `status === "completed"` |
| Handoff evidence | manifest field `handoff.path` or repo file `session-handoff.md` |
| Open blockers | manifest field `blockers` with non-empty open entries |

> Verified event vocabulary: the only completion-relevant timeline events the codebase actually emits are `stage_started`, `stage_completed`, `stage_failed`, `gate_triggered`, `gate_passed`, `gate_failed`. There is NO `verification_recorded` or `approval_recorded` event — do not key the evaluator on those names, or it will report "missing" for every real session while passing on hand-made fixtures. If a future task introduces explicit `verification_recorded`/`approval_recorded` events, extend the evaluator then.

Output:

```json
{
  "status": "pass",
  "reasons": ["goal present", "timeline present"],
  "missing": []
}
```

- [ ] **Step 5.1: Write unit tests for evaluator behavior.**

Create `tests/unit/completion-gate.test.js` with fixture directories for pass, missing verification, missing approval, missing goal, and open blocker cases. Build the timeline fixtures with the REAL event types (`stage_completed`, `gate_passed`), not invented ones, so the tests exercise the same vocabulary the evaluator will see on real sessions.

- [ ] **Step 5.2: Run tests and verify they fail.**

```sh
npm test -- tests/unit/completion-gate.test.js
```

Expected result: FAIL because `scripts/lib/completion-gate.js` does not exist.

- [ ] **Step 5.3: Implement `scripts/lib/completion-gate.js`.**

Export:

```js
function evaluateCompletion(projectRoot, sessionId, options = {}) {}
module.exports = { evaluateCompletion };
```

The function must return `{ status, reasons, missing }`, must read only repo-local files, and must not call an LLM or external command.

- [ ] **Step 5.4: Add CLI command `session complete-check`.**

There are no service-package aliases (see Task 2), so register this as a real leaf under the existing `session` command. `session` is already in `COMMANDS` and already dispatches sub-actions from `args._[0]`, so add a `complete-check` action alongside `start`/`status`:

```sh
node scripts/amber.js session complete-check --session <id> --target .
```

In the `session` dispatch arm, when `args._[0] === "complete-check"`, call `evaluateCompletion(args.target, args.session, args)` and adapt its `{ status, reasons, missing }` output to the CLI result contract. The CLI derives exit status from `result.errors.length`, so only map a failing check into `errors` when `--strict` is passed; otherwise it stays report-only:

```js
const evalResult = evaluateCompletion(args.target, args.session, args);
const failing = args.strict && evalResult.status !== "pass";
result = {
  text: formatCompletion(evalResult),
  errors: failing ? evalResult.missing : [],
  warnings: evalResult.status !== "pass" ? evalResult.missing : [],
};
```

- [ ] **Step 5.5: Add acceptance wiring in report-only mode.**

When `accept` runs, print completion-gate status if `--session <id>` is provided. Do not block legacy `accept` unless `--strict` is passed.

- [ ] **Step 5.6: Verify.**

```sh
npm test -- tests/unit/completion-gate.test.js tests/amber-cli.test.js
node scripts/amber.js session complete-check --help
```

Expected result: completion status is explainable, deterministic, and does not require live agent execution.

## Task 6: Distill To Workflow Pack Proposal

**Files:**
- Create: `scripts/lib/distill-candidates.js`
- Modify: `scripts/amber.js`
- Modify: `docs/api/cli-commands.md`
- Create directory if missing: `docs/maintenance/`
- Test: `tests/unit/distill-candidates.test.js`
- Test: `tests/amber-cli.test.js`

Add a reviewable proposal command that finds repeated workflows and proposes reusable artifacts. It must not install or execute workflow packs.

Command:

```sh
node scripts/amber.js maintenance distill --target . --output docs/maintenance/distill-proposals.md
```

Candidate sources:

- Repeated plan headings under `docs/superpowers/plans/`
- Repeated gate failures in generated gate reports
- Repeated review findings under `docs/reviews/`
- Repeated adoption next-actions under `docs/examples/`
- Repeated maintenance proposals under `.amber/maintenance/` when present

- [ ] **Step 6.1: Write fixture-based tests.**

Create `tests/unit/distill-candidates.test.js` with two repeated findings and one non-repeated finding. Assert only repeated findings become candidates.

- [ ] **Step 6.2: Run tests and verify they fail.**

```sh
npm test -- tests/unit/distill-candidates.test.js
```

Expected result: FAIL because `scripts/lib/distill-candidates.js` does not exist.

- [ ] **Step 6.3: Implement candidate extraction.**

Export:

```js
function findDistillCandidates(projectRoot, options = {}) {}
function writeDistillProposal(projectRoot, outputPath, options = {}) {}
module.exports = { findDistillCandidates, writeDistillProposal };
```

Use deterministic text matching and a default frequency threshold of `2`.

- [ ] **Step 6.4: Add CLI route.**

Route `maintenance distill` in `scripts/amber.js`. Ensure `docs/maintenance/` is created only when `--output` points there.

- [ ] **Step 6.5: Verify.**

```sh
npm test -- tests/unit/distill-candidates.test.js tests/amber-cli.test.js
node scripts/amber.js maintenance distill --target . --output docs/maintenance/distill-proposals.md
```

Expected result: repeated work patterns become reviewable proposals, not automatic changes.

## Task 7: Security Governance Packs

**Files:**
- Create: `workflow-packs/security-audit.pack.json`
- Create: `workflow-packs/secure-code-review.pack.json`
- Create: `workflow-packs/vuln-repair-verification.pack.json`
- Create: `standards/security-governance.json`
- Modify: `src/security/audit-report.js`
- Modify: `docs/api/cli-commands.md`
- Test: `tests/unit/security-governance-packs.test.js`
- Test: `tests/security/audit-report.test.js`

Extend the security story from a report generator and scanner modules into declarative governance packages.

Security categories:

- Dependency vulnerability review
- Secret exposure review
- Permission surface review
- Insecure code generation review
- Vulnerability repair verification
- High-risk agent action review

- [ ] **Step 7.1: Write pack validation tests.**

Match the shape of the existing pack (`workflow-packs/safe-amber-bootstrap.pack.json`), which uses `approvalPolicy` and nested `loopContracts[].reviewGates` — there is NO top-level `gates` field, and there is NO pack JSON schema under `schemas/`. Assert each new pack has:

- `id`
- `title`
- semver `version`
- one or more `steps`
- an `approvalPolicy` object (report-only / read-only posture, no auto-execution)
- review gates expressed the same way the existing pack does (nested under a loop/review contract, not a new top-level `gates` field)
- explicit non-execution boundary text
- `standards` referencing `security-governance` (the existing pack references standards by id in a `standards` array, e.g. `["amber-delivery"]`)

- [ ] **Step 7.2: Add `standards/security-governance.json`.**

Define category names, severity names, required evidence, and remediation expectations. Keep it declarative.

- [ ] **Step 7.3: Add workflow packs.**

Create three dry-run-safe packs:

- `workflow-packs/security-audit.pack.json`
- `workflow-packs/secure-code-review.pack.json`
- `workflow-packs/vuln-repair-verification.pack.json`

- [ ] **Step 7.4: Update audit report metadata.**

In `src/security/audit-report.js`, add a "Governance Categories" or metadata section that labels dependency, secret, and permission sections with security-governance categories. Do not change existing dependency, secret, or permission scan behavior.

> Test-safety note: `tests/security/audit-report.test.js` asserts `!report.includes("FAIL")` in the all-pass case. Do NOT let the new category labels or status text contain the literal substring `FAIL` (even inside a word) on the passing path, or that test breaks.

- [ ] **Step 7.5: Verify.**

```sh
npm test -- tests/unit/security-governance-packs.test.js tests/security/audit-report.test.js
```

Expected result: the new packs pass the unit-test validation in `tests/unit/security-governance-packs.test.js`, and existing security audit report behavior remains compatible.

> Note: `npm run manifests` validates `.claude-plugin`/`.codex-plugin` manifests only — it does NOT validate `workflow-packs/*.pack.json`. Pack validation comes from the unit test above, not from `npm run manifests`. Optional follow-up: add `schemas/workflow-pack.schema.json` and wire it into the manifests step if schema-level pack validation is wanted.

## Task 8: Product Experience Validation

**Files:**
- Create: `tests/e2e/product-service-packages.test.js`
- Modify: `docs/release/demo-script.md`
- Modify: `docs/user-guide/getting-started.md`

Validate the end-to-end experience by service package rather than by isolated command names.

Scenarios:

- Repository Onboarding: `init`, `doctor`
- Adoption Review: `adoption report`, `adoption bundle`, `adoption gate`
- Governed Delivery: `plan`, `gate`, `review`, `session complete-check`
- Continuity Layer: `session start`, `session status`
- Security Governance: `security audit`, pack validation

- [ ] **Step 8.1: Write E2E tests using temp repositories.**

Use the existing `spawnSync` pattern from `tests/amber-cli.test.js`. Drive the REAL command names (`init`, `doctor`, `adoption report`, `plan`, `session start`, `session complete-check`, `security audit`); group the test cases by service package for narrative, but do not spawn service-package alias names — those do not exist as CLI commands. Keep commands dry-run or report-only where possible.

- [ ] **Step 8.2: Update demo script.**

Make `docs/release/demo-script.md` walk through the five service packages. Avoid claims that Amber Protocol executes live agents or replaces reviewers.

- [ ] **Step 8.3: Update getting started.**

Lead `docs/user-guide/getting-started.md` with the five service packages as a navigation structure, mapping each service package to the existing CLI commands a user runs (no aliases — service packages are a documentation grouping).

- [ ] **Step 8.4: Verify.**

```sh
npm test -- tests/e2e/product-service-packages.test.js
npm test
```

Expected result: a new user can understand the product through service packages, while existing users can keep using old commands.

## Release Boundary

Phase 1 release includes:

- Product language aligned to the current `amber-protocol` package
- Service package documentation map (navigation grouping over existing commands; no CLI aliases)
- Security CLI wiring for `security audit` (new `security` command, added to `COMMANDS`)
- Continuity surfaces referenced from sessions
- Completion gate (`session complete-check`) in report-only mode
- Distill proposals in report-only mode
- Security governance packs

Phase 1 must not include:

- Live agent execution as a new product promise
- Scheduled loops as a default behavior
- External system updates
- Automatic PR creation
- Automatic workflow-pack installation from distill proposals
- LLM-based completion judgement
- Writing new state to legacy `.harness`
- Service-package CLI command aliases (service packages are a documentation grouping only)

## Full Verification

Run before considering the transformation complete:

```sh
npm test
npm run manifests
npm run doctor
node scripts/amber.js --help
node scripts/amber.js doctor --help
node scripts/amber.js session complete-check --help
node scripts/amber.js security audit --help
node scripts/harness.js doctor --help
```

Expected result: all existing tests pass, the service package documentation map is in place, the two new CLI commands (`security audit`, `session complete-check`) work and are documented, and every new product capability remains repo-local and artifact-first.
