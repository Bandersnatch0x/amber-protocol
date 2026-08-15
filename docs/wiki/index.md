# Amber Wiki

Last Reviewed: 2026-08-15

This wiki index anchors the repository-local project notes that are kept under
`docs/wiki/`. The pages here are product and historical reference material; they
do not execute workflows or mutate repository state.

## Pages

- [Amber agent operating manual](AMBER_AGENT_OPERATING_MANUAL.md) - distilled
  agent operating rules for governed, evidence-backed Amber work.
- [Learning owner routing](learning-owner-routing.md) - canonical durable owner
  taxonomy, selection rule, compatibility behavior, and execution boundaries.
- [Phase B Alpha task list](PHASE_B_ALPHA_TASKS.md) - historical task list
  predating the Amber Protocol rename; command and file names reflect that era.
- [Schema specification](SCHEMA_SPEC.md) - route, session, and timeline schema
  design notes for the Phase B contract.
- [Amber Ontology MCP protocol design](amber-ontology-mcp.md) - implemented
  design for exposing Amber's governance surface as typed Action Types over a
  stdio MCP server (`scripts/amber-mcp.js`), governed by the
  `schemas/action.type.schema.json` contract and the F018 repository-isolation
  and fail-closed invariants.
- [Context threat model](../architecture/context-threat-model.md) - trust boundaries,
  controls, residual risks, and report-only retention rules for Context artifacts.

## Maintenance

- Run `node scripts/validate-wiki.js --target .` to check local wiki structure
  and links.
- Run `node scripts/amber.js maintenance inspect --target . --json` to surface
  stale docs and wiki lint findings.

## Knowledge Plan & Structured Knowledge Base

This repository supports a declarative Knowledge Plan capability.

- Plan file: `docs/wiki/knowledge-plan.json` (or `.yaml`). Supports common external plan file formats for interoperability.
- `amber wiki knowledge build` materializes structured knowledge pages under
  `docs/wiki/knowledge/`.
- Commands:
  - `node scripts/amber.js wiki knowledge plan --target .`
  - `node scripts/amber.js wiki knowledge build --target .`
  - `node scripts/amber.js wiki knowledge report --target .`

The plan's notes and documents are treated as the source of truth for high-signal
architecture understanding.
