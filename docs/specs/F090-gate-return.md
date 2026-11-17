# F090: Gate return — a gate ruling can send work back to a stage

Status: accepted
Date: 2026-11-17
Related: `docs/adr/0111-gate-return-rewinds-the-session.md`, `docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md` §5, `schemas/route.schema.json`

## Problem

A Route Gate has exactly two outcomes: pass, or block and wait. When a reviewer
reads a gate's artifacts and judges the work not ready, the only governed way
backwards is `session continue --from-checkpoint` (manual, checkpoint-dependent)
or aborting and restarting the session (loses the ledger trail's meaning). A
return ruling made at the gate — "send this back to the implement stage" — has
no first-class record, so the ledger cannot show why work is being redone.

## Contract

1. `amber session approve --session <id> --gate <gate-id> --return-to <stage>`
   records a **return ruling** instead of an approval. Valid targets are the
   gate's owning stage (the stage that declares `gateAfter`) and any earlier
   stage. Returning to a later stage, an unknown stage, or a gate with no
   owning stage is refused.
2. The ruling appends a `gate_returned` record to the session ledger and a
   `gate_returned` event to the timeline. The ledger is append-only: a return
   never edits history, the cursor is *derived* as the completed prefix
   truncated at the return, and re-completed stages re-extend it.
3. The returned gate goes back to pending. A `gate_passed` recorded before the
   return no longer satisfies it; a later `amber session approve` (no
   `--return-to`) re-arms it. Redoing the returned stage always re-arms its
   gate — the rerun cannot flow past the gate on a stale pass.
4. `manifest.completedStages` / `currentStage` are projections: a return
   rebuilds them from the derived cursor. Legacy sessions (cursor in the
   manifest, empty ledger) rewind the manifest directly and carry the ruling
   in their ledger from then on.
5. Convergence is per ruling, not per cursor: a replay of the same ruling
   (same gate, same target, cursor already rewound) reports `already returned`
   and appends nothing. A different gate's return is always recorded, even
   when the cursor does not move — dropping it would leave its stale
   `gate_passed` governing the route.
6. `complete-check` treats approval evidence as voided while the newest ruling
   for any gate is a return; a later re-approval restores it. `amber next` and
   the per-turn breadcrumb count a returned gate as pending again.
7. The route schema is unchanged. The ruling is made by the human at the gate
   at run time; it is not pre-declared by the route author. A gate id outside
   the route gate charset (`[a-zA-Z0-9_-]+`) is refused before any filesystem
   or ledger effect.
8. Legacy `session verify` advances `currentStage` alongside
   `completedStages`, so the projection stays consistent after a redo.

## Scope

Session surface only: the ledger-cursor derivation in the stage runner, the
approve path, the timeline vocabulary and its schema, completion checking, the
lifecycle gate resolver, and the web viewer's gate status rendering. No new
command, no route schema change, no governed-execution change.

## Verification

- `node --test tests/unit/session-gate-return.test.js` — 18 behavior tests:
  cursor truncation and re-extension, the settle→return→re-approve→redo→next
  sequence, target validation, per-ruling convergence (including a second
  gate's return and a replayed identical ruling), refusal of invalid gate ids,
  guidance-surface pending counts, the legacy manifest path with
  currentStage consistency, completion-check voiding and restoration, timeline
  schema parity.
- `node --test tests/unit/session-stage-runner.test.js` — the pre-return gate
  rules still pass unchanged.
- `npm run test --prefix apps/web` — the schema-parity guard that pins the web
  event schema to the CLI timeline schema.
- Mutation checks: disabling the gate-id validation, forcing convergence off,
  ignoring `gate_returned` in the passed-gates fold, and freezing the legacy
  `currentStage` each turned the suite red; restoring turned it green.
