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
5. Repeated identical returns converge: a second return whose projection
   equals the current cursor reports `already returned` and appends nothing.
6. `complete-check` treats approval evidence as voided while the newest ruling
   for any gate is a return; a later re-approval restores it.
7. The route schema is unchanged. The ruling is made by the human at the gate
   at run time; it is not pre-declared by the route author.

## Scope

Session surface only: the ledger-cursor derivation in the stage runner, the
approve path, the timeline vocabulary and its schema, completion checking, and
the web viewer's gate status rendering. No new command, no route schema change,
no governed-execution change.

## Verification

- `node --test tests/unit/session-gate-return.test.js` — 12 behavior tests:
  cursor truncation and re-extension, the settle→return→re-approve→redo→next
  sequence, target validation, idempotence, the legacy manifest path,
  completion-check voiding and restoration, timeline schema parity.
- `node --test tests/unit/session-stage-runner.test.js` — the pre-return gate
  rules still pass unchanged.
- `npm run test --prefix apps/web` — 812 tests including the schema-parity
  guard that pins the web event schema to the CLI timeline schema.
