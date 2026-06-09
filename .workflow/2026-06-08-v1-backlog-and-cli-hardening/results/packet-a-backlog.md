# Packet A Result: V1 Backlog And Boundary Review

## P0

- Make `wiki` match the V1 command promise: `wiki` should create or validate the repository Wiki. Current unified CLI only validates.
- Add local manifest validation for `.codex-plugin` and `.claude-plugin` structures.
- Bring `audit` output fully up to the safety contract: categories for will add, suggested modifications, will not touch, conflicts, unknowns, and next safe command.

## P1

- Add explicit unknown / needs-confirmation markers to generated Wiki pages.
- Expand safety edge tests: dry-run, manifest validation, partial Wiki scaffold, CLI JSON output, and no-overwrite across templates.
- Clarify required vs optional scaffolded files.

## P2

- Polish command-specific CLI help and optional package `bin`.
- Improve command detection conservatively with lockfile/package-manager context.

## Overclaim Flags

- `wiki` says create or validate, but currently only validates.
- Manifest validation is listed as V1 acceptance but is not implemented.
- Manifest validation appears both as V1 acceptance and V1.5 roadmap hardening.
- `audit` safety output shape is stronger than current implementation.

## Suggested Next Slice

Implement `wiki` creation plus tests first.
