# Distributed Governance Contract Registry

**Status:** Accepted
**Authority:** Derived from [Distributed Governance Architecture Baseline](distributed-governance-baseline.md) and accepted resolution #154.
**Scope:** One versioned inventory of public contracts, artifacts, and invariants, plus the deterministic compatibility matrix.

The authoritative registry artifact is [distributed-governance-contract-registry.json](distributed-governance-contract-registry.json). This page explains how to read it; it does not duplicate the inventory.

## Registry structure

Every registry entry has:

- a stable identifier;
- a kind: public contract or invariant;
- a version domain;
- an owning bounded context;
- a semantic version;
- a compatibility disposition;
- the six version-domain bindings for a contract, or resolution and ADR traceability for an invariant.

The six independent version domains are Runtime Protocol, Contract and Schema, Capability, Projection Rule, Component Generation, and Source Generation. No domain substitutes for another, and every admitted distributed-governance session binds the domains it uses explicitly.

## Deterministic compatibility rule

The matrix evaluates a combination only when it names all six version domains exactly once. It then classifies each domain independently:

1. an unregistered version produces **unknown**;
2. a declared refused version produces **refused**;
3. a declared deprecated version produces **deprecated**;
4. the current version produces **supported**.

The combined outcome follows fail-closed precedence: **unknown**, then **refused**, then **deprecated**, then **supported**. Parseability and reachability never prove compatibility or authority.

| Case | Combination | Outcome | Stable evidence identifier |
| --- | --- | --- | --- |
| DG-COMPAT-SUPPORTED-001 | all domains at 1.0.0 | supported | amber.distributed-governance.evidence.compatibility.supported.v1 |
| DG-COMPAT-DEPRECATED-001 | all domains at 0.9.0 | deprecated | amber.distributed-governance.evidence.compatibility.deprecated.v1 |
| DG-COMPAT-REFUSED-001 | all domains at 0.8.0 | refused | amber.distributed-governance.evidence.compatibility.refused.v1 |
| DG-COMPAT-UNKNOWN-001 | Runtime Protocol 2.0.0 with the other domains at 1.0.0 | unknown | amber.distributed-governance.evidence.compatibility.unknown.v1 |

The validator returns a stable evidence identifier for every evaluated combination. Registered cases use the identifiers above; other combinations use a deterministic identifier derived from the canonical domain-version combination.

## Authority and execution boundary

The registry is repository-local and offline-capable. It grants no execution authority, dispatches no worker or tool, invokes no target-project command, and never becomes a second authority. Amber Core remains authoritative for repository-local artifacts; every other bounded context remains within the ownership boundary declared in the baseline.

Validation is deterministic and local:

    npm run contracts:validate

The check validates the registry artifact, cross-references every domain and owner, verifies all required compatibility outcomes, and refuses unstable or missing evidence identifiers.
