# Plan slice contract: declared paths, dependencies, and verification anchors

**spec_id:** plan-slice-contract
**Status:** accepted
**Updated:** 2026-11-05
**Provenance:** external process article (OK platform, 2026-11) distilled into the repository's own
vocabulary; ADR-0109 decision 1; existing plan gate (`scripts/lib/core/planning.js`
`validatePlanContent`)
**Feature:** F084

## Problem Statement

The plan gate treats `## Vertical Slices` as prose. A non-empty body passes, so a plan can declare
one unbounded slice ("make the smallest safe change"), name no files, depend on nothing, and carry
no verification command. Every downstream check then inherits that vagueness: the implementer picks
its own boundary, the reviewer cannot tell whether the change stayed inside it, and "verified" means
whatever the slice author meant.

This is a declaration gap, not a judgment gap. Nothing here needs a model.

## Solution

`## Vertical Slices` becomes a deterministic contract. Each slice declares three facts, and the
gate rejects a plan that omits or contradicts them.

1. **Identity.** Slices are numbered `1..N` in document order. Accepted headers:
   `- [ ] Slice 1: <outcome>`, `Slice 1: <outcome>`, and the bare `1. <outcome>` form —
   the bare form only when the block under it carries slice metadata, because prose that
   starts with a number must not become a slice. A section whose numbering does not start at
   1 or skips a number fails with a renumbering remedy.
2. **`paths:`** the repo-relative paths the slice touches. Non-empty, relative, inside the target,
   at most **5** entries, spanning at most **2** subsystems. A subsystem is
   `scripts/lib/<name>` for a module under that directory, otherwise the first path segment. This is
   the slice-size ceiling: a change that needs more is two slices.
3. **`depends-on:`** earlier slice numbers, or `none`. Every dependency must name a slice that
   appears **before** this one. Self, forward, and non-numeric references fail. The declared edges
   are a DAG by construction.
4. **`verify:`** the one command that proves this slice. Non-empty, not a scaffold placeholder.

Metadata bullets must be indented under their slice. The scaffolded plan carries all three bullets
with `<fill: …>` placeholders, so a freshly scaffolded plan fails the gate until a human curates it —
the same rule the Context manifests section already follows.

### Which plans the contract binds

Only a **terminal** lifecycle is frozen history: `accepted`, `complete`, `completed`, `done`,
`implemented`, `superseded`, `retired`, `obsolete`, `abandoned`, `rejected`. The work is over and the
plan can no longer change, so re-validating it enforces nothing — and re-validating all of them
would fail 62 of the 65 plans already in `docs/plans/` without changing a byte of any of them.

Everything else is gated: a plan with no `Status:` field, a plan still in motion
(`implementation-ready`, `in-progress`, `pending`, `proposed`, `draft`, `blocked`, `paused`), and a
settled word carrying a qualifier (`implemented-pending-verification`, `accepted-pending-review`)
because that plan still has work left.

Opting in is explicit: a plan that declares **any** metadata bullet adopts the contract and is then
held to every rule, including on a settled status. Silence means "pre-contract", a partial
declaration means "I am using this and must finish it".

A qualifier on a terminal word is not settled. Only a date annotation is stripped before the
status is classified: `accepted (2026-09-24)` is accepted, while `accepted (pending review)`,
`implemented (verification pending)`, and `accepted — pending re-review` still name work that
remains and stay gated.

Numbering is checked over the whole section and reported even for a terminal plan: a duplicate,
a gap, or a first header that is not 1 fails with a renumbering remedy. The section is scanned
past prose, so a note between slices cannot hide the slices after it.

## Design Decisions

- **Deterministic only.** No scoring, no weights, no confidence. The gate either sees the
  declaration or it does not.
- **Parse the existing shape.** The parser accepts the header forms already used in `docs/plans/`
  so historical plans stay readable; new plans get the scaffolded form.
- **Ceilings are declarations, not enforcement.** The gate checks what the plan claims. It does not
  inspect the eventual diff; scope drift remains the reviewer's job.
- **Backward compatibility is scoped, not waived.** Settled-lifecycle plans stay readable; plans
  still in motion must declare. The earlier draft of this decision failed every accepted plan in the
  repository, which is a migration cost nobody would pay for history that can no longer change.

## Testing Seams

- Pure parser and validator (`parseVerticalSlices`, `validateVerticalSlices`,
  `sliceSubsystemOf`) tested without disk access.
- The scaffolded plan's bullets are asserted by `buildPlanContent` tests.
- The real CLI is exercised through `amber plan` + `amber gate --plan` on a temp target.
