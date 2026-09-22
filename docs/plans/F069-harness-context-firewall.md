# F069 Plan: Harness H3a — Context Firewall

**Feature:** F069
**Status:** implementation-ready (spec `docs/specs/F069-harness-context-firewall.md`, accepted 2026-09-22 via `issues/0094`)
**User Confirmation:** confirmed (「按推荐」, 2026-09-22)
**Date:** 2026-09-22
**Decision records:** Harness v2 §4.3/§11/§32; ADR-0102 (amended 2026-09-22: runId required only for run-scoped event kinds); F065/F066/F067/F068 as the foundation
**Wayfinder map:** `issues/0066` (tickets 0093–0098; H3b named in fog)

## Context manifests

| Role | Paths |
| --- | --- |
| Normative spec | `docs/specs/F069-harness-context-firewall.md` |
| Composed surfaces (labels only) | `schemas/context-loadout.schema.json` (classification vocabulary + redaction reasons), F017/F027 context lifecycle (untouched) |
| Foundation | `scripts/lib/harness/` (H0 pattern), the event ledger (additive context.* types) |

## Slices (tracer bullets, blocking order)

1. **ContextGrant registry** (ticket 0095, done): `schemas/context-grant.schema.json`
   (§11 formula: subject/resources-prefixes/purpose/classificationCeiling/half-open TTL/policy
   pin; loadout classification vocabulary with ceiling ordering; TTL shape checked in core) +
   `scripts/lib/harness/context-core.js` (H0 pattern: Snapshot Hash, immutability, tombstones)
   + `amber harness context admit|list|inspect` + 5 `AMBER_E_HARNESS_CTX_*` codes + schema-count
   pin 27→28.
2. **Deterministic check + events** (ticket 0096, done): `checkContextAccess` — allow with the
   covering grant pointer, or deny with a closed reason (`no-grant / expired / revoked /
   purpose-mismatch / classification-above-ceiling`; unrated `unknown` fails closed);
   label-only reads. Event types grow additively (`context.granted/denied/revoked`), and
   ADR-0102 is amended: runId is required only for run-scoped kinds — enforced at the write
   seam so a refused body never reaches the chain.
3. **Revocation + expiry projection + run scoping** (ticket 0097, done):
   `revokeContextGrant` — the revocation is a terminal record inside the admission file (the
   admitted grant bytes stay untouched, so the snapshot hash keeps re-deriving); revoked
   grants stay listable; expiry is a read-time projection; denials optionally scope to a run
   (`--run`) so they land on that run's trail.
4. **Integration** (ticket 0098): full gates, three-piece catalog, docs lockstep, stage-7
   two-axis review, ticket-split commits.

## Verification per slice

- Focused: `node --test tests/unit/harness-context.test.js` (6 cases: TTL boundaries, five
  deny reasons, ceiling ordering incl. fail-closed `unknown`, revocation terminality, event
  assertions, tamper fail-closed).
- Full gates: `npm test` (log to file), `manifests`, `doctor`, `gen:agents:check`, `lint`,
  `format:check`, `docs:gen:check`, `docs:verify`.

## Evidence schema

Recorded in `feature_list.json` F069 `evidence[]`. The acceptance demo: an admitted grant
allows its covered subject/resource/purpose inside the window with a pointer; every denial
reason is reachable deterministically; denials and revocations land on the tamper-evident
trail.

## Non-goals

H3b (the firewall verdict wiring into the actual context-loading path — host entry/loadout
build; separate ticket behind this evidence); value-level redaction changes (the loadout
ledger is composed, not modified); MCP projection; replay (H5); scheduler (H7);
homepage/charter change.
