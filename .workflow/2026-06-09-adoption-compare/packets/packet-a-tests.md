# Packet A - RED Tests

Add behavior-first CLI tests for:

- `adoption compare --reports-dir <dir> --json` auto-selecting the latest two reports and reporting metric deltas.
- `adoption compare --base <file> --head <file> --output <file> --json` writing markdown diff output and refusing overwrite.

Verify the tests fail for the expected missing command behavior before implementation.
