# F067 Plan: Harness H1 — Tool / Capability / Effect / Credential Boundary

**Feature:** F067
**Status:** implementation-ready (spec `docs/specs/F067-harness-tool-capability-boundary.md`, accepted 2026-09-22 via `issues/0082`)
**User Confirmation:** confirmed (「按推荐」, 2026-09-22)
**Date:** 2026-09-22
**Decision records:** Harness v2 §12/§25/§30; F065/F066 as the foundation (contract pattern, run records, event ledger)
**Wayfinder map:** `issues/0066` (tickets 0081–0086)

## Context manifests

| Role | Paths |
| --- | --- |
| Normative spec | `docs/specs/F067-harness-tool-capability-boundary.md` |
| Composed authority surfaces (read-only) | `scripts/lib/core/runner-registry.js` (F052 `resolveRequestCapability`), `scripts/lib/core/external-registry.js` (F056 `showExternalEffect`), `scripts/lib/core/loop-policy.js` (existing policy surface for the report-only check) |
| Foundation | `scripts/lib/harness/` (H0 pattern: admit/inspect/list + Snapshot Hash), `tests/unit/runner-registry.test.js` (fixture convention reused) |

## Slices (tracer bullets, blocking order)

1. **Tool schema + registry core** (ticket 0083, done): `schemas/tool.schema.json` (§30's four
   deliverables consolidated into one closed artifact; capability pin if/then shapes; §9
   effect taxonomy) + `scripts/lib/harness/tool-core.js` (admit resolves the pin through the
   real registries — unresolved refuses; immutability; fail-closed reads; list re-hashes and
   flags tombstones) + CLI `amber harness tool admit|list|inspect` + 4 `AMBER_E_HARNESS_TOOL_*`
   codes + schema-count pin 25→26. The connector-≠-permission invariant is test-enforced.
2. **Report-only policy check** (ticket 0084, done): `amber harness tool check --tool <id>`
   reports the verdict the existing policy surface would give (capability-rule exact match,
   deny-wins, defaultAction fallback); no rules surface → the real default (deny), never an
   invented allow. Writes nothing.
3. **Run tool snapshot** (ticket 0085, done): `run.schema.json` additive optional `tools`
   section (snapshot hash + ids over the sorted admitted set); both `harness start` paths
   record it; empty registry → no section (pre-H1 records byte-compatible); tool drift
   changes the snapshot hash.
4. **Integration** (ticket 0086): full gates, three-piece catalog, docs lockstep, stage-7
   two-axis review, ticket-split commits.

## Verification per slice

- Focused: `node --test tests/unit/harness-tool.test.js` (6 cases, real F052 fixture via the
  runner-registry test convention) plus the full harness set.
- Full gates: `npm test` (log to file), `manifests`, `doctor`, `gen:agents:check`, `lint`,
  `format:check`, `docs:gen:check`, `docs:verify`.

## Evidence schema

Recorded in `feature_list.json` F067 `evidence[]`. The acceptance demo: a tool whose
capability pin resolves through the real F052 registry admits; a run started under it records
the tool-set snapshot; `tool check` reports the existing policy surface's verdict.

## Non-goals (unchanged)

No new enforcement or execution authority (runner/external gates stay sole); no credential
material; no MCP projection; no replay (H5); no scheduler (H7); no homepage/charter change.
