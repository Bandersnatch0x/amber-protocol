# Adoption Validate Final Report

Status: completed.

## Summary

Implemented read-only validation for generated adoption report artifacts.

- `adoption validate --reports-dir <dir>` checks report metadata.
- `adoption validate --reports-dir <dir> --index <file>` also checks local markdown links in the index.
- Invalid markdown files in a reports directory fail validation.
- Broken index links fail validation.

## Safety Boundary

- No target project files were modified.
- No target project commands were executed.
- No dynamic workflow or live subagent execution was added.
- The command reports issues only; it does not repair or overwrite files.

## Verification

- Docs example command: status `0`, `Valid: true`, `Reports: 2`.
- `npm test`: status `0`, 71 passing checks.
- `npm run manifests`: status `0`, `Errors: 0`.
- Workflow artifact verification: status `0`.
