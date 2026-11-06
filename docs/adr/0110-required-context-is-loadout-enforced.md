# ADR-0110: Required Context Is Enforced Where It Is Loaded

**Status:** Accepted (2026-11-06)
**Date:** 2026-11-06
**Builds on:** [ADR-0009](0009-contract-driven-context-distillation.md) (context lifecycle and
distillation), [ADR-0010](0010-context-loadout.md) (Loadout assembly and required tier),
[ADR-0109](0109-declarations-carry-gates.md) (a declaration the gate accepts without checking),
`docs/specs/plan-required-context.md`

---

## Context

ADR-0109 established the pattern: a declaration the repository already writes down is either
checked or it is decoration. It applied that pattern to plan slices and to page freshness.

The Context manifest in a plan is the same shape of problem, one step further down the pipeline.
A plan declares the knowledge surfaces its implement and review roles need; `amber gate --plan`
checks that each path exists; then `amber context load` ignores the declaration entirely and
selects pages by route, scope, and budget. An agent can load a Loadout that omits the very
contract its plan named, and no command reports the disagreement.

The manifest also has no way to say how fresh the knowledge must be. A page can be distilled
before the plan was accepted, still hash-match its sources, and describe a world the plan has
since changed.

## Decision

1. **The Context manifest is a loadout contract.** A role's declared surfaces become the
   required tier of a Loadout built for that plan and role. The declaration is not advice and not
   a hint to the allocator; a missing requirement is a failed build. There is no second,
   optional spelling — a declared surface is required, or the plan does not declare it.

2. **A role may state a freshness floor.** `freshness: <date|instant>` is the oldest acceptable
   revision instant for the role's required pages. It is an absolute instant so the same
   declaration reads the same forever. A malformed floor is a gate failure, never "no floor".
   The loadout validates the declaration at its own boundary with the same ISO-8601 parser the
   gate uses. A present but empty or unparseable value refuses with `AMBER_E_INVALID_ARG` naming
   the plan, the role, and the value, before anything is written. That applies to a terminal plan
   too: the gate's terminal-plan exemption covers the gate, not an unvalidated load.

3. **Every requirement resolves to exactly one current, healthy page covering its path.** Absent
   coverage refuses as `missing`; more than one current page refuses as `ambiguous`; a stale,
   tampered, obsolete, or orphaned page refuses as `unhealthy`; a superseded page refuses as
   `superseded`; a page past its TTL refuses as `time-expired`; a page older than the declared
   floor refuses as `stale-floor`. Every refusal carries the closed code
   `AMBER_E_CONTEXT_LOADOUT_REQUIRED` and names the surface and role. After tier selection the
   build re-checks each resolved page against the required tier, so the authority layers
   (classification ceiling, hard expiry, firewall) cannot silently drop a declared page. An
   authority denial is reported as `unhealthy` with the actual denial fact in the detail; the
   page's stored health status is not mutated and the closed reason set is unchanged.

4. **A refused build writes no loadout file.** Partial required tiers are the failure mode this
   feature exists to remove, so the build refuses before persisting rather than writing a file
   with a hole and a warning.

5. **The build repairs nothing.** It does not re-ingest, refresh, retire, or silently demote a
   requirement. Remediation stays an explicit operator action.

6. **`--since` does not remove a plan-declared required page.** This is the narrow F085 exception
   to ADR-0010 D6. The delta filter keeps its meaning for ordinary pages and `--page` pins, but a
   plan-declared required page stays in the required tier even when its revision predates
   `--since`, because decision 4 forbids a required tier with a hole. Coverage matching strips a
   source citation's line range through the shared source-path helper, so a span-cited page covers
   its whole surface.

## Consequences

- A plan that declares knowledge it cannot back with a current page now fails at load time. That
  is the point: the failure moves from "the agent read the wrong thing" to "the operator sees
  which surface is uncovered".
- Page churn becomes visible. Re-distilling a page changes its revision instant, so a plan with a
  freshness floor will start failing once that page ages past it — intentionally, and with the
  surface named.
- The flat manifest form keeps working, so existing plans do not need a migration to stay
  readable. Opting into `freshness:` is per role.
- `context load` grows a plan/role input and one new refusal path. It gains no new admission
  authority: the required tier already existed, and this only decides what belongs in it.
- Terminal plans stay readable. The manifest rules bind plans still in motion, matching the slice
  contract's boundary.

## Alternatives Considered

- **Let the agent check the manifest after loading.** Rejected: the agent has no reliable view of
  what it was not given, which is exactly the failure being fixed.
- **Warn and continue with a partial required tier.** Rejected: a warning on a loadout file is
  read after the fact, if at all, and the artifact looks complete.
- **Choose the newest of several covering pages.** Rejected: silent choice makes the loaded
  knowledge depend on page churn, and hides a real authoring conflict.
- **Use a relative window (`freshness: 30d`).** Rejected: it silently changes meaning as the plan
  ages, so the same declaration cannot be reviewed.
- **Fold the requirement into the budget allocator.** Rejected: requirements are not budgeted
  candidates. A requirement either loads in full or the build fails; letting the budget drop one
  would recreate the gap.
