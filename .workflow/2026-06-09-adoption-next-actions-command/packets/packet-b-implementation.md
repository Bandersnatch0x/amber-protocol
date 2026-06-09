# Packet B: Implementation

## Task

Implement `adoption next-actions` in core and CLI.

## Requirements

- Use `--bundle-dir` and `--output`.
- Refuse missing inputs and existing output.
- Parse bundle manifest/gate/status/latest report.
- Generate a conservative markdown checklist.
- Export and route the helper through `scripts/harness.js`.
- Add human-readable CLI printing.

## Boundary

Read target path metadata only from artifacts. Do not write to or execute commands in the target project.

