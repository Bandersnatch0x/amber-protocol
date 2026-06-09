# Adoption Report Final Report

Status: complete.

## Accepted

- Added `adoption report --target <repo> --output <file>`.
- Added `adoption report --target <repo> --output-dir <dir>` for timestamped non-conflicting report names.
- The report aggregates audit summary, init dry-run, team distribution status/update preview, and maintenance inspection.
- Report generation does not initialize the target project, install team metadata, run target commands, or overwrite existing report files.
- Generated a real StockAgents report at `docs/examples/stockagents-adoption-report.md`.

## Rejected

- No automatic `init`.
- No automatic `team install`.
- No target test/build execution.
- No overwrite when `--output` points to an existing file; `--output-dir` chooses a fresh filename.

## Verification

- `node --test tests/harness-cli.test.js`: 13 passed.
- `npm test`: 64 passed.
- `npm run manifests`: passed with 0 errors.
- `verify_workflow.py .workflow\2026-06-09-adoption-report`: passed.
