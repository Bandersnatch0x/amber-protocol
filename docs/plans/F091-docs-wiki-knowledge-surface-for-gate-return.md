# Plan: docs: wiki knowledge surface for gate return

Feature: F091
Status: accepted
User Confirmation: confirmed

## Goal

The operating manual section 5 and the schema spec timeline enum carry the F090 gate-return ruling semantics, so the wiki layer no longer contradicts the shipped behavior

## High Level Design

- Context: F090 shipped on 2026-11-17 (spec `docs/specs/F090-gate-return.md`, ADR-0111) and
  `schemas/timeline-event.schema.json` already carries the `gate_returned` event type. The wiki
  layer still describes gates as pass-or-block only: `docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md`
  §5 (Task Routes) lists the packaged routes but says nothing about a return ruling, and
  `docs/wiki/SCHEMA_SPEC.md` §3 lists a timeline enum missing `gate_returned`. Both pages also
  carry stale `Last Reviewed` dates.
- Proposed approach: two documentation edits, no code. §5 gains a short subsection stating the
  ruling semantics from F090 contract items 1-8: `amber session approve --return-to <stage>`
  records a return instead of an approval; targets are the gate's owning stage and earlier;
  the ledger stays append-only and the cursor is derived; the returned gate goes back to pending
  so a stale `gate_passed` cannot unblock the rerun; `amber next` and the per-turn breadcrumb
  count a returned gate as pending again; `complete-check` treats approval evidence as voided
  until a later re-approval. `SCHEMA_SPEC.md` gains `gate_returned` between `gate_failed` and
  `checkpoint_created`, matching the schema. Both `Last Reviewed` lines move to 2026-11-18.
- Risks: over-claiming semantics beyond the spec (mitigated by deriving every sentence from
  contract items 1-8 and ADR-0111); a wiki validator or link check rejecting the new prose
  (mitigated by running `node scripts/validate-wiki.js --target .` before and after).

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/specs/F090-gate-return.md, docs/adr/0111-gate-return-rewinds-the-session.md, schemas/timeline-event.schema.json, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, docs/wiki/SCHEMA_SPEC.md
- review: docs/specs/F090-gate-return.md, docs/adr/0111-gate-return-rewinds-the-session.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, docs/wiki/SCHEMA_SPEC.md

## Vertical Slices

Each slice names the paths it touches, the earlier slices it depends on, and the one command that proves it.
A slice carries at most 5 paths and 2 subsystems (a scripts/lib/<name> module or a first path segment).

- [ ] Slice 1: record the gate-return ruling semantics in Operating Manual §5 and refresh its review date.
  - paths: docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md
  - depends-on: none
  - verify: node scripts/validate-wiki.js --target .
- [ ] Slice 2: add `gate_returned` to the SCHEMA_SPEC timeline enum and refresh its review date.
  - paths: docs/wiki/SCHEMA_SPEC.md
  - depends-on: 1
  - verify: node scripts/validate-wiki.js --target .

## Resume Checkpoint

- Resume Point: plan filled; implementation has not started.
- Blockers: user confirmation is pending.
- Next Action: review docs/plans/F091-docs-wiki-knowledge-surface-for-gate-return.md, then confirm it before implementation.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- The user-visible behavior is demonstrably satisfied.
- Existing Amber guardrails still pass.
- `docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md` §5 states the return ruling, its legal targets, the
  re-arm rule, the guidance-surface consequence, and the complete-check voiding.
- `docs/wiki/SCHEMA_SPEC.md` lists `gate_returned` in the timeline event enum at the schema's
  position (between `gate_failed` and `checkpoint_created`).
- Both wiki files carry `Last Reviewed: 2026-11-18`.

## Verification

- node scripts/validate-wiki.js --target .

## Evidence Schema

- Command:
- Result:
- Date:
- Notes: