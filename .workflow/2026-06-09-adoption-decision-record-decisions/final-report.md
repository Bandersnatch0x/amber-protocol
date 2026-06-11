# Adoption Decision-Record Decisions Final Report

Status: completed.

## Outcome

Extended `adoption decision-record` with repeatable `--decision` flags for recording Gate A/B/C statuses and notes.

## Syntax

```sh
node scripts/harness.js adoption decision-record --bundle-dir <bundle-dir> --output <record.md> --decision <gate>=<status>[:note]
```

Supported gates:

- `command-confirmation`
- `bootstrap-write`
- `wiki-scope`

Supported statuses:

- `pending`
- `approved`
- `rejected`
- `deferred`

## Changed Surface

- `scripts/lib/harness-core.js`
- `tests/harness-cli.test.js`
- `README.md`
- `docs/examples/README.md`
- `docs/examples/sample-adoption-decision-record-decisions.md`

## sample Smoke

Generated:

- `docs/examples/sample-adoption-decision-record-decisions.md`

Result:

- target: `D:\code_space\trae-project\sample`
- approval status: `recorded`
- Gate A: `deferred`
- Gate B: `deferred`
- Gate C: `deferred`
- errors: 0

## Verification

- `node --test tests/harness-cli.test.js`: pass, 30 tests
- `npm test`: pass, 85 tests
- `npm run manifests`: pass, errors 0
- `verify_workflow.py .workflow/2026-06-09-adoption-decision-record-decisions`: pass

## V1 Boundary

- Dynamic Workflow execution: not implemented
- Live subagent orchestration: not used
- sample writes: not used
- sample command execution: not used
- Automatic overwrite: not used
