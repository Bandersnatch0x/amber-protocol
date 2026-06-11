# Adoption Report Output Directory Final Report

Status: complete.

## Accepted

- `adoption report --output-dir <dir>` generates timestamped report files.
- Repeated runs produce distinct files and do not overwrite earlier reports.
- `--output` and `--output-dir` are mutually exclusive.
- sample smoke generated two distinct reports under `docs/examples/adoptions/`.

## Boundary

- No target root files were initialized.
- No target project commands were executed.
- Existing explicit output files still use no-overwrite behavior.

## Verification

- `node --test tests/harness-cli.test.js`: 13 passed.
- `npm test`: 66 passed.
- `npm run manifests`: passed with 0 errors.
- `verify_workflow.py .workflow\2026-06-09-adoption-output-dir`: passed.
