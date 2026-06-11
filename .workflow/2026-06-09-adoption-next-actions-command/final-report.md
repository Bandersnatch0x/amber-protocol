# Adoption Next-Actions Command Final Report

Status: completed.

## Outcome

Implemented `adoption next-actions` as a V1-safe CLI command that turns an adoption bundle into a human approval checklist.

## Changed Surface

- `scripts/lib/harness-core.js`
- `scripts/harness.js`
- `tests/harness-cli.test.js`
- `README.md`
- `docs/examples/README.md`
- `docs/examples/sample-adoption-next-actions-cli.md`

## Command

```sh
node scripts/harness.js adoption next-actions --bundle-dir <bundle-dir> --output <next-actions.md>
```

## Behavior

- Reads an adoption bundle directory.
- Requires explicit `--output`.
- Refuses to overwrite existing output.
- Emits JSON and markdown checklist output.
- Includes gate findings, required Harness files, optional wiki starter files, candidate command questions, unknowns, and approval gates.

## sample Smoke

Generated:

- `docs/examples/sample-adoption-next-actions-cli.md`

Result:

- target: `D:\code_space\trae-project\sample`
- gate decision: `wait`
- errors: 0
- candidate commands: 1
- unknowns: 3
- approval gates: 3

## Verification

- `node --test tests/harness-cli.test.js`: pass, 27 tests
- `npm test`: pass, 82 tests
- `npm run manifests`: pass, errors 0
- `verify_workflow.py .workflow/2026-06-09-adoption-next-actions-command`: pass

## V1 Boundary

- Dynamic Workflow execution: not implemented
- Live subagent orchestration: not used
- sample writes: not used
- sample command execution: not used
- Automatic overwrite: not used
