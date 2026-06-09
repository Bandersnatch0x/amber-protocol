# Packet B: Implementation

## Task

Implement `adoption apply-plan --dry-run`.

## Requirements

- Accept `--bundle-dir`, `--output`, and `--dry-run`.
- Refuse missing inputs and existing output.
- Refuse non-dry-run invocation.
- Read bundle manifest target.
- Use dry-run scaffold preview.
- Write markdown plan and JSON payload.

## Boundary

No target project writes. No target command execution.

