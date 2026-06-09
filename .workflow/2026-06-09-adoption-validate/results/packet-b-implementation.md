# Packet B - Implementation

Status: completed.

Implemented:

- `adoption validate --reports-dir <dir>`.
- Optional `--index <file>` validation for local markdown links.
- Strict validation errors for invalid markdown files inside the reports directory.
- Human-readable validation output with `Valid`, `Index checked`, and report count.

Safety boundaries:

- The command is read-only.
- It does not write reports or indexes.
- It does not inspect or execute target projects.

Evidence:

- `node --test tests/harness-cli.test.js` returned status `0` after implementation.
