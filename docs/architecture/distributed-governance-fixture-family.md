# Distributed Governance Fixture Family

**Status:** Proposed
**Authority:** Derived from [Distributed Governance Architecture Baseline](distributed-governance-baseline.md), [Distributed Governance Contract Registry](distributed-governance-contract-registry.md), accepted resolution #154, and the distributed-governance objective in #158.
**Scope:** One canonical fixture family, adversarial variants, golden outputs, and the stable acceptance matrix that drive distributed-governance evidence.

The authoritative fixture-family artifact is [distributed-governance-fixture-family.json](distributed-governance-fixture-family.json). This page explains how to read it; it does not duplicate the inventory.

## Family structure

The fixture family declares:

- one evidence-bearing canonical fixture for each supported profile: Personal Node, Team Hub, and Organization Profile;
- adversarial variants for version, generation, conflict, integrity, authorization, retention, isolation, execution, disclosure, replay, provenance, replication, scope-escape, deny-wins bypass, and compromised person, component, transport, store, projection, and admin surfaces;
- golden outputs for every accepted distributed-governance evidence kind, including a consolidated adversarial-evidence output;
- an acceptance matrix whose entries carry a stable criterion identifier, source decision, invariant, owning bounded context, required artifact or contract, phase gate, deterministic evidence type, threat category where applicable, and referenced golden outputs.

The acceptance matrix has at least one stable criterion for every contract-registry invariant and one criterion for every adversarial threat category. Source decisions are limited to #154 and #158.

## Golden expected outputs

Every golden output carries a deterministic expected-output manifest. The manifest names its records, canonical record order and positions, omission or redaction reasons, freshness basis, and receipt where applicable. No fixture contains a real secret, credential, source body, arbitrary file, or executable command; adversarial material is bounded synthetic Amber-internal evidence.

Each digest is computed from the canonical expected-output manifest plus the inputs of the fixture variants named by that output. Validation recomputes every digest and rejects a changed expected output, record order, omission reason, freshness fact, or receipt.

## Authority and execution boundary

The fixture family is repository-local and offline-capable. It grants no execution authority, dispatches no worker or tool, invokes no target-project command, and never becomes a second authority. Lineage is append-only, and durable language remains Amber internal. Amber Core remains authoritative for repository-local artifacts; every other bounded context remains within the ownership boundary declared in the baseline.

Validation is deterministic and local:

    node scripts/validate-fixture-family.js --target .

For a target, validation reads the source registry declared by that target's fixture family and cross-references that registry; it never silently substitutes the package-root registry. The check validates the fixture-family artifact, cross-references every invariant and required artifact or contract, verifies every required profile and adversarial category, and refuses unstable, missing, or changed golden-output digests.
