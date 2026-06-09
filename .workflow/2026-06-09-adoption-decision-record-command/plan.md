# Adoption Decision-Record Command Plan

Status: active

## Goal

Add a V1-safe CLI command that records adoption approval gates as an auditable markdown artifact:

```sh
node scripts/harness.js adoption decision-record --bundle-dir <bundle> --output <file>
```

## Success Criteria

- Command reads adoption bundle metadata and optional next-actions context.
- Command writes a decision record to an explicit unused `--output` path.
- Command refuses to overwrite existing output.
- Default decisions are `pending`, not approved.
- Record includes Gate A/B/C, evidence sources, V1 boundaries, and next safe action.
- JSON output is machine-readable.
- StockAgents smoke writes only under `docs/examples/`.

## V1 Boundary

- No Dynamic Workflow execution.
- No live subagent orchestration.
- No target project writes.
- No target project command execution.
- No automatic overwrite.

