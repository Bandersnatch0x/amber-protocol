# ADR-0015: Review Blocker Remediation Contracts

**Status:** Accepted
**Date:** 2026-08-07

The review of `origin/master...ef57fc5` exposed security and contract gaps across Context, Loadout, governed execution, workflow assessment, routing, migration, and handoff. We will remediate them as one tracked Feature, F016, because the shared invariant is fail-closed governance at public interfaces; the pre-`ef57fc5` `output/adr-architecture-assessment.md` remains historical research input rather than acceptance evidence.

## Decisions

- Every Context source, Context Page, request, payload, and Loadout path is target-local. A shared filesystem module must reject lexical traversal and any symlink or junction whose real path escapes the target before I/O occurs. Invalid page, feature, route, or file identifiers are rejected rather than rewritten.
- Context ingest requires the matching Distillation Contract. Missing and mismatched contracts use the explicit `AMBER_E_CONTEXT_REQUEST_MISSING` and `AMBER_E_CONTEXT_REQUEST_MISMATCH` errors. Request binding and scope checks occur before the no-change path, and payload scope can never grant itself authority.
- Loadouts carry non-Page governance inputs in a distinct `artifacts.required[]` collection. The required set is target-local `docs/wiki/agent/amber.md` as the canonical Operating Manual, the selected `routes/*.route.json`, and a target-local Loadout Definition installed by scaffold. Page `references` retain only Context Page accounting.
- Required Artifacts fail closed when missing, outside the target, or hash-mismatched. Because this feature has not been pushed, the corrected final Loadout contract is `schemaVersion: 1.0.0`; the incorrect local shape receives no compatibility path.
- Governed execution preserves `confidence_gating` through rule merging and refuses execution unless the configured confidence tier permits it. A dry-run or an `allowed` flag alone is not sufficient authority.
- The handoff facade cycle is removed by extracting target-independent path/layout helpers to `core/handoff-layout.js`. Existing `handoff-bundle` exports remain as compatibility re-exports so public callers do not change.
- F016 owns the remaining review blockers: migration backfill CLI wiring, target-local `next --objective`, session-local no-progress assessment, required Loadout defaults, visible corrupt Context Page errors, schema format registration, generated skill expectations, and current Workflow facade boundary tests.

## Consequences

- Existing local artifacts that relied on paths outside `--target`, omitted requests, self-declared scope, empty required tiers, or the incorrect Loadout shape are refused immediately.
- Scaffold templates must install the Operating Manual, Route manifests, and Loadout Definition without overwriting user-authored files.
- F016 acceptance excludes `docs/quality/release-readiness-1.3.12.md`, `.workbuddy/*`, and the historical assessment. The final handoff may reference F016, and a fresh architecture assessment must bind its claims to the final commit SHA.
