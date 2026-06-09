# Adoption Apply-Plan Dry-Run Plan

Status: active

## Goal

Add a V1-safe dry-run command that converts an adoption bundle into a reviewable apply plan:

```sh
node scripts/harness.js adoption apply-plan --bundle-dir <bundle> --output <file> --dry-run
```

## Success Criteria

- Command requires `--dry-run`.
- Command reads adoption bundle metadata.
- Command writes an explicit unused `--output` markdown plan.
- Command refuses overwrite.
- Command previews target bootstrap file creation using dry-run only.
- JSON output is machine-readable.
- StockAgents smoke writes only under `docs/examples/`.

## V1 Boundary

- No Dynamic Workflow execution.
- No live subagent orchestration.
- No target project writes.
- No target project command execution.
- No automatic overwrite.

