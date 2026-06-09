# Packet B: Implementation

## Task

Implement `adoption decision-record`.

## Requirements

- Accept `--bundle-dir` and `--output`.
- Refuse missing inputs and existing output.
- Read bundle `manifest.json`.
- Optionally read `gate.md` for findings.
- Write a pending decision record.
- Export helper and route through `scripts/harness.js`.

## Boundary

Read bundle artifacts only. Do not write to or execute commands in a target project.

