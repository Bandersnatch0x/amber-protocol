# F061: Ledger Family Factory & Decision Primitives

**Status:** Proposed
**Depends on:** F050 (Decisions & Evidence), F054–F057 (the four newest registry families),
ADR-0028 (factory & primitives decision record)
**Grill record:** two-round design interview, 2026-08-30 — eleven adjudications, all listed
under Implementation Decisions; this Spec is the content authority.

## Problem Statement

Twelve governed registries carry ~19.6k lines while the shared core `registry-ledger.js` owns
only 396. Every family hand-writes the same ritual: path + corrupt-code plumbing (310 sites),
five-line lock wrappers (29), private fold walkers (28), event-problem validators (59). The
families split into two dialects — four "full" families orchestrate through
`appendLedgerEvent`, eight "primitive" families take only the low-level exports and keep a
private append/fold — so `AGENTS.md`'s claim that families *compose* the shared core is only
half true, and each new family costs ~1500 lines of copied ceremony.

Worse, the Decision-critical logic is multiplied: `decisionSnapshotProblem` exists three times
(byte-identical up to the kinds constant), `canonicalHashOf` five times (semantically
equivalent), and single-use Decision spending is implemented by **seven** different spenders
with three return shapes, per-family refusal wording, one slot named `issuer`, and one
cross-ledger check. These are the invariants where silent drift is a security hole.

## Solution

Deepen the seam in two moves, verified by a tracer-bullet migration:

1. **Decision primitives into the primitive layer** — `registry-ledger.js` absorbs the
   decision snapshot validator (kinds as a parameter), the canonical hash, and a shared
   **spend-scan kernel** (given ledger events plus slot paths, decide whether a pinned Decision
   is already spent). The seven spender shells stay in their families, keeping their own return
   shapes, refusal wording, and cross-ledger checks, but all call the one kernel.
2. **`defineLedgerFamily` factory** — a new `scripts/lib/core/ledger-family.js` exposes one
   declarative entry: directory, ledgers (name, lock name, conflict/corrupt codes, ceiling,
   label, fold), producing the family's paths, locks, appends, chain reads, and walks through
   the full-orchestration dialect. The factory has **one** target shape: full orchestration.
3. **Tracer bullet** — `breakglass-registry.js` (full dialect, three-slot spender) is
   reassembled through the factory with byte-identical behavior; the remaining eleven families
   migrate one ticket per family afterwards, primitive-dialect families upgrading to full
   orchestration inside their own tickets.

## User Stories

1. As a protocol author, I want a new registry family declared through one factory call, so
   that the next F05x family costs a data table, not ~1500 copied lines.
2. As a security reviewer, I want exactly one spend-scan kernel, so that single-use Decision
   enforcement cannot drift per family.
3. As a maintainer, I want the 12,116 lines of existing family behavior tests to pass without
   a single edit, so that the refactor is proven byte-compatible, not merely plausible.
4. As an incoming agent, I want `AGENTS.md`'s "families compose registry-ledger" claim to be
   literally true, so that reading one file explains every family.

## Implementation Decisions

All eleven grill adjudications, in dependency order:

1. **Scope (Q1):** skeleton + first slice + one tracer family; the other eleven families are
   follow-up tickets, one per family (Q3).
2. **Byte compatibility (Q2):** error codes, refusal wording, ledger record shapes, and lock
   file names are preserved byte-for-byte. The existing behavior suites are the regression net
   and must not be edited for this feature.
3. **Single target dialect (Q6):** the factory carries only full orchestration
   (`appendLedgerEvent`). Primitive-dialect families upgrade inside their own migration
   tickets; if a family provably cannot upgrade byte-identically, that ticket records the
   variance and re-opens the dialect question — the factory does not grow a second mode
   preemptively.
4. **Spend variants (Q7):** layered split. Snapshot and hash unify directly (facts: three
   snapshot copies differ only in the kinds constant; four hash copies are byte-identical and
   the fifth — runner — is semantically equivalent). Spending unifies only the scan kernel;
   the seven shells keep their per-family return shapes (key / description phrase /
   cutoverId), refusal wording, the `issuer` slot name (a ledger field shape, protected by
   decision 2), and maintain's cross-ledger check.
5. **Tracer family (Q8):** breakglass — full dialect, moderate size, and its three-slot
   grant/revocation/review spender is the sharpest test of the kernel's expressiveness.
6. **Layering (Q9):** decision primitives join `decisionPinProblem` /
   `resolveRegistrationDecision` in `registry-ledger.js` (the primitive layer stays one
   file); the factory is a new file, `scripts/lib/core/ledger-family.js`.
7. **Vocabulary (Q10):** CONTEXT.md gains **Ledger Family**, **Decision Pin**, **Decision
   Spend** (route-family avoidance is route-scoped and does not collide).
8. **Boundary (Q11):** survey opportunities 3 (flag-parse kit), 4 (governance-chain test
   fixture builder), and 5 (web mirror seams) stay out of F061 entirely.

## Tickets

- **T1 — Decision primitives** (no blockers): snapshot (kinds-parameterized), canonical hash,
  and the spend-scan kernel land in `registry-ledger.js`; all copy sites and seven spender
  shells re-point onto them. Full suite byte-green.
- **T2 — `defineLedgerFamily` skeleton** (blocked by T1): the declarative factory in
  `ledger-family.js`, composing the primitive layer including the decision surface.
- **T3 — breakglass tracer migration** (blocked by T2): `breakglass-registry.js` reassembled
  through the factory; its behavior suite passes unedited.
- **T4 — landing** (blocked by T3): `AGENTS.md` claim updated to name the factory as the
  family admission path, `feature_list.json` registration with landing evidence, learnings
  review booked.
- **Follow-ups (post-T3, one ticket per family):** external, maintain, retention (full
  dialect); adapter, runner, release, approval, evidence-receipts, principal,
  gate-evaluation, policy-evaluation (primitive dialect, each upgrading to full
  orchestration under decision 3).

## Testing Decisions

- The 12,116 lines of existing family behavior tests run **unedited** at every ticket; any
  needed assertion change is a spec violation, not a test update.
- T1 adds kernel-level unit tests for the spend scan (single slot, multi slot, `issuer` slot
  name, cross-ledger hook, spent-terminal semantics) and property tests that snapshot/hash
  outputs are byte-identical to the removed copies on recorded fixtures.
- T3 proves the tracer by suite-pass plus a ledger byte comparison on a seeded fixture run
  (same inputs, byte-identical `.amber/breakglass/` ledgers before/after migration).
- Standard gates per ticket: `npm test` (full log to disk), `npm run manifests`,
  `npm run doctor`, `npm run gen:agents:check`.

## Out of Scope

- Survey opportunities 3, 4, 5 (decision 8).
- Any behavior, wording, code, or ledger-shape change (decision 2).
- A second factory dialect (decision 3's re-open clause is the only path back).
- New families or new governance semantics — this feature only deepens the seam under the
  twelve that exist.

## Further Notes

Lineage: architecture-deepening survey 2026-08-30 (opportunities 1+2 merged as this feature);
grill rounds one and two adjudicated 2026-08-30 ("全部按推荐" both rounds); reconnaissance
facts (export surface, dialect split, spender variants, free numbers) recorded in the grill
transcript.

`feature_list.json` registration (deferred to landing, F060 precedent):

```json
{
	"id": "F061",
	"title": "Ledger Family Factory & Decision Primitives",
	"status": "planned",
	"spec": "docs/specs/F061-ledger-family-factory.md",
	"paths": [
		"scripts/lib/core/registry-ledger.js",
		"scripts/lib/core/ledger-family.js",
		"scripts/lib/core/breakglass-registry.js"
	]
}
```
