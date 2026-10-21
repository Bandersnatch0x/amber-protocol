# F069 Plan: Harness H3a — Context Firewall

**Feature:** F069
**Status:** accepted
User Confirmation: confirmed
**Confirmation source:** 「按推荐」, 2026-09-22 (`issues/0094`)
**Date:** 2026-09-22
**Decision records:** Harness v2 §4.3/§11/§32; ADR-0102 (amended 2026-09-22: runId required only for run-scoped event kinds); F065/F066/F067/F068 as the foundation
**Wayfinder map:** `issues/0066` (tickets 0093–0098; H3b named in fog)

## High Level Design

- Context: the run had a boundary and a tool set, but nothing recorded which context a run was
  allowed to read and under which purpose. A denial and an absence of grants were
  indistinguishable, so a reader could not tell "it did not read that" from "it was never
  allowed to".
- Proposed approach: a closed ContextGrant artifact (subject, resource prefixes, purpose,
  classification ceiling, half-open TTL), a deterministic check that allows with the covering
  grant pointer or denies with one of five closed reasons, and revocation/expiry as read-time
  projections over immutable admitted bytes. Denials land on the tamper-evident trail.
- Risks: the check must fail closed on an unrated classification rather than defaulting to allow;
  revocation must not rewrite the admitted grant or the snapshot hash stops re-deriving; and the
  event-type growth is additive only, with ADR-0102 amended so a runId is required only for
  run-scoped kinds.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.

- implement: docs/specs/F069-harness-context-firewall.md, docs/adr/0102-harness-event-ledger-via-ledger-family.md, schemas/context-loadout.schema.json, schemas/event.schema.json
- review: docs/specs/F069-harness-context-firewall.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, CONTEXT.md, docs/agents/dev-workflow.md

## Vertical Slices

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

## Resume Checkpoint

- Resume Point: all four slices are delivered; the feature carries two evidence entries (the `issues/0094` confirmation and the 6/6 focused suite).
- Blockers: none open. What remains is the acceptance decision, which is a human ruling and not a code change.
- Next Action: take the acceptance decision on F069, then `amber gate --confirm` and `amber accept` against this plan if it is positive.
- Recovery Instructions: if this plan file is lost, reconstruct it from `docs/specs/F069-harness-context-firewall.md` and the `issues/0093`–`0098` logs; never hand-edit the F069 entry in `feature_list.json`, which `amber feature` owns.

## Acceptance Criteria

- An admitted grant allows its covered subject/resource/purpose inside the window and cites the covering grant pointer.
- Every one of the five closed deny reasons is reachable deterministically, and an unrated classification fails closed rather than defaulting to allow.
- Revocation is terminal, leaves the admitted grant bytes untouched so the snapshot hash keeps re-deriving, and revoked grants stay listable.
- Denials and revocations land on the tamper-evident trail; expiry is a read-time projection, never a rewrite.
- Existing guardrails still pass, and the current phase boundary is unchanged: the loadout ledger is composed rather than modified, value-level redaction is untouched, and no MCP projection, replay or scheduler is introduced.

## Verification

- Focused: `node --test tests/unit/harness-context.test.js` (6 cases: TTL boundaries, five
  deny reasons, ceiling ordering incl. fail-closed `unknown`, revocation terminality, event
  assertions, tamper fail-closed).
- Full gates: `npm test` (log to file), `manifests`, `doctor`, `gen:agents:check`, `lint`,
  `format:check`, `docs:gen:check`, `docs:verify`.

## Evidence Schema

- Command: `node --test tests/unit/harness-context.test.js`
- Result: pass — 6/6 focused tests green (TTL boundaries, five deny reasons, ceiling ordering incl. fail-closed unknown, revocation terminality, event assertions, tamper fail-closed)
- Date: 2026-09-22
- Notes: the acceptance demo is an admitted grant allowing its covered subject/resource/purpose inside the window with a pointer, every denial reason reachable deterministically, and denials and revocations landing on the tamper-evident trail.

## Non-goals

H3b (the firewall verdict wiring into the actual context-loading path — host entry/loadout
build; separate ticket behind this evidence); value-level redaction changes (the loadout
ledger is composed, not modified); MCP projection; replay (H5); scheduler (H7);
homepage/charter change.
