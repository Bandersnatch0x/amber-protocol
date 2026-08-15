# Learning Write-Back Checkpoint Contract (F023)

> Runtime contract for the post-accept knowledge checkpoint. When a feature's
> plan is accepted, Amber classifies the feature's booked `paths` with fixed,
> path-based rules into mandatory write-back triggers (schema / contract /
> infra) and — if any matched and no review is booked — surfaces one extra
> lifecycle step through every channel that renders the lifecycle SSOT:
> `amber next`, the per-turn workflow-state breadcrumb, and a "Learning
> write-back" section in `amber handoff`. The step is cleared only by
> `amber learnings --feature <id> --reviewed`, which writes a single
> `learningWriteBack` field onto that feature's entry in `feature_list.json`.
> Amber detects, reminds, and books; it never writes or edits a knowledge doc,
> executes a target-project command, or consults an LLM inside the checkpoint.

**Date:** 2026-08-15
**Plan:** `docs/plans/F023-Post-accept-learning-write-back-checkpoint.md`
**Implementation:** `scripts/lib/core/learning-writeback.js` (classification,
inspection, booking), `scripts/lib/core/lifecycle.js` (`learnings` STEPS entry),
`scripts/lib/command-dispatcher.js` (`handleLearnings`),
`scripts/lib/command-registry.js` + `scripts/lib/core/cli-output.js`
(`--reviewed`/`--surface` flags), `scripts/lib/handoff-command.js`
(`learningWriteBackLines`).

## Mechanism (机制)

- **Trigger detection** (`detectWriteBackTriggers`, pure — no globs, no
  judgment). Each booked path is normalized (backslashes → slashes,
  leading `./` dropped, lowercased) and matched against three categories in
  fixed order:
  - `schema` — path ends `.schema.json`, or any `schemas/` or `migrations/`
    segment;
  - `contract` — a `docs/specs/` or `docs/contracts/` segment sequence, or a
    basename starting with `openapi`/`swagger`;
  - `infra` — a `.github/workflows/`, `k8s/`, or `infra/` segment, or a
    basename starting with `Dockerfile`/`docker-compose`.
  Non-string/blank entries are ignored; only matched categories appear, each
  listing its matching paths verbatim and a suggested surface (contract/schema →
  a `docs/specs/` contract doc or `docs/adr/` for a design decision; infra →
  `docs/specs/` or the wiki runbook). `learningWriteBackGuidance` carries the
  classification rule ("how to write it" → specs; "what to consider" → wiki;
  lasting trade-offs → ADR).
- **Lifecycle step.** `STEPS` gains `learnings` after `accept`: it applies only
  to a feature focus whose plan exists AND is logged accepted AND whose
  detection matched ≥ 1 category; `isDone` only when the feature entry carries
  `learningWriteBack.reviewed === true`. Remedy:
  `amber learnings --target <t> --feature <id>`. Because the step lives in the
  SSOT, `amber next` and the F022 breadcrumb render it with no second copy of
  the text.
- **Inspect / book surface.** `amber learnings --target <t> [--feature <id>]`
  is read-only: accept state, triggered categories with matching paths,
  suggested surfaces, guidance, booking state, and the NOT-booked remedy line.
  `--reviewed [--surface <path>]...` books
  `learningWriteBack = { reviewed: true, date, surfaces }` via the shared
  loadFeatures/saveFeatures path; `--surface` is repeatable and each flag also
  accepts a comma-separated list. `--feature` is REQUIRED for booking — Amber
  never books an auto-resolved focus.
- **Handoff reminder.** `renderHandoff` appends a "## Learning write-back"
  section exactly when the focus feature's inspection status is `unreviewed`.

```
feature_list.json feature.paths ──▶ detectWriteBackTriggers      (core/learning-writeback.js)
                                        │  schema / contract / infra (fixed rules)
                                        ▼
                       STEPS "learnings" entry (appliesTo: accepted + ≥1 trigger;
                       isDone: learningWriteBack.reviewed)       (core/lifecycle.js — SSOT)
                                        │
        ┌───────────────────────────────┼─────────────────────────────────┐
        ▼                               ▼                                 ▼
   amber next                    hooks breadcrumb print            amber handoff
  (inferNextStep)              (per-turn, same inference)      ("Learning write-back"
                                                                    section)
        └─────────────── all three advise the same remedy ─────────────────┘
                                        │
                                        ▼
  amber learnings --feature <id> --reviewed [--surface <path>...]
      └─ bookLearningWriteBack ──▶ feature_list.json: feature.learningWriteBack
                                   { reviewed: true, date, surfaces }   (the only write)
```

## Invariants (不变量)

1. **Determinism.** Triggers derive ONLY from the feature's booked paths in
   `feature_list.json` via the fixed match rules above — no ambient state, no
   timestamps, no LLM judgment inside Amber. Identical input yields identical
   output, and a path either matches a category or does not, deterministically.
2. **Amber never writes knowledge docs.** Booking mutates exactly one field on
   one feature entry (`learningWriteBack`) in `feature_list.json`; nothing
   else in the checkpoint path (detection, inspection, lifecycle evaluation,
   handoff rendering) writes anywhere.
3. **No fake gate.** The `learnings` step applies ONLY when the plan is
   accepted AND ≥ 1 trigger category matched; features without matched
   triggers never see the step, and `learningWriteBack.reviewed === true` is
   the only done-condition.
4. **Booking safety.** `--reviewed` requires an explicit `--feature` (an
   auto-resolved focus is never booked); re-booking is an explicit overwrite
   of date/surfaces; a failed booking (missing or unknown feature) leaves
   `feature_list.json` byte-identical; a successful booking keeps the file
   valid under the repo's own feature-list validator.
5. **Channel parity.** The step renders through `amber next` AND the per-turn
   breadcrumb with no second copy of its label/remedy text (both render
   `inferNextStep` output directly). The handoff reminder is a deliberate
   supplementary summary keyed on the same `inspectLearningWriteBack` status —
   its wording is its own, but its trigger condition never diverges from the
   lifecycle SSOT.
6. **Visibility.** Inspection always degrades to visible text (no-focus /
   not-found / not-accepted / no-triggers), never silent, never an error for
   read-only paths; only argument-shaped misuse exits non-zero.

## Drift Symptoms (漂移症状)

- **vs 1 (determinism):** an accepted schema-touching feature never shows the
  checkpoint → the trigger match rules drifted from the path shapes actually
  booked in `feature_list` paths (e.g. a renamed `migrations/` segment or a
  new schema suffix); same repo classifying differently across runs → ambient
  state leaked into detection.
- **vs 2 (no knowledge writes):** a docs/specs or docs/wiki file changes after
  `amber learnings ... --reviewed` → the booking path grew a doc writer;
  reject at review. Only `feature_list.json` may change.
- **vs 3 (no fake gate):** an accepted feature whose paths touch nothing
  matched is still nagged for a review → the appliesTo guard lost its
  no-trigger exit; a booked feature keeps showing the checkpoint → `isDone`
  stopped keying on `learningWriteBack.reviewed`.
- **vs 4 (booking safety):** booking without `--feature` succeeded → the
  explicit-feature guard broke; a typo'd feature id corrupted or reordered
  `feature_list.json` → failed-booking atomicity broke; a re-book appended
  surfaces instead of replacing → overwrite semantics drifted.
- **vs 5 (parity):** the breadcrumb advises learnings but `amber next` does
  not (or vice versa), or the wordings differ → a second step-text copy
  appeared outside `lifecycle.js` STEPS; handoff shows the reminder for a
  booked feature → the handoff section stopped keying on the same inspection
  status.
- **vs 6 (visibility):** `amber learnings` exits 1 or prints nothing on an
  empty/unfocused repo → a read-only path became an error or went silent.
- **Cross-cutting:** a newly added lifecycle step is never mentioned per-turn
  → the parity walk was not extended in the same change (its coverage guard
  should already be failing); `amber learnings` missing from the default help
  → the registry tier/order lists drifted.

## Test Anchors (测试锚点)

- `tests/unit/learning-writeback.test.js` — the dedicated suite:
  - "classifies schema paths…", "classifies contract paths…", "classifies
    infra paths…", "a plain source path matches nothing", "accepts Windows
    backslash separators", "matches case-insensitively but lists the original
    path", "detects multiple categories from one path list", "an empty list
    (or non-list input) yields no triggers, and classification is
    deterministic" — invariant 1 (fixed rules, fixed order, determinism).
  - "guidance names the three knowledge surfaces" — the classification-rule
    guidance (invariant 1's surface suggestions).
  - "inspection writes nothing (invariant 2)" — invariant 2's direct
    write-absence anchor; "books {reviewed, date, surfaces} onto the named
    entry only; other entries untouched" — booking's single-field/single-entry
    write (invariant 2).
  - "an accepted feature with trigger paths gets the learnings step next
    (invariants 3, 5)", "a feature with no trigger paths never sees the
    learnings step, even accepted and unbooked", "before accept, trigger
    paths alone do not surface the step", "after booking, the learnings step
    is done and no longer advised" — invariant 3.
  - "missing featureId errors and writes nothing (never books an
    auto-resolved feature)", "nonexistent feature errors and leaves the file
    byte-identical", "re-booking is an explicit overwrite of date/surfaces",
    "keeps feature_list.json valid under the repo's own validator after
    booking" — invariant 4.
  - "renders when the focus feature is accepted + triggered + unbooked,
    naming feature and remedy" / "is absent once the review is booked" (handoff
    section), plus the CLI inspect/booking tests below — invariant 5.
  - "explicit featureId, found + unreviewed…", "booked feature: status
    reviewed…", "nonexistent featureId: featureFound false, visible text, no
    errors", "no featureId and no resolvable focus: visible no-focus text, no
    errors", "degrades visibly for not-accepted and no-trigger features" —
    invariant 6.
  - CLI end-to-end ("inspect renders the trigger and the NOT-booked remedy,
    exit 0", "--reviewed without --feature exits 1 with the
    never-book-auto-resolved error", "repeatable --surface flags and
    comma-separated values both book every surface", "--json emits a
    machine-readable envelope with the expected fields", "booking through the
    CLI clears the checkpoint (advisor goes quiet)") — invariants 4, 5, 6
    through the real `scripts/amber.js` process.
- `tests/unit/workflow-state-breadcrumb-parity.test.js` — checkpoints 11–12
  inside "walks one repo through the lifecycle; every checkpoint renders
  through the per-turn channel" (accepted + triggered → `learnings` renders
  with label and remedy; booked → "all lifecycle steps complete"); "covers
  exactly the eligible lifecycle steps (guard: a new STEPS entry must extend
  the walk)" is invariant 5's coverage guard.
- `tests/unit/command-registry-parity.test.js` — "one Command registry drives
  help, policy, dispatch, and the public command list" (`learnings` in
  PUBLIC_COMMAND_ORDER) and "Command tiers are the single visibility source"
  (`learnings` tier core → default help) guard the command wiring.

**Mandatory-update rule:** any change to the trigger categories or match
rules, the `learnings` step semantics (appliesTo/isDone/remedy), the booking
shape (`learningWriteBack` field, `--reviewed`/`--surface` flags), or the
handoff "Learning write-back" section must update this contract AND the
parity-walk / anchor tests above in the same change — the coverage guard in
the parity walk fails the suite otherwise.
