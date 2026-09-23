# F071: Harness H3b — Firewall Verdict Wiring (the Loadout Consumes the Grants)

**spec_id:** F071
**Status:** draft
**Updated:** 2026-09-23
**Provenance:** Harness v2 proposal §11 (Grant formula), §22.1 (default deny), §32/§41 (H3 Specification + Phase-H3 gate: "Agent saw what? Why was it allowed? What was hidden? When did access expire?"); F069 H3a as the staged foundation (its spec named H3b as explicitly out of scope); the existing context-loading path — `context load` → `buildLoadout`/`previewLoadout` (`scripts/lib/core/context-loadout.js`), the §3.3 ingress-exclusion discipline, `schemas/context-loadout.schema.json`; F017/F027 lifecycle as the untouched authority; ADR-0102 (event vocabulary); wayfinder map `issues/0066`; user direction 2026-09-23 (「继续推进v2.2」)
**Feature:** F071

## Problem Statement

The firewall verdict exists but is never consulted where it matters: `context load` assembles
the artifact an agent actually sees — the Context Loadout — from a deterministic, budgeted,
freshness-gated selection, and F069's `checkContextAccess` answers "may subject S see resource
R for purpose P right now" deterministically from the granted set. But nothing connects them:
a loadout is built without asking whether its subject holds covering grants, so "Agent saw
what? Why was it allowed?" is answered by the check command only when a reviewer thinks to run
it — never at the moment of loading. The loadout already enforces two authority facts at
ingress (hard expiry, classification ceiling under §3.3); the grant verdict is the third, and
it is missing.

## Solution

Wire the F069 verdict into the loadout build, behind the §3.3 exclusion discipline that
already exists:

- **Activation is explicit**: `amber context load --subject <s> --purpose <p> [--run <id>]`
  turns the firewall on. Declaring a subject without a purpose refuses (the check cannot be
  meaningful without both). **Without `--subject` the build is byte-identical to today** —
  no `firewall` section, no new fields; absence of the section is the visible statement that
  the load was not grant-governed (never silent: the reviewer sees which mode produced the
  artifact they are reading).
- **The verdict is F069's, not a second one**: each candidate page (after the existing
  §3.3 authority exclusions, before tier selection — a required pin cannot pull a page past
  the firewall either) passes through `checkContextAccess(subject, resource=pageId,
  purpose, classification=page.classification, now, runId)`. `allow` keeps the page and cites
  the covering grant; `deny` excludes it with reason `firewall` and the closed deny reason
  (`no-grant`/`revoked`/`expired`/`purpose-mismatch`/`classification-above-ceiling`) in the
  detail. The check's `context.denied` events land on the tamper-evident trail exactly as in
  H3a — no new event types, no second trail.
- **The loadout cites its authority**: an additive `firewall` section — `{mode: "on",
  subject, purpose, checkedAt, grants: [{id, snapshotHash, validUntil}] (the distinct
  covering grants), deniedCount}` — so the Phase-H3 gate's four questions are answered from
  the artifact itself: saw what (pages), why allowed (grants cited), what was hidden
  (excluded reason `firewall` + closed reason), when access expires (validUntil per grant).
  A declared subject with **no covering grant at all** denies every page (fail-closed, loud:
  an empty allowed set with full citations).
- **Determinism**: the verdict depends on `now` (TTL) — the same time input the build already
  takes for expiry and delta. Firewall-off builds keep full byte-identity. Firewall-on builds
  embed the real evaluation instant (`firewall.checkedAt`), so two firewall builds of the same
  state produce different bytes even when every verdict is unchanged — the byte-dedupe is
  deliberately defeated for firewall builds (the file rewrites and one `loadout-written` event
  re-appends), while per-page denial events appear only when a page is actually denied.
- **Compose, never duplicate**: the loadout's own `maxClassification` ceiling and hard-expiry
  exclusions run first and unchanged; the grant ceiling is the grant's, evaluated by the
  check. No new classification taxonomy, no redaction-ledger changes (the §3.2 ledger stays
  the bounded empty ledger it is today).

## User Stories

1. As a maintainer, I want `context load --subject S --purpose P` to admit only pages
   covered by S's live grants, so that what an agent actually loads is what was granted.
2. As a reviewer, I want denied pages excluded with reason `firewall` and the exact closed
   reason, so that "what was hidden and why" is readable in the artifact.
3. As a reviewer, I want the loadout to cite the covering grants (id + Snapshot Hash +
   validUntil), so that "why was it allowed / when does access expire" is in the artifact.
4. As a maintainer, I want a subject without grants to produce an empty allowed set with
   full citations, so that missing authorization is loud, not silent.
5. As a maintainer, I want a plain `context load` (no subject) to stay byte-identical, so
   that the F017/F027 flows are untouched until they declare a governing identity.
6. As a reviewer, I want every firewall denial on the trail as a `context.denied` event, so
   that access history stays unfalsifiable.

## Implementation Decisions

- **One verdict function**: the build calls `checkContextAccess` verbatim; the loadout build
  adds zero verdict logic of its own. The per-page denial events are the check's own.
- **Additive schema growth (ADR-0012)**: `schemas/context-loadout.schema.json` grows an
  optional `firewall` section and extends the `excluded[].reason` enum with `firewall`;
  pre-H3b persisted loadouts stay valid (verify reads them unchanged); no new schema file
  (schema-count pin unchanged).
- **Ingress order**: §3.3 authority exclusions (expiry, classification ceiling) run first;
  the firewall runs second — a page already excluded for expiry/ceiling never queries the
  grants, and the recorded reason is the first authority fact that applied.
- **CLI flags exist already** (`--subject`, `--purpose`, `--run` in FLAG_SPECS); the command
  adapter's `loadBody` passes them through — no new flags, expert tier unchanged.
- **The report-only check command is unchanged**: `amber harness context check` remains the
  point-check; the loadout build is now the second consumer of the same verdict.

## Testing Decisions

- Conformance at the real path: `buildLoadout` with subject+purpose against admitted grants —
  allow path cites the grant; every closed deny reason surfaces as a firewall exclusion
  (expired via grant windows against the build's wall clock — the build accepts no `--now`
  injection; the check command itself carries the injected-`--now` coverage from H3a;
  revoked; purpose-mismatch; classification-above-ceiling with a page above the ceiling;
  no-grant empties the set);
  required pins cannot pull a denied page; the trail carries the per-page `context.denied`
  events; a no-subject build is byte-identical to the pre-F071 bytes; schema round-trip
  (verify reads a firewall-bearing loadout).
- A good test asserts externally observable behavior (loadout fields, exclusion reasons,
  event kinds), never internals.

## Out of Scope

- ContextItem/ContextProfile as new artifact kinds (the grant + loadout composition covers
  the §32 deliverables; a separate ContextItem artifact is not needed for the gate);
  making subject declaration mandatory (a charter-level default-deny flip, not an H3b
  decision); value-level redaction changes; MCP projection; replay (H5); scheduler (H7);
  homepage/charter change.

## Further Notes

- Design decisions above follow the standing user directive (map `issues/0066`: 执行带入;
  this session's「继续推进v2.2」continues it). The HITL gate for draft → accepted is
  `issues/0105`.
- Naming/seam/guard constraints identical to the F065–F070 batches.
