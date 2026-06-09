# Packet A - Implementer

Status: DONE.

Added RED test for:

- `adoption bundle --reports-dir <dir> --index <file> --output-dir <dir> --json`.
- Required files: `README.md`, `status.md`, `index.md`, `diff.md`, `gate.md`, `manifest.json`.
- Manifest target, latest report, gate decision, and safety boundaries.
- Existing output-dir refusal.

Evidence:

- `node --test tests/harness-cli.test.js` returned status `1`.
- The expected failing test was `adoption bundle writes a review bundle with manifest and refuses overwrite`.
