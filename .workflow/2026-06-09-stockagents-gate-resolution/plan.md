# StockAgents Gate Resolution Plan

Status: active

## Goal

Turn the StockAgents adoption `wait` decision into a reviewable, human-approvable next-actions document without modifying StockAgents.

## Inputs

- `docs/examples/stockagents-adoption-bundle/gate.md`
- `docs/examples/stockagents-adoption-bundle/status.md`
- `docs/examples/stockagents-adoption-bundle/manifest.json`
- Latest adoption report referenced by the bundle manifest
- `init --dry-run --json` preview for missing Harness files

## Success Criteria

- Findings are classified into missing Harness files, unconfirmed candidate commands, unresolved unknowns, and conflict state.
- Required and optional bootstrap file candidates are separated.
- A next-actions document exists at `docs/examples/stockagents-adoption-next-actions.md`.
- The document clearly states that the target project was not modified and no target commands were executed.
- Simulated subagent results include implementer, spec review, and quality review notes.
- Workflow artifact verification passes.

## V1 Boundary

- No Dynamic Workflow execution.
- No live subagent orchestration.
- No StockAgents file writes.
- No StockAgents command execution.
- No automatic overwrite.

