# Packet A - RED Tests

Status: completed.

Added behavior tests for:

- `adoption validate --reports-dir <dir> --json` succeeds on valid adoption report metadata and does not write an index.
- `adoption validate --reports-dir <dir> --index <file> --json` fails when an index links to a missing report.

Evidence:

- `node --test tests/harness-cli.test.js` returned status `1`.
- The expected failing tests were the two `adoption validate` tests.
