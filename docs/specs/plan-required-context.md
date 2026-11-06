# Plan required context: role declarations enforced at loadout

**spec_id:** plan-required-context
**Status:** accepted
**Updated:** 2026-11-06
**Provenance:** ADR-0109 decision 1 (a declaration the gate accepts without checking); ADR-0010
Loadout tiers; `## Context manifests` in `scripts/lib/core/planning.js`
**Feature:** F085

## Problem Statement

A plan already names the knowledge surfaces its implement and review roles need. `amber gate
--plan` validates that each entry exists. Nothing then connects that declaration to the Loadout
an agent actually loads: `amber context load` selects pages by route, scope, and budget, and a
declared surface that no page covers is simply absent. The plan says "the implementer needs this
contract"; the loadout quietly disagrees.

The same gap hides a weaker failure. A page can cover the surface and still be useless — stale
against its source, superseded, past its TTL, or distilled before the plan's accepted freshness
floor. Today every one of those is a judgment the agent makes after loading, if it notices.

This is a declaration gap, not a retrieval-quality gap. Nothing here needs a model or a score.

## Solution

The Context manifest becomes a loadout contract with one addition and one enforcement point.

### 1. Every declared surface is required; a role may add a freshness floor

The role bullet keeps its bare knowledge-surface paths and gains one optional sibling bullet:

```text
- implement: docs/specs/plan-required-context.md, docs/adr/0110-required-context-is-loadout-enforced.md
  - freshness: 2026-10-01
- review: docs/specs/plan-required-context.md
```

Every declared path is required — there is no second, optional spelling. The existing flat form
stays valid and means "these paths are required, with no declared floor".

`freshness:` is an ISO-8601 date or instant and is the **oldest acceptable revision instant** for
every page covering that role's declared surfaces. Absent means no floor. A malformed floor fails
the gate: an unparseable declaration is not "no declaration". A `freshness:` bullet outside a role
block is itself an error, not an orphaned hint.

The loadout validates the declaration again at its own boundary. A present but empty or
unparseable floor refuses with `AMBER_E_INVALID_ARG` naming the plan, the role, and the declared
freshness value, before any file is written. That refusal is a declaration error, not a
page-requirement failure, and it applies to a terminal plan too: the gate's terminal-plan
exemption covers the gate, not an unvalidated load.

### 2. Loadout enforcement

`amber context load --plan <plan> --role <implement|review>` (and `context preview`) resolves the
role's declared set and applies it as the loadout's required tier. Requirements are unioned with
any `--page` pins; nothing in the declaration is optional.

For every required surface the loadout must find **exactly one current page** whose sources cover
that path, and that page must be:

- present, with status `ok` (not `stale`, `stale-by-time`, `tampered`, `obsolete`, or `orphaned`);
- current, with no superseding page;
- within its TTL at build time; and
- at or after the role's freshness floor, compared against the page's revision instant.

After tier selection the build re-checks every declared page against the required tier. The
authority layers (classification ceiling, hard expiry, firewall) run before selection and can drop
a page the resolver accepted, so a declared page that did not survive refuses the build. That
refusal uses the closed reason `unhealthy` and carries the actual authority fact (for example
`firewall: firewall deny ...` or `classification restricted exceeds ...`) in the detail. The
page's stored health status is not mutated.

Any page-requirement failure refuses the whole build with `AMBER_E_CONTEXT_LOADOUT_REQUIRED` and
names the surface, the role, and the closed reason (`missing`, `ambiguous`, `unhealthy`,
`superseded`, `time-expired`, or `stale-floor`). The loadout file is never written when a
requirement fails: a partial required tier is the failure this feature exists to prevent.
Inherited required-tier budget overflow keeps its existing code,
`AMBER_E_CONTEXT_LOADOUT_REQUIRED_OVERFLOW`.

`--since` keeps its ADR-0010 D6 delta meaning for ordinary pages and `--page` pins. Plan-declared
required pages are the narrow F085 exception: they stay in the required tier even when their
revision predates `--since`, because a required tier that omits a declared surface would defeat
the guarantee above.

### 3. Report, never silently repair

The build adds no admission authority. It does not re-ingest, refresh, retire, or rewrite a page,
and it does not drop a failing requirement to the priority tier. An authority denial is reported,
never repaired, and the page's stored health status stays as the write path recorded it. The
operator sees the reason and runs `amber context refresh` or re-distils the page.

## Design Decisions

- **One resolution, one refusal.** A single pass over the role's required surfaces produces the
  required tier or the first refusal; the build never retries a weaker interpretation.
- **Coverage is a source-path match.** A page covers a surface when one of its `sources[].ref`
  normalizes to that repo-relative path. Matching is exact after normalization (`./`, backslashes,
  quoting, case, and leading or trailing slashes); no globs, no prefixes, no fuzzy matching. A
  source citation's line range (`#L10-L20`) is stripped by the shared source-path helper, so a
  span-cited page covers its whole surface.
- **Ambiguity fails closed.** Two current pages covering one required surface is `ambiguous`, not
  "pick the newer one". Choosing silently would let page churn change what an agent reads.
- **The floor is an instant, not a duration.** A plan that says "not older than 2026-10-01" reads
  the same forever; a relative window would silently move as the plan ages.
- **Terminal plans stay readable.** The gate already exempts terminal lifecycles from the slice
  contract; the manifest rules follow the same boundary so historical plans do not fail.

## Testing Seams

- Pure manifest parser and validator in `scripts/lib/core/planning.js`
  (`parseContextManifests`, `validatePlanContent` for the freshness rules), tested without disk
  access.
- `scripts/lib/core/context-requirements.js` owns the resolution and refusal reasons; the loadout
  build calls it once and projects the outcome.
- The committed suite exercises the real CLI through `amber context load --plan --role` on a temp
  target: a passing plan-bound load, the `--plan` plus `--since` required-page case, and the
  invalid-floor refusal. The resolver unit tests cover all six closed reasons.
