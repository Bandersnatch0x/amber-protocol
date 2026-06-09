# Adoption Next-Actions Command Plan

Status: active

## Goal

Productize the StockAgents gate-resolution checklist as a V1-safe CLI command:

```sh
node scripts/harness.js adoption next-actions --bundle-dir <bundle> --output <file>
```

## Success Criteria

- Command reads an adoption bundle directory.
- Command writes a markdown next-actions checklist to an explicit unused `--output` path.
- Command refuses to overwrite existing output.
- Output includes gate findings, required Harness files, optional wiki starter files, candidate command questions, unknown-resolution questions, and human approval gates.
- JSON output is machine-readable.
- StockAgents smoke writes only under `docs/examples/`.
- No target project files are written and no target project commands are executed.

## V1 Boundary

- No Dynamic Workflow execution.
- No live subagent orchestration.
- No target project command execution.
- No target project writes.
- No automatic overwrite.

