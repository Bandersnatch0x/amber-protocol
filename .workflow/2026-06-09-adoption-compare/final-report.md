# Adoption Compare Final Report

Status: completed.

## Summary

Implemented adoption report comparison.

- `adoption compare --reports-dir <dir>` auto-selects the latest two reports.
- `adoption compare --base <file> --head <file>` compares explicit reports.
- `--output <file>` writes a markdown diff only when the path does not already exist.
- Comparison reports metric deltas, candidate command changes, unknown changes, generated order, and target equality.

## Safety Boundary

- No target project files were modified.
- No target project commands were executed.
- No dynamic workflow or live subagent execution was added.
- The command does not repair, rewrite, or overwrite adoption artifacts automatically.

## Verification

- Docs example command: status `0`, `Same target: true`.
- `npm test`: status `0`, 73 passing checks.
- `npm run manifests`: status `0`, `Errors: 0`.
- Workflow artifact verification: status `0`.
