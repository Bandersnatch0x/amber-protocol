# Packet A Result: Tests

Accepted:

- CLI tests cover `adoption report --output-dir`.
- Tests verify non-conflicting report paths for repeated runs.
- Tests verify `--output` and `--output-dir` cannot be used together.

Verification:

- `node --test tests/harness-cli.test.js`: passed 13 tests.

