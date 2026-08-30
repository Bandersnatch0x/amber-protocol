# ADR-0028: Ledger Families Compose One Factory; Decision Primitives Live in the Primitive Layer

**Status:** Accepted (2026-08-30)
**Date:** 2026-08-30
**Builds on:** [ADR-0023](0023-canonical-artifact-body-envelope-hash.md) (canonical admission),
F050's Decision/Approval contracts, and the shared governed-ledger core
(`scripts/lib/core/registry-ledger.js`)

---

## Context

Twelve governed registry families total ~19.6k lines against a 396-line shared core. They have
split into two dialects — four families orchestrate appends through `appendLedgerEvent`, eight
compose only the low-level primitives and keep private append/fold walkers — and the
Decision-critical logic has multiplied: three snapshot validators, five canonical hashes, and
seven single-use spenders with three return shapes and per-family refusal wording. `AGENTS.md`
claims the families "compose registry-ledger.js"; at 396/19,600 lines the claim is half true.
F054–F057 landed as four consecutive new families, so the marginal cost of the ceremony
(~1500 lines per family) is a recurring tax, and drift between spender copies is a standing
security risk. F061 is the feature that acts on this record.

## Decision

1. **One factory, one dialect.** New and migrated families are declared through
   `defineLedgerFamily` (`scripts/lib/core/ledger-family.js`), which carries only the
   full-orchestration dialect (`appendLedgerEvent`). Primitive-dialect families upgrade inside
   their own migration tickets; a family that provably cannot upgrade byte-identically records
   the variance in its ticket and re-opens this decision — the factory never grows a second
   mode preemptively. *(Amended 2026-08-30 — see Amendment below: the re-open clause fired on
   #306 with evidence from three families; the dialect stays single, the declaration vocabulary
   gains two closed extensions.)*
2. **Byte-compatibility is the contract.** Migrations preserve error codes, refusal wording,
   ledger record shapes, and lock file names byte-for-byte. The existing family behavior
   suites (12,116 lines) are the regression net and are never edited to make a migration pass.
3. **Decision primitives belong to the primitive layer.** The decision snapshot validator
   (kinds-parameterized), the canonical hash, and the single spend-scan kernel join
   `decisionPinProblem` and `resolveRegistrationDecision` in `registry-ledger.js`. Spender
   shells stay per-family — return shape, refusal wording, the `issuer` slot name, and
   cross-ledger checks are family surface, protected by decision 2 — but every shell consumes
   the one kernel.
4. **Migration is one ticket per family**, blockers-first, tracer bullet first (breakglass).
   No wholesale batch migration.
5. **Vocabulary.** CONTEXT.md carries **Ledger Family**, **Decision Pin**, and **Decision
   Spend** as the governing terms; specs and code comments follow them.

## Consequences

A new family becomes a data table plus its domain fold instead of ~1500 copied lines, and the
"compose registry-ledger" claim becomes literally auditable in one file per layer. Single-use
Decision enforcement has exactly one scan implementation to review. The cost: migrations are
deliberately slow (one family, one ticket, full unedited suite each time), and the factory's
single dialect means eight families each pay an upgrade step inside their migration ticket
before they benefit.

## Rejected alternatives

- **A dual-mode factory** (full + primitive) would move the ceremony instead of deleting it:
  two admission surfaces to learn, two to review.
- **Wording/shape normalization during migration** would force edits across the 12k-line
  behavior net, destroying the only proof of equivalence.
- **One parameterized spender swallowing all seven variants** would make the parameter surface
  the union of every family quirk — a pseudo-factory harder to audit than the copies.
- **Wholesale batch migration** trades the tracer's cheap falsification for a single
  all-or-nothing risk event.

## Related

- `docs/specs/F061-ledger-family-factory.md` (tickets T1–T4 and follow-up cadence)
- Architecture-deepening survey 2026-08-30 (opportunities 1 and 2; 3–5 explicitly out of
  scope)

## Amendment (2026-08-30) — evidence-driven extension of the declaration vocabulary

The decision-1 re-open clause fired on the first primitive-dialect migration (#306,
principal). Measured variance, pinned by unedited behavior suites: the principal fold
validates `schemaVersion`/`at` **before** the chain link on every event (its suite asserts
the dedicated version code on unchained fixtures at five seams, where the factory's
chain-first walk reports corruption instead — code and wording both change), and its
in-lock ceiling refusal names `AMBER_PRINCIPAL_MAX_REGISTRY_BYTES` where the orchestration
wording is generic. The same fold order is built into `approval-registry.js` and
`evidence-receipts.js`, so the variance is systemic, not a one-family quirk.

Ruling (user adjudication, 2026-08-30): the dialect stays single — one orchestration, no
private appends or folds — and the declaration vocabulary gains exactly two **closed**
extensions:

1. an optional per-ledger `fold.preLink(event, lineIndex)` hook, executed per event
   immediately before the chain-link check, for families whose recorded contract adjudicates
   domain problems ahead of chain problems;
2. an optional per-ledger ceiling refusal wording override, defaulting to the shared
   orchestration wording so the four already-migrated families are byte-unaffected.

This is not preemptive growth: both extensions exist only because three families' recorded
test contracts demand them, and neither reopens a path to a private append or an unchained
read.
