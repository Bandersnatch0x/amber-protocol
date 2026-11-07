# F088: Render the knowledge map before recent changes

Status: implemented
Date: 2026-11-07
Issue: https://github.com/Bandersnatch0x/amber-protocol/issues/400
Related: `docs/specs/F059-knowledge-decision-map.md`, `docs/specs/F060-knowledge-map-v2-code-graph.md`

## Problem

The knowledge page mounts graph, recent-change and semantic-status queries together.
The ordinary tRPC batch response waits for all three queries. The recent-change
query repeats graph construction for drift and reads history, maintenance and live
links before the batch can return. Its work delays a graph that the map could
already display. A cold browser replay exceeded the existing 15-second graph
assertion while that response was pending.

## Contract

1. Request the graph and semantic status with their current read-only semantics.
2. Enable the initial recent-change query only after graph data is available.
   A recent-change request that remains pending must not prevent the map from
   rendering its real node and edge counts.
3. Preserve the graph loading and error states. If no graph data is available,
   do not start the initial recent-change request.
4. Preserve the live feed, manual refresh, error handling, no-poll options and
   no-retry options once graph data exists.
5. Preserve consent-gated semantic inference and the current graph contents,
   source validation and API contracts. Do not introduce a server-wide cache,
   synthetic graph data, a higher timeout or automatic retries.

The organizing state is the existing graph query result. No additional readiness
boolean or synchronization protocol is needed. A cached graph is already data
available to the page and may enable the feed immediately.

## Verification

- Hold any network request containing `knowledge.recentChanges` and render the
  graph through the real fixture-backed API before releasing that request.
  The old combined batch must fail this regression.
- Verify the recent query transitions from disabled while the graph is loading
  to enabled after graph data arrives, preserving its other query options.
- Verify normal recent-feed loading, manual refresh, graph errors, no-provider
  behavior and the existing consent-gated semantic flow.
- Repeat cold browser runs with the current timeouts and retain every outcome.
- Compare unprofiled API request patterns on a fixed corpus in at least five
  alternating samples per pattern. Count errors and verify identical graph
  output. Report these numbers as first-map API response time, separately from
  browser rendering and server startup.

## Scope

The change belongs in the knowledge page's existing query options. Backend
snapshot lifetime, graph construction, public signatures and fresh-read behavior
stay governed by F059 and F060. The separately observed one-off mobile timeout
requires its own diagnosis before any change is made to that path.
