# F068: Harness H2 — Execution Boundary (Contracts, Adapters, Comparable Boundaries)

**spec_id:** F068
**Status:** accepted
**Updated:** 2026-09-22
**Provenance:** Harness v2 proposal §13/§24/§31 (Execution Boundary) and §23 (drift table); F052 runner declared prefixes / F062 stage verbs / F066 vertical slice as the existing authority surfaces; `scripts/lib/worktree-manager.js` (the one worktree seam the governed runner already uses); ADR-0100/0101/0102; wayfinder map `issues/0066`; user confirmation 2026-09-22 (`issues/0088`, 「按推荐」)
**Feature:** F068

## Problem Statement

Today a governed execution's boundary is real but scattered: the F052 capability declares
path prefixes / timeout / credential class, the governed runner isolates in a git worktree,
and the execution ledger records what happened — but there is no single **declared**
ExecutionContract artifact, no **effective** boundary report from the workspace provider, and
no **observed**-vs-declared comparison a reviewer can read. Harness v2 §13's rule ("Declared
vs Effective vs Observed must be comparable; Observed > Declared must BLOCK, never silently
continue") is enforced only implicitly inside the runner. Without an admitted contract and a
comparable report, execution drift is a review-time archaeology project.

## Solution

A **staged H2** (this spec = H2a; the governed-runner wiring is H2b):

- **ExecutionContract** (`schemas/execution-contract.schema.json`, `apiVersion amber.dev/v1`):
  the DECLARED boundary as an admitted, immutable artifact (the H0 pattern):
  `workspace` (type `git-worktree` | `local`, base), `filesystem` (read/write/deny path
  prefixes), `network` (mode, default `deny`), `resources` (timeout minutes, max children),
  `mutation` (mode `isolated` | `restricted`). Admitted through
  `amber harness execution admit|list|inspect` with Snapshot Hash, tombstone lists, and
  fail-closed reads — byte-for-byte the contract/tools pattern.
- **ExecutionAdapter interface + two first adapters** (§31): an adapter prepares a workspace
  and reports the **EFFECTIVE** boundary it actually provided. `GitWorktreeAdapter` composes
  the existing `worktree-manager.js` (the one seam the governed runner already uses — no
  second worktree implementation); `LocalAdapter` prepares a bounded root. Amber does not own
  the sandbox (§24): adapters prepare, report, and clean up — they never execute target
  commands (execution stays with the existing governed gates).
- **Comparable boundary record** (§13): the run's additive `execution` section (F065 already
  reserves `execution.ref`) grows to `{contract, contractSnapshotHash, effective, observed,
  comparison}` where `observed` folds the existing governed-execution ledger records
  (refusals, mutations, receipts) that cite the run. `comparison` is a deterministic fold:
  observed-within-declared → `ok`; observed outside the declared prefixes/limits → `violation`
  and a `execution.failed`-adjacent refusal event — never a silent continuation.
- **H2b (explicitly out of this spec)**: wiring the governed runner to execute inside the
  adapter-prepared workspace and to emit per-mutation observed records. H2a proves the
  objects and the comparison on records that already exist; H2b touches
  `governed-runner.js` behind its own ticket and evidence.

## User Stories

1. As a maintainer, I want to admit an ExecutionContract declaring workspace, filesystem
   prefixes, network mode, and resource limits, so that the declared boundary is one
   reviewable artifact.
2. As a maintainer, I want `prepare` to hand back the EFFECTIVE boundary the adapter actually
   provided (worktree path, base commit, applied prefixes), so that declared vs effective can
   be compared instead of trusted.
3. As a reviewer, I want the run's execution section to show declared / effective / observed
   side by side with a deterministic comparison verdict, so that drift is readable without
   archaeology.
4. As a reviewer, I want an observed-outside-declared finding to surface as a violation
   record (BLOCK posture), so that nothing silently continues past its contract.
5. As a maintainer, I want the adapter to reuse the existing worktree seam, so that there is
   exactly one worktree implementation and the governed runner's behavior is unchanged.
6. As a successor agent, I want `amber harness execution inspect` to present the whole
   boundary picture for one run, so that "它在哪里运行、能碰什么、实际碰了什么" is one view.

## Implementation Decisions

- **Compose, never duplicate**: `GitWorktreeAdapter.prepare` calls the existing
  `createWorktree` seam; adapters are pure boundary reporters — no execution, no new
  isolation runtime (§24).
- **Admission follows the H0 pattern** (Snapshot Hash, immutability, tombstones); storage
  under the harness state area; no new ledger family (contracts are declarations).
- **Observed folds existing records**: the governed execution ledger already records actions,
  refusals, and receipts; the comparison folds those citing the run — H2a writes no new
  observation mechanism.
- **Network mode default `deny`** in the schema description; H2a does not enforce network —
  it declares it, and enforcement remains where it is today.
- **Run integration is additive** (ADR-0012 conventions); pre-H2 records stay valid; the
  comparison verdict enum is closed (`ok | violation | unevaluated`).
- **CLI stays untyped, expert tier**; `harness execution` subcommands join the
  untyped-subcommand list; schema-count pin 26→27 in the same batch.

## Testing Decisions

- Conformance tests at the existing seams: contract admit/immutable/tombstone (tool pattern);
  GitWorktreeAdapter.prepare against a real temp git repo asserting the effective report and
  that the created worktree is visible to `worktree-manager.listWorktrees`; LocalAdapter
  bounded root; the comparison fold over fixture ledger records (ok / violation / unevaluated);
  run-section additive round-trip.
- A good test asserts externally observable behavior (JSON shapes, refusal codes, verdicts),
  never internal helpers.

## Out of Scope

- H2b governed-runner wiring (separate ticket, own evidence); sandbox runtimes
  (Docker/WSL/CI/Remote adapters — later); network enforcement; replay (H5); scheduler (H7);
  MCP projection; homepage/charter change.

## Further Notes

- Design decisions above were **confirmed by the user 2026-09-22 (`issues/0088`, 「按推荐」)**;
  the confirmation ticket is closed and this spec is accepted.
- Naming/seam/guard constraints identical to F065–F067 batches.
