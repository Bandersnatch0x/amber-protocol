# Packet A: RED Tests

## Task

Add failing CLI tests for `adoption apply-plan --dry-run`.

## Requirements

- Creates a markdown apply plan from a bundle fixture.
- Reports dry-run mode and no target writes.
- Includes created/skipped preview files.
- Refuses to overwrite output.
- Rejects missing `--dry-run`.

## Boundary

Temporary fixtures only. No real target project writes.

