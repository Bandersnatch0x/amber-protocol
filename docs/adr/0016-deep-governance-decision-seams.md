# ADR-0016: Deep Governance Decision Seams

**Status:** Accepted
**Date:** 2026-08-13

## Context

Route selection, Journey selection, command registration, Context Action dispatch,
and MCP invocation had overlapping decision knowledge in adapters. The overlap
made behavior difficult to test through one interface and allowed typed coverage
to drift from the Governance Console and MCP surfaces.

## Decision

Amber Protocol uses four deep modules with compatibility adapters:

1. `route-journey-decision` owns deterministic Route/Journey selection and
   Decision Evidence. Explicit Routes win, missing matches preserve the existing
   `feature-standard` fallback, and Journey affinity is optional.
2. `command-registry` projects Command Definitions into help, tiers, handlers,
   and the typed command set. Action Types remain declarative JSON artifacts and
   are validated against the registry.
3. `context/action-registry` gives every Context Action an explicit effect,
   evidence, alias, and approval disposition. Mutating Actions remain
   approval-required.
4. `mcp-invocation-coordinator` owns Action/Function lookup, target resolution,
   caching, normalized outcomes, and error semantics. `amber-mcp.js` remains a
   stdio adapter.

Existing public entrypoints and output projections remain compatible. The
decision modules are data-oriented and testable through their external seams;
filesystem loading and presentation remain adapter responsibilities.

## Constraints

- ADR-0014's Route matching remains deterministic and does not use an LLM.
- ADR-0009 and ADR-0010 remain authoritative for Context contracts, gates,
  Context Pages, Required Artifacts, and Loadouts.
- ADR-0001, ADR-0003, ADR-0005, and F018 MCP invariants remain authoritative:
  only registry-proven reads execute directly; mutations are approval-required;
  configured-target isolation and fail-closed error semantics are preserved.

## Consequences

Changes to decision rules concentrate behind one interface and can be verified
without invoking CLI or MCP transport. Compatibility adapters remain until all
callers are migrated, but they contain projections rather than independent
policy. Adding a governed command or Context Action requires an explicit contract
and parity tests.
