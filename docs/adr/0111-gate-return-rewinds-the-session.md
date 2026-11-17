# ADR-0111: A Gate Return Rewinds the Session by Derivation

**Status:** Accepted (2026-11-17)
**Date:** 2026-11-17
**Builds on:** [ADR-0003](0003-governance-gated-execution.md) (governed execution gates and the
tamper-evident ledger), [ADR-0029](0029-named-governed-commands-and-stage-verbs.md) (the governed
session run seam and its ledger-owned cursor), `docs/specs/F090-gate-return.md`

---

## Context

A Route Gate had two outcomes: pass, or block. A reviewer who judges the work
not ready had no governed way backwards — `session continue --from-checkpoint`
is manual and checkpoint-dependent, and aborting loses the meaning of the
ledger trail. Session delivery workflows (external reference implementations
included) treat "send the work back to a chosen step" as a first-class ruling;
Amber's vocabulary had no record for it.

## Decision

1. **A return is a ruling recorded at the gate, not a pre-declared edge.** The
   human decides at `session approve` time, with `--return-to <stage>`. The
   route schema is unchanged: Amber keeps the ruling with the governed party
   at run time rather than letting the route author script fallback paths in
   advance. Automatic rework-on-failure stays out of scope.

2. **The rewind is derived, never stored.** The ledger is append-only, so a
   return appends a `gate_returned` record; `cursorFromLedger` truncates the
   completed prefix at it, and re-completed stages re-extend the prefix. No
   file is rewritten to express "work was undone" — replaying the ledger
   converges on the same state, and a repeated return finds nothing to do.

3. **The newest ruling for a gate wins.** `resolveCurrentStage` reads
   `gate_returned` / `gate_passed` records in order; a return voids the
   earlier pass and the gate is pending again. Redoing the returned stage
   cannot flow past its gate on the stale pass. `complete-check` mirrors the
   rule: approval evidence is voided while any gate's newest ruling is a
   return.

4. **A gate blocks rerun output, not first execution.** The gate at the cursor
   blocks only when its owning stage already recorded a completion — a stage
   that has never run is not gated by its own `gateAfter`. This keeps first
   execution ungated exactly as before the feature existed.

5. **Targets are the gate's owning stage and earlier.** Returning forward or
   to an unknown stage is refused. Returning to the owning stage is legal: the
   stage is redone and the gate sees its new output.

## Consequences

- The ledger trail shows every return inline with the work it rewound; the
  timeline gains one event type; the web viewer renders the `returned` gate
  status.
- Legacy sessions (cursor in `manifest.completedStages`, empty ledger) rewind
  the manifest directly and carry the ruling in their ledger from then on;
  mixed derivations do not arise because the manifest is always rebuilt after
  a ruling.
- No new command, no Action Type, no MCP surface change: the ruling rides the
  existing `session approve` write, so the approval seam's human-only
  attribute covers returns too.
