# PR: Adoption Review Chain

## Summary

Adds a V1-safe adoption review chain for existing projects. The new adoption commands create review artifacts, gate records, dry-run plans, and selected-file proposals without writing target project files or running target project commands.

## Changes

- Add adoption review commands:
  - `adoption next-actions`
  - `adoption decision-record`
  - `adoption apply-plan --dry-run`
  - `adoption selected-files`
- Extend adoption CLI help and README coverage.
- Add tests for overwrite refusal, decision parsing, dry-run enforcement, selected-file validation, and unsafe include paths.
- Add sample review artifacts under `docs/examples/`.
- Record simulated workflow packet/spec/quality review evidence under `.workflow/`.
- Document future live loop scheduling readiness as a future-only track.

## V1 Boundary

- No Dynamic Workflow execution.
- No live subagent orchestration.
- No target project writes.
- No target project command execution.
- No automatic overwrite.
- sample was used as a read-only validation target only.

## Verification

- `node --test tests/harness-cli.test.js`: passed, 35 tests.
- `npm test`: passed, 90 tests.
- `npm run manifests`: passed, `Errors: 0`.
- Workflow artifact verification passed for all staged workflow evidence.
- sample boundary check passed: selected Harness files remain absent from `D:\code_space\trae-project\sample`.

## Commit Structure

- `8c4fae7` Add V1-safe adoption review commands
- `a3c8cb7` Add sample adoption review artifacts
- `dc8479f` Record adoption workflow evidence
- `a652747` Document future live loop readiness boundary

## Review Notes

- The workflow evidence commit is intentionally large because it records packet results for multiple simulated workflows.
- If repository policy does not keep `.workflow/` run evidence, that commit can be reviewed or handled separately.
- `apply-plan` is intentionally dry-run only in V1.
- `selected-files` only accepts safe relative known Harness file paths.

