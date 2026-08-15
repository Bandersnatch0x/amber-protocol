# Plan: Break-loop post-mortem scaffold

Feature: F025
Status: implementation-ready
User Confirmation: confirmed

## Goal

When a friction or bug class recurs after a fix, `amber break-loop` scaffolds a post-mortem document with a five-way root-cause taxonomy and a prevention-mechanism menu mapped to Amber's knowledge surfaces, and `amber break-loop validate` refuses placeholder content — recurring defects get a durable, checkable prevention record instead of a re-fixed symptom

## High Level Design

- Context:
  - Amber's dogfood loop converts friction into one-off issues (#118-#122), but nothing
    distinguishes a *recurring* defect class from a fresh one.
  - The #118 fix (evidence dates) was followed within one slice by the same bug class
    resurfacing elsewhere (#122 residual UTC stamps) — the signature of fixing symptoms
    without a prevention record.
  - The ritual doc (docs/dogfood-weekly.md §5) says "log friction" (one issue per friction)
    but has no escalation path when the same class comes back.
- Proposed approach:
  1. New module scripts/lib/core/break-loop.js — the single source for: the five root-cause
     categories (original wording; the generic engineering taxonomy: missing contract/spec,
     cross-layer drift, change propagation failure, verification gap, implicit assumption);
     a prevention-mechanism menu, each entry mapped to its Amber write-back surface
     (contract doc + mandatory test anchor, parity/coverage guard, checklist item in the
     wiki/ritual, code invariant/centralized helper); the post-mortem template sections; and
     the scaffold + validate functions. Help, scaffold, and validate all render from these
     same constants so they can never disagree.
  2. `amber break-loop` command (tier core): the default action scaffolds
     docs/quality/break-loops/<localIsoDate>-<slug>.md with `--issue <n> --title "<t>"
     --recurrence <n>` (recurrence ≥ 2 required — the operator declares the loop, Amber
     never auto-detects); never overwrites an existing file (plan-command convention —
     refuse with a visible error naming the file); `validate --file <path>` checks every
     section is present and contains no unfilled placeholder markers (the gate's plan
     validation style); both read/write follow the plan/gate command conventions.
  3. Template sections (each with one-line original guidance): Symptom & evidence (commands +
     observed vs expected); Recurrence & why previous fixes failed (one entry per prior fix);
     Root-cause classification (exactly one primary category from the five, optional
     secondary); Prevention mechanism (exactly one from the menu, with its write-back
     surface named); Write-back record (surface path + test anchor to add); Verification
     (how to prove the loop is broken).
  4. Wiring: registry definition (usage + examples, tier core) + dispatcher handler +
     PUBLIC_COMMAND_ORDER entry in tests/unit/command-registry-parity.test.js; docs wiring:
     a CLI_REFERENCE section, and dogfood-weekly §5 gains one escalation line (friction
     that recurs → run break-loop; post-mortem linked from the new issue).
- Risks:
  - Taxonomy wording must stay original — the Trellis-mechanism analysis (P2-1) is AGPL and
    design-only; no phrasing may be copied from it.
  - Scaffold filename collisions (same date + slug) — refuse to overwrite rather than
    suffix-generate; the error names the existing file so the operator decides.
  - validate must not greenwash — placeholder detection runs on every section, not just the
    first, and errors name the offending section(s).
- Scope:
  - Touches `scripts/lib/core/break-loop.js` (new single-source module),
    `scripts/lib/command-registry.js` + `scripts/lib/command-dispatcher.js` (command wiring,
    tier core), `tests/unit/break-loop.test.js` (new suite),
    `tests/unit/command-registry-parity.test.js` (PUBLIC_COMMAND_ORDER entry),
    `docs/CLI_REFERENCE.md` (new section), `docs/dogfood-weekly.md` (§5 escalation line),
    plus `docs/quality/break-loops/` (first post-mortem arrives via the live dogfood).
    Reuses `localIsoDate` and `slugify` from `scripts/lib/core/text-utils.js` as imports.
  - Non-goals: no network/issue-tracker access (--issue is a recorded reference number
    only), no auto-detection of recurrence (the operator declares it with --recurrence),
    no LLM judgment inside Amber (the analysis stays with the operator/agent), no changes
    to the friction→issue flow itself, and no lifecycle step — the breadcrumb parity walk
    stays untouched (break-loop is an on-demand ritual, not a lifecycle gate).

## Vertical Slices

- [ ] Slice 1: single-source module — scripts/lib/core/break-loop.js with the five
  root-cause categories, the prevention-mechanism menu (each entry mapped to its write-back
  surface), the six template sections with one-line guidance, and the scaffold + validate
  pure functions (scaffold renders taxonomy + menu from the same constants the help will
  use; validate applies the gate-style section checks); red tests first in
  tests/unit/break-loop.test.js.
- [ ] Slice 2: `amber break-loop` scaffold action — registry definition (tier core, usage +
  examples) + dispatcher handler; `--issue <n> --title "<t>" --recurrence <n>` with
  recurrence ≥ 2 required (visible error below 2); filename
  docs/quality/break-loops/<localIsoDate>-<slug>.md via the shared text-utils helpers;
  never overwrites an existing file. PUBLIC_COMMAND_ORDER entry in the parity test in the
  same change.
- [ ] Slice 3: `amber break-loop validate --file <path>` — every section present, no
  unfilled placeholder markers in any section, errors name the offending section(s);
  fails on the raw scaffold, passes when filled.
- [ ] Slice 4: docs wiring + verification battery — CLI_REFERENCE section (scaffold +
  validate + taxonomy/menu in help), dogfood-weekly §5 escalation line (recurring friction
  → run break-loop; post-mortem linked from the new issue); full npm test; amber
  review/gate on this plan.
- [ ] Slice 5: live dogfood — a real post-mortem for the #118→#122 UTC-date recurrence
  scaffolded, filled, validated green, and committed under docs/quality/break-loops/ as
  the feature's own evidence.

## Resume Checkpoint

- Resume Point: plan scaffolded; implementation has not started.
- Blockers: user confirmation is pending.
- Next Action: review docs/plans/F025-Break-loop-post-mortem-scaffold.md, then confirm it before implementation.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- `amber break-loop --target <t> --issue <n> --title "<t>" --recurrence <n>` scaffolds
  docs/quality/break-loops/<localIsoDate>-<slug>.md containing all six template sections
  plus the five root-cause categories and the prevention-mechanism menu rendered from the
  single source in scripts/lib/core/break-loop.js.
- An existing scaffold file is never overwritten — the command refuses with a visible
  error naming the file (plan-command convention).
- `--recurrence < 2` is refused with a visible error: the operator declares the loop;
  Amber never auto-detects recurrence.
- `amber break-loop validate --file <p>` fails while any section is missing or contains
  unfilled placeholder markers (naming the offending section(s)) and passes only when
  every section is filled — no greenwashing.
- `amber break-loop --help` documents the five-category taxonomy and the
  prevention-mechanism menu with their write-back surfaces (help and scaffold read the
  same single source).
- Registry parity green with break-loop in PUBLIC_COMMAND_ORDER and the tier-core default
  help; the breadcrumb parity walk stays untouched — no lifecycle step, because break-loop
  is an on-demand ritual, not a lifecycle gate.
- Live dogfood: a real post-mortem for the #118→#122 UTC-date recurrence sits under
  docs/quality/break-loops/, passes validate, and is committed as the feature's own
  evidence.
- No network/issue-tracker access, no auto-detection of recurrence, no LLM judgment
  inside Amber; the friction→issue flow itself is unchanged. Existing Amber guardrails
  still pass.
- `npm test` green (0 failed).

## Verification

- node --test tests/unit/break-loop.test.js
- amber break-loop --target <tmp> --issue 118 --title "..." scaffolds docs/quality/break-loops/<date>-<slug>.md with all required sections
- amber break-loop validate --target <tmp> --file <scaffolded> fails on placeholders and passes when filled
- amber break-loop --help renders the taxonomy and menu
- node scripts/amber.js review --target . --plan docs/plans/F025-Break-loop-post-mortem-scaffold.md --json
- node scripts/amber.js gate --target . --plan docs/plans/F025-Break-loop-post-mortem-scaffold.md

## Evidence Schema

Planned evidence entries; record actual results and dates at verification time.

- Command: node --test tests/unit/break-loop.test.js
- Result: required — scaffold shape (six sections + taxonomy + menu from the single
  source), no-overwrite refusal, validate fails placeholders and passes filled,
  recurrence guard (≥ 2), slug/date naming via localIsoDate
- Date: record at verification
- Notes: new suite for the scripts/lib/core/break-loop.js pure functions

- Command: node --test tests/unit/command-registry-parity.test.js
- Result: required — registry parity green with break-loop in PUBLIC_COMMAND_ORDER and the
  tier-core default help
- Date: record at verification
- Notes: PUBLIC_COMMAND_ORDER is hardcoded; updating it in the same change as the registry
  definition keeps the guard honest

- Command: amber break-loop --target . --issue 122 --title "Evidence/reflux dates drift UTC vs local day" --recurrence 2
- Result: required — live dogfood: the real #118→#122 UTC-date recurrence gets a
  post-mortem under docs/quality/break-loops/, filled and validated green, committed as
  the feature's own evidence
- Date: record at verification
- Notes: recurrence ≥ 2 declared by the operator; --issue is a recorded reference number
  only — no issue-tracker network access

- Command: amber break-loop --help
- Result: required — renders the five-category taxonomy and the prevention-mechanism menu
  with their write-back surfaces
- Date: record at verification
- Notes: help and scaffold read the same single source, so they cannot disagree

- Command: npm test
- Result: required — full repository suite green (0 failed)
- Date: record at verification
- Notes: final gate before review/gate
