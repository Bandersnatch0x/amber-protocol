# ADR-0017: Live observability via artifact polling and SSE invalidation

**Status:** Accepted
**Date:** 2026-08-19
**Builds on:** [ADR-0001](0001-governance-first-artifact-first.md) (governance-first, artifact-first), [ADR-0005](0005-experimental-execution-removal.md) (no live agent dispatch), [ADR-0007](0007-web-viewer-role.md) (supervised action viewer)

---

## Context

The web console's session detail page subscribed to SSE events but never rendered
the event array; the timeline query had no auto-refresh. SSE events are emitted
only by the web control plane, while CLI/runner activity lands in
`.amber/sessions/<id>/timeline.jsonl` via `scripts/lib/session-timeline.js`.
Users saw a running session with no visible activity ("缺乏可观测性"), and
runner-ack timeouts left the page showing "executing" with no event producer
attached.

## Decision

Live observability is **artifact-driven**: the web console polls the existing
`session.timeline` tRPC query (backed by `readTimelineEvents` reading
`timeline.jsonl`) on a conditional 5-second interval, gated by the shared
`isActiveStatus` view-model helper and stopped at terminal states. Non-heartbeat
SSE events trigger an immediate refetch (the invalidation-signal pattern already
used for evidence jobs). Disk `timeline.jsonl` is the single source of truth.

Client-side, timeline (disk) and SSE event arrays are merged with exact
`(type, timestampMs)` deduplication. Rendering reuses the timeline page's
`TimelineEvent` primitives and `timeline.event.*` i18n labels. The Live Activity
Card presents the most recent 30 events newest-first, distinguishes
runner-timeout empty state from normal empty state, and aggregates observation
entry points (full timeline link, transcript link when available).

### Rejected alternatives

1. **Server-side timeline-tailer** (fs.watch + byte-offset incremental reads
   bridging disk appends into SSE) — deferred to BACKLOG: Windows `fs.watch`
   flakiness, watcher lifecycle management, and a new server subsystem for what
   is an optimization, not a gap fix.
2. **WebSocket** — duplicates the existing SSE pipeline (auth, heartbeat,
   reconnect, cursor).
3. **Runner-side instrumentation of new event types** — unnecessary; the runner
   already appends activity events during execution via `session-timeline.js`.
4. **Rendering chat transcripts** — vocabulary boundary: Session is "not a live
   agent runtime or chat session" (CONTEXT.md).

## Consequences

**Positive:** ≤5s latency for CLI-written activity (SSE makes web-plane actions
immediate); reuses two patterns already proven in the same page file; zero new
server-side infrastructure.

**Negative:** Full-file JSONL read per poll; accepted for V1 (files are small,
active sessions only, terminal states stop polling). Production SSE auth gap
unchanged (polling is the source-of-truth path regardless).

**Neutral:** Follow-ups recorded in BACKLOG.md: (1) server-side timeline-tailer
for sub-second latency; (2) ADR-0013 no-progress findings surfaced via a new
read-only continuity seam; (3) `getEventSummary` hard-coded English i18n.

## Related

- ADR-0001 (governance-first, artifact-first — the provenance boundary)
- ADR-0005 (no live agent dispatch)
- ADR-0007 (supervised action viewer — allowed mutations and SSE)
- ADR-0013 (no-progress detection — reads the same timeline events)
- `schemas/timeline-event.schema.json` — event vocabulary
- `apps/web/src/components/session/LiveActivityCard.tsx` — implementation
