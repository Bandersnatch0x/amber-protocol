# F074: Harness H6 — Control Plane (the Aggregated Surface over the Shared Core)

**spec_id:** F074
**Status:** accepted
**Updated:** 2026-09-24
**Provenance:** Harness v2 proposal §20 (CLI Architecture: the existing commands stay compatible; `amber harness` is the ONE aggregation entry), §35 (H6 Specification + the target command list), §44 (Phase H6 gate: 新旧 CLI 共同使用同一个 Core); F065–F073 as the landed cores (contract/tool/execution/context/run/event/validation/replay); the F063 tier mechanism (expert tier by registration, the default seven-verb help surface unchanged); ADR-0102 (event vocabulary); wayfinder map `issues/0066`; user direction 2026-09-24 (「继续」)
**Feature:** F074

## Problem Statement

The harness cores are landed, but the §35 surface is not fully aggregated: `harness
trace`, `harness events`, `harness policy check`, `harness capabilities`, and `harness
eval` do not exist as harness verbs. What exists today is scattered — `harness inspect
--run` shows the run + its events as a side-effect of §38, `harness tool check` answers
the policy verdict for ONE tool, `amber eval run` lives on the F058 surface. Nothing is
wrong with the cores; the control-plane aggregation is missing. The §44 gate is
explicit: 新旧 CLI 共同使用同一个 Core — the aggregation must compose the existing
cores verbatim (zero new semantic verdicts), keep every old command byte-compatible,
and leave every mutating operation exactly as gated as it is today.

## Solution

Five read-only subverbs over the shared cores — the last of which is a governed
*alias*, not a new authority:

- **`harness trace --run <id>`**: the run's causal line in one view — the run record
  (state, subject, harness refs, additive summaries), its state history, its admission
  pointers, and its full run-scoped event trail in order. Composes `getRun` +
  `readRunEvents` verbatim (the §38 gate shape, factored out of the `inspect --run`
  branch, which keeps its exact shape for compatibility). A corrupt run or chain fails
  closed through the readers.
- **`harness events [--run <id>]`**: the run-scoped event stream alone (`--run`) or the
  whole verified harness ledger (no `--run`). Composes `readRunEvents` /
  `readHarnessEvents` verbatim. The ledger fold re-walks the chain — a corrupt event
  refuses the read.
- **`harness policy check --run <id>` / `--tool <id>`**: the run's policy posture
  from the trail — the `policy.evaluated` events (verdict, policy ref, timestamps),
  the frozen `harness.policy` ref, and the replay/validate axes' policy verdicts when
  recorded — or, as a separate leg, the connector ≠ permission verdict for ONE tool
  (`checkHarnessTool` verbatim, the same citation `tool check` gives; one leg per
  invocation). Report-only: it computes nothing, gates nothing, and can never deny or
  allow an operation (the §35 surface describes control-plane *visibility*; the
  enforcement stays inside the governed runner, unchanged).
- **`harness capabilities`**: the capability snapshot — the admitted tools with their
  resolved pins (corrupt records degrade to tombstones — by design, listable; this
  is the `tool list` degradation discipline, not fail-closed) and the registry's tool
  snapshot hash, composed from `listHarnessTools` + `toolsSnapshot` verbatim.
  Read-only; admission stays `harness tool admit` (explicitly gated as today).
- **`harness eval [--run <id>]`**: a governed *alias* over the F058 surface.
  Without `--run`: `amber eval run`'s deterministic instruction-surface suite
  (report-only, never an Approval, never a model call) — composed by calling the same
  eval command handler the `amber eval` surface uses, NOT by re-implementing any
  eval logic. With `--run <id>`: the run's eval artifacts on record (the eval /
  eval-result artifact pointers the run cites, read from the ledger's pointers) —
  report-only. The alias is the §35 aggregation, not a second authority: `eval
  admit` (the F050 T7 admission path) is NOT aliased and stays on its own explicitly
  gated surface.
- **Everything existing stays byte-compatible**: all current subverbs, flags, output
  shapes, and gates are untouched (`harness inspect --run` keeps its exact body; the
  new `trace` is a separate subverb, not a reshape). The five new verbs are read-only
  with one deliberate exception — none of them writes a governance artifact; `harness
  eval` writes nothing itself (the F058 `eval run` is report-only by its own contract).
- **Additive everything (ADR-0012)**: no schema change (no new record types — the
  trace/events/policy/capabilities/eval views are compositions, not artifacts); the
  schema-count pin stays 28; no new error codes (readers reuse the cores' codes).
- **CLI (expert tier, untyped)**: the five subverbs join the existing `harness`
  registration; `--tool` already maps in FLAG_SPECS (the evidence command's accumulate
  form is untouched — the harness reads `toolVal` like `tool inspect` does); raw-CLI
  smoke for the new subverbs through the real `parseArgs` path.

## User Stories

1. As an operator, I want `harness trace --run <id>` to show the run's whole causal
   line (record, history, admission pointers, trail) in one read, so that "what
   happened" is one command, not four.
2. As a reviewer, I want `harness events [--run <id>]` over the verified chain, so that
   the event trail is directly citable without hand-filtering.
3. As a reviewer, I want `harness policy check --run <id>` to show the run's policy
   posture from the trail, so that "what governed this run" is visible without
   re-deriving it.
4. As an operator, I want `harness capabilities` to show the admitted tools and their
   resolved pins with the registry snapshot hash, so that the capability boundary is
   inspectable in one view.
5. As a maintainer, I want `harness eval` to reach the F058 suite and a run's eval
   artifacts through the harness surface, so that the control plane aggregates without
   a second authority (eval admit stays where it is).
6. As a compatibility owner, I want every existing harness command to stay
   byte-compatible, so that 新旧 CLI 共同使用同一个 Core holds literally.

## Implementation Decisions

- **Compose, never re-implement**: each subverb is a thin adapter over the existing
  cores (`getRun`, `readRunEvents`, `readHarnessEvents`, `listHarnessTools`,
  `toolsSnapshot`, `checkHarnessTool`, the eval command's own handler). Zero new
  semantic verdicts; a conformance test asserts the trace/events bodies equal what the
  cores return directly.
- **`inspect --run` is not reshaped**: it keeps its exact §38 body (`run` + `events`);
  `trace` adds the narrative fields (state history, admission pointers, summaries) on
  top of the same citations.
- **`harness eval` is an alias with a disclosure**: it invokes the same handler the
  `amber eval` surface registers (report-only) — the alias boundary is asserted by a
  test that the alias's result is byte-identical to `amber eval run`'s through the
  real dispatcher for both surfaces (behavioral identity pins the same dispatch path),
  and that a stray positional (e.g. `harness eval admit`) is refused loudly — `eval
  admit` stays on its own explicitly gated surface.
- **Report-only ceiling**: the five subverbs write only the CLI response — no ledger
  appends, no record writes, no summary refreshes (distinct from validate/replay,
  which write receipts/results as their governed artifacts). `harness policy check`
  and `harness capabilities` can never mutate a gate, rule, or registry.
- **Naming/seam/guard constraints identical to F065–F073**: banned strings out; all
  paths through the state-dir seam; new test files `git add`ed explicitly (F063 N4);
  lint/format full gates.

## Testing Decisions

- Conformance at the real path: `trace --run` equals the run record + the ordered
  trail (and equals `inspect --run`'s event list — same core); `events --run` is the
  trail (a missing or empty `--run` fails closed); `events` (no --run) is the whole
  ledger; `policy check --run` surfaces the trail's verdicts and the frozen ref, and
  the `--tool` leg's failure shape is identical to `tool check`'s; `capabilities`
  matches `tool list` + the snapshot hash; `harness eval` (no --run) returns the F058
  report byte-identical to `amber eval run`; `harness eval --run` cites the closed
  `eval/`/`eval-result/` artifact-identity pointers — today no core emits
  eval-prefixed pointers onto harness events, so a plain run asserts the empty set
  (loud), and the pointer-carrying case lands when a producer exists (future work,
  disclosed); the run-posture verbs (trace/events/policy/eval --run) fail closed on a
  missing or corrupt run.
- Byte-compatibility: the pre-F074 `inspect --run` body keys are unchanged (the
  existing harness-commands tests keep passing unmodified is the delivered
  compatibility evidence — the fallback the spec names here is the mechanism).
- Report-only ceiling pinned by bytes: run-record bytes and the event ledger are
  byte-identical across a policy/capabilities/eval/trace cycle.
- CLI smoke through the real dispatcher (and raw argv where a flag mapping is touched
  — none is expected).

## Out of Scope

- `harness execution terminate` (a mutating verb the proposal lists in §20 but that
  crosses the execution lifecycle's settled BLOCK posture — F070 resolves violations
  by contract revision, never by an operator kill; deferred with disclosure, a new
  spec decision needed before it lands); `harness diff <run-a> <run-b>` (cross-run
  comparison belongs with H5's replay lineage, a separate ticket); §20's `policy
  inspect` and `context grants` variants (§35 — the spec's chosen target list —
  names `policy check` and `context inspect`; the existing `harness context list`
  already covers the grants surface, and a separate policy-inspect view would
  duplicate the trail citation `policy check --run` gives); MCP projection; removing
  or reshaping any existing command (compatibility is the gate); charter/homepage
  change.

## Further Notes

- Design decisions above follow the standing user directive (map `issues/0066`: 执行带入;
  this session's「继续」continues it). The HITL gate for draft → accepted is
  `issues/0120`.
- The §44 gate demo (新旧 CLI 同一 Core) lands as an orchestration artifact under
  `.scratch/orchestration/f074-h6/`.
