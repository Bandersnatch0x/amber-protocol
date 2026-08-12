# Plan: 修复 Amber MCP 治理与仓库隔离不变量

Feature: F018
Status: passing
User Confirmation: confirmed

## Goal

MCP Action 和 Function 只能通过受治理且仓库本地的 seam 执行或读取，并以准确错误语义失败关闭

## High Level Design

- Context:
  - Final review baseline: `HEAD eeef26040bb7e3da79180d2456cdded252e9b602` plus the complete uncommitted ontology v0.6 worktree.
  - Existing positive evidence is substantial (`29/29` targeted integration tests, `1674` repository tests passed, and all manifest/doctor/wiki/generated-skill gates passed), but the negative-path coverage does not enforce the governance claims.
  - The blockers are structural: Action metadata, command behavior, target resolution, execution policy, error semantics, and documentation currently provide multiple sources of truth.
- Invariants to establish in one place:
  1. **Configured repository invariant** — every Action and Function operates only on the canonical real path of a repository explicitly configured at server startup.
  2. **Read-only invariant** — an operation is executable without approval only when its complete parameterized behavior cannot write, approve, execute a target-project command, or create durable evidence.
  3. **Governed execution invariant** — the MCP adapter never directly executes a mutating Action; mutation is either returned as an approval-required submission or delegated through an explicitly governed runner adapter.
  4. **Contract parity invariant** — Action `mode`, effects, approver, evidence, command mapping, and command capability must agree before registration.
  5. **Fail-closed invariant** — corrupt governance state, unresolved real paths, unknown capabilities, and non-zero command results are errors, never empty/success states.
  6. **Protocol truth invariant** — ontology docs, MCP wire behavior, CLI exit behavior, generated help, and tests describe the same contract.
- Proposed approach:
  - Extract a deep repository-target module that owns configured targets, canonicalization, `_target` resolution, descendant checks, and Windows junction/symlink handling.
  - Extract a deep Action contract/runtime module that validates registration, classifies parameterized effects, and exposes separate read-only and governed-submission paths. `scripts/amber-mcp.js` remains the stdio/MCP adapter rather than owning policy decisions.
  - Make command capability metadata the single comparison surface for Action registration; validate all eight Action Types against it at startup and in tests.
  - Remove write-capable parameters from read-only MCP Actions. In particular, `amber.governance.report` returns content through MCP and does not expose `--output` while classified read-only.
  - Normalize successful empty queries at the CLI seam to exit `0`; then make every other non-zero child exit an MCP error without command-specific exceptions.
  - Keep Functions read-only and TTL-cached, but resolve every existing path through canonical real paths and include canonical configured repositories in cache keys.
- Risks:
  - Tightening `_target` is an intentional compatibility break for clients that relied on arbitrary per-call directories; document the migration to `--targets`.
  - Correcting empty-query exit codes may affect shell scripts that treated exit `1` as a valid empty result.
  - Action registration may fail at startup once semantic parity checks become strict; land corrected manifests in the same slice as the validator.
  - Do not broaden Amber into live orchestration, automatic target-project execution, or an autonomous execution platform while repairing the seam.

## Review Findings Covered

- `_target` can escape the configured repository set.
- Function path checks do not defend against symlink/junction real-path escape.
- `governance.report --output` is write-capable but declared read-only.
- Action approver/evidence declarations are not checked against actual command capabilities.
- The protocol can directly spawn future `autonomous/system` mutations without policy, approval, isolation, or ledger gates.
- Read-only child processes can exit non-zero while MCP reports success.
- Corrupt session manifests are ignored by the concurrency guard, making it fail open.
- Unknown Action wire behavior differs between the ontology document and MCP-native implementation.
- Wiki index implementation status contradicts ontology v0.6.
- Missing negative tests allow all of the above while the positive suite stays green.

## Vertical Slices

- [x] Slice 1: Characterize every blocker with failing tests before production changes.
  - Add integration cases for arbitrary existing `_target`, configured-target allow/deny, symlink/junction escape, `governance.report` with `output`, corrupt active-session manifests, non-zero read-only commands, Action contract mismatches, and unknown tools.
  - Add unit tests for canonical target containment and parameterized Action capability classification.
  - Preserve positive tests for Function schema validation, cache isolation/TTL, ownership writeback, conflict owners, MCP initialize/tools, and structured results.

- [x] Slice 2: Deepen the configured-repository module.
  - Canonicalize `--target` and every `--targets` entry once at startup with real-path resolution; reject missing, duplicate, or non-directory entries explicitly.
  - Resolve `_target` only to an exact member of that configured set; relative overrides are resolved first and then compared by canonical real path.
  - Centralize descendant reads behind one real-path-aware function that rejects symlink/junction escape and path traversal on Windows and POSIX.
  - Use canonical targets in Function context and cache keys; keep `--no-cache` and TTL behavior unchanged.

- [x] Slice 3: Establish semantic Action contract parity at registration.
  - Introduce one command-capability registry for the MCP-mapped command/subcommand variants: read/write effects, approval policy, evidence type, and whether direct read-only execution is permitted.
  - Reject unknown command mappings, unsupported variants, approver mismatches, evidence mismatches, effect mismatches, and write-capable parameters hidden behind a read-only declaration.
  - Correct all eight Action Type manifests against the real CLI behavior. Resolve the `session.verify` `verify-result` versus `timeline-event` mismatch from the command's persisted evidence, not by weakening validation.
  - Remove `output` from the read-only governance-report Action interface; MCP returns its report through content/structuredContent.

- [x] Slice 4: Separate read-only execution from governed mutation submission.
  - Delete the generic `mayExecute` path that lets metadata alone authorize direct mutation.
  - Permit child-process execution only for registry-proven read-only command variants with registry-proven read-only parameters.
  - Return mutating/interactive Actions as `approvalRequired` submissions without spawning them. If future MCP mutation execution is needed, require a separate governed-runner adapter with policy, approval, isolation, and ledger evidence; do not add it in this repair unless an existing CLI path satisfies all four gates.
  - Reject `autonomous` Action registration when no governed adapter exists; do not imply autonomous session support.

- [x] Slice 5: Make result and concurrency semantics fail closed.
  - Make MCP `isError` true for every unexpected non-zero exit, timeout, signal, spawn failure, contract failure, and governance-state read failure.
  - Change valid empty CLI queries to return exit `0` with an explicit empty structured result; remove the MCP exception that treats exit `1` as success.
  - Return an explicit conflict/governance error when any active-session manifest is unreadable or invalid; never ignore corrupt state in a decision gate.
  - Preserve own-session verify/approve behavior, ownership reporting, and the single-active-session invariant.

- [x] Slice 6: Align MCP wire behavior and durable documentation.
  - Choose MCP-native unknown-tool JSON-RPC errors as canonical and update the ontology wording; do not retain the obsolete `accepted=false` shape unless it is exposed as an actual custom method.
  - Update `docs/wiki/index.md`, ontology status, safety model, `_target` migration guidance, execution semantics, and CLI empty-result semantics.
  - Keep `AGENTS.md`/`CLAUDE.md` claims limited to behavior enforced by tests.
  - Re-run wiki validation and generated-agent drift checks.

- [x] Slice 7: Close the review and prepare command-surface convergence separately.
  - Re-run both Standards and Spec review axes against the final patch; require zero high/medium findings for the covered invariants.
  - Record executed verification evidence on F018 before changing status to passing.
  - After the typed seam is safe, open a separate approved feature for “intent router + deep journey skills + default-help projection.” Do not mix the 35-command user-interface redesign into this security repair or remove deterministic governance primitives here.

## Resume Checkpoint

- Resume Point: all seven slices implemented; status `passing`. All automated verification gates green (1711 tests, manifests/doctor/wiki/gate 0 errors).
- Blockers: none.
- Next Action: optional follow-up — open the separate approved feature for "intent router + deep journey skills + default-help projection" (command-surface convergence), keeping it isolated from this security repair. Do not add a mutation-executing governed runner adapter inside F018.
- Recovery Instructions: the typed seam lives in `scripts/lib/mcp-targets.js`, `scripts/lib/mcp-action-contracts.js`, and `scripts/lib/mcp-registry-loader.js`; `scripts/amber-mcp.js` consumes them. Never regenerate or overwrite this plan.

## Acceptance Criteria

- `_target` accepts only canonical repositories supplied by `--target`/`--targets`; arbitrary existing directories fail with JSON-RPC `-32602`.
- Functions cannot escape a configured repository through `..`, absolute paths, symlinks, or Windows junctions.
- No parameter combination classified read-only can create or modify a file.
- Every Action Type passes semantic parity validation for command existence, effects, approver, evidence, and execution policy; a deliberately mismatched fixture is refused at registration.
- MCP directly executes only proven read-only variants. Every mutation is non-executing and approval-required unless a four-gate governed adapter is explicitly present.
- Non-zero exits, timeouts, signals, corrupt governance state, and contract failures are surfaced as errors; valid empty queries return exit `0`.
- Corrupt manifests make the concurrency decision fail closed without losing ownership information for valid sessions.
- Unknown tools, documentation, and tests agree on the MCP-native error shape.
- Function schema validation, cache isolation/TTL, owner writeback, conflict owners, and structuredContent continue to work.
- The final Standards and Spec reviews report no remaining high or medium findings within F018 scope.
- No dynamic workflow execution, live subagent dispatch, automatic target-project command execution, or user-file overwrite behavior is introduced.
- **Phase boundary guardrails**: this repair preserves the current governance-only phase boundary — it tightens the typed seam and adds no execution scope. Explicit guardrails: no live orchestration, no autonomous execution platform, no four-gate governed runner adapter is introduced here, and the 35-command intent-router/UI redesign is deferred to a separate approved feature.

## Verification

- node --test tests/unit/mcp-targets.test.js tests/unit/mcp-action-contracts.test.js
- node --test tests/integration/action-type-schema.test.js tests/integration/amber-mcp.test.js
- npm test
- npm run manifests
- npm run doctor
- npm run gen:agents:check
- node scripts/validate-wiki.js --target .
- node scripts/amber.js gate --target . --plan docs/plans/F018-Amber-MCP.md
- final two-axis code review against the frozen implementation baseline

## Evidence Schema

- Command: `node --test tests/unit/mcp-targets.test.js tests/unit/mcp-action-contracts.test.js tests/integration/action-type-schema.test.js tests/integration/amber-mcp.test.js`
- Result: 59/59 pass (incl. negative-path characterization: unconfigured `_target`, `--output` rejection, non-zero read-only → isError, corrupt-manifest fail-closed, junction escape, contract mismatch refused, unknown-flag fail-closed).
- Command: `npm test`
- Result: 1711/1711 pass, 4 skipped (baseline was 1674; targeted F018 coverage includes Action and Function manifest-schema failures, exact effects parity, and runtime extraction paths).
- Command: `npm run manifests` / `npm run doctor` / `npm run gen:agents:check` / `node scripts/validate-wiki.js --target .` / `node scripts/amber.js gate --target . --plan docs/plans/F018-Amber-MCP.md`
- Result: all green — 0 errors (manifests, doctor, wiki), 31 generated-agent files up to date, F018 gate 0 errors.
- Date: 2026-08-12
- Notes: Six invariants enforced in deep modules (`scripts/lib/mcp-targets.js`, `scripts/lib/mcp-action-contracts.js`, `scripts/lib/mcp-registry-loader.js`, and `scripts/lib/mcp-action-runtime.js`); `scripts/amber-mcp.js` remains the stdio/MCP protocol adapter. Session manifests now fail closed on missing, malformed, or schema-invalid state. `session.start` no longer exposes autonomous mode. Mutations are always `approvalRequired` and never spawned; only registry-proven read-only variants execute. Protocol server version is `0.7.0`. No dynamic execution / live dispatch / auto target-project execution / user-file overwrite introduced.
- Artifact or session id: `docs/plans/F018-Amber-MCP.md`; modules under `scripts/lib/mcp-*.js`; tests under `tests/unit/mcp-*.test.js` and `tests/integration/amber-mcp.test.js`.
- Remaining risk: `_target` tightening is an intentional compatibility break (documented migration to `--targets`); `loop recommend` on a pack-less repo stays exit 1 by existing CLI contract and now correctly surfaces as `isError` (structuredContent still shipped). The 35-command intent-router/UI convergence is deliberately deferred to a separate feature (Slice 7).
