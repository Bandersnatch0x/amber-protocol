# F070: Harness H2b — Governed-Runner Wiring (Prepared Workspaces, Per-Mutation Observation)

**spec_id:** F070
**Status:** draft
**Updated:** 2026-09-23
**Provenance:** Harness v2 proposal §13 (Declared/Effective/Observed), §24 (Amber does not own the sandbox), §31 (H2 Specification + acceptance), §40 (Phase H2 gate); F068 H2a as the staged foundation (its spec named H2b as explicitly out of scope); ADR-0100/0101/0102; the G-9 row 11 seam (`execution-domain-adapter.js`, `setExecutionAdapter`); wayfinder map `issues/0066`; user direction 2026-09-23 (「继续推进v2.2」)
**Feature:** F070

## Problem Statement

H2a proved the objects: an admitted ExecutionContract, an EFFECTIVE report, and a
deterministic Declared-vs-Observed fold. But the wiring is still open: a real governed
execution (`runGovernedCommand`) never enters the adapter-prepared workspace — the
execution-domain-adapter creates and destroys its own throwaway worktree per attempt — and
no per-mutation observed record is produced by a run. `evaluateExecution` folds only
caller-supplied observed files, once, and refuses growth. The §40 H2 gate ("Where did it
run? What could it access? What did it actually modify?") is answerable only by hand-built
fixtures. One H2a gap makes it worse: a `local`-type workspace points at the repo root
itself, so "main checkout 不作为默认 cwd" (§31 acceptance) does not hold for local
contracts.

## Solution

Wire the governed runner to the H2a objects, behind the seams that already exist:

- **Prepared-workspace consumption through the G-9 row 11 seam**: `runGovernedCommand`
  grows an additive, optional `preparedWorkspacePath`. When present, execution delegates
  through the SAME `execution-domain-adapter` seam to a new adapter method
  `executeInPreparedWorkspace` — the prepared workspace is the cwd, and neither
  `createWorktree` nor auto-`removeWorktree` runs (the workspace must outlive the command
  for observation). Absent the option, behavior is byte-for-byte today's. The FOUR GATES
  (policy, approval, ledger, frozen-admission verification) stay in Core, run unchanged,
  and always precede any effect. Core still never imports `worktree-manager` or
  `child_process` at module load (guards G1/G8 unchanged).
- **Per-mutation observation is deterministic**: after each governed attempt inside the
  prepared workspace, the workspace's dirty-path classification (the adapter's existing
  `observe()` / `getRepoSnapshot` — no new observation mechanism, no OS watchers) is
  appended as one immutable observed entry bound to the attempt (attemptId + governed
  ledger pointer as `source`). Per-attempt dirty-path delta is the finest deterministic
  granularity Amber can own; per-write interception is a sandbox feature Amber does not
  own (§24).
- **Observed grows; the fold recomputes**: `evaluateExecution` drops the one-shot refusal.
  The observed trail is append-only; the comparison is the same deterministic
  `compareBoundaries` fold recomputed over the FULL trail at each evaluation; the verdict
  enum stays closed (`ok | violation | unevaluated`); BLOCK posture is unchanged
  (violation → `execution.failed` event, running→blocked / created/admitted→cancelled;
  resolved only by BLOCKED→RUNNING human-review recovery or a contract revision, never by
  widening).
- **Main checkout is never the default cwd**: preparing a `local`-type workspace creates a
  bounded scratch root under the harness state area (the effective report shows the bounded
  root). Additive change; existing H2a records stay valid.
- **Explicit release**: preparation and release are separate recorded steps.
  `amber harness execution release --run <id>` removes a prepared git-worktree through the
  ONE worktree seam and records `releasedAt` (additive). A finished command never silently
  deletes the workspace.
- **CLI (expert tier, untyped)**: `amber harness execution run --run <id> --command-id <id>`
  executes ONE governed named command inside the prepared workspace — the same closed
  `resolveCommandId` policy surface, the same four gates, the same ledger — then observes
  and folds automatically. `amber harness execution release --run <id>` closes the
  workspace. `inspect --run` remains the one three-boundary view.

## User Stories

1. As a maintainer, I want a governed command for a run to execute inside the
   adapter-prepared workspace, so that "Run 使用独立 workspace" holds for real executions
   and not only for records.
2. As a reviewer, I want each governed attempt in the prepared workspace to append a
   deterministic mutation-observation entry, so that the observed trail is produced by the
   run itself instead of hand-built fixtures.
3. As a reviewer, I want the observed trail to grow and the comparison to recompute over
   the full trail, so that a multi-attempt run ends with one readable verdict.
4. As a reviewer, I want an observed-outside-declared mutation to BLOCK the run
   (`execution.failed`, running→blocked), so that nothing silently continues past its
   contract.
5. As a maintainer, I want a `local`-type workspace to prepare a bounded scratch root, so
   that the main checkout is never the default cwd of a prepared run (§31).
6. As a maintainer, I want `release` to remove the prepared workspace as a recorded step,
   so that workspace lifetime is explicit and auditable.

## Implementation Decisions

- **Compose the row-11 seam, never bypass it**: the wiring rides
  `execution-domain-adapter.js` + `setExecutionAdapter` exactly as G-9 row 11 landed it;
  no second spawn path, no second worktree implementation. New adapter method first,
  governed-runner option second, harness caller third — each covered by its own test.
- **The four gates stay Core and precede any effect**: the harness caller invokes
  `runGovernedCommand`; it never re-implements or reorders a gate. The command executed is
  a closed named command from `rules.json` (`resolveCommandId`); prefix/fuzzy rules are not
  accepted here either.
- **Observation rides existing seams**: dirty-path classification via the adapter's
  `observe()` (getRepoSnapshot); the observed entry shape matches what
  `compareBoundaries` already folds (`kind: "mutation"`, `paths`, `source`); the
  unevaluated-mutation finding's "H2b wires per-mutation observation" note becomes true.
- **Additive record growth follows ADR-0012**: `releasedAt` and per-attempt observation
  fields are additive on the inline ExecutionRecord shape check; pre-H2b records stay
  valid; no new schema file (schema-count pin unchanged).
- **New error codes register in the catalog** (`AMBER_E_HARNESS_EXEC_*` family) — the
  error-catalog test refuses unregistered literals.
- **CLI stays untyped, expert tier**; new `execution` subverbs join the existing surface;
  flag mapping must be smoke-tested through the real CLI (the parseArgs FLAG_SPECS
  whitelist silently turns unregistered flags into positionals).

## Testing Decisions

- Conformance at the seams: `executeInPreparedWorkspace` runs in the given path and creates
  no worktree (`listWorktrees` unchanged); `runGovernedCommand` with
  `preparedWorkspacePath` leaves the main checkout clean while the mutation lands in the
  prepared workspace; a violating mutation (outside declared write prefixes) produces the
  violation verdict, the `execution.failed` event, and the run BLOCK transition; observed
  growth appends and recomputes; `release` removes the worktree and records `releasedAt`;
  local prepare creates a bounded root.
- Real temp git repos for anything touching the worktree seam, as in H2a.
- CLI smoke through the real dispatcher for the new subverbs (hook both console.log and
  process.stdout.write in JSON-mode assertions).

## Out of Scope

- Sandbox runtimes (Docker/WSL/CI/Remote adapters); network enforcement; per-write OS-level
  interception (a sandbox feature, §24); replay (H5); scheduler (H7); MCP projection;
  H3b (context-firewall verdicts into the actual loading path — its own fog ticket);
  homepage/charter change.

## Further Notes

- Design decisions above follow the standing user directive (map `issues/0066`: 执行带入,
  「按 dev workflow 完成所有规划的任务」; this session's「继续推进v2.2」continues it).
  The HITL gate for draft → accepted is `issues/0100`.
- Naming/seam/guard constraints identical to the F065–F069 batches (the same banned-string
  allowlist the legacy-references test enforces; state-dir seam; no new root .md).
