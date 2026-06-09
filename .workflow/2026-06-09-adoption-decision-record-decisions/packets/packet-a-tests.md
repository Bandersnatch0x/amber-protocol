# Packet A: RED Tests

## Task

Add failing tests for `adoption decision-record --decision`.

## Requirements

- Valid decisions update Gate A/B/C statuses and notes in JSON and markdown.
- Multiple `--decision` flags are accepted.
- Unknown gate ids fail without writing output.
- Unknown statuses fail without writing output.

## Boundary

Temporary fixtures only. No target project writes.

