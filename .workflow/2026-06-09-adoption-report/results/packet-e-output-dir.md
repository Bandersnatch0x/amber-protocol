# Packet E Result: Output Directory

Accepted:

- Added `--output-dir` for `adoption report`.
- Generated filenames include the target slug and timestamp.
- Multiple reports in the same output directory do not overwrite each other.
- `--output` and `--output-dir` together are rejected.

StockAgents smoke:

- `adoption report --output-dir <temp>` generated a timestamped report.
- StockAgents root Harness files remained absent.

Verification:

- `node --test tests/harness-cli.test.js`: 13 passed, 0 failed.

