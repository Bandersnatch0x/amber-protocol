# Declarative Loop Contract Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the spec-defined live-loop readiness layer without adding live scheduling, daemon work, external writes, or autonomous mutation.

**Architecture:** Build on the current local artifact model in `scripts/lib/harness-core.js`: workflow packs already declare loop contracts, task preparation already writes replayable ledgers, orchestration records already carry loop status, and maintenance already inspects reviewable evidence. The remaining plan adds explicit readiness validation, dry-run/record-only loop commands, connector and approval-policy checks, no-progress detection metadata, and documentation that keeps the execution boundary visible.

**Tech Stack:** Node.js built-ins, `node:test`, JSON artifacts under `.harness/`, existing CLI routing in `scripts/harness.js`, and existing workflow-pack/profile fixtures.

## Objective

Implement the approved Declarative Loop Contract design as artifact-only Harness behavior:

- Workflow packs can declare **Loop contracts** and validate them without scheduling or execution.
- Task **Replay** artifacts can preserve trace-derived failure inputs and **Regression proposals**.
- Agent **Orchestration records** can reference **Loop contracts** and record **Hard stop**, budget, review-bandwidth, and reviewer-gate status.
- Maintenance proposals can promote real failures into reviewable **Regression proposals**.

Do not add a scheduler, cron runner, live subagent runner, external writes, PR automation, account-bearing CLI automation, or automatic trace-derived code/test fixes.

## Current Implementation Map

- Core implementation: `scripts/lib/harness-core.js`
- CLI entrypoint: `scripts/harness.js`
- Workflow pack fixture: `workflow-packs/safe-harness-bootstrap.pack.json`
- Profile fixture: `profiles/default.profile.json`
- V3 tests: `tests/phase-v3.test.js`
- V4 tests: `tests/phase-v4.test.js`
- V4.5 tests: `tests/phase-v4-5.test.js`
- V5.5 tests: `tests/phase-v5-5.test.js`
- Future-readiness tests to add: `tests/phase-future-loop-readiness.test.js`
- Verification scripts: `npm test`, `npm run manifests`, `npm run doctor`

## Current Implementation Baseline

The current repository already implements the first declarative layer this plan originally described:

- `tests/phase-v3.test.js` covers workflow-pack `loopContracts` validation and inspection.
- `tests/phase-v4.test.js` covers task preparation ledgers, evidence packs, trace replay, and regression proposal fields.
- `tests/phase-v4-5.test.js` covers orchestration records with `--loop-contract`, hard-stop status, budget status, review bandwidth, and reviewer gate status.
- `scripts/lib/harness-core.js` already contains `validateLoopContracts`, `describeLoopContracts`, task `ledger.json` generation, evidence inspection, `dispatchAgentTask`, and `recordAgentReview`.
- `SPEC.md` now goes beyond that baseline and requires a future execution-readiness layer: loop ledgers, connector contracts, explicit approval policy, no-progress detection, isolated workspace checks, budget ceilings, reviewer gates, and dry-run/record-only future loop commands.

Treat Tasks 1-4 below as the implemented baseline. Execute Tasks 5-8 to close the gap between the current implementation and the revised spec.

## Domain Language And Architecture Guardrails

Use the domain terms in `UBIQUITOUS_LANGUAGE.md` when naming prose, docs, and test descriptions:

- **Loop contract**: dry-run-safe declaration of a repeated agent workflow.
- **State spine**: durable artifact that records what a loop tried, what passed, what remains, and where to resume.
- **Triage output**: classification produced by discovery work: archive, candidate task, needs-human, blocked, or regression proposal.
- **Hard stop**: loop limit such as maximum iterations, timeout, no-progress detection, or budget ceiling.
- **Integration contract**: declarative connector description; validation must not call the external system.
- **Regression proposal**: reviewable suggestion to turn a real failure into a repeatable assertion or test.
- **Evidence pack**: replayable bundle of task evidence and requirements for inspection.
- **Orchestration record**: artifact-only record of worker assignment, reviewer assignment, status, and reviewer evidence.
- **Review bandwidth**: practical limit on how much candidate work can be trusted because someone must review it.

JSON field names may remain camelCase, such as `stateSpine`, `triageOutputs`, `hardStops`, and `reviewBandwidthStatus`, but user-facing strings and docs should use the canonical terms above. Keep any new implementation behind existing module interfaces where possible; do not widen the CLI interface unless the task explicitly adds a flag.

## Implementation Review Adjustments

This plan was reviewed against the current implementation before execution. Apply these corrections while implementing:

- Current code already has the right extension points, but not the new loop-contract fields. `validateWorkflowPackData`, `inspectWorkflowPack`, `prepareTaskExecution`, `dispatchAgentTask`, `recordAgentReview`, `inspectMaintenance`, and `proposeMaintenance` should be extended in place.
- `parseArgs` lives in `scripts/lib/harness-core.js`; `scripts/harness.js` only routes parsed arguments to commands.
- Task 2 is a prerequisite for Task 4. Maintenance can only promote regression proposals after task evidence files have a stable `regressionProposal` shape.
- Task 3 stores loop status on **Orchestration records** only. It must not imply that Harness executed a loop, scheduled work, dispatched live agents, or coordinated subagents.
- Task 4 must scan existing `.harness/executions/**/evidence.json` files read-only and write only the reviewable maintenance proposal. It must not create regression test files.

Minimum declarative schemas for this implementation:

```js
const LOOP_CONTRACT_STATUS = {
  hardStopStatus: ["not-recorded", "within-limits", "hit-limit"],
  budgetStatus: ["not-recorded", "within-budget", "over-budget"],
  reviewBandwidthStatus: ["not-recorded", "available", "saturated"],
  reviewGateStatus: ["pending", "satisfied", "blocked"]
};

const REGRESSION_PROPOSAL_STATUS = ["proposed"];
```

Keep these values local to `scripts/lib/harness-core.js` unless an existing local pattern already centralizes constants.

Estimated implementation size after this review:

- Lean code-and-tests implementation: 6-8 hours.
- Strict packet isolation, spec review, quality review, docs, and full verification: 8-12 hours.
- Conservative schedule if existing tests expose unrelated fallout: 1 working day.

Recommended packet order:

1. Workflow-pack loop contract validation and inspection.
2. Task replay evidence shape.
3. Orchestration loop status shape.
4. Maintenance regression proposal extraction.
5. Future-loop readiness report and gate.
6. Dry-run/record-only `loop` command surface.
7. Docs, fixtures, and full verification.

## Task 1: Validate Loop Contracts In Workflow Packs

- [x] **Step 1: Write the failing tests**

  Edit `tests/phase-v3.test.js`.

  Add assertions to the existing pack inspect/validate test that the sample pack exposes a loop contract:

  ```js
  assert.equal(payload.pack.loopContracts[0].id, "daily-harness-triage");
  assert.equal(payload.pack.loopContracts[0].execution.executesAnything, false);
  assert.equal(payload.pack.loopContracts[0].hardStops.maxIterations, 3);
  assert.equal(payload.pack.loopContracts[0].hardStops.noProgressDetection, true);
  assert.equal(payload.pack.loopContracts[0].triageOutputs.includes("candidate-task"), true);
  ```

  Add a new invalid-pack fixture inside the test using a temp JSON file:

  ```js
  const badPack = path.join(tempDir("loop-contract"), "bad-loop.pack.json");
  fs.writeFileSync(badPack, JSON.stringify({
    id: "bad-loop",
    title: "Bad Loop",
    version: "1.0.0",
    steps: [{ id: "inspect", title: "Inspect", description: "Inspect only" }],
    loopContracts: [{
      id: "unsafe-loop",
      trigger: { type: "scheduled", cadence: "daily" },
      goal: "Find issues",
      stateSpine: ".harness/loops/unsafe/state.json",
      inputs: ["issues"],
      skills: ["triage"],
      triageOutputs: ["candidate-task"],
      hardStops: { maxIterations: 0, noProgressDetection: false },
      budget: {},
      reviewGates: [],
      execution: { schedulesJobs: true, dispatchesAgents: true, writesExternalSystems: true }
    }]
  }, null, 2));
  const result = runHarness(["pack", "validate", "--file", badPack, "--json"]);
  assert.notEqual(result.status, 0);
  const errors = JSON.parse(result.stdout).errors.join("\n");
  assert.match(errors, /maxIterations/);
  assert.match(errors, /budget/);
  assert.match(errors, /review gate/);
  assert.match(errors, /must not schedule jobs/);
  assert.match(errors, /must not dispatch live agents/);
  assert.match(errors, /must not write external systems/);
  ```

- [x] **Step 2: Run the targeted test and verify it fails**

  ```sh
  node --test tests/phase-v3.test.js
  ```

  Expected result before implementation: the test fails because `loopContracts` are not exposed or validated.

- [x] **Step 3: Extend the sample pack**

  Edit `workflow-packs/safe-harness-bootstrap.pack.json`.

  Add a top-level `loopContracts` array with one dry-run loop:

  ```json
  {
    "id": "daily-harness-triage",
    "title": "Daily Harness Triage",
    "trigger": { "type": "scheduled", "cadence": "daily", "enabled": false },
    "goal": "Inspect Harness health and produce reviewable candidate work without executing it.",
    "stateSpine": ".harness/loops/daily-harness-triage/state.json",
    "inputs": ["doctor report", "maintenance inspect", "recent evolution findings"],
    "skills": ["harness-maintenance"],
    "connectors": [],
    "triageOutputs": ["archive", "candidate-task", "needs-human", "blocked", "regression-test-proposal"],
    "hardStops": { "maxIterations": 3, "timeoutMinutes": 30, "noProgressDetection": true },
    "budget": { "maxTokens": 200000, "maxUsd": 25 },
    "reviewGates": ["human-approval", "reviewer-evidence"],
    "execution": {
      "executesAnything": false,
      "schedulesJobs": false,
      "dispatchesAgents": false,
      "writesExternalSystems": false
    }
  }
  ```

- [x] **Step 4: Validate loop contract data**

  Edit `scripts/lib/harness-core.js`.

  Add `validateLoopContracts(data.loopContracts, errors, warnings)` from `validateWorkflowPackData`. The helper must:

  - Allow `loopContracts` to be absent.
  - Require `loopContracts` to be an array when present.
  - Require each contract to include non-empty `id`, `goal`, and `stateSpine`.
  - Require `trigger.type` to be one of `manual`, `scheduled`, `goal`, or `external-signal`.
  - Require `triageOutputs` to include only `archive`, `candidate-task`, `needs-human`, `blocked`, or `regression-test-proposal`.
  - Require `hardStops.maxIterations` to be an integer greater than `0`.
  - Require `hardStops.noProgressDetection` to be `true`.
  - Require at least one of `hardStops.timeoutMinutes`, `budget.maxTokens`, or `budget.maxUsd`.
  - Require `reviewGates` to contain at least one non-empty string entry.
  - Require `execution.executesAnything === false`.
  - Reject `execution.schedulesJobs === true`.
  - Reject `execution.dispatchesAgents === true`.
  - Reject `execution.writesExternalSystems === true`.
  - Treat `connectors` as **Integration contract** declarations only; validation must not call or resolve the external system.
  - Do not require connectors to exist; the safe bootstrap pack can declare no external connector.

  Add a small normalizer for `inspectWorkflowPack`:

  ```js
  function describeLoopContracts(data) {
    return Array.isArray(data.loopContracts)
      ? data.loopContracts.map((contract) => ({
          id: contract.id,
          title: contract.title || contract.id,
          trigger: contract.trigger || null,
          goal: contract.goal || "",
          stateSpine: contract.stateSpine || "",
          triageOutputs: Array.isArray(contract.triageOutputs) ? contract.triageOutputs : [],
          hardStops: contract.hardStops || {},
          budget: contract.budget || {},
          connectors: Array.isArray(contract.connectors) ? contract.connectors : [],
          reviewGates: Array.isArray(contract.reviewGates) ? contract.reviewGates : [],
          execution: {
            executesAnything: false,
            schedulesJobs: Boolean(contract.execution && contract.execution.schedulesJobs),
            dispatchesAgents: Boolean(contract.execution && contract.execution.dispatchesAgents),
            writesExternalSystems: Boolean(contract.execution && contract.execution.writesExternalSystems)
          }
        }))
      : [];
  }
  ```

  Include `loopContracts: describeLoopContracts(data)` in the inspected pack payload.

- [x] **Step 5: Run the targeted test and verify it passes**

  ```sh
  node --test tests/phase-v3.test.js
  ```

  Expected result after implementation: V3 tests pass and unsafe loop contracts are rejected.

- [x] **Step 6: Commit**

  ```sh
  git add scripts/lib/harness-core.js tests/phase-v3.test.js workflow-packs/safe-harness-bootstrap.pack.json
  git commit -m "feat: validate declarative loop contracts"
  ```

## Task 2: Preserve Trace-To-Regression Replay Evidence

- [x] **Step 1: Write the failing tests**

  Edit `tests/phase-v4.test.js`.

  Add a test that prepares trace-derived work:

  ```js
  test("task prepare records trace-derived replay and regression proposal", () => {
    const target = tempDir("trace-regression");
    assert.equal(runHarness(["init", "--target", target]).status, 0);
    assert.equal(runHarness(["plan", "--target", target, "--feature", "F001", "--title", "Trace regression"]).status, 0);
    const plan = "docs/plans/F001-trace-regression.md";
    const planPath = path.join(target, plan);
    fs.writeFileSync(planPath, fs.readFileSync(planPath, "utf8").replace("User Confirmation: pending", "User Confirmation: confirmed"));

    const result = runHarness([
      "task", "prepare",
      "--target", target,
      "--plan", plan,
      "--task", "trace-failure",
      "--trace-input", "fixtures/traces/failing-input.json",
      "--agent-config", "crm-agent-v2",
      "--regression-assertion", "The response must include specific deal details, not just a count",
      "--json"
    ]);

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.traceReplay.traceInput, "fixtures/traces/failing-input.json");
    assert.equal(payload.regressionProposal.assertion, "The response must include specific deal details, not just a count");

    const evidence = JSON.parse(fs.readFileSync(path.join(target, ".harness", "executions", "trace-failure", "evidence.json"), "utf8"));
    assert.equal(evidence.traceReplay.traceInput, "fixtures/traces/failing-input.json");
    assert.equal(evidence.traceReplay.agentConfig, "crm-agent-v2");
    assert.equal(evidence.regressionProposal.status, "proposed");
    assert.equal(evidence.regressionProposal.modifiesTests, false);
  });
  ```

- [x] **Step 2: Run the targeted test and verify it fails**

  ```sh
  node --test tests/phase-v4.test.js
  ```

  Expected result before implementation: CLI options are ignored and `traceReplay` is absent.

- [x] **Step 3: Parse task options**

  Edit `scripts/lib/harness-core.js` and `scripts/harness.js`.

  In `parseArgs`, add:

  - `--trace-input` -> `args.traceInput`
  - `--agent-config` -> `args.agentConfig`
  - `--regression-assertion` -> `args.regressionAssertion`

  For `task prepare`, pass these optional arguments into `prepareTaskExecution`:

  - `traceInput`
  - `agentConfig`
  - `regressionAssertion`

  Update the `task prepare` route from:

  ```js
  prepareTaskExecution(args.target, args.plan, args.task)
  ```

  to:

  ```js
  prepareTaskExecution(args.target, args.plan, args.task, args)
  ```

  Keep the existing required `--task` behavior unchanged.

- [x] **Step 4: Store replay evidence**

  Edit `scripts/lib/harness-core.js`.

  Change `prepareTaskExecution(target, planRelativePath, taskIdInput)` to accept `options = {}`:

  ```js
  function prepareTaskExecution(target, planRelativePath, taskIdInput, options = {}) {
  ```

  Add to `ledger`:

  ```js
  traceDerived: Boolean(options.traceInput || options.regressionAssertion)
  ```

  Add to `evidence`:

  ```js
  traceReplay: options.traceInput || options.agentConfig ? {
    traceInput: options.traceInput || "",
    agentConfig: options.agentConfig || "",
    exactReplayRequired: Boolean(options.traceInput)
  } : null,
  regressionProposal: options.regressionAssertion ? {
    assertion: options.regressionAssertion,
    status: "proposed",
    modifiesTests: false,
    approvalRequired: true
  } : null
  ```

  Add to the returned payload:

  ```js
  traceReplay: evidence.traceReplay,
  regressionProposal: evidence.regressionProposal
  ```

  Add replay markdown lines when trace data is present:

  ```md
  ## Trace Replay

  - Trace input: fixtures/traces/failing-input.json
  - Agent config: crm-agent-v2
  - Exact replay required: true

  ## Regression Proposal

  - Assertion: The response must include specific deal details, not just a count
  - Modifies tests: false
  - Approval required: true
  ```

- [x] **Step 5: Run the targeted test and verify it passes**

  ```sh
  node --test tests/phase-v4.test.js
  ```

  Expected result after implementation: V4 tests pass and trace-derived replay data is persisted.

- [x] **Step 6: Commit**

  ```sh
  git add scripts/harness.js scripts/lib/harness-core.js tests/phase-v4.test.js
  git commit -m "feat: record trace regression replay evidence"
  ```

## Task 3: Add Loop Contract Status To Orchestration Records

- [x] **Step 1: Write the failing tests**

  Edit `tests/phase-v4-5.test.js`.

  Extend the `agent dispatch supports stop resume and separate reviewer evidence` test to pass loop metadata:

  ```js
  const dispatch = runHarness([
    "agent", "dispatch",
    "--target", target,
    "--task", "slice-1",
    "--worker", "worker-a",
    "--reviewer", "reviewer-b",
    "--loop-contract", "daily-harness-triage",
    "--hard-stop-status", "within-limits",
    "--budget-status", "within-budget",
    "--review-bandwidth-status", "available",
    "--review-gate-status", "pending",
    "--json"
  ]);
  ```

  Assert the dispatch payload and file include the loop status:

  ```js
  const dispatchPayload = JSON.parse(dispatch.stdout);
  assert.equal(dispatchPayload.dispatch.loop.contractId, "daily-harness-triage");
  assert.equal(dispatchPayload.dispatch.loop.hardStopStatus, "within-limits");
  assert.equal(dispatchPayload.dispatch.loop.budgetStatus, "within-budget");
  assert.equal(dispatchPayload.dispatch.loop.reviewBandwidthStatus, "available");
  assert.equal(dispatchPayload.dispatch.loop.reviewGateStatus, "pending");
  ```

  In the review step, add:

  ```sh
  --review-gate-status satisfied
  ```

  Then assert the reviewed dispatch has `reviewGateStatus === "satisfied"`.

- [x] **Step 2: Run the targeted test and verify it fails**

  ```sh
  node --test tests/phase-v4-5.test.js
  ```

  Expected result before implementation: `dispatch.loop` is absent.

- [x] **Step 3: Parse agent loop options**

  Edit `scripts/lib/harness-core.js`.

  In `parseArgs`, add:

  - `--loop-contract` -> `args.loopContract`
  - `--hard-stop-status` -> `args.hardStopStatus`
  - `--budget-status` -> `args.budgetStatus`
  - `--review-bandwidth-status` -> `args.reviewBandwidthStatus`
  - `--review-gate-status` -> `args.reviewGateStatus`

  `scripts/harness.js` already passes the parsed `args` object into `dispatchAgentTask(args.target, args)` and `recordAgentReview(args.target, args)`. Keep that shape; do not add a second options parser.

  For `agent dispatch`, support:

  - `loopContract`
  - `hardStopStatus`
  - `budgetStatus`
  - `reviewBandwidthStatus`
  - `reviewGateStatus`

  For `agent review`, pass `reviewGateStatus`.

- [x] **Step 4: Store loop status**

  Edit `scripts/lib/harness-core.js`.

  In `dispatchAgentTask`, add:

  ```js
  loop: {
    contractId: options.loopContract || null,
    hardStopStatus: options.hardStopStatus || "not-recorded",
    budgetStatus: options.budgetStatus || "not-recorded",
    reviewBandwidthStatus: options.reviewBandwidthStatus || "not-recorded",
    reviewGateStatus: options.reviewGateStatus || "pending"
  }
  ```

  Validate status values:

  - `hardStopStatus`: `not-recorded`, `within-limits`, `hit-limit`
  - `budgetStatus`: `not-recorded`, `within-budget`, `over-budget`
  - `reviewBandwidthStatus`: `not-recorded`, `available`, `saturated`
  - `reviewGateStatus`: `pending`, `satisfied`, `blocked`

  Invalid values must produce errors without writing dispatch files.

  In `recordAgentReview`, update `dispatch.loop.reviewGateStatus` when `options.reviewGateStatus` is present. If `dispatch.loop` does not exist, create it with `contractId: null`, `hardStopStatus: "not-recorded"`, `budgetStatus: "not-recorded"`, and `reviewBandwidthStatus: "not-recorded"`. Do not treat `reviewBandwidthStatus` as evidence by itself; it is a **Review bandwidth** signal on the **Orchestration record**.

- [x] **Step 5: Run the targeted test and verify it passes**

  ```sh
  node --test tests/phase-v4-5.test.js
  ```

  Expected result after implementation: V4.5 tests pass and reviewer evidence remains separate from worker output.

- [x] **Step 6: Commit**

  ```sh
  git add scripts/harness.js scripts/lib/harness-core.js tests/phase-v4-5.test.js
  git commit -m "feat: record loop orchestration status"
  ```

## Task 4: Promote Failures Into Regression Proposals

- [x] **Step 1: Write the failing tests**

  Edit `tests/phase-v5-5.test.js`.

  In `maintenance propose writes reviewable gardening proposal without changing source docs`, add a trace-derived evidence pack before running `maintenance propose`:

  ```js
  const executionPath = path.join(target, ".harness", "executions", "trace-failure");
  fs.mkdirSync(executionPath, { recursive: true });
  fs.writeFileSync(path.join(executionPath, "evidence.json"), JSON.stringify({
    taskId: "trace-failure",
    plan: "docs/plans/F001-trace-failure.md",
    evidence: [],
    requiredForReplay: ["ledger.json", "evidence.json", "replay.md"],
    chatHistoryRequired: false,
    traceReplay: {
      traceInput: "fixtures/traces/failing-input.json",
      agentConfig: "crm-agent-v2",
      exactReplayRequired: true
    },
    regressionProposal: {
      assertion: "The response must include specific deal details, not just a count",
      status: "proposed",
      modifiesTests: false,
      approvalRequired: true
    }
  }, null, 2));
  ```

  Assert inspection and proposal output:

  ```js
  const inspect = runHarness(["maintenance", "inspect", "--target", target, "--json"]);
  assert.equal(inspect.status, 0, inspect.stderr);
  const inspectPayload = JSON.parse(inspect.stdout);
  assert.ok(inspectPayload.regressionProposals.some((proposal) => proposal.taskId === "trace-failure"));

  assert.match(proposal, /Regression Proposals/);
  assert.match(proposal, /trace-failure/);
  assert.match(proposal, /The response must include specific deal details/);
  assert.equal(fs.existsSync(path.join(target, "tests", "trace-failure.test.js")), false);
  ```

- [x] **Step 2: Run the targeted test and verify it fails**

  ```sh
  node --test tests/phase-v5-5.test.js
  ```

  Expected result before implementation: `regressionProposals` and the proposal section are absent.

- [x] **Step 3: Extract regression proposals**

  Edit `scripts/lib/harness-core.js`.

  Add:

  ```js
  function extractRegressionProposals(targetRoot) {
    const executionsRoot = path.join(targetRoot, ".harness", "executions");
    if (!pathExists(executionsRoot)) {
      return [];
    }

    const seen = new Set();
    const proposals = walkFiles(executionsRoot)
      .filter((filePath) => path.basename(filePath) === "evidence.json")
      .map((filePath) => {
        try {
          const data = readJson(filePath);
          if (!data.regressionProposal || data.regressionProposal.status !== "proposed") {
            return null;
          }
          const assertion = data.regressionProposal.assertion || "";
          const taskId = data.taskId || path.basename(path.dirname(filePath));
          const key = `${taskId}\n${assertion}`;
          if (!assertion || seen.has(key)) {
            return null;
          }
          seen.add(key);
          return {
            taskId,
            plan: data.plan || "",
            assertion,
            traceInput: data.traceReplay ? data.traceReplay.traceInput || "" : "",
            agentConfig: data.traceReplay ? data.traceReplay.agentConfig || "" : "",
            modifiesTests: false,
            approvalRequired: true,
            source: relativeSlash(targetRoot, filePath)
          };
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((left, right) => left.taskId.localeCompare(right.taskId));

    return proposals.slice(0, 50);
  }
  ```

  Implementation notes:

  - Use the existing `walkFiles`, `pathExists`, `readJson`, and `relativeSlash` helpers.
  - Ignore malformed or incomplete `evidence.json` files; maintenance inspection must remain read-only and resilient.
  - Dedupe by `taskId + assertion` so repeated inspection does not produce noisy proposal sections.
  - Cap output at 50 proposals to keep maintenance output bounded.
  - Force `modifiesTests: false` in the proposal output even if an evidence file says otherwise.

  Add `regressionProposals: extractRegressionProposals(targetRoot)` to `inspectMaintenance`.

- [x] **Step 4: Add proposal markdown section**

  Edit `buildMaintenanceProposalContent`.

  Add this section after `## Evolution Rollup`:

  ```md
  ## Regression Proposals

  - trace-failure: The response must include specific deal details, not just a count
    - Trace input: fixtures/traces/failing-input.json
    - Agent config: crm-agent-v2
    - Source: .harness/executions/trace-failure/evidence.json
    - Modifies tests: false
    - Approval required: true
  ```

  If no proposals exist, write:

  ```md
  - No trace-derived regression proposals detected.
  ```

  Preserve `sourceFilesChanged: false`; this command must not modify `tests/` or source docs. A **Regression proposal** is not an approved regression test until a human accepts it.

- [x] **Step 5: Run the targeted test and verify it passes**

  ```sh
  node --test tests/phase-v5-5.test.js
  ```

  Expected result after implementation: maintenance tests pass and **Regression proposals** are reviewable only.

- [x] **Step 6: Commit**

  ```sh
  git add scripts/lib/harness-core.js tests/phase-v5-5.test.js
  git commit -m "feat: propose regressions from trace evidence"
  ```

## Task 5: Add Future Loop Readiness Report And Gate

**Files:**

- Modify: `scripts/lib/harness-core.js`
- Modify: `scripts/harness.js`
- Create: `tests/phase-future-loop-readiness.test.js`
- Modify: `workflow-packs/safe-harness-bootstrap.pack.json`

- [x] **Step 1: Write failing tests for readiness inspection**

  Create `tests/phase-future-loop-readiness.test.js`.

  ```js
  "use strict";

  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const test = require("node:test");

  const ROOT = path.resolve(__dirname, "..");
  const CLI = path.join(ROOT, "scripts", "harness.js");

  function tempDir(name) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `coding-harness-loop-readiness-${name}-`));
  }

  function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  function runHarness(args) {
    return spawnSync(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      encoding: "utf8"
    });
  }

  test("pack readiness reports missing future-loop controls without executing anything", () => {
    const dir = tempDir("missing-controls");
    const pack = path.join(dir, "pack.json");
    writeJson(pack, {
      id: "unsafe-loop-pack",
      name: "Unsafe Loop Pack",
      version: "0.1.0",
      skills: [],
      standards: [],
      scripts: {},
      integrations: [],
      approvalGates: [],
      loopContracts: [{
        id: "daily-triage",
        goal: "Review incoming signals",
        owner: "maintainers",
        trigger: { type: "scheduled", cadence: "daily" },
        inputSources: ["docs/signals.md"],
        stateSpine: ".harness/loops/daily-triage/state.json",
        triageOutputs: ["candidate-task"],
        connectors: ["github"],
        hardStops: { maxIterations: 3, noProgressDetection: true },
        budget: { maxMinutes: 30 },
        reviewGates: ["human-review"],
        execution: { executesAnything: false, schedulesJobs: false }
      }]
    });

    const result = runHarness(["pack", "readiness", "--file", pack, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);

    assert.equal(payload.readiness.readyForLiveScheduling, false);
    assert.deepEqual(payload.readiness.allowedNow, ["describe", "validate", "dry-run", "record"]);
    assert.match(payload.readiness.blockers.join("\n"), /connector contract github/);
    assert.match(payload.readiness.blockers.join("\n"), /approval policy/);
    assert.match(payload.readiness.blockers.join("\n"), /execution ledger/);
    assert.match(payload.readiness.blockers.join("\n"), /workspace isolation/);
    assert.equal(payload.execution.executesAnything, false);
    assert.equal(payload.execution.schedulesJobs, false);
  });

  test("pack readiness passes only as dry-run-ready when all controls are declared", () => {
    const pack = path.join(ROOT, "workflow-packs", "safe-harness-bootstrap.pack.json");
    const result = runHarness(["pack", "readiness", "--file", pack, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);

    assert.equal(payload.readiness.readyForLiveScheduling, false);
    assert.equal(payload.readiness.readyForDryRun, true);
    assert.equal(payload.readiness.readyForRecordOnly, true);
    assert.deepEqual(payload.readiness.blockers, ["live scheduling is disabled by product boundary"]);
    assert.ok(payload.readiness.controls.includes("loop contract"));
    assert.ok(payload.readiness.controls.includes("connector contracts"));
    assert.ok(payload.readiness.controls.includes("approval policy"));
    assert.ok(payload.readiness.controls.includes("execution ledger"));
    assert.ok(payload.readiness.controls.includes("workspace isolation"));
    assert.ok(payload.readiness.controls.includes("no-progress detection"));
    assert.ok(payload.readiness.controls.includes("reviewer gate"));
  });
  ```

- [x] **Step 2: Run the targeted test and verify it fails**

  ```sh
  node --test tests/phase-future-loop-readiness.test.js
  ```

  Expected result before implementation: the command fails because `pack readiness` is unknown.

- [x] **Step 3: Add declarative readiness data to the sample pack**

  Edit `workflow-packs/safe-harness-bootstrap.pack.json` so the existing loop contract has all readiness declarations required by `SPEC.md`. Keep every value declarative and non-executing.

  Add or update these top-level fields:

  ```json
  {
    "connectorContracts": [
      {
        "id": "local-docs",
        "type": "filesystem",
        "mode": "read-only",
        "credentials": "none",
        "redaction": "not-required",
        "externalWrites": false
      }
    ],
    "approvalPolicy": {
      "readOnlyInspection": "allowed",
      "reportGeneration": "allowed",
      "fileMutation": "requires-human-approval",
      "commandExecution": "requires-human-approval",
      "externalNotification": "requires-human-approval",
      "issueCreation": "requires-human-approval",
      "selfApprovalAllowed": false
    },
    "loopLedger": {
      "required": true,
      "pathTemplate": ".harness/loops/{contractId}/ledger.json",
      "chatHistoryRequired": false,
      "recordsInputSnapshot": true,
      "recordsToolSummary": true,
      "recordsBudgetUsage": true,
      "recordsStopReason": true,
      "recordsApprovalState": true,
      "recordsReviewerOutcome": true
    },
    "workspaceIsolation": {
      "mutatingLoopsUseWorktree": true,
      "mainCheckoutMutation": false
    }
  }
  ```

  Ensure the existing loop contract references the declared connector and keeps these controls:

  ```json
  {
    "connectors": ["local-docs"],
    "hardStops": {
      "maxIterations": 3,
      "noProgressDetection": true
    },
    "budget": {
      "maxMinutes": 30
    },
    "reviewGates": ["human-review"],
    "execution": {
      "executesAnything": false,
      "schedulesJobs": false
    }
  }
  ```

- [x] **Step 4: Implement readiness inspection in the core module**

  Add a small pure function near `describeLoopContracts` in `scripts/lib/harness-core.js`.

  ```js
  function inspectLoopReadiness(data) {
    const controls = [];
    const blockers = [];
    const loopContracts = Array.isArray(data.loopContracts) ? data.loopContracts : [];
    const connectorContracts = Array.isArray(data.connectorContracts) ? data.connectorContracts : [];
    const connectorIds = new Set(connectorContracts.map((connector) => connector && connector.id).filter(Boolean));
    const approvalPolicy = data.approvalPolicy && typeof data.approvalPolicy === "object" ? data.approvalPolicy : null;
    const loopLedger = data.loopLedger && typeof data.loopLedger === "object" ? data.loopLedger : null;
    const workspaceIsolation = data.workspaceIsolation && typeof data.workspaceIsolation === "object" ? data.workspaceIsolation : null;

    if (loopContracts.length > 0) {
      controls.push("loop contract");
    } else {
      blockers.push("loop contract is missing");
    }

    if (connectorContracts.length > 0) {
      controls.push("connector contracts");
    }

    if (approvalPolicy && approvalPolicy.selfApprovalAllowed === false) {
      controls.push("approval policy");
    } else {
      blockers.push("approval policy must disallow self-approval");
    }

    if (
      loopLedger &&
      loopLedger.required === true &&
      loopLedger.chatHistoryRequired === false &&
      loopLedger.recordsInputSnapshot === true &&
      loopLedger.recordsToolSummary === true &&
      loopLedger.recordsBudgetUsage === true &&
      loopLedger.recordsStopReason === true &&
      loopLedger.recordsApprovalState === true &&
      loopLedger.recordsReviewerOutcome === true
    ) {
      controls.push("execution ledger");
    } else {
      blockers.push("execution ledger policy must record replay evidence, budget usage, stop reason, approval state, and reviewer outcome without chat history");
    }

    if (
      workspaceIsolation &&
      workspaceIsolation.mutatingLoopsUseWorktree === true &&
      workspaceIsolation.mainCheckoutMutation === false
    ) {
      controls.push("workspace isolation");
    } else {
      blockers.push("workspace isolation must require worktrees for mutating loops and forbid main-checkout mutation");
    }

    for (const contract of loopContracts) {
      const contractId = contract && contract.id ? contract.id : "unknown-loop";
      const connectors = Array.isArray(contract.connectors) ? contract.connectors : [];
      for (const connector of connectors) {
        if (!connectorIds.has(connector)) {
          blockers.push(`connector contract ${connector} is missing for loop ${contractId}`);
        }
      }
      if (contract && contract.hardStops && contract.hardStops.noProgressDetection === true) {
        controls.push("no-progress detection");
      } else {
        blockers.push(`no-progress detection is missing for loop ${contractId}`);
      }
      if (contract && contract.budget && Number.isFinite(contract.budget.maxMinutes)) {
        controls.push("budget ceiling");
      } else {
        blockers.push(`budget ceiling is missing for loop ${contractId}`);
      }
      if (Array.isArray(contract.reviewGates) && contract.reviewGates.length > 0) {
        controls.push("reviewer gate");
      } else {
        blockers.push(`reviewer gate is missing for loop ${contractId}`);
      }
    }

    blockers.push("live scheduling is disabled by product boundary");

    return {
      readyForDryRun: loopContracts.length > 0 && blockers.every((blocker) => blocker === "live scheduling is disabled by product boundary"),
      readyForRecordOnly: loopContracts.length > 0 && blockers.every((blocker) => blocker === "live scheduling is disabled by product boundary"),
      readyForLiveScheduling: false,
      allowedNow: ["describe", "validate", "dry-run", "record"],
      controls: [...new Set(controls)],
      blockers
    };
  }
  ```

  Then add `inspectWorkflowPackReadiness(filePath)`:

  ```js
  function inspectWorkflowPackReadiness(filePath) {
    const absolutePath = path.resolve(filePath);
    const data = readJson(absolutePath);
    const validation = validateWorkflowPackData(data);
    return {
      file: absolutePath,
      validation,
      readiness: inspectLoopReadiness(data),
      execution: {
        executesAnything: false,
        schedulesJobs: false,
        callsExternalSystems: false
      }
    };
  }
  ```

  Export `inspectWorkflowPackReadiness`.

- [x] **Step 5: Route `pack readiness` through the CLI**

  In `scripts/harness.js`, import `inspectWorkflowPackReadiness` from `harness-core`.

  Update the `pack` action routing:

  ```js
  } else if (action === "readiness") {
    result = inspectWorkflowPackReadiness(args.file || args._[1]);
  } else {
    console.error(usage("pack"));
    return 1;
  }
  ```

  Update `usage("pack")` so it lists:

  ```text
  node scripts/harness.js pack readiness --file workflow-packs/safe-harness-bootstrap.pack.json --json
  ```

- [x] **Step 6: Run the targeted test and verify it passes**

  ```sh
  node --test tests/phase-future-loop-readiness.test.js
  ```

  Expected result after implementation: readiness tests pass, and no command schedules or executes loop work.

- [x] **Step 7: Commit**

  ```sh
  git add scripts/lib/harness-core.js scripts/harness.js tests/phase-future-loop-readiness.test.js workflow-packs/safe-harness-bootstrap.pack.json
  git commit -m "feat: add loop readiness inspection"
  ```

## Task 6: Add Dry-Run And Record-Only Loop Command Surface

**Files:**

- Modify: `scripts/lib/harness-core.js`
- Modify: `scripts/harness.js`
- Modify: `tests/phase-future-loop-readiness.test.js`

- [x] **Step 1: Write failing tests for `loop run`, `loop record`, `loop status`, and `loop inspect`**

  Append these tests to `tests/phase-future-loop-readiness.test.js`.

  ```js
  test("loop run only writes a dry-run ledger preview", () => {
    const dir = tempDir("loop-dry-run");
    const ledger = path.join(dir, "ledger-preview.json");
    const pack = path.join(ROOT, "workflow-packs", "safe-harness-bootstrap.pack.json");

    const result = runHarness([
      "loop", "run",
      "--file", pack,
      "--contract", "daily-harness-triage",
      "--dry-run",
      "--output", ledger,
      "--json"
    ]);

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.mode, "dry-run");
    assert.equal(payload.executesAnything, false);
    assert.equal(payload.schedulesJobs, false);
    assert.equal(payload.ledgerPreview.contractId, "daily-harness-triage");
    assert.equal(payload.ledgerPreview.stopReason, "dry-run-only");
    assert.equal(fs.existsSync(ledger), true);
  });

  test("loop run refuses non-dry-run execution", () => {
    const pack = path.join(ROOT, "workflow-packs", "safe-harness-bootstrap.pack.json");
    const result = runHarness(["loop", "run", "--file", pack, "--contract", "daily-harness-triage", "--json"]);

    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.match(payload.errors.join("\n"), /requires --dry-run/);
  });

  test("loop record stores manual loop evidence and loop status can inspect it", () => {
    const dir = tempDir("loop-record");
    const ledger = path.join(dir, "manual-ledger.json");
    const pack = path.join(ROOT, "workflow-packs", "safe-harness-bootstrap.pack.json");

    const recordResult = runHarness([
      "loop", "record",
      "--file", pack,
      "--contract", "daily-harness-triage",
      "--trigger-source", "manual",
      "--stop-reason", "reviewer-gate-required",
      "--output", ledger,
      "--json"
    ]);

    assert.equal(recordResult.status, 0, recordResult.stderr);
    const recorded = JSON.parse(recordResult.stdout);
    assert.equal(recorded.record.contractId, "daily-harness-triage");
    assert.equal(recorded.record.approvalState, "pending-review");
    assert.equal(recorded.record.reviewerOutcome, "not-reviewed");

    const statusResult = runHarness(["loop", "status", "--ledger", ledger, "--json"]);
    assert.equal(statusResult.status, 0, statusResult.stderr);
    const status = JSON.parse(statusResult.stdout);
    assert.equal(status.record.stopReason, "reviewer-gate-required");
    assert.equal(status.record.executesAnything, false);
  });

  test("loop inspect explains contract readiness without writing a ledger", () => {
    const pack = path.join(ROOT, "workflow-packs", "safe-harness-bootstrap.pack.json");
    const result = runHarness(["loop", "inspect", "--file", pack, "--contract", "daily-harness-triage", "--json"]);

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.contract.id, "daily-harness-triage");
    assert.equal(payload.readiness.readyForLiveScheduling, false);
    assert.equal(payload.execution.executesAnything, false);
  });
  ```

- [x] **Step 2: Run the targeted test and verify it fails**

  ```sh
  node --test tests/phase-future-loop-readiness.test.js
  ```

  Expected result before implementation: the new tests fail because the `loop` command is unknown.

- [x] **Step 3: Implement loop contract resolution and ledger preview helpers**

  Add these helpers in `scripts/lib/harness-core.js` near the readiness helpers:

  ```js
  function findLoopContract(data, contractId) {
    const contracts = Array.isArray(data.loopContracts) ? data.loopContracts : [];
    const contract = contracts.find((candidate) => candidate && candidate.id === contractId);
    if (!contract) {
      throw new Error(`Loop contract ${contractId} was not found.`);
    }
    return contract;
  }

  function buildLoopLedgerRecord(data, contract, options = {}) {
    const now = new Date().toISOString();
    return {
      schemaVersion: 1,
      recordedAt: now,
      triggerSource: options.triggerSource || "manual",
      resolvedProfile: options.profile || null,
      workflowPackVersion: data.version || null,
      contractId: contract.id,
      contractVersion: contract.version || data.version || null,
      inputSnapshot: {
        sources: Array.isArray(contract.inputSources) ? contract.inputSources : [],
        capturedAt: now
      },
      actionSummary: options.actionSummary || "dry-run preview only; no actions executed",
      producedArtifacts: [],
      replayEvidence: [],
      budgetUsage: { minutes: 0 },
      stopReason: options.stopReason || "dry-run-only",
      approvalState: "pending-review",
      reviewerOutcome: "not-reviewed",
      executesAnything: false,
      schedulesJobs: false,
      callsExternalSystems: false
    };
  }
  ```

- [x] **Step 4: Implement record-only core functions**

  Add these functions to `scripts/lib/harness-core.js` and export them.

  ```js
  function inspectLoopContract(options = {}) {
    const absolutePath = path.resolve(options.file);
    const data = readJson(absolutePath);
    const contract = findLoopContract(data, options.contract);
    return {
      file: absolutePath,
      contract,
      readiness: inspectLoopReadiness(data),
      execution: {
        executesAnything: false,
        schedulesJobs: false,
        callsExternalSystems: false
      }
    };
  }

  function dryRunLoopContract(options = {}) {
    const errors = [];
    if (!options.dryRun) {
      errors.push("loop run requires --dry-run until live scheduling is implemented.");
    }
    if (errors.length > 0) {
      return { errors, warnings: [], executesAnything: false, schedulesJobs: false };
    }
    const absolutePath = path.resolve(options.file);
    const data = readJson(absolutePath);
    const contract = findLoopContract(data, options.contract);
    const ledgerPreview = buildLoopLedgerRecord(data, contract, { stopReason: "dry-run-only" });
    if (options.output) {
      fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
      fs.writeFileSync(path.resolve(options.output), JSON.stringify(ledgerPreview, null, 2));
    }
    return {
      mode: "dry-run",
      file: absolutePath,
      ledgerPreview,
      executesAnything: false,
      schedulesJobs: false,
      callsExternalSystems: false
    };
  }

  function recordLoopContract(options = {}) {
    const absolutePath = path.resolve(options.file);
    const data = readJson(absolutePath);
    const contract = findLoopContract(data, options.contract);
    const record = buildLoopLedgerRecord(data, contract, {
      triggerSource: options.triggerSource || "manual",
      stopReason: options.stopReason || "manual-record"
    });
    if (options.output) {
      fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
      fs.writeFileSync(path.resolve(options.output), JSON.stringify(record, null, 2));
    }
    return { record, executesAnything: false, schedulesJobs: false, callsExternalSystems: false };
  }

  function inspectLoopLedger(options = {}) {
    const ledgerPath = path.resolve(options.ledger);
    const record = readJson(ledgerPath);
    return { ledger: ledgerPath, record };
  }
  ```

- [x] **Step 5: Route `loop` subcommands through the CLI**

  In `scripts/harness.js`, import the new functions:

  ```js
  dryRunLoopContract,
  inspectLoopContract,
  inspectLoopLedger,
  recordLoopContract
  ```

  Add `"loop"` to `COMMANDS`.

  Add a `loop` usage branch:

  ```text
  node scripts/harness.js loop inspect --file workflow-packs/safe-harness-bootstrap.pack.json --contract daily-harness-triage --json
  node scripts/harness.js loop run --file workflow-packs/safe-harness-bootstrap.pack.json --contract daily-harness-triage --dry-run --output .harness/loops/daily-harness-triage/ledger-preview.json --json
  node scripts/harness.js loop record --file workflow-packs/safe-harness-bootstrap.pack.json --contract daily-harness-triage --trigger-source manual --stop-reason reviewer-gate-required --output .harness/loops/daily-harness-triage/manual-ledger.json --json
  node scripts/harness.js loop status --ledger .harness/loops/daily-harness-triage/manual-ledger.json --json
  ```

  Add route handling:

  ```js
  } else if (command === "loop") {
    const action = args._ && args._[0];
    if (action === "inspect") {
      result = inspectLoopContract({ file: args.file, contract: args.contract });
    } else if (action === "run") {
      result = dryRunLoopContract({
        file: args.file,
        contract: args.contract,
        dryRun: args.dryRun,
        output: args.output
      });
    } else if (action === "record") {
      result = recordLoopContract({
        file: args.file,
        contract: args.contract,
        triggerSource: args.triggerSource,
        stopReason: args.stopReason,
        output: args.output
      });
    } else if (action === "status") {
      result = inspectLoopLedger({ ledger: args.ledger });
    } else {
      console.error(usage("loop"));
      return 1;
    }
  }
  ```

  Extend `parseArgs` in `scripts/lib/harness-core.js` for:

  ```js
  } else if (arg === "--contract") {
    args.contract = argv[index + 1];
    index += 1;
  } else if (arg === "--ledger") {
    args.ledger = argv[index + 1];
    index += 1;
  } else if (arg === "--trigger-source") {
    args.triggerSource = argv[index + 1];
    index += 1;
  } else if (arg === "--stop-reason") {
    args.stopReason = argv[index + 1];
    index += 1;
  }
  ```

  `--dry-run` already exists. Keep existing `--loop-contract` support for orchestration records; do not rename it.

- [x] **Step 6: Run the targeted test and verify it passes**

  ```sh
  node --test tests/phase-future-loop-readiness.test.js
  ```

  Expected result after implementation: all future-readiness tests pass.

- [x] **Step 7: Commit**

  ```sh
  git add scripts/lib/harness-core.js scripts/harness.js tests/phase-future-loop-readiness.test.js
  git commit -m "feat: add record-only loop command surface"
  ```

## Task 7: Update Docs And Fixtures

- [x] **Step 1: Update public docs only if behavior differs**

  Update `README.md`, `SPEC.md`, `ROADMAP.md`, and `docs/superpowers/specs/2026-06-09-declarative-loop-contract-design.md` only when shipped field names or constraints differ from the approved design.

  Required documentation points if Tasks 5-6 are implemented exactly as planned:

  - `loop inspect`, `loop run --dry-run`, `loop record`, and `loop status` are record-only surfaces.
  - `pack readiness` never runs jobs, dispatches live agents, writes external systems, or opens PRs.
  - `readyForLiveScheduling` remains `false` by design.
  - Connector configuration is not approval.
  - Loop output cannot approve itself.
  - Mutating loops must remain outside the current product boundary.

- [x] **Step 2: Update examples if output shape changes**

  If CLI output snapshots or example adoption reports include workflow pack or maintenance details, regenerate or edit only the affected example files. Do not update unrelated generated examples.

- [x] **Step 3: Run docs-adjacent verification**

  ```sh
  npm run manifests
  npm run doctor
  node scripts/harness.js pack readiness --file workflow-packs/safe-harness-bootstrap.pack.json --json
  node scripts/harness.js loop inspect --file workflow-packs/safe-harness-bootstrap.pack.json --contract daily-harness-triage --json
  ```

  Expected results:

  - `npm run manifests` reports `Errors: 0`.
  - `npm run doctor` reports product-repo checks with `Errors: 0`.
  - `pack readiness` reports `readyForDryRun: true`, `readyForRecordOnly: true`, and `readyForLiveScheduling: false`.
  - `loop inspect` reports `execution.executesAnything: false`.

- [x] **Step 4: Commit**

  ```sh
  git add README.md SPEC.md ROADMAP.md docs/superpowers/specs/2026-06-09-declarative-loop-contract-design.md workflow-packs/safe-harness-bootstrap.pack.json
  git commit -m "docs: align loop contract implementation"
  ```

## Task 8: Full Verification

- [x] **Step 1: Run the full test suite**

  ```sh
  npm test
  ```

  Expected result: all Node tests pass.

- [x] **Step 2: Run manifest validation**

  ```sh
  npm run manifests
  ```

  Expected result: `Errors: 0`.

- [x] **Step 3: Run product doctor**

  ```sh
  npm run doctor
  ```

  Expected result: `Errors: 0`.

- [x] **Step 4: Run a manual smoke check**

  ```sh
  node scripts/harness.js pack inspect --file workflow-packs/safe-harness-bootstrap.pack.json --json
  node scripts/harness.js pack validate --file workflow-packs/safe-harness-bootstrap.pack.json --json
  node scripts/harness.js pack readiness --file workflow-packs/safe-harness-bootstrap.pack.json --json
  node scripts/harness.js loop run --file workflow-packs/safe-harness-bootstrap.pack.json --contract daily-harness-triage --dry-run --output .harness/loops/daily-harness-triage/ledger-preview.json --json
  node scripts/harness.js loop status --ledger .harness/loops/daily-harness-triage/ledger-preview.json --json
  ```

  Expected result:

  - `pack inspect` reports `loopContracts[0].id === "daily-harness-triage"`.
  - `pack validate` reports no errors.
  - `pack readiness` reports live scheduling is disabled by product boundary.
  - `loop run --dry-run` writes a ledger preview with `stopReason === "dry-run-only"`.
  - `loop status` can inspect the ledger preview without chat history.
  - No command schedules jobs, dispatches live agents, writes external systems, opens PRs, or modifies tests.

- [x] **Step 5: Commit verification-only updates if needed**

  ```sh
  git status --short
  git add <only-files-intentionally-changed>
  git commit -m "test: verify declarative loop contracts"
  ```

  Skip this commit when verification produces no tracked file changes.
