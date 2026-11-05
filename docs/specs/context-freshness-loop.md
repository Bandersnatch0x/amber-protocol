# Context freshness loop: one derived expiry and append-only knowledge feedback

**spec_id:** context-freshness-loop
**Status:** accepted
**Updated:** 2026-11-05
**Provenance:** external process article (OK platform, 2026-11) distilled into the repository's own
vocabulary; ADR-0009 (context lifecycle); ADR-0109 decision 2; `schemas/context-page.schema.json`
`ttl`
**Feature:** F084

## Problem Statement

`ttl` exists on Context Pages and the page schema documents it as "the load-build derives the
effective hard expiry from the page's ingest/refresh instant", but only one consumer ever read it:
`context-loadout.js` excluded expired pages while assembling a Loadout. The other read paths —
`context verify`, `context refresh`, `context stats`, and `deriveAssurance` — ignored `ttl`
completely.

Two consequences:

1. **Silent staleness.** A page can be expired for weeks while `amber context verify` reports it
   `ok` and `doctor` reports no hard failure. The one command an operator runs to check knowledge
   health says the opposite of the truth the load path already knows.
2. **No feedback channel.** When an injected page contradicts the code, the only remedy is a full
   re-distillation. Nothing records "this page is wrong" between ingests, so confidence never
   moves and the next reader has no signal.

## Solution

### 1. One freshness policy module

`scripts/lib/core/context-freshness.js` owns every freshness answer. No consumer re-derives an
expiry.

- **Revision instant.** The latest `ingest` event with outcome `accepted` or `no-change` for the
  page. `created_at` applies only to pages with no ingest evidence; `page-written` is the last
  fallback. A re-ingest therefore restarts the TTL window.
- **Expiry.** `expiresAtFromTtl(page, revisionInstant)`. `ttl` absent means no hard expiry.
- **Boundary.** Expired when `expiresAt <= now` (half-open, matching the existing exclusion).

### 2. Verify reports it

`checkPage` gains `expiresAt` and a `stale-by-time` status with the closed code
`AMBER_E_CONTEXT_PAGE_TIME_STALE`. Source-level facts keep precedence: a page that is both
source-stale and time-stale reports `stale` and still carries the time-stale finding. The summary
gains a `timeStale` count. `verifyPages(target, { now })` accepts an injected clock. `summary.timeStale` counts pages past
their ttl — including pages whose status is the stronger `stale` — so the doctor line reports the
fact rather than a status tally.

### 3. Refresh requests cover TTL

`refreshPages` gains a second trigger. A page with an elapsed TTL and unchanged sources produces a
request with `reason: "ttl-expired"`; a page that also changed sources produces
`reason: "source-change"` (one request covers both). The request carries `expiredAt` whenever the
ttl had elapsed, including when a source change supplies the reason; the persisted request records
the same instant at `target.expiredAt`, validated as a `date-time` by the request schema. The
`request-created` event's `trigger` records the same reason, so `stats` can count them.

`verify --loadout` reads the same answer: a required page whose recorded `expiresAt` has passed
is reported `AMBER_E_CONTEXT_PAGE_TIME_STALE` even when its hash still matches, because that is
the check the operator is told to run immediately before the agent loads the artifact.
`verifyLoadoutFile(target, path, { now })` accepts the injected clock.

### 4. Append-only knowledge feedback

`amber context feedback --page <id> --verdict <contradicted|confirmed> [--note <text>]` appends one
`knowledge-feedback` event to `.amber/context/events.jsonl`. It never rewrites the page.

- **Effective confidence** is derived at read time: each `contradicted` event since the page's
  current revision drops one level (`high → medium → low`, floored at `low`); an unspecified
  confidence becomes `low` on the first contradiction. `deriveAssurance` returns the effective
  `confidence` alongside `storedConfidence` and the `feedback` counts. When an event shares the
  revision's millisecond instant, append position decides: feedback logged after the revision
  event counts, feedback logged before a re-ingest stays outside the window.
- **A re-ingest clears prior decay**, because the window starts at the new revision.
- **Loadout visibility.** `context load` projects the derived `confidence`, `storedConfidence`, and
  `feedback` counts into every selected page's metadata, at the required, priority, and optional
  tiers alike, so a contradicted page is visibly lower to the agent that loads the artifact. The
  page bytes are unchanged and confidence never affects inclusion.
- `context stats` reports `feedback: { contradicted, confirmed }`.

Feedback is a write action in the Action registry (`approvalRequired: true`), matching every other
context write.

## Design Decisions

- **Deterministic, no model.** Decay is a fixed ladder, not a score. No weights, no age blending —
  age is already expressed as freshness, and duplication would make two numbers disagree.
- **Events, not page edits.** The page is the distilled content; feedback is commentary about it.
  Mixing them would make every contradiction a content revision and force a re-ingest.
- **No auto-demotion of tier.** A contradicted page still loads; it loads with visibly lower
  confidence. Automatic exclusion would let one agent's note silently remove shared knowledge.
- **The clock is injected, not read twice.** Verify and refresh take `now` once so two pages in one
  run cannot straddle a boundary.

## Out of Scope

- Weighted freshness scoring (explicitly rejected: a gate must not carry hidden weights).
- Automatic page retirement on repeated contradiction (needs a human decision surface first).
- Declarative required-context manifests in plans (tracked separately; the plan gate already
  enforces curated manifests).
