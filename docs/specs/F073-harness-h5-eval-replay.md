# F073: Harness H5 — Eval & Replay (ValidationReceipt, Drift Detection, Regression Proposals)

**spec_id:** F073
**Status:** accepted
**Updated:** 2026-09-23
**Provenance:** Harness v2 proposal §7 (Replay Model: what replay must not depend on, the drift candidates), §16 (Validation Specification: static/dynamic/behavioral/evidence → a receipt, not an exit code), §17 (Eval Loop: eval may find problems but never changes governance), §26 (Eval Does Not Mean Authority), §34 (H5 Specification + acceptance), §43 (Phase H5 gate: `amber harness replay run-123` completes without chat history), §46.5 (replay test matrix), §51C/D (validation + replay acceptance); ADR-0102 (event vocabulary — `validation.completed` has sat in the closed enum since H0 with no producer); F065–F072 as the staged spine (run record snapshots, tool snapshot, execution records, attempt records, event ledger); the F054 detector/findings precedent (deterministic findings, human triage); wayfinder map `issues/0066`; user direction 2026-09-23 (「继续推进v2.2」)
**Feature:** F073

## Problem Statement

The run record already freezes its world — contract Snapshot Hash, tool-registry
snapshot, admission receipt, execution declared/effective/observed trail, the full
tamper-evident event ledger — but nothing reads that frozen world back. There is no
ValidationReceipt (§51C: "Run 有 Validation Receipt" is unanswerable), and the
`validation.completed` event kind has sat in the closed enum since H0 with zero
producers. Replay (§7) is the architecture's named differentiator and the §43 gate is
explicit — `amber harness replay run-123` must complete **without chat history** — yet
no command even compares a run's snapshots against the current tree. When a run failed
or drifted, nothing proposes a regression candidate for human review (§17's Finding →
Proposal → Human Review chain has no harness end).

## Solution

Two deterministic, model-independent surfaces over the frozen run — an evaluator and a
replayer — plus one human-only consumer. Neither executes anything, neither mutates
governance state, and neither reads any chat/conversation source (§7: replay may not
depend on chat history, current mutable policy, current tool registry, current working
directory, or current context — the replay reads the run's own records and the current
artifact hashes only):

- **ValidationReceipt** (`scripts/lib/harness/validation-core.js`):
  `amber harness validate --run <id>` walks the run's own records through a closed
  check set — `policy` (a `policy.evaluated` event exists on the trail and none is
  deny), `execution` (no prepared record → `not-run` with the reason; a prepared
  record's comparison verdict must not be `violation`), `tools` (a tool snapshot is
  present **or** the run predates H1 — reported as `not-run`, never invented),
  `context` (the admission receipt is complete — the six checks all pass),
  `evidence` (the run's event chain verifies — the ledger fold is re-walked), and
  `attempts` (every attempt record is terminal — no `running` attempt dangles on a
  settled run). Each check lands `pass | fail | not-run` (`not-run` is the honest
  disclosure — a missing check can never silently read as passing; §16's "Validation
  只生成 Receipt，而不是只返回 exit code"). The receipt is a JSON record under
  `.amber/harness/validations/<runId>/<receiptId>.json` (closed inline shape, immutable
  once written for a given evaluation — re-validating after the run changed appends a
  new receipt keyed by content; re-validating an unchanged run is idempotent) and
  emits the enum's first `validation.completed` event
  (run-scoped, pointers citing the receipt file). `result.status` is `accepted` only
  when every check is `pass` or an honestly-motivated `not-run`; any `fail` lands
  `rejected`. Task outcome and validation stay separate facts (§4.6: Task Result PASS
  with Policy FAIL cannot overwrite each other) — the receipt never touches the run's
  state machine.
- **Replay engine** (`scripts/lib/harness/replay-core.js`):
  `amber harness replay --run <id>` re-derives each §7 axis from the run's records and
  compares it to what the run froze — no chat history, no conversation state:
  - `contract`: the admitted contract record still hashes to the frozen
    `contractSnapshotHash` (re-hash the stored record, never re-admit);
  - `tools`: the current tool registry's snapshot hash equals the frozen
    `tools.snapshotHash` (a registry admitted/changed since → tool drift);
  - `execution`: the prepared execution record still exists and its frozen effective
    boundary is unchanged (a released/missing workspace is reported as the recorded
    fact — release is a recorded step, not drift; a record that fails its closed
    shape lands as execution-axis environment drift, per-axis — it never aborts the
    replay);
  - `context`: the admission receipt is complete AND consistent with the trail (the
    `run.admitted` chain event witnessed the receipt; a record that lost its receipt
    while the trail still carries the witness is drift — tampering, not silence).
    Pointers are cited verbatim, not re-resolved to artifacts; the context *grant*
    surface is NOT re-evaluated — grants are TTL-bound and the run's authority was
    settled at admission;
  - `policy`: the frozen `harness.policy` ref is compared against the
    `policy.evaluated` trail event (what the run actually operated under);
  - `attempts`: the attempt fold is re-derived against the run's frozen
    `attempts` summary (count, last attempt id, last attempt state) — a
    mismatch between the frozen fact and the records is non-determinism
    drift.
  Each axis lands `equivalent | drift | unevaluated` (unevaluated = the axis has no
  frozen fact to compare — disclosed, never guessed). The §7 candidate causes
  (`environment-drift`, `policy-drift`, `tool-drift`, `context-drift`,
  `model-drift`, `non-determinism`) are the closed drift-kind enum:
  `tool-drift`, `context-drift`, `policy-drift`, `environment-drift` (contract
  or execution record), `non-determinism` (attempts fold vs the frozen
  summary). `model-drift` is RESERVED in the enum as the explicit §7 residual
  candidate — no surface emits it today (Amber has no model introspection), so
  it is a named placeholder, never a produced verdict.
- **Comparison + regression proposal** (inside `replay-core.js`): the replay result is
  the comparison (`original` run outcome vs `replay` verdict vs per-axis drift).
  `amber harness propose-regression --run <id>` derives a regression proposal ONLY
  from recorded facts (the run's terminal outcome is `failed`/`cancelled`, or the
  replay found drift) — never from caller input (the F054 `propose` discipline). The
  proposal is a JSON record (`rg-*.json`) under `.amber/harness/replays/<runId>/`
  citing the run, the
  replay verdict, and the exact drift kinds; it is DATA for human review (§17: eval
  finds problems, humans change governance — no command here touches a policy, rule,
  contract, or grant; a conformance test asserts the policy/rules files are
  byte-identical after validate+replay+propose on a drifted run).
- **Additive everything (ADR-0012)**: the run record grows an optional `validation`
  summary (`{status, receiptedAt}`) and an optional `replay` summary
  (`{verdict, replayedAt}`) — absent on pre-H5 records; no new schema file (schema
  pin unchanged at 28); receipt/replay/proposal record shapes are closed inline shape
  checks (the H2a/F072 precedent).
- **New error codes register in the catalog** (`AMBER_E_HARNESS_VALIDATION_*`,
  `AMBER_E_HARNESS_REPLAY_*`).

## User Stories

1. As a reviewer, I want `amber harness validate --run <id>` to produce a
   ValidationReceipt with per-check pass/fail/not-run, so that "did this run actually
   pass validation" is an artifact, not an exit code.
2. As a maintainer, I want `validation.completed` on the trail, so that the event
   ledger's validation vocabulary is real instead of reserved.
3. As a successor agent or person, I want `amber harness replay --run <id>` to answer
   "would this run still hold?" from records alone, so that continuation does not
   depend on any chat history (the §43 gate and the H5 「不依赖聊天历史」 acceptance).
4. As a reviewer, I want each axis reported equivalent/drift/unevaluated with the
   closed §7 drift kinds, so that drift is named, not guessed.
5. As a maintainer, I want a failed/drifted run to yield a regression proposal derived
   only from recorded facts, so that the §17 Finding → Proposal → Human Review chain
   has its harness end.
6. As a governance owner, I want validate/replay/propose to be structurally unable to
   mutate policy, contracts, rules, or grants, so that eval can never change
   governance by itself (§17/§26).

## Implementation Decisions

- **Replay is verification, not re-execution**: the replay re-derives and compares
  frozen facts; it never re-runs the governed command. Re-execution stays with the
  governed runner (F070) and is a NEW run (retry is a new run, ADR-0101) — a replay
  that wants to re-execute prepares a fresh run and compares runs. This keeps Amber's
  `executesAnything: false` boundary intact.
- **Read-only by construction**: validate/replay/propose write only their own records
  (`.amber/harness/{validations,replays,regressions}/`) and the two additive run
  summaries; the conformance test asserts policy/rules/contract/grant files are
  byte-identical across a full drifted-run cycle.
- **Compose the H4 folds**: the evidence check re-walks the event ledger's fold; the
  attempts check reuses `listAttempts`/terminal states; the tools axis reuses the
  `toolsSnapshot` hashing; no second trail, no parallel hash implementation.
- **CLI stays untyped, expert tier**: `harness validate --run`, `harness replay
  --run`, `harness propose-regression --run` join the existing surface; no new flags
  beyond the existing `--run`; raw-CLI smoke for any flag mapping change (the
  parseArgs whitelist trap).
- **Naming/seam/guard constraints identical to F065–F072**: banned strings out; all
  paths through `statePath()`/`statePathForCreate()`; new files `git add`ed
  explicitly before the full suite (F063 N4); lint/format full gates (not per-file).

## Testing Decisions

- Conformance at the real path: a clean run validates `accepted` (policy pass,
  evidence pass, tools not-run disclosed, context per receipt, attempts terminal) and
  emits `validation.completed`; a run with a boundary-violation comparison validates
  `rejected` (execution fail); replay on an untouched fixture target reports all
  axes `equivalent`/`unevaluated`; admitting a new tool after the run freezes →
  replay reports `tool-drift` (the §46.5 matrix: same environment → equivalent;
  tool drift detected; policy drift detected via a changed frozen ref vs trail;
  context/execution drift via a mutated admission pointer artifact and a corrupted
  execution record; non-determinism via an attempts-fold mismatch fixture);
  `propose-regression` refuses on a clean passing run (nothing to propose), produces
  a proposal on a failed run and on drift; the governance-untouched assertion (no
  policy/rules/contract/grant byte change) covers every command in the surface.
- CLI smoke through the real dispatcher for the three subverbs.

## Out of Scope

- Command re-execution (replay never re-runs anything — retry is a new run);
  `model-drift` detection beyond the explicit residual (no model introspection);
  eval-suite integration (`amber eval run` stays the instruction-surface surface,
  F058); scheduler/daemon (H7 frozen); MCP projection; H6 control plane;
  homepage/charter change.

## Further Notes

- Design decisions above follow the standing user directive (map `issues/0066`: 执行带入;
  this session's「继续推进v2.2」continues it). The HITL gate for draft → accepted is
  `issues/0115`.
- The §43 gate demo (`amber harness replay run-123` without chat history) lands as an
  orchestration artifact under `.scratch/orchestration/f073-h5/`.
