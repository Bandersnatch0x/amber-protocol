# sample Gate Resolution Plan

Status: active

## Goal

Turn the sample adoption `wait` decision into a reviewable, human-approvable next-actions document without modifying sample.

## Inputs

- `docs/examples/sample-adoption-bundle/gate.md`
- `docs/examples/sample-adoption-bundle/status.md`
- `docs/examples/sample-adoption-bundle/manifest.json`
- Latest adoption report referenced by the bundle manifest
- `init --dry-run --json` preview for missing Harness files

## Success Criteria

- Findings are classified into missing Harness files, unconfirmed candidate commands, unresolved unknowns, and conflict state.
- Required and optional bootstrap file candidates are separated.
- A next-actions document exists at `docs/examples/sample-adoption-next-actions.md`.
- The document clearly states that the target project was not modified and no target commands were executed.
- Simulated subagent results include implementer, spec review, and quality review notes.
- Workflow artifact verification passes.

## V1 Boundary

- No Dynamic Workflow execution.
- No live subagent orchestration.
- No sample file writes.
- No sample command execution.
- No automatic overwrite.

