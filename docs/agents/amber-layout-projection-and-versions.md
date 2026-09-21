# `.amber/` layout projection map and version-field table (governance contract §11.2/§11.4)

**Status:** documentation of the D0 rulings (spec `trusted-control-governance-contract.md` §11.2/§11.4); no physical layout change is authorized by this document.

## 1. `.amber/` projection map (§11.4)

The v3.1 taxonomy (`harness/ policy/ runs/ approvals/ capabilities/ contexts/ evidence/ audit/`) is a **read-side projection grouping** over the physical layout — never a migration. A physical re-layout would break every path-pinned reader for taxonomy cosmetics.

| v3.1 directory | Physical projection |
| --- | --- |
| `harness/` | the state root itself (`.amber/`) |
| `policy/` | `.amber/governance/rules.json` + `.amber/policies/` (F050 Policy Contracts) + `.amber/staleness/` |
| `runs/` | `.amber/sessions/` (manifests, session ledgers, timelines) + `.amber/executions/` (F052 execution homes) — the run is a projection over attempt records and folds, not a directory |
| `approvals/` | `.amber/approvals/` (already aligned) |
| `capabilities/` | `.amber/runner/` (F052 registry: runners + capabilities) |
| `contexts/` | `.amber/context/` (requests, pages, loadouts) |
| `evidence/` | `.amber/evidence/` (receipts) |
| `audit/` | `.amber/audit/` + the governed ledger folds (loops/routes/sessions `ledger.jsonl`) |

Directories physically present today (grep-verified): `sessions, sync, context, governance, retention, artifacts, evidence, memory, external, handoff, adapters, principals, maintain, approvals, team, identity, gates, breakglass, runner, loops, executions, staleness, release, profile, policies, knowledge, provenance, audit, routes, reports, projections, maintenance`.

The only new physical directories the four canonical contracts authorize:
1. `.amber/research/` — the citation store (context-runtime contract §6.2, `citations.jsonl`).
2. `.amber/suggestions/` — the suggestion-review ledger (evolution contract §8.2, `review.jsonl`).

## 2. Version-field table (§11.2)

Protocol versioning is **artifact-local and content-hashed**; the only cross-artifact version authority is the frozen per-attempt tuple (run contract §4 `contractHash`), never a global API version string. No `amber.dev/v1` umbrella exists.

| Versioned artifact | Version field | Location |
| --- | --- | --- |
| schemas (route/session/timeline/policy/loadout/benchmark/…) | `schemaVersion` | inside each `schemas/*.schema.json` document |
| environment profiles | `ENVIRONMENT_PROFILE_VERSION` (code-pinned) | `scripts/lib/core/runner-registry.js` |
| risk policy | `RISK_POLICY_VERSION` (code-pinned; **2** since the §7.2 four-level escalation) | `scripts/lib/core/runner-registry.js` |
| capability / runner registrations | `runnerVersion` / `capabilityVersion` per event | F052 registry events |
| routes | `{id, version}` | the session manifest route pin (`schemas/session-manifest.schema.json`) |
| policy rules | `schemaVersion` (1→2 per §6.2; coexistence, no forced migration) + content `policyHash` | rules.json + run contract §3 |
| contracts (HarnessContract) | `contractHash` — a fingerprint, **not** a protocol version | attempt records (run contract §4) |
| ledger event shapes | `schemaVersion` per record | each governed ledger (loop-ledger, registries, evidence, citations) |
| session manifests | `schemaVersion: 1.0.0-rc.1` | `schemas/session-manifest.schema.json` |

Compatibility discipline (§11.1): additive optional fields never bump a schema version (ADR-0012); closed-event validators split ALLOWED from REQUIRED per era; legacy plaintext timeline lines are a tolerated prefix, never upgraded; pre-field records read as `NON_REPLAYABLE`/gap, never default-filled.
