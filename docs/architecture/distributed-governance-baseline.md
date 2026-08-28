# Distributed Governance Architecture Baseline

**Status:** Accepted
**Authority:** Consolidates accepted resolutions #145–#157 and the distributed-governance objective in #158.
**Scope:** Repository-local governance extended by optional distributed contexts and read-only projections.
**Language boundary:** Amber internal language only. This baseline names no implementation technology and no external project, product, protocol, or research source.

## Bounded contexts

| Context | Owns | Never owns |
| --- | --- | --- |
| **Amber Core** | Repository-local schemas, identifiers, governed Actions and Functions, admission, validation, local policy enforcement, canonical work, decisions, evidence, approvals, context, learning, ledger, and acceptance artifacts. | Remote administration, synchronization-operational state, or projection authority. |
| **Sync Runtime** | Protocol negotiation, Sync Session and Sync Operation state, immutable envelopes, bounded delivery, acknowledgement, replay, checkpoints, subscriptions, cancellation settlement, reconnect, fencing and handoff, conflict recording, and synchronization telemetry. | Domain meaning, conflict resolution, knowledge admission, projection refresh, or execution authority. |
| **Governance Graph** | Graph vocabulary, deterministic projection rules, bounded temporal and relationship queries, provenance and explanation paths, conflict, impact, and precedent views. | Canonical fact ownership or mutation authority. |
| **Governed Knowledge Base** | Knowledge Record admission and lifecycle semantics: candidate, review, accepted, stale, refresh-required, superseded, and retired; provenance, freshness, confidence, review scope, refresh, retirement, and cross-repository discovery. | Canonical repository artifacts or independent domain rules. |
| **Visualization Workbench** | Authorized read snapshots, deterministic temporal, causal, relationship, and mind-map/context projections, bounded filters, sorting, paging, traces, and compare views. | Mutation authority, canonical admission, or projection-derived writes. |
| **Organization Control Plane** | Person and Agent Identity, Tenant and Organization structure, Team, Membership, Repository Registration, Role Assignment, Policy Assignment, and administrative fencing. | Repository-local work state, decisions, evidence, approvals, context, or accepted knowledge. |

## Deployment profiles

- **Personal Node** — Single-operator, offline-first profile. It contains one or more repository-local Amber Core instances and may run local Governance Graph, Governed Knowledge Base, and Visualization Workbench projections. It uses one explicit deterministic local Tenant, Organization, and Person scope, and may declare local Agent Identities and Repository Registrations. Those bootstrap identity facts are authoritative only inside the local administrative scope.
- **Team Hub** — Single-Tenant, single-Organization configuration. It adds Sync Runtime, shared projections, and the minimum Organization Control Plane authority required for Person and Agent Identity, flat Team, Membership, Repository Registration, Role Assignment, and Policy Assignment.
- **Organization Profile** — Same six bounded contexts, protocol, artifact model, identity types, and authorization semantics as Team Hub, expanded to organization-wide administrative scope and cross-repository governance. Tenant count is deployment topology, not a fourth profile.

Changing profile does not rewrite Identity or Amber Core artifacts. Moving Personal Node identity into a shared profile requires explicit Organization Control Plane admission or mapping; unadmitted local identity cannot produce shared governance mutations. Moving a Repository to another Tenant is an explicit fenced transfer that starts a new Repository generation, terminates old-Tenant Role and Policy applicability, and begins with no target-Tenant authorization. Historical facts, Conflicts, provenance, and envelopes retain their original Tenant, Repository, and generation scope; a transfer record proves continuity.

## Authority boundaries

1. Repository artifacts are authoritative for governed work, decisions, evidence, approvals, context, and accepted knowledge.
2. Organization Control Plane is authoritative for identity, membership, tenant configuration, assigned policy, and administrative fencing.
3. Sync Runtime is authoritative only for synchronization-operational facts.
4. Governance Graph, Governed Knowledge Base, and Visualization Workbench are rebuildable read-only projections or read models; they never become canonical authority.
5. Every mutation returns to exactly one owning context through a versioned governed command or Action. Adapters contain no independent domain rules.
6. No bounded context intercepts tools, dispatches workers, executes target-repository work, or grants execution authority.

## Invariant traceability matrix

| Invariant | Source resolutions | Affected ADRs | Disposition |
| --- | --- | --- | --- |
| Repository-local authority | #145, #147, #153, #157 | ADR-0001 | Amend ADR-0001 to distinguish repository-local Core from optional non-executing distributed contexts. |
| Offline operation | #145, #150, #153 | ADR-0001, ADR-0011 | Amend ADR-0001 for the offline Core boundary; preserve ADR-0011's explicit fail-closed posture. |
| Optional non-executing Sync Runtime | #145, #147, #149, #157 | ADR-0001, ADR-0005 | Amend ADR-0001 for the optional distributed boundary; preserve ADR-0005's removal of execution authority. |
| One versioned protocol and artifact model | #145, #147, #149, #152 | ADR-0012 | Amend ADR-0012 with distributed envelope, structural identity, version negotiation, capability negotiation, and compatibility/refusal contracts. |
| Rebuildable read-only projections | #145, #148, #150, #156, #157 | ADR-0007, ADR-0012 | Preserve ADR-0007's supervised read-only viewer boundary; amend ADR-0012 for projection and interchange versioning. |
| Exact-scope deny-wins authorization and privacy minimization | #145, #151, #156 | ADR-0011 | Preserve ADR-0011's fail-closed authorization boundary. |
| Fail-closed degraded read-only | #145, #147, #150, #151, #156 | ADR-0011 | Preserve ADR-0011's explicit fail-closed behavior. |
| Append-only lineage and immutable records | #145, #147, #148, #151, #155 | ADR-0004 | Preserve ADR-0004's evidence-grade verification and immutable evidence chain. |
| Source and Resolution ownership | #145, #147, #148, #149, #155 | ADR-0009, ADR-0012 | Amend ADR-0009 to make Context Page the Core form of the broader Knowledge Record lifecycle; amend ADR-0012 for ownership-bearing versioned interchange. |
| Conflict preservation and governed resolution | #145, #147, #148, #155 | ADR-0004, ADR-0015 | Preserve ADR-0004's evidence discipline and ADR-0015's review-blocker remediation contracts. |
| Tenant and Repository isolation | #145, #146, #151, #152 | ADR-0012 | Amend ADR-0012 so isolation is structural in versioned protocol and schema contracts. |
| No hidden authority or execution | #145, #147, #149, #153, #154, #157 | ADR-0001, ADR-0003, ADR-0005 | Amend ADR-0001 for distributed non-execution; preserve ADR-0003's narrow governed exception and ADR-0005's execution removal. ADR-0020 Stage A (accepted after this matrix) rides ADR-0003's preserved exception for the governed local sync commit. |

## ADR disposition

- **Amend ADR-0001** to distinguish repository-local Amber Core from optional non-executing distributed contexts.
- **Amend ADR-0009** to make Context Page the Core form of the broader Knowledge Record lifecycle.
- **Amend ADR-0012** with the distributed envelope, structural identity, version negotiation, capability negotiation, and compatibility/refusal contract.
- **Preserve** ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0007, ADR-0008, ADR-0010, ADR-0011, ADR-0013, ADR-0014, ADR-0015, ADR-0016, and ADR-0017 within their accepted scopes.
- ADR-0002 remains historically superseded by ADR-0005; this baseline introduces no new supersession.

No other ADR is marked for amendment.