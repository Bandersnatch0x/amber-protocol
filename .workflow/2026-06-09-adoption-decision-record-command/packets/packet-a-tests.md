# Packet A: RED Tests

## Task

Add a failing CLI test for `adoption decision-record`.

## Requirements

- Build a minimal adoption bundle fixture.
- Run `adoption decision-record --bundle-dir <bundle> --output <file> --json`.
- Assert JSON includes kind, target, output path, gate decision, decisions, boundaries, and approval status.
- Assert markdown includes Gate A/B/C and pending decisions.
- Assert overwrite refusal.

## Boundary

Temporary fixtures only. No target project writes.

