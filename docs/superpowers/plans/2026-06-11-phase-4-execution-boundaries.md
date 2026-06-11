# Phase 4: Execution Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Depends on:** Phase 3 (Maintenance Automation) — M1–M7 stable

**Goal:** Add 4 execution boundary validators (E1–E4) that inspect metadata, schemas, and readiness gates WITHOUT invoking live agents or running target project commands. Implements SPEC Article 19 non-goals (conservative boundaries).

---

## E1: `amber execution validate-loop` — loop contract dry-run validator

**Purpose:** Validate loop contract schema, check hard stops, verify state spine declarations; explain what WOULD run without executing.

### Steps

- [ ] E1.1: Create `scripts/lib/core/execution-validator.js` with `validateLoopContract(contractPath)`
  - Load `.amber/loop-contracts/<name>.json` schema
  - Required fields: `goal`, `owner`, `trigger`, `cadence`, `inputSources`, `stateSpine`, `triageOutput`, `hardStops`, `budgetCeiling`, `reviewerGate`
  - Validate `hardStops`: maxIterations, timeout, noProgressDetection must be present
  - Validate `budgetCeiling`: maxTokens, maxDuration present
  - Validate `reviewerGate`: cannot be `"self-approve"`
  - Check `inputSources` references exist (files/commands/connectors declared)
  - Return: `{ valid: bool, errors: [], warnings: [], dryRun: {steps, risks, gates} }`
- [ ] E1.2: Add `explainLoopDryRun(contract)` — generate plain-English explanation of loop flow
  - "Would trigger: <trigger> every <cadence>"
  - "Would read inputs: <inputSources>"
  - "Would triage: <triageOutput> via <stateSpine>"
  - "Would stop at: <hardStops>"
  - "Requires approval: <reviewerGate>"
- [ ] E1.3: Wire `amber execution validate-loop --contract <file> [--json]`
- [ ] E1.4: Test: contract missing hardStops → error; contract with self-approve → error; valid contract → green + dry-run explanation
- [ ] E1.5: Add `--explain` flag: output detailed step-by-step dry-run (no execution)

---

## E2: `amber execution validate-pack` — workflow pack metadata inspector

**Purpose:** Check workflow-pack manifest for declarative correctness; verify no execution code hidden in metadata.

### Steps

- [ ] E2.1: Add `validateWorkflowPack(packPath)` in `scripts/lib/core/execution-validator.js`
  - Load `workflow-packs/<name>/manifest.json`
  - Required fields: `name`, `version`, `skills`, `standards`, `profiles`, `environmentContract`, `approvalGates`
  - Check `environmentContract`: vars declared but NOT set (execution detail)
  - Check `approvalGates`: all gates reference valid gate types from policy
  - Scan `skills/` for shell scripts: flag if script contains `curl`, `ssh`, `aws`, `gcloud`, account-bearing CLIs
  - Check `profiles/*/workflow.md`: must be declarative (no `#!/bin/bash` inline execution)
  - Return: `{ valid: bool, errors: [], warnings: [], unsafeScripts: [], externalDependencies: [] }`
- [ ] E2.2: Add `detectUnsafePackPatterns(packPath)` — grep for risky patterns
  - `eval`, `exec`, `system()`, `subprocess.call`, `child_process.exec` in scripts
  - Environment variable access without declaration: `$AWS_ACCESS_KEY`, `$GITHUB_TOKEN` undeclared in manifest
- [ ] E2.3: Wire `amber execution validate-pack --pack <path> [--json]`
- [ ] E2.4: Test: pack with undeclared env var → warning; pack with `eval` in script → error; clean pack → green
- [ ] E2.5: Output: validation report + "Safe to install: YES/NO/REVIEW" + list of external dependencies

---

## E3: `amber execution validate-integration` — MCP/connector contract check

**Purpose:** Validate integration/connector contracts declare side effects, credentials, permissions; no live calls.

### Steps

- [ ] E3.1: Add `validateIntegrationContract(contractPath)` in `scripts/lib/core/execution-validator.js`
  - Load `.amber/integrations/<name>.json` connector contract
  - Required fields: `name`, `type` (mcp|api|cli), `sideEffects`, `credentials`, `mutabilityClass`, `approvalGate`, `redactionRules`, `rateLimit`
  - Validate `sideEffects` is explicit: read-only / create / update / delete / notify
  - Validate `mutabilityClass`: read-only / append-only / mutable / destructive
  - Validate `approvalGate` matches policy: cannot bypass user-approval for destructive actions
  - Check `credentials` declared but NOT stored in contract (must reference secret manager)
  - Return: `{ valid: bool, errors: [], warnings: [], permissionGate: string, risks: [] }`
- [ ] E3.2: Add MCP tool schema check: if `type: "mcp"`, validate `tools` array matches MCP schema (name, description, inputSchema)
- [ ] E3.3: Wire `amber execution validate-integration --contract <file> [--json]`
- [ ] E3.4: Test: contract with credentials inline → error; contract with destructive + no approval → error; valid contract → green
- [ ] E3.5: Output: contract summary + permission gates + "Live calls: BLOCKED until approval policy satisfied"

---

## E4: `amber execution readiness` — pre-flight gate check

**Purpose:** Verify execution prerequisites before ANY agent work: approved plan + verified worktree + policy compliance.

### Steps

- [ ] E4.1: Add `checkExecutionReadiness(projectRoot, taskId)` in `scripts/lib/core/execution-validator.js`
  - Check 1: Plan exists + status approved (from future V2 plan schema)
  - Check 2: Worktree isolated (not main branch, no uncommitted changes in parent)
  - Check 3: Policy compliance: gates configured, budget set, reviewer assigned
  - Check 4: Required environment variables declared in manifest exist
  - Check 5: Integration contracts for external services approved
  - Return: `{ ready: bool, blockers: [], warnings: [], checksPassed: {plan, worktree, policy, env, integrations} }`
- [ ] E4.2: Add `--task <id>` support: load task from `.amber/executions/<taskId>/plan.json`
- [ ] E4.3: Wire `amber execution readiness --target <repo> [--task <id>] [--json]`
- [ ] E4.4: Test: no approved plan → blocker; main branch → blocker; missing env var → blocker; all checks pass → green
- [ ] E4.5: Output: checklist table (check | status | blocker) + "Execution: READY / BLOCKED" + next action if blocked
- [ ] E4.6: Add `--strict` mode: treat warnings as blockers (for CI pre-execution gate)

---

## Verification Checklist (Phase 4 完成后)

- [ ] `npm test` — all existing + E1–E4 tests green
- [ ] `amber execution validate-loop --contract <file>` → schema validation + dry-run explanation
- [ ] Loop contract missing hardStops → explicit error
- [ ] `amber execution validate-pack --pack <path>` → detects unsafe scripts + undeclared env vars
- [ ] `amber execution validate-integration --contract <file>` → checks MCP schema + permission gates
- [ ] Integration with inline credentials → error
- [ ] `amber execution readiness --target . --task <id>` → pre-flight checklist
- [ ] Missing approved plan → blocker status
- [ ] All checks pass → "READY" status (but still doesn't execute)
- [ ] `npm run manifests` — green

---

## Notes

- **NEVER execute:** All E1–E4 commands are metadata validators; they MUST NOT:
  - Invoke live agents or spawn subagent sessions
  - Run target project commands (npm test, git push, etc.)
  - Call external APIs or account-bearing CLIs
  - Modify files outside `.amber/` directory
  - Schedule cron jobs or register hooks
- **Dry-run only:** E1 loop validation explains flow without executing; actual loop scheduling is ROADMAP Future Track.
- **Schema evolution:** E2/E3 validate against current manifest/contract schemas; update validators when schemas change.
- **Policy enforcement:** E4 readiness gate is the last check before future execution layers; passing E4 does NOT imply auto-execution.
- **Integration with V2:** E4 references plan approval from future V2 plan layer; stub plan schema for Phase 4, wire real schema in V2.
- **CI integration:** E4 `--strict` mode designed for CI pre-execution gate: "amber execution readiness --strict || exit 1".
- **Conservative defaults:** When uncertain about safety, E2/E3 should WARN or ERROR, not silently pass.
- **Connector contracts:** E3 validates contracts exist and are well-formed; actual connector invocation requires separate approval flow (future).
- **No false readiness:** E4 must never report READY if any safety check fails; false negatives (blocked when safe) are acceptable, false positives (ready when unsafe) are NOT.
