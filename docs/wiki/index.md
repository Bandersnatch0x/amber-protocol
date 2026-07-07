# Amber Wiki

Last Reviewed: 2026-06-29

This wiki index anchors the repository-local project notes that are kept under
`docs/wiki/`. The pages here are product and historical reference material; they
do not execute workflows or mutate repository state.

## Pages

- [Amber agent operating manual](AMBER_AGENT_OPERATING_MANUAL.md) - distilled
  agent operating rules for governed, evidence-backed Amber work.
- [Phase B Alpha task list](PHASE_B_ALPHA_TASKS.md) - historical task list
  predating the Amber Protocol rename; command and file names reflect that era.
- [Schema specification](SCHEMA_SPEC.md) - route, session, and timeline schema
  design notes for the Phase B contract.

## Maintenance

- Run `node scripts/validate-wiki.js --target .` to check local wiki structure
  and links.
- Run `node scripts/amber.js maintenance inspect --target . --json` to surface
  stale docs and wiki lint findings.
