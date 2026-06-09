# Packet A Tests Result

Status: DONE

## RED Tests

Added tests for:

- `adoption apply-plan --dry-run` writes a markdown preview and refuses overwrite.
- `adoption apply-plan` without `--dry-run` is rejected in V1.

## RED Evidence

Before implementation:

- `apply-plan` was not routed.
- missing `--dry-run` returned the generic adoption action error rather than the V1 dry-run guard.

