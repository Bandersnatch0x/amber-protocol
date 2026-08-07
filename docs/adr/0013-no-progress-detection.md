# ADR-0013: No-Progress Detection — a workflow-effectiveness signal, not a new error code

**Status:** Accepted
**Date:** 2026-08-07
**Builds on:** [ADR-0001](0001-governance-first-artifact-first.md) (governance-first, artifact-first — no runtime interception), [ADR-0005](0005-experimental-execution-removal.md) (no live agent dispatch), [ADR-0008](0008-workflow-effectiveness-vs-governance-readiness.md) (workflow effectiveness is a separate assessment), [ADR-0003](0003-governance-gated-execution.md) (governance gates, not executor rules)

---

## Context

Amber's loop contracts **declare** no-progress conditions — repeated tool calls,
empty evidence increments, budget exhaustion — but nothing detects them. Today
"did the work stall?" is answered by a human reading a session transcript, or
by whatever the host agent happens to notice. That is exactly the kind of
judgement ADR-0001 says Amber must not smuggle into runtime hooks.

The reference comparison (`docs/research-harness-pattern-comparison.md` §4.8)
records three concrete, artifact-only signals the reference harness uses:

1. **Repeated tool calls**, deduplicated by the **raw target** — never a
   normalized target, because normalization folds digits and would collide
   `cat log1.txt` with `cat log2.txt`.
2. **Empty evidence increments** — a step produced a diff that is empty.
3. **Budget exhaustion** — cumulative usage exceeds the loop contract's
   budget ceiling.

Amber's posture on this is fixed by ADR-0001 and ADR-0005: Amber only produces
inspectable artifacts (plan/report/timeline/ledger) and never intercepts a
running agent. Detection must therefore read what already exists — session
timeline events and result evidence — and report what it finds.

## Decision

Add a **no-progress detector** to the `workflow-assessment` module
(`scripts/lib/workflow-assessment/internal/no-progress.js`). It is a pure,
artifact-based function:

```
detectNoProgress({ timelineEvents, resultEvidence, loopContract }) -> findings[]
```

### It is a workflow-effectiveness signal (ADR-0008 family), not governance readiness

No-progress detection lives under workflow effectiveness, beside the ADR-0008
assessment, and answers a different question from governance readiness:
*is available evidence consistent with effective execution?* It never feeds
the readiness `overall` score, never changes the readiness decision, and never
adds an error-catalog code. Its output is a list of **risk findings** on the
governance report — surfaced, not enforced. A stalled loop is a risk to
record, not a new failure state in the error vocabulary.

### The three signals

1. **Repeated tool calls** — extract the tool-call target from timeline events
   (`tool_call` / `command_executed` events with `data.tool` | `data.command`,
   and `stage_completed` / `verification_failed` events whose `data.command`
   records the executed command). Deduplicate by the **raw target, verbatim** —
   no trimming, no case-folding, no digit normalization. A target observed at
   or above the threshold (default 3) yields one `no-progress-repeated-tool-call`
   finding. Raw-target dedup is a hard requirement: normalization collapses
   `cat log1.txt` and `cat log2.txt` into one key and would fabricate a
   repetition the session never performed.

2. **Empty evidence increment** — when result evidence carries a diff/delta
   that is empty (`null`, `""`, `[]`, `{}`, zero change counts), the step
   produced no new evidence. One `no-progress-empty-evidence-increment` finding.
   Absent evidence, or evidence without a recognizable diff field, reports
   nothing — the detector is tolerant of shape and never fabricates a claim.

3. **Budget exhaustion** — when the loop contract declares a `budgetCeiling`
   (numeric), cumulative usage observed across timeline events and result
   evidence is summed; exceeding the ceiling, or the presence of a
   `budget_exceeded` timeline event, yields one `no-progress-budget-exhausted`
   finding. The loop contract is a declaration, so exceeding its ceiling is
   reported as the more severe `error`-grade risk item — but still a finding,
   not an error-catalog code.

### Boundary — detection only, never enforcement

The detector never runs during a session, never intercepts tool calls, never
terminates a loop, and never dispatches anything. It is invoked when a
governance report is built and read-only. Stopping a loop stays the human's
decision, informed by the report. Findings carry severity
(`warning` | `error`) for display ordering only.

## Consequences

**Positive:** The stalled-work question gets a deterministic, testable answer
from artifacts Amber already owns — no runtime hook, no new product boundary.
Raw-target dedup keeps the detector honest across numeric file names. Findings
flow into the governance report without polluting the error catalog or the
readiness decision.

**Negative:** Detection is only as good as the artifacts — a session whose
timeline records no structured tool targets yields no repeated-tool-call
finding even if the agent looped. That is the correct failure mode for a
read-only assessor (report nothing rather than guess).

**Neutral:** `budgetCeiling` is introduced here as the detector's vocabulary;
existing loop-contract budget fields (`budget.maxTokens`, `budget.maxUsd`,
`hardStops.timeoutMinutes`) are not re-read, so old contracts without a
`budgetCeiling` simply skip budget detection.

## Related

- ADR-0001 (governance-first, artifact-first — the provenance boundary that
  forbids runtime interception)
- ADR-0005 (experimental execution removal — no live agent dispatch)
- ADR-0008 (workflow effectiveness vs governance readiness — this detector is
  the effectiveness family; readiness is untouched)
- `docs/research-harness-pattern-comparison.md` §4.8 — signal mapping and the
  raw-target dedup rationale
- `schemas/timeline-event.schema.json` — event vocabulary the detector reads
