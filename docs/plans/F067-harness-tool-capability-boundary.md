# F067 Plan: Harness H1 — Tool / Capability / Effect / Credential Boundary

**Feature:** F067
**Status:** implemented (feature_list: passing); originally recorded implementation-ready (spec `docs/specs/F067-harness-tool-capability-boundary.md`, accepted 2026-09-22 via `issues/0082`)
User Confirmation: confirmed
**Confirmation source:** 「按推荐」, 2026-09-22 (`issues/0082`)
**Date:** 2026-09-22
**Decision records:** Harness v2 §12/§25/§30; F065/F066 as the foundation (contract pattern, run records, event ledger)
**Wayfinder map:** `issues/0066` (tickets 0081–0086)

## High Level Design

- Context: H0 and the vertical slice established the contract/run/event pattern, but a run had no
  recorded view of which tools it could reach and under which capability pins. Without that,
  "this run could not have done X" is unprovable after the fact.
- Proposed approach: one closed tool artifact whose capability pin must resolve through the
  registries that already exist (F052 runner registry, F056 external effects), plus a report-only
  policy check that answers with the existing policy surface's verdict, plus an additive run
  snapshot so the admitted tool set is frozen with the run. Every step composes existing seams
  rather than adding enforcement.
- Risks: the tool registry must never become a second permission source (the connector-≠-permission
  invariant is test-enforced); an unresolved pin must refuse rather than degrade; and pre-H1 run
  records must stay byte-compatible, which is why the snapshot section is optional and absent when
  the registry is empty.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.

- implement: docs/specs/F067-harness-tool-capability-boundary.md, docs/specs/F065-harness-h0-foundation.md, docs/specs/F066-harness-vertical-slice.md, docs/adr/0100-harness-contract.md, schemas/run.schema.json
- review: docs/specs/F067-harness-tool-capability-boundary.md, docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, CONTEXT.md, docs/agents/dev-workflow.md

## Vertical Slices

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

## Resume Checkpoint

- Resume Point: all four slices are delivered; the feature carries two evidence entries (the `issues/0082` confirmation and the 6/6 focused suite).
- Blockers: none open. What remains is the acceptance decision, which is a human ruling and not a code change.
- Next Action: take the acceptance decision on F067, then `amber gate --confirm` and `amber accept` against this plan if it is positive.
- Recovery Instructions: if this plan file is lost, reconstruct it from `docs/specs/F067-harness-tool-capability-boundary.md` and the `issues/0081`–`0086` logs; never hand-edit the F067 entry in `feature_list.json`, which `amber feature` owns.

## Acceptance Criteria

- A tool whose capability pin does not resolve through the real F052 registry is refused at admission; a resolvable pin admits.
- The tool registry never becomes a permission source: the connector-≠-permission invariant holds under test.
- `tool check` reports the existing policy surface's verdict, and with no rules surface it reports the real default (deny) rather than an invented allow.
- A run started under an admitted tool set records the tool snapshot, and tool drift changes its hash; an empty registry leaves the section absent, keeping pre-H1 records byte-compatible.
- Existing guardrails still pass, and the current phase boundary is unchanged: no new enforcement or execution authority, no credential material, no MCP projection, no replay, no scheduler.

## Verification

- Focused: `node --test tests/unit/harness-tool.test.js` (6 cases, real F052 fixture via the
  runner-registry test convention) plus the full harness set.
- Full gates: `npm test` (log to file), `manifests`, `doctor`, `gen:agents:check`, `lint`,
  `format:check`, `docs:gen:check`, `docs:verify`.

## Evidence Schema

- Command: `node --test tests/unit/harness-tool.test.js`
- Result: pass — 6/6 focused tests green (real F052 fixture via the runner-registry test convention: registerPrincipal + decision artifacts + registerRunner/Capability)
- Date: 2026-09-22
- Notes: the acceptance demo is a tool whose capability pin resolves through the real F052 registry admitting, a run under it recording the tool-set snapshot, and `tool check` reporting the existing policy surface's verdict.

## Non-goals

No new enforcement or execution authority (runner/external gates stay sole); no credential
material; no MCP projection; no replay (H5); no scheduler (H7); no homepage/charter change.
