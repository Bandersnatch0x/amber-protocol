# Agentic Engineering Planning Signals Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Objective

Implement the confirmed agentic-engineering lessons as small, testable enhancements to the existing static Harness surfaces:

- V2 `plan` and `gate` should emit and validate durable source/resume fields.
- V2.5 `review` and `accept` should expose human feedback and redirect evidence.
- V5.5 `maintenance propose` should turn repeated delivery findings into reviewable workflow-pack candidate proposals.

Keep the existing safety boundary intact: no live agent dispatch, no remote/email task ingress, no account-bearing CLI automation, no external service calls, and no automatic rewrite of source docs or standards.

## Current Implementation Notes

- `scripts/lib/harness-core.js` owns the relevant functions:
  - `buildPlanContent`
  - `validatePlanGate`
  - `reviewPlan`
  - `acceptPlan`
  - `extractEvolutionFindings`
  - `buildMaintenanceProposalContent`
- V2 tests live in `tests/phase-v2.test.js`.
- V2.5 tests live in `tests/phase-v2-5.test.js`.
- V5.5 tests live in `tests/phase-v5-5.test.js`.
- The full verification command is `npm test`.

## Task 1: Extend Generated Plans With Durable Agent Checkpoint Sections

- [ ] **Step 1: Write the failing test**

  Edit `tests/phase-v2.test.js` in the `plan creates a feature-linked vertical-slice plan without overwriting` test. After the existing assertions for `Feature: F001`, `## Vertical Slices`, and `## Verification`, read the plan content once and assert the new sections and fields:

  ```js
  const content = fs.readFileSync(planPath, "utf8");
  assert.match(content, /## Source Bundle/);
  assert.match(content, /- Type: codebase-finding/);
  assert.match(content, /- Provenance: feature_list\.json/);
  assert.match(content, /- Freshness: current repository state/);
  assert.match(content, /- Confidence: confirmed/);
  assert.match(content, /- Inspection Status: inspected/);
  assert.match(content, /## Reviewer Summary/);
  assert.match(content, /## Resume Checkpoint/);
  assert.match(content, /- Current State: plan drafted/);
  assert.match(content, /- Next Action: obtain user confirmation before implementation/);
  assert.match(content, /- Chat History Required: false/);
  assert.match(content, /## Human Feedback And Redirect Log/);
  ```

- [ ] **Step 2: Run the targeted test and verify it fails**

  ```sh
  node --test tests/phase-v2.test.js
  ```

  Expected result before implementation: the test fails because the generated plan lacks `## Source Bundle`, `## Reviewer Summary`, `## Resume Checkpoint`, and `## Human Feedback And Redirect Log`.

- [ ] **Step 3: Update the plan template**

  Edit `scripts/lib/harness-core.js` in `buildPlanContent`. Insert these sections after `## Goal` and before `## High Level Design`:

  ```md
  ## Source Bundle

  - Type: codebase-finding
  - Source: feature_list.json
  - Provenance: feature_list.json
  - Freshness: current repository state
  - Confidence: confirmed
  - Inspection Status: inspected
  - Notes: generated from the selected feature record

  ## Reviewer Summary

  - User-visible change:
  - Primary risk:
  - Decision needed:

  ## Resume Checkpoint

  - Current State: plan drafted
  - Blockers: user confirmation pending
  - Next Action: obtain user confirmation before implementation
  - Recovery Instructions: run `node scripts/harness.js gate --target <target> --plan <plan> --json`
  - Chat History Required: false

  ## Human Feedback And Redirect Log

  - No redirects recorded yet.
  ```

  Keep `User Confirmation: pending` unchanged so the existing approval gate still blocks implementation.

- [ ] **Step 4: Run the targeted test and verify it passes**

  ```sh
  node --test tests/phase-v2.test.js
  ```

  Expected result after implementation: all V2 tests pass.

- [ ] **Step 5: Commit**

  ```sh
  git add scripts/lib/harness-core.js tests/phase-v2.test.js
  git commit -m "feat: add durable plan checkpoint sections"
  ```

## Task 2: Make Gate Validation Aware Of Source Bundles And Resume Checkpoints

- [ ] **Step 1: Write the failing test**

  Add a new test to `tests/phase-v2.test.js`:

  ```js
  test("gate requires source bundle and resume checkpoint sections", () => {
    const target = tempDir("gate-source-bundle");
    assert.equal(runHarness(["init", "--target", target]).status, 0);
    assert.equal(runHarness(["plan", "--target", target, "--feature", "F001", "--title", "Source bundle"]).status, 0);

    const relativePlan = "docs/plans/F001-source-bundle.md";
    const planPath = path.join(target, relativePlan);
    let content = fs.readFileSync(planPath, "utf8");
    content = content
      .replace(/## Source Bundle[\s\S]*?## Reviewer Summary/, "## Reviewer Summary")
      .replace(/## Resume Checkpoint[\s\S]*?## Human Feedback And Redirect Log/, "## Human Feedback And Redirect Log")
      .replace("User Confirmation: pending", "User Confirmation: confirmed");
    fs.writeFileSync(planPath, content);

    const result = runHarness(["gate", "--target", target, "--plan", relativePlan, "--json"]);

    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.ok(payload.errors.some((error) => /Source Bundle/.test(error)));
    assert.ok(payload.errors.some((error) => /Resume Checkpoint/.test(error)));
  });
  ```

- [ ] **Step 2: Run the targeted test and verify it fails**

  ```sh
  node --test tests/phase-v2.test.js
  ```

  Expected result before implementation: the new test fails because `validatePlanGate` does not require the new sections.

- [ ] **Step 3: Update `validatePlanGate`**

  Edit `scripts/lib/harness-core.js`. In the section list currently containing `High Level Design`, `Vertical Slices`, `Acceptance Criteria`, `Verification`, and `Evidence Schema`, add:

  - `Source Bundle`
  - `Reviewer Summary`
  - `Resume Checkpoint`
  - `Human Feedback And Redirect Log`

  Keep all new section checks as non-empty section checks using the existing `hasSectionWithBody` helper. Do not make freshness or confidence values machine-enforced in this task; the generated template supplies them and review can surface richer checks later.

- [ ] **Step 4: Run the targeted test and verify it passes**

  ```sh
  node --test tests/phase-v2.test.js
  ```

  Expected result after implementation: V2 tests pass, and plans missing source/resume sections are blocked by `gate`.

- [ ] **Step 5: Commit**

  ```sh
  git add scripts/lib/harness-core.js tests/phase-v2.test.js
  git commit -m "feat: validate plan source and resume sections"
  ```

## Task 3: Expose Human Feedback Evidence In Review And Acceptance

- [ ] **Step 1: Write the failing review test**

  In `tests/phase-v2-5.test.js`, update `review passes confirmed plans and accept appends evolution log` after `confirmPlan(target, plan);`. Replace the generated empty feedback entry with concrete human feedback:

  ```js
  const planPath = path.join(target, plan);
  fs.writeFileSync(planPath, fs.readFileSync(planPath, "utf8").replace("- No redirects recorded yet.", [
    "- Decision: approved after narrowing scope to the smallest safe slice.",
    "- Redirect: keep external-service automation out of core Harness."
  ].join("\n")));
  ```

  Then assert both review JSON and evolution log preserve the signal:

  ```js
  const reviewPayload = JSON.parse(review.stdout);
  assert.ok(reviewPayload.humanFeedback.entries.some((entry) => /narrowing scope/.test(entry)));
  assert.ok(reviewPayload.humanFeedback.entries.some((entry) => /external-service automation/.test(entry)));
  assert.match(fs.readFileSync(evolutionPath, "utf8"), /Human feedback:/);
  assert.match(fs.readFileSync(evolutionPath, "utf8"), /narrowing scope/);
  ```

- [ ] **Step 2: Run the targeted test and verify it fails**

  ```sh
  node --test tests/phase-v2-5.test.js
  ```

  Expected result before implementation: the test fails because `reviewPlan` does not return `humanFeedback` and `acceptPlan` does not write human feedback to the evolution log.

- [ ] **Step 3: Add a section extraction helper**

  In `scripts/lib/harness-core.js`, add a helper near `hasSectionWithBody` or near `readPlanField`:

  ```js
  function readPlanSectionLines(content, section) {
    const heading = `## ${section}`;
    const lines = content.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === heading);
    if (start === -1) {
      return [];
    }
    const body = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^##\s+/.test(lines[index])) {
        break;
      }
      body.push(lines[index]);
    }
    return body
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter(Boolean);
  }
  ```

- [ ] **Step 4: Update `reviewPlan`**

  In `reviewPlan`, read the plan content when the plan exists, then include:

  ```js
  humanFeedback: {
    section: "Human Feedback And Redirect Log",
    entries: readPlanSectionLines(content, "Human Feedback And Redirect Log")
  }
  ```

  Preserve the current error behavior. If the plan file is missing, return an empty entries array while keeping the gate errors.

- [ ] **Step 5: Update `acceptPlan`**

  When building the evolution log entry, include a concise feedback block:

  ```md
  - Human feedback:
    - <entry>
  ```

  If there are no entries, write:

  ```md
  - Human feedback: none recorded
  ```

  Keep appending only to `docs/wiki/engineering/harness-evolution.md`; do not modify source docs, standards, or workflow packs.

- [ ] **Step 6: Run the targeted test and verify it passes**

  ```sh
  node --test tests/phase-v2-5.test.js
  ```

  Expected result after implementation: V2.5 tests pass and review JSON contains `humanFeedback.entries`.

- [ ] **Step 7: Commit**

  ```sh
  git add scripts/lib/harness-core.js tests/phase-v2-5.test.js
  git commit -m "feat: preserve human feedback in review"
  ```

## Task 4: Propose Workflow-Pack Candidates From Repeated Findings

- [ ] **Step 1: Write the failing maintenance test**

  In `tests/phase-v5-5.test.js`, extend `maintenance propose writes reviewable gardening proposal without changing source docs`. After the existing assertions for `Suggested Standards Diff`, add:

  ```js
  assert.match(proposal, /Suggested Workflow-Pack Candidates/);
  assert.match(proposal, /missing-rollback-evidence/);
  assert.match(proposal, /No source docs or standards were changed/);
  ```

  Also assert inspect exposes machine-readable candidates:

  ```js
  const inspect = runHarness(["maintenance", "inspect", "--target", target, "--json"]);
  assert.equal(inspect.status, 0, inspect.stderr);
  const inspectPayload = JSON.parse(inspect.stdout);
  assert.ok(inspectPayload.workflowPackCandidates.some((candidate) => candidate.id === "missing-rollback-evidence"));
  ```

- [ ] **Step 2: Run the targeted test and verify it fails**

  ```sh
  node --test tests/phase-v5-5.test.js
  ```

  Expected result before implementation: the test fails because maintenance inspection/proposals do not expose workflow-pack candidates.

- [ ] **Step 3: Add candidate derivation**

  In `scripts/lib/harness-core.js`, add:

  ```js
  function buildWorkflowPackCandidates(evolutionRollup) {
    return evolutionRollup.map((item) => ({
      id: slugify(item.finding),
      title: item.finding,
      occurrences: item.count,
      proposalType: "workflow-pack-candidate",
      reviewRequired: true,
      source: "docs/wiki/engineering/harness-evolution.md"
    }));
  }
  ```

  In `inspectMaintenance`, after `evolutionRollup` is computed, include:

  ```js
  workflowPackCandidates: buildWorkflowPackCandidates(evolutionRollup)
  ```

  Use the already existing `slugify` helper.

- [ ] **Step 4: Update the proposal markdown**

  In `buildMaintenanceProposalContent`, add a section after `## Evolution Rollup` and before `## Suggested Standards Diff`:

  ```md
  ## Suggested Workflow-Pack Candidates

  - missing-rollback-evidence: Missing rollback evidence (2 occurrences)
  ```

  If no repeated findings exist, write:

  ```md
  - No repeated delivery findings to promote into workflow-pack candidates.
  ```

  This is only a proposal. It must not create or modify files under `workflow-packs/`.

- [ ] **Step 5: Run the targeted test and verify it passes**

  ```sh
  node --test tests/phase-v5-5.test.js
  ```

  Expected result after implementation: maintenance tests pass and proposals include workflow-pack candidates without changing source docs or standards.

- [ ] **Step 6: Commit**

  ```sh
  git add scripts/lib/harness-core.js tests/phase-v5-5.test.js
  git commit -m "feat: propose workflow pack candidates"
  ```

## Task 5: Update Public Docs For The Implemented Behavior

- [ ] **Step 1: Write docs after behavior is green**

  Update `README.md` only if command outputs changed beyond the docs already added in the design pass. The README should mention:

  - `plan` emits source bundles and resume checkpoints.
  - `review` returns human feedback entries.
  - `maintenance propose` may include workflow-pack candidate proposals.

- [ ] **Step 2: Update implementation spec if details changed**

  If implementation uses a different section title, JSON field name, or maintenance proposal shape than this plan, update `SPEC.md`, `ROADMAP.md`, and `docs/superpowers/specs/2026-06-09-agentic-engineering-lessons-design.md` to match the shipped behavior.

- [ ] **Step 3: Run docs-relevant verification**

  ```sh
  npm run doctor
  npm run manifests
  ```

  Expected result:

  - `npm run doctor` reports `Errors: 0`.
  - `npm run manifests` reports `Errors: 0`.

- [ ] **Step 4: Commit**

  ```sh
  git add README.md SPEC.md ROADMAP.md docs/superpowers/specs/2026-06-09-agentic-engineering-lessons-design.md
  git commit -m "docs: describe planning signal enhancements"
  ```

## Task 6: Full Verification

- [ ] **Step 1: Run the complete test suite**

  ```sh
  npm test
  ```

  Expected result: all Node tests pass.

- [ ] **Step 2: Run manifest validation**

  ```sh
  npm run manifests
  ```

  Expected result: `Errors: 0`.

- [ ] **Step 3: Run product doctor**

  ```sh
  npm run doctor
  ```

  Expected result: product-repo checks report `Errors: 0`.

- [ ] **Step 4: Inspect generated outputs manually**

  Use a temporary target repository and verify the user-facing artifacts:

  ```sh
  node scripts/harness.js init --target "$TEMP/harness-signals"
  node scripts/harness.js plan --target "$TEMP/harness-signals" --feature F001 --title "Signals smoke"
  node scripts/harness.js gate --target "$TEMP/harness-signals" --plan docs/plans/F001-signals-smoke.md --json
  ```

  Expected result:

  - `plan` writes the new source bundle, reviewer summary, resume checkpoint, and human feedback sections.
  - `gate` blocks until `User Confirmation: confirmed`.
  - After confirmation, `review` returns `humanFeedback.entries`.
  - `maintenance propose` writes a reviewable proposal and does not change source docs, standards, or workflow packs.

- [ ] **Step 5: Final commit if verification changes files**

  ```sh
  git status --short
  git add <only-files-intentionally-changed>
  git commit -m "test: verify planning signal enhancements"
  ```

  Skip this commit when verification produces no tracked file changes.
