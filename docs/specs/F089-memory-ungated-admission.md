# F089: Ungated memory admission

Status: proposed (implementation shipped; spec acceptance pending)
Date: 2026-11-07
Related: `docs/adr/0018-governed-memory-layer.md`, `docs/specs/2026-08-21-governed-memory-layer.md`, `docs/specs/F087-provenance-refresh-gamma-exemption.md`

## Problem

The memory layer carried two controls the repository owner has retired. The non-TTY identity gate
refused `amber memory request|ingest|book` unless stdout was a terminal or `--yes` was passed, which
blocked ordinary agent automation. The γ admission limit capped charged admissions at five per
rolling 168 hours and brought a mixed-pool ordering, a provenance-only refresh exemption, a
charged/exempt ledger partition, a `status.gamma` projection and a doctor rule. Neither control
defines what a memory entry is, and both add ceremony the owner no longer wants.

## Contract

1. `request`, `ingest` and `book` never refuse a non-interactive invocation. `--yes` stays accepted
   and ignored, so existing scripts do not break.
2. `ingest` admits every eligible candidate in the request. There is no quota, truncation, pool
   ordering, provenance exemption, charged/exempt partition or `AMBER_E_MEMORY_RATE_LIMITED`.
3. Admitted `memory-ingest` events carry no γ or ranking fields; they keep `kind`, `requestId`,
   `channel`, `outcome`, `entryIds`, `skippedAbandoned` and `batchId`. Rejected events keep their
   existing `code`. Older events that carry γ fields stay readable and are ignored.
4. `memory status` projects `entries` and `surface`. It exposes no `gamma` object and no
   corrupt-partition error.
5. `doctor` no longer judges γ or partition consistency. Its other memory rules are unchanged.
6. The entry-level human `approve`, `abandon`, schema/binding/signal gates, the single event ledger,
   and the rule that Amber never writes `MEMORY.md` are unchanged.

## Scope

The change is confined to the memory policy, command and doctor modules, their tests, the memory
documentation surface and the ADR-0018 amendment. It does not touch schemas, the MCP approval seam,
the session or context pipelines.

## Verification

- A non-TTY `request` + `ingest` + `approve` + `book` chain completes without `--yes`.
- A request with more than five entries is admitted in one ingest.
- `memory status --json` has no `gamma` key.
- The full root suite passes, including the memory integration and trigger suites.
