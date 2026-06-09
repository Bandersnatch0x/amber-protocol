# Packet A: RED Tests

## Task

Add a failing CLI test for `adoption next-actions`.

## Requirements

- Build a minimal bundle fixture with `manifest.json`, `gate.md`, `status.md`, and a latest report.
- Run `adoption next-actions --bundle-dir <bundle> --output <file> --json`.
- Expect markdown output file creation.
- Expect JSON to include `kind`, `target`, `outputPath`, `gateDecision`, `approvalGates`, and `boundaries`.
- Verify overwrite refusal.

## Boundary

Test fixtures are local temporary directories only.

