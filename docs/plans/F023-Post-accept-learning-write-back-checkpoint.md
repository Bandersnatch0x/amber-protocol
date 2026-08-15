# Plan: Post-accept learning write-back checkpoint

Feature: F023
Status: implementation-ready
User Confirmation: confirmed

## Goal

After a feature is accepted, Amber deterministically detects whether the work hit mandatory knowledge write-back triggers (schema/contract/infra paths) and, when triggered, surfaces a visible checkpoint through amber next, the per-turn breadcrumb, and amber handoff until the learning review is booked via amber learnings --reviewed

## High Level Design

- Context:
  - Amber's lifecycle ends at accept → handoff with no knowledge-consolidation
    checkpoint. Learnings from a finished slice (design decisions, contracts, gotchas) live
    only in the session's timeline and the operator's memory; future sessions start
    without them.
  - The F022 breadcrumb made every lifecycle step visible per-turn — but there is no
    lifecycle step that says "write down what you learned", so the knowledge write-back is
    silently skipped exactly like the terminal tail used to be.
- Proposed approach:
  - Trigger detection (new read-only module `scripts/lib/core/learning-writeback.js`):
    from a feature's booked `paths` (plus optional operator-supplied extra paths),
    classify deterministic mandatory triggers — `schema` (paths matching `*.schema.json`,
    `schemas/**`, `migrations/**`), `contract` (`docs/specs/**`, `docs/contracts/**`,
    `openapi*`/`swagger` files), and `infra` (`.github/workflows/**`, `Dockerfile*`,
    `docker-compose*`, `k8s/**`, `infra/**`). Each triggered category lists its matching
    paths and suggests the Amber knowledge surface: contract/schema → a `docs/specs/`
    contract doc (or `docs/adr/` for a design decision); infra → `docs/specs/` or the wiki
    runbook; judgment-based learnings (conventions, gotchas, patterns) → `docs/wiki`
    knowledge notes (`docs/adr/` for design decisions with lasting trade-offs). The output includes the classification rule as
    guidance text (original wording): "how to write it" content belongs in a spec/contract
    doc; "what to consider" content belongs in the wiki/guides.
  - New lifecycle STEPS entry `learnings` in `scripts/lib/core/lifecycle.js`, positioned
    after `accept`: appliesTo a feature focus whose plan is accepted AND whose trigger
    detection matched at least one category; isDone when the feature entry carries
    `learningWriteBack.reviewed === true`. When no trigger matched, the step does not
    apply (no fake gate). Remedy: `amber learnings --target <t> --feature <id>` to
    inspect, `--reviewed` to book. This makes the checkpoint flow through `amber next`
    AND the F022 breadcrumb automatically (same SSOT).
  - New command `amber learnings` (tier core, so it shows in default help): read-only
    inspection by default — resolves the feature (`--feature` or auto-focus), shows
    triggered categories, matching paths, suggested surfaces, and current booking state;
    `--reviewed [--surface <path>...]` books `learningWriteBack: { reviewed: true, date,
    surfaces }` onto the feature entry via the existing loadFeatures/saveFeatures path
    (validators are permissive to the extra field). Booking requires the feature to
    exist; re-booking is idempotent-with-update.
  - Handoff wiring: `amber handoff` output gains a "Learning write-back" section when the
    focus feature is accepted with unreviewed triggers (the finish-phase reminder).
  - Non-goals (hard): Amber never writes/edits knowledge docs itself; no auto-execution;
    no agent dispatch; trigger detection is path-based and deterministic (no LLM judgment
    inside Amber — operators can always book `--reviewed` manually for judgment-based
    learnings the path rules can't see).
- Risks:
  - lifecycle STEPS is shared by `amber next`, the breadcrumb, and doctor remedies —
    adding a step must extend the breadcrumb parity walk in the same change or its
    coverage guard fails (that guard firing is the mechanism working as designed).
  - PUBLIC_COMMAND_ORDER in tests/unit/command-registry-parity.test.js is hardcoded and
    must gain `learnings`.
- Scope:
  - Touches `scripts/lib/core/learning-writeback.js` (new trigger-detection module),
    `scripts/lib/core/lifecycle.js` (STEPS entry),
    `scripts/lib/learnings-command.js` or a dispatcher section (command),
    `scripts/lib/command-registry.js` + `scripts/lib/command-dispatcher.js` (learnings
    command wiring; note handleHooks-style conventions),
    `scripts/lib/handoff-command.js` (section),
    `tests/unit/learning-writeback.test.js` (new),
    `tests/unit/workflow-state-breadcrumb-parity.test.js` (walk extension),
    `tests/unit/command-registry-parity.test.js` (PUBLIC_COMMAND_ORDER + help guard),
    `docs/specs/2026-08-15-learning-writeback.md` (new four-part contract:
    mechanism/invariants/drift symptoms/test anchors), plus docs wiring (CLI_REFERENCE,
    README, CLAUDE.md if apt).
  - Non-goals: no knowledge-doc writing/editing by Amber, no target-project command
    execution, no agent dispatch, no LLM judgment inside trigger detection, and no new
    platform surfaces beyond `amber next`, the breadcrumb, and `amber handoff`.

## Vertical Slices

- [ ] Slice 1: trigger detection module pure functions — classify `schema`/`contract`/
  `infra` from booked paths (each category + no-trigger), with suggested surfaces and the
  classification-rule guidance text; red tests first in
  tests/unit/learning-writeback.test.js.
- [ ] Slice 2: lifecycle `learnings` step + parity walk extension — add the STEPS entry
  after `accept` (appliesTo/isDone per design) and extend the breadcrumb parity walk in
  the same change so its coverage guard stays green.
- [ ] Slice 3: `amber learnings` command (inspect + book) — read-only inspection default,
  `--reviewed [--surface <path>...]` booking via loadFeatures/saveFeatures, registry +
  dispatcher wiring (PUBLIC_COMMAND_ORDER and help guard updated together).
- [ ] Slice 4: handoff section — "Learning write-back" appears in `amber handoff` output
  when the focus feature is accepted with unreviewed triggers.
- [ ] Slice 5: contract doc + docs wiring — docs/specs/2026-08-15-learning-writeback.md
  four-part contract (mechanism/invariants/drift symptoms/test anchors), CLI_REFERENCE,
  README, CLAUDE.md if apt; then the full verification battery
  (npm test + amber review/gate).

## Resume Checkpoint

- Resume Point: plan scaffolded; implementation has not started.
- Blockers: user confirmation is pending.
- Next Action: review docs/plans/F023-Post-accept-learning-write-back-checkpoint.md, then confirm it before implementation.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- Trigger detection covers the three categories (schema/contract/infra) deterministically
  from the feature's booked paths — including the no-trigger case where nothing matches —
  with matching paths, suggested surfaces, and the classification-rule guidance.
- The `learnings` step appears in the per-turn breadcrumb channel and `amber next` only
  when the focus feature's plan is accepted, at least one trigger category matched, and
  the review is unbooked; when no trigger matched, the step does not apply (no fake gate).
- `amber learnings --reviewed [--surface <path>...]` books `learningWriteBack` on the
  feature entry, the booking survives `node scripts/validate-feature-list.js --target .`
  clean (Errors: 0), and re-booking is idempotent-with-update.
- `amber handoff` surfaces the "Learning write-back" reminder when the focus feature is
  accepted with unreviewed triggers.
- The breadcrumb parity walk covers the new `learnings` step (label + remedy rendered),
  and registry parity stays green with `learnings` in PUBLIC_COMMAND_ORDER and the
  default help.
- No auto-write of any knowledge doc: Amber detects, reminds, and books; the write-back
  is done by the operator/agent. No target-project command execution, no agent dispatch,
  no LLM judgment inside Amber.
- `npm test` green (0 failed); existing Amber guardrails still pass.

## Verification

- node --test tests/unit/learning-writeback.test.js
- node --test tests/unit/workflow-state-breadcrumb-parity.test.js (walk extended with the learnings checkpoint)
- amber learnings --target . (read-only inspection renders triggers, matching paths, suggested surfaces, booking state)
- amber learnings --target . --feature <id> --reviewed --surface <path> books learningWriteBack on the feature entry
- node scripts/amber.js review --target . --plan docs/plans/F023-Post-accept-learning-write-back-checkpoint.md --json
- node scripts/amber.js gate --target . --plan docs/plans/F023-Post-accept-learning-write-back-checkpoint.md

## Evidence Schema

Planned evidence entries; record actual results and dates at verification time.

- Command: node --test tests/unit/learning-writeback.test.js
- Result: required — trigger classification passes per category (schema, contract, infra)
  plus the no-trigger case; lifecycle step application passes (triggered vs not, reviewed
  vs not); booking round-trip passes (write + validate-feature-list clean + idempotent
  re-book)
- Date: record at verification
- Notes: new suite for scripts/lib/core/learning-writeback.js pure functions plus the
  lifecycle step and booking semantics

- Command: node --test tests/unit/workflow-state-breadcrumb-parity.test.js
- Result: required — parity walk extended with a learnings checkpoint; every step id in
  lifecycle.js STEPS (including `learnings`) is reachable and rendered through the
  breadcrumb channel
- Date: record at verification
- Notes: extending the walk in the same change as the STEPS entry is what keeps this
  guard green

- Command: amber learnings --target .
- Result: required — read-only inspection renders triggers, matching paths, suggested
  surfaces, and booking state; live dogfood: F022 (whose paths include docs/specs/**)
  shows the checkpoint and gets booked during F023's lifecycle
- Date: record at verification
- Notes: registry parity green (learnings in PUBLIC_COMMAND_ORDER + default help) and
  handoff "Learning write-back" section verified in the same dogfood pass

- Command: npm test
- Result: required — full repository suite green (0 failed)
- Date: record at verification
- Notes: final gate before review/gate
