# ADR-0006: Web viewer is `.amber`-only

**Status:** Accepted
**Date:** 2026-07-07

## Context

The CLI's `scripts/lib/state-dir-resolver.js` encapsulates the `.amber`-preferred /
`.harness`-legacy dual-path policy. The web viewer (`apps/web`) never implemented the
legacy fallback, so a repository still on `.harness` is invisible in the UI. An
architecture review (2026-07-07) flagged this as a one-sided locality of the dual-path
knowledge and asked for an explicit decision rather than a silent omission.

## Decision

The web viewer reads `.amber` only (`apps/web/server/lib/artifact-store.ts`). It will
not carry the `.harness` fallback. Repositories on legacy state must run
`amber migrate` before the viewer can display them — migration is a one-time,
already-supported path, and duplicating the dual-path policy across the JS/TS seam
would spread legacy knowledge into new code.

## Consequences

- Future architecture reviews should not re-suggest adding `.harness` support to the viewer.
- If the viewer ever needs legacy reads, the policy must be ported from
  `state-dir-resolver.js` into `artifact-store.ts` in one place, not per-reader.
