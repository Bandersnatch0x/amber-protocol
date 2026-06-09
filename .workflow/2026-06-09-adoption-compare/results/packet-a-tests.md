# Packet A - RED Tests

Status: completed.

Added behavior tests for:

- `adoption compare --reports-dir <dir> --json` auto-selecting the latest two reports and reporting metric, candidate-command, and unknown deltas.
- `adoption compare --base <file> --head <file> --output <file> --json` writing a markdown diff and refusing overwrite.

Evidence:

- `node --test tests/harness-cli.test.js` returned status `1`.
- The expected failing tests were the two `adoption compare` tests.
