# F071 Plan: Harness H3b — Firewall Verdict Wiring

**Feature:** F071
**Status:** accepted
User Confirmation: confirmed
**Confirmation source:** 「继续推进v2.2」, 2026-09-23 — standing directive per map `issues/0066` 执行带入 (`issues/0105`)
**Date:** 2026-09-23
**Decision records:** Harness v2 §11/§22.1/§32/§41; F069 H3a as the staged foundation; §3.3 ingress discipline
**Wayfinder map:** `issues/0066` (H3b named in fog, now graduated)

## High Level Design

- Context: H3a could answer "is this access allowed" but nothing asked it. The loadout builder
  assembled context without consulting the grants, so the firewall was a surface a caller had to
  remember rather than one the real path passed through.
- Proposed approach: wire the one existing verdict into `loadBuildConfig` after the §3.3
  authority exclusions, calling `checkContextAccess` verbatim per candidate page. A denial
  excludes the page with the closed reason, and `assembleLoadout` emits an additive `firewall`
  section citing the covering grants when a subject is declared.
- Risks: the build must stay byte-identical when no subject is declared, or every existing
  loadout changes; the verdict must be called rather than re-implemented, or two answers drift;
  and a missing grant must be loudly fail-closed rather than a silent empty loadout.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.

- implement: docs/specs/F071-harness-h3b-firewall-wiring.md, docs/specs/F069-harness-context-firewall.md, schemas/context-loadout.schema.json, docs/agents/dev-workflow.md
- review: docs/specs/F071-harness-h3b-firewall-wiring.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, CONTEXT.md, docs/agents/dev-workflow.md

## Vertical Slices

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

## Resume Checkpoint

- Resume Point: all three slices are delivered; the feature carries two evidence entries (the `issues/0105` confirmation and the 42/42 focused suite).
- Blockers: none open. What remains is the acceptance decision, which is a human ruling and not a code change.
- Next Action: take the acceptance decision on F071, then `amber gate --confirm` and `amber accept` against this plan if it is positive.
- Recovery Instructions: if this plan file is lost, reconstruct it from `docs/specs/F071-harness-h3b-firewall-wiring.md` and the `issues/0106`–`0108` logs; never hand-edit the F071 entry in `feature_list.json`, which `amber feature` owns.

## Acceptance Criteria

- One admitted grant covers `docs/` for purpose `review`, and `context load --subject reviewer --purpose review` includes the covered pages and cites the grant (id + snapshot + validUntil).
- The same load under purpose `deploy` excludes every page with reason `firewall`/`purpose-mismatch`, each denial on the trail.
- All five closed deny reasons are reachable through the real build path, and a missing grant fails closed loudly rather than producing a silent empty loadout.
- Removing the subject reproduces the pre-F071 bytes exactly, and a subject declared without a purpose is refused.
- Existing guardrails still pass, and the current phase boundary is unchanged: no mandatory subject declaration, no ContextItem/ContextProfile artifacts, no value redaction changes, no replay or scheduler.

## Verification

- Focused: `node --test tests/unit/context-loadout.test.js` plus the harness-context set.
- Full gates: `npm test` (log to file, read whole), `npm run manifests`, `npm run doctor`,
  `npm run gen:agents:check`, `npm run lint`, `npm run format:check`, `npm run docs:gen:check`.

## Evidence Schema

- Command: `node --test tests/unit/context-loadout.test.js`
- Result: pass — 42/42 focused tests green (allow citation, all five closed deny reasons through the real build path, required-pin discipline, no-grant fail-closed, byte-identical no-subject build, denial events on the trail, verify round-trip)
- Date: 2026-09-23
- Notes: the acceptance demo is one admitted grant covering `docs/` for purpose `review`, a load that includes those pages and cites the grant, a `deploy`-purpose load excluding every page with the closed reason, and the subject-free build reproducing today's bytes.

## Non-goals

Mandatory subject declaration (charter-level default-deny flip); ContextItem/ContextProfile
artifacts; value redaction changes; replay (H5); scheduler (H7); MCP projection;
homepage/charter change.
