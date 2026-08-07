# ADR-0014: Routing Advisor — objective-driven `amber next` (T5.8)

**Status:** Accepted
**Date:** 2026-08-07
**Scope:** wayfinder map #102, T5.8 (decision: ADOPT).
**Builds on:** ADR-0001 (governance-first, artifact-first), ADR-0008 (workflow effectiveness is
distinct from governance readiness).

---

## Context

`amber next` currently answers one question: *where is this repo in the Amber lifecycle, and what
command should I run next?* It infers position from on-disk state (init → feature → plan → gate →
verify → approve → handoff → complete-check → accept). That inference is correct but reactive — it
tells you what the lifecycle demands next, not what *you* are trying to accomplish.

When a human starts a fresh piece of work — "fix a login bug", "add a payment integration", "refactor
the checkout module" — the useful question is not lifecycle position but **routing**: which
route/workflow-pack matches this objective? Today that auto-matching exists only inside
`amber session start` (goalPattern regexes over `route.trigger`). It is reactive at session-creation
time, and it cannot propose the workflow pack that should accompany the route.

We want `amber next` to double as a **read-only routing advisor**: give it an objective, and it
suggests a route (and optionally a workflow pack) from route manifest metadata. This stays firmly
inside Amber's artifact-first boundary (ADR-0001): it reads declarative manifests, scores keyword
matches, and prints advice. It never creates a session, never runs a route stage, and never executes
anything.

## Decision

`amber next --objective <text>` becomes an objective-driven routing advisor. It is an **evolution** of
the existing lifecycle inference, not a replacement: without `--objective`, `amber next` behaves
exactly as before (pure lifecycle-position inference, backward compatible).

Routing suggestions are produced by **deterministic keyword/description matching over route manifest
metadata**, never by semantic retrieval, embeddings, or any LLM call:

1. **Route matching** reads each route's optional top-level `objective` and `description` fields (plus
   `displayName` and `routeId`) and scores the objective's tokens against that text. Objectives that
   contain a route-id keyword (`bugfix` / `feature` / `refactor` …) are prioritized via an id-keyword
   bonus.
2. **Workflow-pack matching** reads pack metadata from `workflow-packs/*.pack.json` (`id`, `title`,
   `description`). Objectives with security-sensitive keywords (payment, credentials, auth, PII,
   external integration, …) are routed to a security/review pack (e.g. `secure-code-review`);
   otherwise the pack with the most objective-token overlap is suggested, when any.
3. **No match** emits an explicit degrade advice: run the plan gate first
   (`amber plan` → `amber session start`), rather than guessing a route.

The suggestion is surfaced as a `routingSuggestion` field in the `next` envelope (present only when
`--objective` is given) and as a "Route suggestion:" block in the human-readable text.

## Consequences

**Positive:** a single read-only command now answers both "what's next in the lifecycle" and "which
route fits this objective"; the matching is fully inspectable (no hidden model); the workflow-pack
dimension is proposed before any session exists, so the pack can gate the work from the start.

**Negative:** keyword/description matching is crude — a mis-worded objective can miss or over-match,
and the quality of suggestions depends on route authors writing meaningful `objective`/`description`
metadata. This is accepted: the advisor is advisory, the human makes the call, and
`amber session start` remains the authoritative route selector.

**Neutral:** no execution surface is added. `--objective` is a pure read of declarative manifests;
nothing Amber-side changes when the flag is absent.

## Related

- ADR-0001 (governance-first, artifact-first — read-only boundary preserved)
- ADR-0008 (workflow effectiveness is a separate dimension from governance readiness)
- `schemas/route.schema.json` — top-level optional `objective`/`description` metadata fields
  (added under issue #111, consumed here)
- `scripts/lib/route-selector.js` — existing goalPattern auto-matching used by `session start`
