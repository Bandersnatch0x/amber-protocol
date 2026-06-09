# Packet A - RED Tests

Status: completed.

Added CLI behavior tests for:

- `adoption list --reports-dir <dir> --json` reading report metadata in newest-first order without writing an index.
- `adoption index --reports-dir <dir> --output <file> --json` writing an explicit markdown index and refusing to overwrite it.

Evidence:

- `node --test tests/harness-cli.test.js` returned status `1`.
- The expected failing tests were `adoption list reads report metadata without writing an index` and `adoption index writes a markdown index and refuses to overwrite it`.
