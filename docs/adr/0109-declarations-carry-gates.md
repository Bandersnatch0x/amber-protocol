# ADR-0109: Declarations Carry Gates; Knowledge Expires on a Deterministic Clock

**Status:** Accepted (2026-11-05)
**Date:** 2026-11-05
**Builds on:** [ADR-0009](0009-contract-driven-context-distillation.md) (context lifecycle and
distillation), [ADR-0010](0010-context-loadout.md) (Loadout assembly and freshness gating),
[ADR-0003](0003-governance-gated-execution.md) (deterministic, reviewable gates),
`docs/specs/plan-slice-contract.md`, `docs/specs/context-freshness-loop.md`

---

## Context

An external account of a large internal AI delivery pipeline described two mechanisms worth
adopting. First, work is cut into slices small enough to review, each with a stated dependency and
a stated way to prove it. Second, injected project knowledge is treated as perishable: it carries a
validity window, and consumers report when it no longer matches the code.

Amber already has the surfaces for both — a plan gate with a `## Vertical Slices` section, and a
Context Page schema with a `ttl` field — but neither surface enforced anything. The slice section
was prose; `ttl` was read by exactly one consumer. The gap was not a missing feature. It was a
declaration the gate accepted without checking.

The same account also proposed things this repository must not adopt: a seven-dimension weighted
score as an admission gate, and model confidence as an automatic admission signal. Both hide
judgment inside a number. Amber's gates are deterministic and human-owned, so those are refused
here and recorded as refused rather than silently dropped.

## Decision

1. **A plan's slices are a declaration the gate checks.** Each slice states its paths (at most 5,
   spanning at most 2 subsystems), its dependencies (earlier slices only, so the edges form a DAG
   by construction), and the one command that proves it. The gate rejects a plan that omits or
   contradicts the declaration. It never inspects the eventual diff — scope drift stays a reviewer
   judgment. The contract binds plans still in motion; only a terminal lifecycle is frozen history
   and stays readable, while any plan that declares even one metadata bullet has opted in and is
   held to every rule.

2. **Knowledge freshness has exactly one derivation.** `scripts/lib/core/context-freshness.js`
   computes the page's revision instant (latest accepted ingest, falling back to `created_at`), the
   expiry (that instant plus `ttl`), and the expiry test. Verify, refresh, Loadout assembly, and
   assurance all read that one answer. A page past its expiry is reported by `amber context verify`
   (`stale-by-time`, `AMBER_E_CONTEXT_PAGE_TIME_STALE`) and produces a `ttl-expired` refresh
   request.

3. **Consumer feedback is an append-only event, and confidence decay is a fixed ladder.** A
   `knowledge-feedback` event records `contradicted` or `confirmed` with an optional note. Each
   contradiction since the current revision drops effective confidence one level, floored at `low`.
   The page is never rewritten, a re-ingest clears prior decay, and a contradicted page still loads
   with visibly lower confidence rather than being silently excluded.

4. **Refused: weighted admission scores and confidence-based auto-admission.** A gate decides on
   required evidence and bounded explicit alternatives, never on a weighted total. Confidence is
   an observation attached to a page; it is never an input that admits or blocks work. Human
   acceptance and approval remain the only admission authority.

## Consequences

- Plans still in motion fail the gate until their slices are declared; terminal history is exempt
  and stays readable. The first draft exempted nothing, which would have failed 62 of the 65 plans
  already in `docs/plans/` — a contract that invalidates every historical record it cannot change
  buys no enforcement and costs the corpus. The exemption is deliberately narrow: `proposed`,
  `draft`, and `blocked` are still gated, because those plans can move again.
- `amber context verify` now disagrees with `amber context load` in one fewer case: an expired page
  is no longer `ok` at verify while excluded at load. Operators see the same fact on both paths.
- `deriveAssurance` returns a derived `confidence` and keeps `storedConfidence`, so a reader can
  always tell an original judgment from decayed confidence. Nothing writes the derived value back.
- Two new closed vocabularies exist and must stay closed: verify status `stale-by-time` and refresh
  reason `ttl-expired`.
- A contradicted page keeps loading. If repeated contradiction should eventually retire a page, that
  needs a human decision surface, not an automatic rule.

## Alternatives Considered

- **Reject the slice contract as over-specification.** Rejected: the gate already required the
  section, so the only choice was whether the requirement meant anything. An unenforced declaration
  is worse than none, because it reads as a check.
- **Compute freshness inside each consumer.** Rejected: the original defect was exactly that one
  consumer read `ttl` and three did not. One module is the fix, not four copies.
- **Write decayed confidence onto the page.** Rejected: it makes an append-only event history
  disagree with the page file, and it destroys the original human judgment.
- **Auto-exclude contradicted pages from Loadouts.** Rejected for now: one agent's note would
  silently remove shared knowledge from every other agent's context.
- **Exempt every status that sounds settled (`proposed`, `draft`, `blocked`).** Rejected: those
  plans can move again, so exempting them would gate nothing at exactly the moment the declaration
  matters. The first implementation used a word-boundary regex, which also exempted
  `completed-pending-verification` and `accepted-pending-review` — a qualifier means work remains.
