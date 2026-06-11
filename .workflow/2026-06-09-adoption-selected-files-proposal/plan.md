# Adoption Selected-Files Proposal Plan

Status: active

## Goal

Add a V1-safe command that turns an adoption bundle into a reviewable selected-files proposal:

```sh
node scripts/harness.js adoption selected-files --bundle-dir <bundle> --output <file> --include AGENTS.md
```

## Success Criteria

- Command reads adoption bundle metadata.
- Command writes an explicit unused `--output` markdown proposal.
- Command refuses overwrite.
- Proposal separates required Harness files from optional starter wiki files.
- Repeatable `--include <relative-path>` records selected files.
- Unknown included files return errors and do not write output.
- JSON output is machine-readable.
- sample smoke writes only under `docs/examples/`.

## V1 Boundary

- No Dynamic Workflow execution.
- No live subagent orchestration.
- No target project writes.
- No target project command execution.
- No automatic overwrite.

