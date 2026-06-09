# Packet A - RED Tests

Add behavior-first CLI tests for:

- `adoption validate --reports-dir <dir> --json` succeeds on valid generated reports and does not write files.
- `adoption validate --reports-dir <dir> --index <file> --json` fails when the index links to a missing report.

Verify the tests fail for the expected missing command behavior before implementation.
