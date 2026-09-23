# F071 Plan: Harness H3b — Firewall Verdict Wiring

**Feature:** F071
**Status:** implementation-ready (spec `docs/specs/F071-harness-h3b-firewall-wiring.md`, accepted 2026-09-23 via `issues/0105`)
**User Confirmation:** confirmed (「继续推进v2.2」, 2026-09-23 — standing directive per map `issues/0066` 执行带入)
**Date:** 2026-09-23
**Decision records:** Harness v2 §11/§22.1/§32/§41; F069 H3a as the staged foundation; §3.3 ingress discipline
**Wayfinder map:** `issues/0066` (H3b named in fog, now graduated)

## Context manifests

| Role | Paths |
| --- | --- |
| Normative spec | `docs/specs/F071-harness-h3b-firewall-wiring.md` |
| Composed seam (the one verdict) | `scripts/lib/harness/context-core.js` (`checkContextAccess` — called verbatim, never re-implemented) |
| Wired path | `scripts/lib/core/context-loadout.js` (`loadBuildConfig`/`applyAuthorityExclusions`-adjacent wiring, `assembleLoadout`), `schemas/context-loadout.schema.json` (additive optional `firewall` + `excluded[].reason` enum growth) |
| CLI pass-through | `scripts/lib/context/adapters/command.js` (`loadBody`), existing FLAG_SPECS `--subject`/`--purpose`/`--run` |

## Slices (tracer bullets, blocking order)

1. **Firewall-gated build** (ticket 0106): `loadBuildConfig` accepts `subject`/`purpose`/
   `runId` (subject without purpose refuses); the firewall pass runs after §3.3 authority
   exclusions, calling `checkContextAccess` per candidate page; deny → excluded reason
   `firewall` with the closed reason; the covering grants are collected.
2. **Citation + schema** (ticket 0107): `assembleLoadout` emits the additive `firewall`
   section (mode/subject/purpose/checkedAt/grants{ id, snapshotHash, validUntil }/deniedCount)
   when a subject is declared, nothing otherwise (byte-identical builds); schema growth
   (optional `firewall`, `excluded[].reason` += `firewall`); CLI `load --subject --purpose
   [--run]` pass-through.
3. **Integration gates** (ticket 0108): conformance tests at the real path (allow citation,
   all five closed deny reasons, required-pin discipline, no-grant fail-closed loudness,
   byte-identical no-subject build, event trail, schema round-trip), full gates, docs
   lockstep, stage-7 two-axis review, ticket-split commits.

## Verification per slice

- Focused: `node --test tests/unit/context-loadout.test.js` plus the harness-context set.
- Full gates: `npm test` (log to file, read whole), `npm run manifests`, `npm run doctor`,
  `npm run gen:agents:check`, `npm run lint`, `npm run format:check`, `npm run docs:gen:check`.

## Evidence schema

Recorded in `feature_list.json` F071 `evidence[]`. The acceptance demo: one admitted grant
covers `docs/` for purpose `review`; `context load --subject reviewer --purpose review`
includes the covered pages and cites the grant (id + snapshot + validUntil); the same load
with purpose `deploy` excludes every page with reason `firewall`/`purpose-mismatch`, each
denial on the trail; removing the subject reproduces today's bytes.

## Non-goals

Mandatory subject declaration (charter-level default-deny flip); ContextItem/ContextProfile
artifacts; value redaction changes; replay (H5); scheduler (H7); MCP projection;
homepage/charter change.
