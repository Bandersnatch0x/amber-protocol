# F076: Harness Cross-Run Diff (the H5 Replay Lineage's Comparison Across Two Runs)

**spec_id:** F076
**Status:** accepted
**Updated:** 2026-09-24
**Provenance:** Harness v2 proposal §7 (Replay Model) + §20 (`harness diff <run-a> <run-b>`) + §43 (the H5 gate, already reached by F073); F073 as the staged foundation (its spec named `harness diff` explicitly out of scope — "cross-run comparison belongs with H5's replay lineage, a separate ticket"); F072's lifecycle view and checkpoint digests (the recursive canonicalization precedent); the H5 replay axes (contract/tools/execution/context/policy/attempts) as the comparison vocabulary; user direction 2026-09-24 (「先做2,3,4」)
**Feature:** F076

## Problem Statement

H5's replay answers "would THIS run still hold?" by re-deriving one run's axes. The
§20 surface also names `harness diff <run-a> <run-b>` — "did two runs of the same
task run under the same world?" — and nothing answers it: a retry pair (Run #1 FAILED,
Run #2 COMPLETED, ADR-0101) has no declared comparison, so "what changed between the
failed attempt and the successful one" is answered by eyeballing two JSON files.

## Solution

`amber harness diff --from <runId> --to <runId>` — a read-only comparison of two
runs over the SAME six-axis vocabulary the replay engine uses, derived from the two
frozen records (no chat history, no re-execution, no new authority):

- **Per-axis comparison**: for each §7 axis, each run's frozen fact is derived exactly
  as the replay engine derives it (contract snapshot hash, tools snapshot hash,
  execution effective-boundary presence + comparison verdict, admission receipt
  completeness + trail witness, policy frozen ref + trail verdict, attempts summary) —
  and the two runs' facts are compared: `same | differs | only-a | only-b`
  (`only-*` = the axis has a frozen fact on one side and none on the other;
  disclosed, never guessed).
- **The verdict**: `equivalent-world` when every shared axis is `same`; `world-drift`
  when any shared axis `differs`; `incomparable` disclosed when the runs share no
  axis facts at all. The outcome states of the two runs are reported side by side
  but NEVER compared into the verdict — outcome is the runs' own business (a FAILED
  run under an equivalent world is exactly the no-progress signal the attempts axis
  already reports).
- **Zero new artifacts**: the diff is a command response, not a stored record (both
  sides are already immutable records; a diff of immutable records is reproducible by
  re-running the command — no receipt/proposal is warranted here, keeping H5's
  artifact discipline intact). Read-only: writes nothing, fails closed on corrupt
  records through the same readers.
- **Additive everything (ADR-0012)**: no schema change, no new event kinds, no new
  error codes beyond reuse of the readers'.

## User Stories

1. As a maintainer, I want `harness diff --from --to` to compare two runs of one task
   over the same axes the replay uses, so that "what changed between them" is one
   readable answer.
2. As a reviewer, I want per-axis `same | differs | only-a | only-b`, so that a
   partially-overlapping pair is disclosed rather than silently narrowed.
3. As a governance owner, I want the comparison to be read-only and derive from
   frozen facts only, so that diffing grants no authority and mutates nothing.

## Implementation Decisions

- **Reuse the replay derivation verbatim**: the axis facts are derived by the same
  `deriveAxes` logic the replay engine uses (composed, never re-implemented) — the
  comparison is a fold over two derivations, and a conformance test asserts the
  per-axis fact for a single run equals what `harness replay --run` reports for that
  axis (same core).
- **CLI (expert tier, untyped)**: `harness diff --from <id> --to <id>`; both flags
  required (a one-sided diff is not a diff); no new flags beyond these two (add to
  FLAG_SPECS with the raw-CLI smoke the H4/H6 discipline requires). Disclosed
  divergence from the §20 sketch: the proposal names the surface positionally
  (`diff <run-a> <run-b>`); the delivered surface requires the explicit
  `--from`/`--to` flags and accepts no positional run ids, so each run id's role
  stays unambiguous under the `harness <subverb>` convention — behavior of the
  comparison itself is unchanged.
- **Naming/seam/guard constraints identical to F065–F074.**

## Testing Decisions

- Conformance at the real path: two runs created under the same fixtures diff
  `equivalent-world`; a tool admitted between the two runs (the real F052 fixture
  chain) flips the tools axis to `differs` → `world-drift`; a run with no tool
  snapshot vs one with → `only-a`/`only-b`; identical axis facts for ONE run equal
  what `harness replay` reports; corrupt records fail closed; the command writes
  nothing (bytes pinned).
- CLI smoke through the real dispatcher (both flags through the real parseArgs path).

## Out of Scope

- Storing diffs as records (reproducible by re-running — see Solution);
  cross-TASK diffs (same-task pairs are the discipline; a cross-task diff would
  compare unrelated worlds and is refused — both runs must share the same
  `subject.task` when both declare one, else disclosed as `unrelated` and refused);
  execution `terminate` (settled by F078 as an explicit zero-write refusal: Amber
  owns no cancellable live-process handle and never fakes kill with cancel+release);
  MCP projection.

## Further Notes

- Design decisions follow the standing user directive (0066 close-out follow-ups;
  this session's「先做2,3,4」). The HITL gate for draft → accepted is `issues/0124`.
