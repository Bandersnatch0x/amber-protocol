# Adoption Decision-Record Decisions Plan

Status: active

## Goal

Extend `adoption decision-record` so it can record explicit Gate A/B/C decisions while staying a read-only audit artifact generator.

Proposed syntax:

```sh
node scripts/harness.js adoption decision-record --bundle-dir <bundle> --output <file> --decision command-confirmation=approved --decision bootstrap-write=deferred:Need owner review
```

## Success Criteria

- `--decision <gate>=<status>[:note]` is accepted.
- Supported gates are:
  - `command-confirmation`
  - `bootstrap-write`
  - `wiki-scope`
- Supported statuses are:
  - `pending`
  - `approved`
  - `rejected`
  - `deferred`
- Unknown gates or statuses return errors and do not write output.
- Markdown and JSON include recorded statuses and notes.
- The record still does not approve or execute target project writes by itself.
- StockAgents example is generated under `docs/examples/`.

## V1 Boundary

- No Dynamic Workflow execution.
- No live subagent orchestration.
- No target project writes.
- No target project command execution.
- No automatic overwrite.

