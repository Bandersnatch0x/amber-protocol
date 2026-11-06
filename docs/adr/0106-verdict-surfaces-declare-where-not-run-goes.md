# ADR-0106: A Verdict Surface Must Declare Where "Did Not Run" Is Recorded

**Status:** Accepted (2026-11-02)
**Date:** 2026-11-02
**Builds on:** [ADR-0004](0004-evidence-grade-verification.md) (evidence-grade verification),
[ADR-0012](0012-protocol-and-schema-versioning.md) (schema growth and drift signalling),
[ADR-0028](0028-ledger-family-factory-and-decision-primitives.md) (declaration-plus-factory as the
way a governed surface is admitted)

---

## Context

Four separate incidents share one root cause.

- `688e9df0` — `security audit` printed `Overall Status: PASS` for every repository. The CLI
  wrapper hardcoded `{ pass: true }` for two scans and an empty array for the third; the three
  real scanners sat unused next to it.
- `cb7bb8a1` — the harness leak check could not distinguish "scanned and found nothing" from
  "never scanned".
- `88632c52` — the leak check credited an unreadable page as scanned.
- `cli-advertised-flags` (`issues/357`) — a documented flag missing from `FLAG_SPECS` became a
  silent no-op: the command succeeded and ignored what the user asked for.

Each was repaired in place. Nothing established the rule the repairs implement, so each new
verdict surface re-derived it.

The codebase already answers "where does *did not run* live" three different ways, and all three
are correct for the surface that uses them:

| Surface | Placement | Evidence |
| --- | --- | --- |
| Gate, Policy | **refusal before an outcome** — no record exists | `gate-evaluation.js` "only contract/expiry/resolution failures refuse to run"; `policy-evaluation.js` "refuse before append and return outcome:null" |
| Evidence | **a separate assurance axis** — `status` stays two-valued, `assurance` carries `unavailable` | `evidence-receipts.js`: `EVIDENCE_STATUSES = ["pass","fail"]` beside `RECORDABLE_ASSURANCE = ["unavailable","observed","replayable"]` |
| Harness checks, security audit | **a third status value** — `not-run` / `unevaluated` / `unscanned` | `validation-core.js` `CHECK_STATUSES`; `held-out-core.js` `leak.status`; `688e9df0` "the report folds three states instead of two" |

The three placements are not interchangeable. A Gate Outcome is a recorded, revision-bound
Decision; there is no such thing as a recorded "we did not evaluate", so refusal is the only honest
option. An Evidence receipt must be able to say "the check failed" while also saying "the
observation is unavailable", which is two axes, not three values. A harness check has neither a
refusal path nor an assurance axis, so it needs a third value.

What is missing is not a shared vocabulary — it is the **obligation to choose**. A surface that
picks none of the three silently lets "did not run" read as "passed", which is what all four
incidents did.

The existing vocabularies also disagree on words for the same outcome: `fail` / `deny` /
`violation` for the negative, and `not-run` / `unevaluated` / `unavailable` / `unknown` /
`unscanned` / `incomparable` for the absent. `validation-core.js` alone declares two different
vocabularies, and `held-out-core.js` writes `"not-run"` as an inline literal with no declaration at
all.

## Decision

1. **Every verdict surface declares its not-run placement.** The closed set is `refusal`,
   `assurance`, `status`. A surface that declares none is a defect, not a default.
2. **The declaration is made through a factory, not a comment.** `defineVerdictSurface({ axis,
   notRun, ... })` refuses at definition time when `notRun` is missing or outside the closed set,
   the same way `defineLedgerFamily` refuses a malformed declaration. A surface cannot half-adopt
   the rule.
3. **Recorded outcome vocabularies do not change.** Gate Outcomes stay `pass|fail` and Policy
   Outcomes stay `pass|deny`, exactly as `CONTEXT.md` defines them. The factory maps an internal
   verdict onto each surface's recorded vocabulary. This is a code-shape decision, not a schema
   change, so ADR-0012 versioning and existing ledgers are untouched.
4. **A static seam guard forbids declaring a verdict vocabulary outside the factory**, on the
   pattern already used by the git, state-dir, confined-write, web-adapter, and ledger-ritual
   seams. One word per concept becomes checkable instead of remembered.
5. **Lifecycle status vocabularies are out of scope.** `adapter READ_STATUSES`,
   `retention HOLD_STATUSES`, `canonical ARTIFACT_STATUSES`, `breakglass GRANT_STATUSES`, and
   `runner REQUEST_STATUSES` describe where a record sits in its lifecycle, not whether a check
   passed. The two mixed axes are adjudicated as follows.

   `retention SETTLEMENT_STATUSES` **is in scope**. `unavailable` means the Holder was never
   reached, so nothing was deleted: it is a third status value, retryable alongside `refused` and
   `failed`, and declared as one.

   `external-registry`'s `DECLARED_STATUSES` and `EXECUTION_OUTCOMES` are **not verdict
   surfaces**. The external effect did run; what is undetermined is its result, which is a
   different question from "did a check pass". `attempted` and `unknown` are two distinct degrees
   of that indeterminacy — only `unknown` reconciles to `committed`, and either needs an
   idempotent contract to retry — so collapsing them into one not-run value would erase a
   transition the ledger depends on. Splitting outcome from observation would change a recorded
   vocabulary, which ADR-0012 forbids without a schema version.

## Rationale

- **Unifying the recorded vocabularies would break a published contract to win a cosmetic
  consistency.** Gate and Policy outcomes are revision-bound, hash-chained records consumed by
  strict queries. Adding a `not-run` value to them would need a schema version and a migration,
  and would invite a recorded outcome that the domain says cannot exist.
- **A shared vocabulary alone would not have prevented any of the four incidents.** Each one was a
  surface that never asked the question. The obligation to answer is the load-bearing part.
- **The factory is the precedent this repository already trusts.** ADR-0028 replaced ten
  hand-written ledger rituals with one declaration; the same move applies here, and the same
  failure (a surface quietly re-deriving the ritual) is what the ledger-ritual seam guard now
  catches.
- **Being able to read a verdict across surfaces is worth one word each.** A maintainer should not
  have to learn that `unevaluated` here means `unscanned` there.

## Consequences

- Eleven modules and sixteen closed vocabularies gained a declaration naming their placement.
  Gate, Policy, and Evidence change in documentation value only: their placements were already
  right, they were merely undeclared. Two surfaces that wrote the word as an inline literal
  (`held-out-core.js`, `src/security/audit-report.js`) now read it from the declaration instead.
- A new verdict surface that omits the declaration fails at import, and one that declares a
  hand-rolled vocabulary fails the seam guard, which scans both production trees (`scripts/lib`
  and `src`) because the security audit surface spans them. The `security audit` defect class is
  closed structurally rather than by a per-module fix.
- The `external-registry` outcome vocabularies stay outside the rule, with the reason recorded at
  the declaration site as well as in decision 5 — so the next reader meets the argument where
  they meet the code.
- This ADR does not make the three placements interchangeable. It makes choosing one explicit, and
  it keeps each surface's refusal path, assurance axis, or third value where it already is.
