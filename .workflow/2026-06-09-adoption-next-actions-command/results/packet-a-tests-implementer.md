# Packet A Tests Result

Status: DONE

## RED Test

Added CLI test:

- `adoption next-actions writes a gate checklist from a bundle and refuses overwrite`

The test creates a local temporary adoption bundle fixture, runs:

```sh
node scripts/harness.js adoption next-actions --bundle-dir <bundle> --output <file> --json
```

and asserts:

- JSON kind is `adoption-next-actions`
- target and output path are reported
- gate decision is `wait`
- approval gates are `command-confirmation`, `bootstrap-write`, and `wiki-scope`
- V1 boundaries remain false for target file copy and target command execution
- markdown includes required files, candidate command, and human approval gates
- second write to the same output path is rejected

## RED Evidence

Before implementation, the test failed because `adoption next-actions` was not routed.

