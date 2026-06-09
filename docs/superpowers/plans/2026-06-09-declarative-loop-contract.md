# Declarative Loop Contract Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

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
- Verification scripts: `npm test`, `npm run manifests`, `npm run doctor`

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
5. Docs, fixtures, and full verification.

## Task 1: Validate Loop Contracts In Workflow Packs

- [ ] **Step 1: Write the failing tests**

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

- [ ] **Step 2: Run the targeted test and verify it fails**

  ```sh
  node --test tests/phase-v3.test.js
  ```

  Expected result before implementation: the test fails because `loopContracts` are not exposed or validated.

- [ ] **Step 3: Extend the sample pack**

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

- [ ] **Step 4: Validate loop contract data**

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

- [ ] **Step 5: Run the targeted test and verify it passes**

  ```sh
  node --test tests/phase-v3.test.js
  ```

  Expected result after implementation: V3 tests pass and unsafe loop contracts are rejected.

- [ ] **Step 6: Commit**

  ```sh
  git add scripts/lib/harness-core.js tests/phase-v3.test.js workflow-packs/safe-harness-bootstrap.pack.json
  git commit -m "feat: validate declarative loop contracts"
  ```

## Task 2: Preserve Trace-To-Regression Replay Evidence

- [ ] **Step 1: Write the failing tests**

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

- [ ] **Step 2: Run the targeted test and verify it fails**

  ```sh
  node --test tests/phase-v4.test.js
  ```

  Expected result before implementation: CLI options are ignored and `traceReplay` is absent.

- [ ] **Step 3: Parse task options**

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

- [ ] **Step 4: Store replay evidence**

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

- [ ] **Step 5: Run the targeted test and verify it passes**

  ```sh
  node --test tests/phase-v4.test.js
  ```

  Expected result after implementation: V4 tests pass and trace-derived replay data is persisted.

- [ ] **Step 6: Commit**

  ```sh
  git add scripts/harness.js scripts/lib/harness-core.js tests/phase-v4.test.js
  git commit -m "feat: record trace regression replay evidence"
  ```

## Task 3: Add Loop Contract Status To Orchestration Records

- [ ] **Step 1: Write the failing tests**

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

- [ ] **Step 2: Run the targeted test and verify it fails**

  ```sh
  node --test tests/phase-v4-5.test.js
  ```

  Expected result before implementation: `dispatch.loop` is absent.

- [ ] **Step 3: Parse agent loop options**

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

- [ ] **Step 4: Store loop status**

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

- [ ] **Step 5: Run the targeted test and verify it passes**

  ```sh
  node --test tests/phase-v4-5.test.js
  ```

  Expected result after implementation: V4.5 tests pass and reviewer evidence remains separate from worker output.

- [ ] **Step 6: Commit**

  ```sh
  git add scripts/harness.js scripts/lib/harness-core.js tests/phase-v4-5.test.js
  git commit -m "feat: record loop orchestration status"
  ```

## Task 4: Promote Failures Into Regression Proposals

- [ ] **Step 1: Write the failing tests**

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

- [ ] **Step 2: Run the targeted test and verify it fails**

  ```sh
  node --test tests/phase-v5-5.test.js
  ```

  Expected result before implementation: `regressionProposals` and the proposal section are absent.

- [ ] **Step 3: Extract regression proposals**

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

- [ ] **Step 4: Add proposal markdown section**

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

- [ ] **Step 5: Run the targeted test and verify it passes**

  ```sh
  node --test tests/phase-v5-5.test.js
  ```

  Expected result after implementation: maintenance tests pass and **Regression proposals** are reviewable only.

- [ ] **Step 6: Commit**

  ```sh
  git add scripts/lib/harness-core.js tests/phase-v5-5.test.js
  git commit -m "feat: propose regressions from trace evidence"
  ```

## Task 5: Update Docs And Fixtures

- [ ] **Step 1: Update public docs only if behavior differs**

  Update `README.md`, `SPEC.md`, `ROADMAP.md`, and `docs/superpowers/specs/2026-06-09-declarative-loop-contract-design.md` only when shipped field names or constraints differ from the approved design.

- [ ] **Step 2: Update examples if output shape changes**

  If CLI output snapshots or example adoption reports include workflow pack or maintenance details, regenerate or edit only the affected example files. Do not update unrelated generated examples.

- [ ] **Step 3: Run docs-adjacent verification**

  ```sh
  npm run manifests
  npm run doctor
  ```

  Expected results:

  - `npm run manifests` reports `Errors: 0`.
  - `npm run doctor` reports product-repo checks with `Errors: 0`.

- [ ] **Step 4: Commit**

  ```sh
  git add README.md SPEC.md ROADMAP.md docs/superpowers/specs/2026-06-09-declarative-loop-contract-design.md workflow-packs/safe-harness-bootstrap.pack.json
  git commit -m "docs: align loop contract implementation"
  ```

## Task 6: Full Verification

- [ ] **Step 1: Run the full test suite**

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

  Expected result: `Errors: 0`.

- [ ] **Step 4: Run a manual smoke check**

  ```sh
  node scripts/harness.js pack inspect --file workflow-packs/safe-harness-bootstrap.pack.json --json
  node scripts/harness.js pack validate --file workflow-packs/safe-harness-bootstrap.pack.json --json
  ```

  Expected result:

  - `pack inspect` reports `loopContracts[0].id === "daily-harness-triage"`.
  - `pack validate` reports no errors.
  - No command schedules jobs, dispatches live agents, writes external systems, opens PRs, or modifies tests.

- [ ] **Step 5: Commit verification-only updates if needed**

  ```sh
  git status --short
  git add <only-files-intentionally-changed>
  git commit -m "test: verify declarative loop contracts"
  ```

  Skip this commit when verification produces no tracked file changes.
