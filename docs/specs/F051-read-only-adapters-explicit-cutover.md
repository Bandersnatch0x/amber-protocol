# F051: Read-only Adapters & Explicit Cutover

**Status:** Proposed  
**Depends on:** F049  
**Program:** [Amber Governed Capabilities](../roadmaps/amber-governed-capabilities-program.md)  
**GitHub mirror:** [#211](https://github.com/Bandersnatch0x/amber-protocol/issues/211)

## Problem Statement

Existing Amber state, legacy files, and external systems may already own records that future Canonical
Artifacts need to reference. A migration that writes through an Adapter or silently prefers the
newest copy would create competing authorities, erase provenance, and make rollback impossible.

## Solution

Introduce registered read-only Adapters and an explicit Cutover Decision. Adapters preserve source
identity, bytes or digest, provenance, freshness, scope, mappings, and conflicts. They may create
Findings and migration candidates but cannot mutate Canonical Artifacts. Canonical ownership changes
only after bounded shadow comparison, coverage checks, independent owner approval, and rollback
evidence.

## User Stories

1. As an adopter, I want Amber to read legacy records without overwriting them, so that migration starts safely.
2. As an external-system owner, I want my record to remain authoritative before Cutover, so that a projection cannot seize ownership.
3. As an auditor, I want source bytes or digest, identity, scope, provenance, and Adapter version retained, so that every mapping is explainable.
4. As an operator, I want unavailable, stale, conflict, and unmapped states explicit, so that uncertainty cannot pass as accepted data.
5. As a Canonical Owner, I want migration candidates re-admitted through normal validation, so that Adapter output cannot bypass canonicalization or scope checks.
6. As a migration owner, I want Cutover scoped by repository, Artifact Type, scope, and generation, so that unrelated records remain untouched.
7. As a migration owner, I want coverage and shadow-read comparison before Cutover, so that missing or divergent records are visible.
8. As a source owner, I want independent confirmation before ownership changes, so that one side cannot unilaterally seize authority.
9. As a recovery operator, I want backup, restore, compatibility, and rollback evidence, so that Cutover is reversible through a new Decision.
10. As an operator, I want post-Cutover source divergence to create a Finding and degraded read-only state, so that legacy changes cannot overwrite Canonical Artifacts.
11. As an auditor, I want historical source and Cutover records preserved, so that rollback cannot make migration appear never to have happened.
12. As a maintainer, I want Adapter removal blocked until compatibility fixtures pass, so that retired compatibility paths remain reproducible.

## Implementation Decisions

- Each Adapter declares source owner, supported record types and versions, exact scope, identity
  mapping, freshness rules, permissions, and read receipts.
- Pre-Cutover Adapters are target-read-only and may write only their own governance observations,
  mappings, coverage, Findings, and receipts.
- Adapter output cannot directly create or update a Canonical Artifact. A migration candidate is
  revalidated by a normal create-draft or submit Action.
- Unknown shape, changed hash, missing source, duplicate identity, cross-tenant reference, and
  contradictory records remain `unmapped`, `stale`, `unavailable`, or `conflict`.
- Cutover is a separate human Decision scoped to repository, Artifact Type, scope, generation, and
  owner identities.
- Cutover requires compatibility fixtures, shadow comparison, coverage accounting, unmapped-item
  disposition, source and target hashes, independent owner confirmation, and rollback evidence.
- After Cutover, the legacy source is historical or diagnostic only. Divergence creates a Finding;
  it never restores legacy authority or auto-syncs canonical state.
- Rollback is a new governed Decision with its own evidence. Historical Cutover and divergence
  records are immutable.

## Testing Decisions

- The highest seam is Adapter read → migration candidate → Cutover decision → post-Cutover read.
- Tests assert source preservation, mappings, receipts, owner state, Findings, stable errors, and
  whether canonical authority changed.
- Exact fixtures cover Adapter contracts, source hashes, mappings, Cutover records, and errors.
- Semantic fixtures cover read-only behavior, partial-scope Cutover, owner separation, unavailable
  and conflict states, divergence, and explicit rollback.
- Integrity fixtures cover changed source bytes, duplicate identities, cross-scope references,
  missing coverage, tampered comparison receipts, and deterministic compatibility replay.
- Prior art is the existing context source Adapter, state migration, sync envelope admission,
  projection freshness, and external-reference hygiene suites.

## Out of Scope

- Bidirectional synchronization, automatic Cutover, write-through Adapters, or last-write-wins.
- External side-effect execution, deployment, deletion, or production credentials.
- Deleting historical sources to make Cutover appear clean.

## Further Notes

F055 builds coordinated deletion on the registered Adapter and owner model established here.
