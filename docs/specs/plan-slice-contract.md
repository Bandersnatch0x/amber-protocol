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
   `- [ ] Slice 1: <outcome>`, `1. <outcome>`, `1) <outcome>`, `Slice 1: <outcome>`.
   A slice whose number does not match its position fails.
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

## Design Decisions

- **Deterministic only.** No scoring, no weights, no confidence. The gate either sees the
  declaration or it does not.
- **Parse the existing shape.** The parser accepts the header forms already used in `docs/plans/`
  so historical plans stay readable; new plans get the scaffolded form.
- **Ceilings are declarations, not enforcement.** The gate checks what the plan claims. It does not
  inspect the eventual diff; scope drift remains the reviewer's job.
- **Backward compatibility is explicit.** Plans written before this contract fail the gate until
  their slices are declared. That is the intended effect: the gate is a contract, and the migration
  cost is one edit per open plan.

## Testing Seams

- Pure parser and validator (`parseVerticalSlices`, `validateVerticalSlices`,
  `sliceSubsystemOf`) tested without disk access.
- The scaffolded plan's bullets are asserted by `buildPlanContent` tests.
- The real CLI is exercised through `amber plan` + `amber gate --plan` on a temp target.
