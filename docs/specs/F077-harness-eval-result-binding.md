# F077: Harness Eval-Result Binding (the First Eval-Prefixed Pointer Producer)

**spec_id:** F077
**Status:** accepted
**Updated:** 2026-09-24
**Provenance:** Harness v2 proposal §16 (Validation produces a receipt), §17 (Eval Loop: eval may find problems but never changes governance), §26 (Eval Does Not Mean Authority), §35 (H6 control plane aggregates, never re-implements); F073 (ValidationReceipt: the closed check set, `validation.completed` and its `validation-receipt:` pointer — its spec named eval-suite integration explicitly out of scope); F074 (`harness eval --run` reads the closed `eval/`/`eval-result/` artifact-identity pointer prefixes off the run's trail and disclosed that "today no core emits eval-prefixed pointers onto harness events … the pointer-carrying case lands when a producer exists (future work, disclosed)"); F058 (canonical `eval` definition + `eval-result` outcome artifacts, `extensions.evalResult.result.overall ∈ {pass, fail}`, `extensions.evalResult.definition` pin); F054 `maintain complete` (the `--eval-result <identity>@<revision>` pin grammar, `parseRevisionPin`); ADR-0021 (`<type>/<identity>@<revision>` is the one revision reference the Governance Graph resolves); wayfinder map `issues/0066` close-out (the eval-prefixed pointer producer is one of its two named remaining follow-ups); user direction 2026-09-24 (「继续剩余项」)
**Feature:** F077

## Problem Statement

The H6 control plane's `harness eval --run <id>` is wired to report a run's eval
artifacts by reading the closed `eval/` and `eval-result/` artifact-identity prefixes
off the run's own event pointers — and nothing produces them. The only harness core
that emits pointers about evaluation today is the F073 validator, and it emits
`validation-receipt:<runId>#<receiptId>` only. So the pointer leg of `harness
eval --run` (and of `harness trace`) is provably empty on every run: the F074 test
asserts the empty set loudly and the spec discloses the gap. Meanwhile the F058 surface
does produce canonical `eval-result` artifacts (with `overall` verdicts and a pinned
`eval` definition), and F054 already binds them by `<identity>@<revision>` — but a
harness run and an eval-result that judged it are never joined on record. "Which eval
judged this run, and what did it say" has no answer in the run's causal line.

## Solution

One explicit, human-declared binding on the existing validator — no new verb, no new
artifact type, no new event kind:

- **`amber harness validate --run <id> --eval-result <identity>@<revision>`**
  resolves the pin to a COMMITTED `eval-result` revision through the canonical
  artifact reader (`showArtifact` — fail-closed on settlement corruption, exact
  identity spelling, `null` refuses with a named not-found). The receipt's closed
  check set grows one leg, **`eval`**, present ONLY when a result is bound:
  `pass` when the bound result's `extensions.evalResult.result.overall` is `pass`,
  `fail` when it is `fail`; a bound result that records no `overall` verdict is
  refused before any receipt is written (`AMBER_E_INVALID_ARG` — binding something
  that cannot judge is a caller error, not an honest `not-run`). The check's
  `pointer` is the canonical revision reference `eval-result/<identity>@<revision>`.
- **The receipt records the binding** (additive, closed inline shape): `evalResult:
  { identity, revision, contentHash, overall, definition: { identity, revision } |
  null }` — the definition pin is copied verbatim from the result's own
  `extensions.evalResult.definition` when present, after that exact committed
  `eval` revision resolves through the same canonical reader (F058 records it;
  a fixture result may omit it — disclosed as `null`, never invented; a
  present-but-malformed or dangling pin refuses before any write).
- **The `validation.completed` event carries the eval-prefixed pointers**: the
  existing `validation-receipt:<runId>#<receiptId>` pointer stays first; a bound
  validation appends `eval-result/<identity>@<revision>` and, when the definition pin
  is present, `eval/<definition.identity>@<definition.revision>` — exactly the
  `<type>/<identity>@<revision>` form the Governance Graph resolves
  (`amber artifact show --type <type> --id <identity> --revision <n>`), so `harness
  eval --run` and `harness trace` light up end to end with zero change on the H6 side.
- **Unbound validation is byte-identical to F073**: without `--eval-result` the check
  array, the receipt bytes, the receiptId, and the event pointers are exactly what
  F073 produces (a conformance test pins the bytes) — a pass recorded before F077 is
  never silently revised, and re-validating an unchanged, unbound run stays idempotent
  across the F077 boundary. Binding a result changes the receipt content, so it
  yields a NEW content-addressed receipt (binding is a new fact; re-binding the same
  result is idempotent).
- **Eval never changes governance (§17/§26)**: the binding writes the receipt, the
  event, and the additive run summary only — the eval-result artifact, the run's
  state machine, policy, contracts, and grants are byte-identical before and after
  (the F073 conformance guard extends to the bound path). The verdict is the human's
  and the eval's, recorded; Amber neither derives an `overall` nor re-runs the suite.
- **Additive everything (ADR-0012)**: no schema change, no new event kind, no new
  flag (`--eval-result` already exists in FLAG_SPECS from F054), the `eval` check name
  joins the closed allowed set (an F073 receipt without it stays valid); one new error
  code is NOT needed — `AMBER_E_ARTIFACT_NOT_FOUND`/`AMBER_E_INVALID_ARG` and the
  artifact reader's own corruption codes already name every refusal.

## User Stories

1. As a reviewer, I want `harness validate --run <id> --eval-result <id>@<rev>` to
   bind the committed eval-result that judged the run onto its ValidationReceipt, so
   that "which eval judged this run and what did it say" is a recorded fact on the
   run's causal line.
2. As a maintainer, I want `harness eval --run <id>` and `harness trace --run <id>` to
   actually cite `eval/` and `eval-result/` pointers once a binding exists, so that the
   H6 pointer leg is real instead of a disclosed gap.
3. As a governance owner, I want an unbound validation to be byte-identical to F073 and
   the bound path to mutate nothing beyond the receipt/event/summary, so that eval
   binding grants no authority and revises no recorded pass.

## Implementation Decisions

- **Compose the canonical reader, never re-implement resolution**: the result pin
  resolves through `showArtifact(target, identity, { type: "eval-result", revision })`
  and a definition pin, when present, resolves through the same reader with
  `type: "eval"` — the reader `amber artifact show` uses; spelling variants,
  dangling definitions, cyclic traces, and hash mismatches refuse with the reader's
  own codes.
- **Pin grammar is shared**: `parseRevisionPin(raw, "--eval-result",
  "eval-result/instruction-surface/<hash>@1")` — the F054 grammar verbatim
  (`<identity>@<positive-int>`), so `maintain complete` and `harness validate` agree
  on what a pin is.
- **The check is a projection of the result, not a judgment**: `eval` is `pass`/`fail`
  by copying `overall`; there is no threshold, weight, or model confidence anywhere.
- **Pointer rendering reuses the graph's node-id form**: `artifactGraphNodeId(type,
  identity, revision)` (ADR-0021) — one rendering, resolvable back through `artifact
  show`.
- **CLI (expert tier, untyped)**: `harness validate --run <id> [--eval-result
  <identity>@<revision>]`; `validate list` ignores the flag; a truncated
  `--eval-result` (last token, no value) fails closed like every value flag; a
  malformed pin refuses with the grammar example.
- **Naming/seam/guard constraints identical to F065–F076**: banned strings out; all
  paths through `statePath()`/`statePathForCreate()`; new files `git add`ed before
  the full suite (F063 N4); lint/format full gates.

## Testing Decisions

- Conformance at the real path: a committed `eval-result` revision (with a pinned
  `eval` definition, the F058 shape) bound onto a real run yields an `accepted`
  receipt whose `eval` check is `pass` with the canonical pointer, whose `evalResult`
  block copies identity/revision/contentHash/overall/definition, and whose
  `validation.completed` event carries `validation-receipt:` + `eval-result/…@n` +
  `eval/…@n`; `harness eval --run` then reports exactly those two pointers (the F074
  empty-set case keeps passing for an unbound run); an `overall: fail` result lands
  `eval=fail` → `rejected`; a result without `overall` refuses before writing; an
  unknown identity/revision or dangling definition refuses with the reader's
  not-found; an omitted definition is disclosed as `null` and emits no invented
  `eval/` pointer; a malformed pin refuses with the grammar example; the unbound
  receipt bytes and receiptId are identical to F073's for the same run (pinned);
  binding is a new content-addressed receipt and re-binding the same result is
  idempotent; the governance-untouched
  guard (policy/rules/contract/grants + the eval-result artifact bytes) holds across
  the bound path.
- CLI smoke through the real dispatcher (`--eval-result` through the real parseArgs
  path, including the truncated-flag refusal).

## Out of Scope

- Producing eval-results from a harness run (the F058 suite stays the only producer;
  a per-run eval producer is its own spec); replay/diff consuming the eval leg (the
  replay axes are the frozen-world vocabulary — a bound eval is a judgment about the
  run, not a fact of its world); binding more than one result per receipt (bind again
  → a new receipt; the run summary points at the latest); `harness execution
  terminate` (still deferred with disclosure, needs its own spec decision); MCP
  projection.

## Further Notes

- Design decisions follow the standing user directive (0066 close-out follow-ups;
  this session's「继续剩余项」). The HITL gate for draft → accepted is `issues/0126`.
