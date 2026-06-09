# Packet B: Implementation

## Task

Implement `adoption selected-files`.

## Requirements

- Accept `--bundle-dir`, `--output`, and repeatable `--include`.
- Refuse missing inputs and existing output.
- Validate included paths against known Harness template files.
- Generate markdown proposal and JSON payload.

## Boundary

The command is a proposal generator only. It must not write target files.

